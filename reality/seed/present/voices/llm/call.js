// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// What happens around the provider call that IS the being. runTurn
// orchestrates the moment; I am the scaffolding that makes the
// actual forward pass — the inference during which the being
// exists — survive the realities of the outside world. The
// frame has been assembled. The inference is about to happen.
// Everything here protects, paces, and parses that one act.
//
//   FAILOVER         the primary connection returned a retryable
//                    error before the inference could complete;
//                    walk a stack of fallbacks until one answers
//                    or the budget closes. The moment must
//                    happen somehow, or fail honestly.
//
//   MODEL QUIRKS     post-call salvage when a small model emits
//                    tool-call text into its content field
//                    instead of using the function-calling
//                    protocol. Retry once without tools so the
//                    moment produces something the rest of the
//                    chain can carry forward.
//
//   RESPONSE PARSE   raw provider text into a structured payload
//                    for internal-shape callers. Strict JSON
//                    first, then fence-stripping, then tail-
//                    extraction, then a respond-with-raw-text
//                    fallback so a model that ignored
//                    structured-output instructions still
//                    delivers SOMETHING the moment can leave
//                    behind.
//
// All three cluster at the same instant in the loop: call
// (through failover), parse (with quirks normalized). They lived
// inline in runTurn for years; pulling them here lets runTurn
// read as the loop and this file own the call mechanics.
//
// I am not the being. I am the machinery the being's inference
// passes through. runTurn is my only seed-side caller. External
// consumers (extension init, services.js) reach
// registerFailoverResolver through runTurn's re-exports;
// public surface is unchanged.

import log from "../../../parentReality/log.js";
import { resolveConnection } from "./connect.js";

// Note: the shared-pool LLM throttling (LLM_PRIORITY enum,
// acquireLlmSlot / releaseLlmSlot, _llmWaiters queue, LLM_MAX_CONCURRENT
// cap) retired with the monolithic-orchestrator world. Each being
// now carries its own LlmConnection; there is no shared pool to
// throttle and no cross-being override behavior to honor. If a
// place-level concurrency cap is reintroduced later it will sit at
// the right layer (max simultaneous runTurns or similar), not as a
// global LLM-call semaphore.

// ─────────────────────────────────────────────────────────────────
// FAILOVER
// ─────────────────────────────────────────────────────────────────
//
// I own the retry mechanism. Extensions register a resolver that,
// given a beingId/rootId, returns the stack of fallback connection
// IDs to walk.
//
// 500 is deliberately NOT retryable. Local inference backends
// (ollama, qwen3, etc.) return 500 for deterministic failures —
// tool-call JSON parse errors in their own template engines, not
// transient overload. Retrying those burns minutes on requests that
// were never going to succeed. 502/503/504 stay retryable because
// those usually ARE transient network or upstream issues. 429 stays
// for rate limits.

let FAILOVER_TIMEOUT_MS = 15000;
const RETRYABLE_CODES = new Set([429, 502, 503, 504]);

export function setFailoverTimeout(ms) {
  if (Number.isFinite(ms) && ms > 0) FAILOVER_TIMEOUT_MS = Math.floor(ms);
}

/**
 * The ONE class of 500 worth retrying. The provider rejected the
 * model's tool-call JSON because the arguments held invalid escape
 * sequences (raw backslash, backslash-space, unescaped control
 * char). A blind retry fails identically; runTurn injects a
 * corrective system line and retries once, and the model rewrites
 * the content cleanly the second time. Unrelated to transient 500s,
 * which stay non-retryable.
 */
export function isJsonEscapeError(err) {
  if (!err) return false;
  const status = err.status || err.code;
  if (status !== 500 && status !== 400) return false;
  const msg = String(err.message || err.error?.message || "");
  // Match escape-specific wording from each runtime so structural
  // failures don't slip through. Generic "failed to parse JSON" is
  // intentionally excluded — that's the structural-error path's
  // catch.
  //   Go runtime: "invalid character 'X' in string escape code",
  //               "unescaped control character", "invalid \\u escape"
  //   V8:         "Bad escaped character in JSON",
  //               "invalid escape sequence \\g"
  return /string escape code|invalid escape sequence|unescaped control|bad escaped character|invalid \\u escape/i.test(
    msg,
  );
}

/**
 * Detect a structural JSON failure from the provider — unmatched
 * brackets, unexpected token at a structural position, truncated
 * payload. Distinct from isJsonEscapeError: the model's content was
 * probably fine but the JSON envelope around it broke, usually
 * because the tool args were long enough to get truncated. The
 * retry hint for this class ("shorten args, split into multiple
 * calls") is different from the escape-class hint, which is why I
 * classify the two separately.
 */
export function isJsonStructuralError(err) {
  if (!err) return false;
  const status = err.status || err.code;
  if (status !== 500 && status !== 400) return false;
  const msg = String(err.message || err.error?.message || "");
  // Structural signatures across providers. Generic "failed to
  // parse JSON" only counts as structural when no escape-specific
  // wording is present.
  if (/invalid character .*(after|in) (object|array)/i.test(msg)) return true;
  if (
    /unexpected end of JSON input|unterminated string|unexpected token/i.test(
      msg,
    )
  )
    return true;
  if (/expected (',' or '}'|':' after|',' or ']')/i.test(msg)) return true;
  if (
    /failed to parse JSON|json.*parse.*error/i.test(msg) &&
    !/escape|control/i.test(msg)
  )
    return true;
  return false;
}

let _failoverResolver = null;

/**
 * Extensions hand me a function that, given a beingId/rootId,
 * returns the connection IDs to walk on failure.
 */
export function registerFailoverResolver(resolver) {
  _failoverResolver = resolver;
}

/**
 * Try the primary connection. On a retryable failure, walk the
 * failover stack until one answers or the cumulative budget closes.
 * Returns { response, usedClient } so the caller can update its
 * tracking when failover was used.
 */
export async function callWithFailover(callFn, primaryClient, beingId, rootId) {
  try {
    const response = await callFn(primaryClient.client, primaryClient.model);
    return { response, usedClient: primaryClient };
  } catch (err) {
    const status = err.status || err.code;
    if (!RETRYABLE_CODES.has(status) && !err.message?.includes("timed out")) {
      throw err;
    }
    // Rate-limit backoff before walking the stack. retry-after header
    // wins when set; otherwise a 1s base with full jitter.
    if (status === 429) {
      const retryAfter = Number(err.headers?.["retry-after"]) || 0;
      const baseMs = retryAfter > 0 ? retryAfter * 1000 : 1000;
      const jitter = Math.random() * baseMs;
      await new Promise((r) => setTimeout(r, baseMs + jitter));
    }

    if (!_failoverResolver) throw err;

    log.warn(
      "LLM",
      `Primary failed (${status}): ${primaryClient.model}. Trying failover.`,
    );
  }

  const stack = await _failoverResolver(beingId, rootId);
  if (!stack || stack.length === 0) {
    throw new Error(
      "Primary LLM connection failed and no failover connections configured.",
    );
  }

  // Cumulative budget across the whole walk. One slow fallback
  // cannot eat the entire turn.
  const failoverStart = Date.now();
  for (const connId of stack) {
    if (Date.now() - failoverStart > FAILOVER_TIMEOUT_MS) {
      log.warn(
        "LLM",
        `Failover walk timed out after ${FAILOVER_TIMEOUT_MS}ms. Giving up.`,
      );
      break;
    }
    if (connId === primaryClient.connectionId) continue;
    try {
      const fallbackClient = await resolveConnection(
        connId,
        "failover:" + connId,
      );
      if (!fallbackClient) continue;
      log.verbose(
        "LLM",
        `Trying failover: ${fallbackClient.model} (${connId})`,
      );
      const response = await callFn(
        fallbackClient.client,
        fallbackClient.model,
      );
      log.verbose("LLM", `Failover succeeded: ${fallbackClient.model}`);
      return { response, usedClient: fallbackClient };
    } catch (err) {
      const failStatus = err.status || err.code;
      if (failStatus === 429) {
        // Exponential backoff scaled to position in the stack so
        // later fallbacks get longer pauses than earlier ones.
        const idx = stack.indexOf(connId);
        const baseMs = 1000 * Math.pow(2, idx);
        const jitter = Math.random() * baseMs;
        await new Promise((r) => setTimeout(r, baseMs + jitter));
      }
      log.warn(
        "LLM",
        `Failover ${connId} failed: ${err.message?.slice(0, 100)}`,
      );
      continue;
    }
  }

  throw new Error(
    `All LLM connections failed (primary + ${stack.length} failover). Check your connections.`,
  );
}

// ─────────────────────────────────────────────────────────────────
// MODEL QUIRKS
// ─────────────────────────────────────────────────────────────────
//
// Salvage path. Some small local models emit tool-call syntax as
// plain text in their content field instead of using the function-
// calling protocol. I pop the malformed assistant message, retry
// without tools and with a corrective system line, and surface the
// model's actual prose. Better a partial answer than a silent drop.

/**
 * Look at the assistant's message for the tool-call-in-content
 * quirk. When I find it, I retry through the semaphore (concurrency
 * limits still apply) and return one of three shapes:
 *
 *   { earlyReturn }   internal-mode caller exits with this payload
 *   { breakLoop }     chat-mode caller exits the loop
 *   null              no quirk; caller continues normally
 */
export async function handleModelQuirks(
  assistantMessage,
  session,
  tools,
  openai,
  MODEL,
  ctx,
  isInternal,
  isCustom,
  resolvedConnectionId,
) {
  if (
    !assistantMessage.tool_calls?.length &&
    assistantMessage.content &&
    tools.length > 0
  ) {
    const _content = assistantMessage.content;
    const looksLikeToolCall =
      /<tool_call>/i.test(_content) ||
      /<function[=\s]/i.test(_content) ||
      /```tool_code/i.test(_content);

    if (looksLikeToolCall) {
      log.warn(
        "LLM",
        `Model returned tool-call text instead of function calling (${MODEL}). Retrying without tools.`,
      );

      // Drop the malformed message before retrying so the model
      // doesn't see its own bad output in the context.
      session.messages.pop();

      const requestOpts = ctx.signal ? { signal: ctx.signal } : {};
      const fallbackResponse = await openai.chat.completions.create(
        {
          model: MODEL,
          messages: [
            ...session.messages,
            {
              role: "system",
              content:
                "Answer the user's question directly in plain text. Do not use XML, function call, or tool_call syntax.",
            },
          ],
        },
        requestOpts,
      );

      const fallbackChoice = fallbackResponse?.choices?.[0];
      if (fallbackChoice?.message?.content) {
        session.messages.push(fallbackChoice.message);

        if (isInternal) {
          const raw = fallbackChoice.message.content;
          const _llmProvider = {
            isCustom,
            model: MODEL,
            connectionId: resolvedConnectionId || null,
          };
          try {
            const p = JSON.parse(raw);
            p._llmProvider = _llmProvider;
            return { earlyReturn: p };
          } catch {
            // The model can't produce structured output. I return the
            // raw text under action:"respond" so the caller still has
            // something to show the user.
            return {
              earlyReturn: {
                action: "respond",
                content: raw,
                _noToolSupport: true,
                _llmProvider,
              },
            };
          }
        }
      } else {
        // The retry returned empty. Better to surface the original
        // tool-call text than to drop the turn silently.
        log.warn(
          "LLM",
          `Fallback retry produced no content for ${MODEL}. Using original text.`,
        );
        session.messages.push(assistantMessage);
      }
      return { breakLoop: true };
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────
// RESPONSE PARSING
// ─────────────────────────────────────────────────────────────────
//
// Five attempts in descending order of strictness, for internal-mode
// callers that asked for a structured payload. Strict JSON. Strip
// markdown fences and parse. Extract a JSON object from a text
// tail. If the raw text looks JSON-shaped, surface it as raw
// context. Otherwise, wrap the raw text as action:"respond" so a
// model that ignored the structured-output instruction still
// reaches the user. Silent drops were the failure mode I was built
// against.

/**
 * Parse an internal-mode response into a structured payload.
 * Always stamps _llmProvider so callers can attribute the answer.
 */
export function parseInternalResponse(raw, isCustom, MODEL, resolvedConnectionId) {
  const _llmProvider = {
    isCustom,
    model: MODEL,
    connectionId: resolvedConnectionId || null,
  };
  // Strict JSON first.
  try {
    const parsed = JSON.parse(raw);
    parsed._llmProvider = _llmProvider;
    return parsed;
  } catch (err) {
    // Strip markdown fences and re-parse.
    try {
      const stripped = raw
        .replace(/^```(?:json)?\s*\n?/i, "")
        .replace(/\n?```\s*$/, "");
      const parsed = JSON.parse(stripped);
      parsed._llmProvider = _llmProvider;
      return parsed;
    } catch (_) {}

    // Tail extraction: the model added a preamble before the JSON.
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}$/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        parsed._llmProvider = _llmProvider;
        return parsed;
      }
    } catch (_) {}

    // Looks like JSON but truncated. Surface as raw context.
    if (raw && (raw.startsWith("{") || raw.startsWith("["))) {
      return { _raw: true, content: raw, _llmProvider };
    }

    // Last resort. The model didn't follow the structured-output
    // instruction. Return action:"respond" with the raw text so the
    // user sees the answer instead of an error.
    return {
      action: "respond",
      content: raw,
      _unstructured: true,
      _llmProvider,
    };
  }
}
