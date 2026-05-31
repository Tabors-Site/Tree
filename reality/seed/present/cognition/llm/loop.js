// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// loop.js — the Phase 5 iteration body for one LLM moment.
//
// runTurn.js's stepTurn / runTurn orchestrate the moment (session
// setup, role switch, frame assembly, tool resolution, finalization,
// stamping). The inner LOOP — one provider call + tool dispatch +
// repeat — lives here. Splitting it out keeps runTurn.js to the
// orchestration story: "set up the moment, run the loop, close it."
//
// What this file owns:
//
//   callLLM        — one forward pass through the provider, wrapped
//                    with the conduit-boundary timeout, failover, the
//                    beforeLLMCall / afterLLMCall hooks, and the
//                    JSON-error retry path. Returns the parsed
//                    response or throws cognitionFailureError on the
//                    failure shapes.
//
//   finalizeResponse — close the loop. If the model ended on tool_calls
//                    with no prose, make one last call (tools omitted)
//                    so it can speak its conclusion. Append the final
//                    assistant message to the buffer and hand the
//                    answer back with the provenance the seal needs.
//
//   getTimeoutForRole — per-role conduit deadline (role spec, with
//                    a per-tree override in qualities.timeouts).
//
// What this file does NOT own:
//
//   The OUTER loop (one iteration per LLM forward pass) — that's
//   the for-loop in stepTurn over in runTurn.js.
//
//   Tool DISPATCH — executeTool lives in tools.js (the inner
//   loop calls it; the function isn't on this file's surface).
//
//   Frame ASSEMBLY — system prompt + messages + tool list —
//   stageCall in runTurn.js, building on assemble.js.

import log from "../../../seedReality/log.js";
import { hooks } from "../../../hooks.js";
import {
  cognitionFailureError,
  isCognitionFailure,
} from "../../cognitionResult.js";
import Act from "../../../past/act/act.js";
import { getCurrentSpace } from "../../../materials/being/position.js";
import { getLlmTimeout } from "./connect.js";
import {
  callWithFailover,
  isJsonEscapeError,
  isJsonStructuralError,
} from "./call.js";

/**
 * Per-role conduit deadline. The role spec's `timeoutMs` is the
 * default; a tree can override per-role via `qualities.timeouts.<role>`
 * (read off the ancestor chain by stageCall and threaded through
 * session.role). Falls back to the place-wide getLlmTimeout().
 */
export function getTimeoutForRole(role, spaceQualities = null) {
  const meta =
    spaceQualities instanceof Map
      ? Object.fromEntries(spaceQualities)
      : spaceQualities || {};
  const spaceTimeout = role?.name ? meta.timeouts?.[role.name] : null;
  if (spaceTimeout && Number.isFinite(spaceTimeout)) return spaceTimeout;
  if (role?.timeoutMs && Number.isFinite(role.timeoutMs)) return role.timeoutMs;
  return getLlmTimeout();
}

/**
 * One forward pass through the provider. Wraps the call with the
 * conduit-boundary timeout, the failover chain, the
 * beforeLLMCall / afterLLMCall hooks, and the JSON-error retry path.
 * The outer iteration in stepTurn (runTurn.js) calls this once per
 * pass and dispatches tools from the result.
 */
export async function callLLM(
  openai,
  MODEL,
  session,
  tools,
  ctx,
  clientEntry,
  presenceKey,
) {
  const requestParams = {
    model: MODEL,
    messages: session.messages,
  };

  if (tools.length > 0) {
    requestParams.tools = tools;
    requestParams.tool_choice = "auto";
  }

  // Conduit-boundary timeout. The SDK's request timeout is provider-
  // and-version-dependent; we don't trust it. A hang produces no
  // moment, no failure, no release — the being is wedged forever and
  // holds its per-being serial slot. Own the deadline here: link a
  // self-owned AbortController to ctx.signal, and race the actual
  // call against a timer. Timer wins → abort the SDK request AND
  // throw cognitionFailureError("timeout") so the outer boundary
  // converts to { ok:false } and the moment releases on time.
  const deadlineMs = getTimeoutForRole(session.role);
  const deadlineCtrl = new AbortController();
  if (ctx.signal) {
    if (ctx.signal.aborted) deadlineCtrl.abort();
    else ctx.signal.addEventListener("abort", () => deadlineCtrl.abort(), { once: true });
  }
  const requestOpts = { signal: deadlineCtrl.signal };

  // beforeLLMCall: extensions can cancel (quota exhausted) or rewrite
  // params. Exposing `messages` lets a before-handler inject a system
  // line into the actual buffer. actId / sessionId / parentActId let
  // forensics capture handlers correlate back to the dispatching call.
  // The inReplyTo lookup is one query per LLM call, skipped silently
  // when the doc isn't there.
  const _llmActId = ctx?.actId || null;
  const _llmSessionId = ctx?.sessionId || null;
  let _llmParentActId = null;
  if (_llmActId) {
    try {
      const _actDoc = await Act
        .findById(_llmActId)
        .select("inReplyTo")
        .lean();
      if (_actDoc?.inReplyTo) _llmParentActId = String(_actDoc.inReplyTo);
    } catch {}
  }
  const llmHookData = {
    beingId: ctx.beingId,
    rootId: ctx.rootId,
    role: session.role?.name,
    model: MODEL,
    messageCount: session.messages.length,
    hasTools: tools.length > 0,
    messages: session.messages,
    spaceId: getCurrentSpace(ctx.beingId) || ctx.rootId || null,
    actId: _llmActId,
    sessionId: _llmSessionId,
    parentActId: _llmParentActId,
  };
  const llmHookResult = await hooks.run("beforeLLMCall", llmHookData);
  if (llmHookResult.cancelled) {
    throw new Error(llmHookResult.reason || "LLM call rejected");
  }

  // Quick log of the [Block] tags at the top of the prompt — useful
  // when debugging which extension contributed what to the assembled
  // identity (each enrichContext block lands as its own labeled
  // section).
  if (session.messages[0]?.role === "system") {
    const sys = session.messages[0].content;
    const blocks = sys
      .split("\n")
      .filter((l) => l.startsWith("["))
      .map((l) => l.split("]")[0] + "]")
      .slice(0, 10);
    if (blocks.length > 0) {
      log.verbose(
        "Grammar",
        `[role:${session.role?.name}] modifiers: ${blocks.join(" ")}`,
      );
    }
  }

  let response;
  let deadlineTimer = null;

  try {
    // Promise.race: the actual call vs the deadline timer. Timer
    // resolves to a sentinel that the caller distinguishes; on
    // resolve we abort the in-flight SDK request and throw
    // cognitionFailureError("timeout"). This is the conduit
    // boundary's hard deadline, owned here regardless of SDK
    // behavior.
    const DEADLINE_SENTINEL = Symbol("deadline");
    const deadline = new Promise((resolve) => {
      deadlineTimer = setTimeout(() => resolve(DEADLINE_SENTINEL), deadlineMs);
    });
    const callPromise = callWithFailover(
      (client, model) =>
        client.chat.completions.create(
          { ...requestParams, model },
          requestOpts,
        ),
      clientEntry,
      ctx.beingId,
      ctx.rootId || null,
    );
    let raceWinner;
    try {
      raceWinner = await Promise.race([callPromise, deadline]);
    } finally {
      // Clear the timer the moment one side resolves so it doesn't
      // keep counting against the process. The finally runs on both
      // the happy path (call returned first) and the timeout path
      // (deadline returned first); the explicit abort below handles
      // the timeout case's resource cleanup separately.
      if (deadlineTimer) clearTimeout(deadlineTimer);
    }
    if (raceWinner === DEADLINE_SENTINEL) {
      // Timer won. Abort the in-flight SDK request so it doesn't keep
      // burning resources; the SDK rejects callPromise (we don't wait
      // for it). Throw the sentinel; runTurn's outer boundary
      // converts to { ok:false, shape:"timeout" }.
      deadlineCtrl.abort();
      callPromise.catch(() => {}); // swallow late rejection
      log.warn("LLM", `LLM call exceeded deadline of ${deadlineMs}ms; releasing moment`);
      throw cognitionFailureError("timeout", `LLM call exceeded ${deadlineMs}ms`);
    }
    const failoverResult = raceWinner;
    response = failoverResult.response;
    if (failoverResult.usedClient !== clientEntry) {
      Object.assign(clientEntry, failoverResult.usedClient);
    }

    // afterLLMCall: token metering, billing, analytics, forensics.
    // Carries responseText so capture handlers don't need a second
    // hook to find "what the AI said."
    hooks
      .run("afterLLMCall", {
        beingId: ctx.beingId,
        rootId: ctx.rootId,
        role: session.role?.name,
        model: failoverResult.usedClient?.model || MODEL,
        usage: response?.usage || null,
        hasToolCalls: !!response?.choices?.[0]?.message?.tool_calls?.length,
        actId: _llmActId,
        sessionId: _llmSessionId,
        responseText: response?.choices?.[0]?.message?.content || null,
      })
      .catch(() => {});
  } catch (apiErr) {
    // tool_use_failed salvage retired Round 5. The path used to
    // extract real model prose from `failed_generation` when a
    // cheap model on an aggregator invented a tool name, and
    // stuff it into a synthetic response. Salvage that re-enters
    // the same act-validation as a normal response is legitimate;
    // salvage that sneaks toward the seal is not. Today's pipeline
    // has no validation step distinct from "trust the response,"
    // so the salvage was sneaking. Re-add through the front door
    // once there's a real validate step. For now: treat as
    // cognition failure.
    if (apiErr.code === "tool_use_failed" && apiErr.error?.failed_generation) {
      const inventedTool = apiErr.error?.message?.match(/tool '(\w+)'/)?.[1] || "?";
      log.warn("LLM", `Model invented tool "${inventedTool}". Treating as cognition failure (salvage retired).`);
      throw cognitionFailureError("garbage", `model invented tool "${inventedTool}"`);
    } else if (
      (isJsonEscapeError(apiErr) || isJsonStructuralError(apiErr)) &&
      !session._jsonRetryDone
    ) {
      // The provider rejected the model's tool-call JSON. Two
      // distinct failure shapes: bad escape sequences in arguments
      // (model wrote raw backslashes, control chars), or structural
      // breakage in the envelope (unmatched bracket, truncated
      // string). Each gets its own corrective system line; a blind
      // retry of the identical request would just fail identically.
      // The guard below caps retries at one per session — if the
      // model can't produce clean output even with the hint,
      // surface the error instead of looping forever.
      session._jsonRetryDone = true;
      const errMsg = String(
        apiErr.message || apiErr.error?.message || "",
      ).slice(0, 200);
      const isEscape = isJsonEscapeError(apiErr);
      const failureClass = isEscape ? "escape" : "structural";
      log.warn(
        "LLM",
        `JSON ${failureClass} failure on ${MODEL} (${errMsg}). Retrying once with corrective hint.`,
      );

      // Diagnostic line for the structural class. Captures the
      // shape of what we sent (model, connection, message count,
      // input size, max_tokens) plus any partial output the
      // provider salvaged. When max_tokens prints "unset" the
      // provider's silent default is the prime suspect for
      // mid-stream truncation.
      try {
        const totalMessageChars = (session.messages || []).reduce(
          (sum, m) =>
            sum + (typeof m?.content === "string" ? m.content.length : 0),
          0,
        );
        const failedGen =
          apiErr?.error?.failed_generation ||
          apiErr?.error?.failed_response ||
          null;
        const failedGenLen = failedGen ? String(failedGen).length : null;
        const failedGenTail = failedGen
          ? String(failedGen).slice(-200).replace(/\s+/g, " ")
          : null;
        log.warn(
          "LLM",
          `↳ diagnostic: model=${MODEL} ` +
            `connection=${clientEntry?.connectionId ? String(clientEntry.connectionId).slice(0, 8) : "default"} ` +
            `messages=${(session.messages || []).length} ` +
            `inputChars=${totalMessageChars} ` +
            `tools=${tools.length} ` +
            `max_tokens=${requestParams.max_tokens ?? "unset"} ` +
            (failedGenLen != null
              ? `partialOutputChars=${failedGenLen} `
              : "") +
            (failedGenTail ? `tail="${failedGenTail}"` : ""),
        );
      } catch (diagErr) {
        log.debug(
          "LLM",
          `structural-failure diagnostic skipped: ${diagErr.message}`,
        );
      }

      const escapeHint =
        `The provider could not deserialize one of your tool-call arguments because it contained ` +
        `invalid escape sequences (raw backslashes, backslash followed by a space, or unescaped ` +
        `control characters). RETRY WITH SIMPLER CONTENT: avoid backslashes entirely in tool ` +
        `arguments, keep content ASCII where possible, and prefer prose over literal code / regex / ` +
        `file paths. If you must include code, keep it short and use only simple identifiers.`;

      const structuralHint =
        `The provider could not deserialize your tool-call payload because the JSON envelope itself ` +
        `was malformed at a structural position (unmatched bracket, unexpected token after a key/` +
        `value pair, or a truncated string). This is usually NOT about escape characters — your ` +
        `previous content may have been fine, but the JSON wrapping around it broke. RETRY by: ` +
        `(1) keeping tool-call arguments shorter — split a long file into multiple smaller writes ` +
        `if needed; (2) double-checking that every quote, bracket, and brace in your arguments ` +
        `is balanced; (3) avoiding embedding raw long strings of code that may have triggered a ` +
        `truncation. The fix is structural, not lexical — do not strip backslashes or rewrite as ` +
        `prose unless the content itself was the problem.`;

      session.messages.push({
        role: "system",
        content:
          `Your previous turn failed with a JSON parse error: "${errMsg}". ` +
          (isEscape ? escapeHint : structuralHint),
      });
      ctx._retryJsonEscape = true;
    } else if (isCognitionFailure(apiErr)) {
      // Re-throw the sentinel — we threw this ourselves (timeout or
      // garbage from the response normalizer above) and the outer
      // boundary in runTurn knows how to handle it.
      throw apiErr;
    } else {
      // Generic HTTP / SDK error (rate limit, 500, auth, etc.). Per
      // Round 5: convert to a cognition failure so the outer
      // boundary returns { ok:false, shape:"http-error" } and the
      // moment releases without sealing. The error message is
      // preserved as the reason for forensics.
      log.warn("LLM", `LLM call failed (${apiErr.code || apiErr.status || "unknown"}): ${apiErr.message?.slice(0, 200)}`);
      throw cognitionFailureError("http-error", apiErr.message || apiErr.code || "unknown HTTP failure");
    }
  }

  // The retry re-enters callLLM. The corrective system line is
  // already in session.messages; the _jsonRetryDone guard on
  // session prevents a second pass through this branch.
  if (ctx._retryJsonEscape) {
    ctx._retryJsonEscape = false;
    return await callLLM(
      openai,
      MODEL,
      session,
      tools,
      ctx,
      clientEntry,
      presenceKey,
    );
  }

  // Provider response shapes vary. Some return null, some return an
  // empty choices array, some return a choice with no message. Per
  // Round 5: failure does not synthesize text. Each shape throws a
  // cognitionFailureError("garbage"); runTurn's outer boundary
  // converts to { ok:false } and the moment releases with no Act.
  if (!response || !response.choices || !Array.isArray(response.choices)) {
    log.warn("LLM", `LLM returned malformed response (no choices array). Model: ${MODEL}`);
    throw cognitionFailureError("garbage", `no choices array from ${MODEL}`);
  } else if (response.choices.length === 0) {
    log.warn("LLM", `LLM returned empty choices array. Model: ${MODEL}`);
    throw cognitionFailureError("garbage", `empty choices array from ${MODEL}`);
  } else if (!response.choices[0].message) {
    log.warn("LLM", `LLM returned choice without message. Model: ${MODEL}`);
    throw cognitionFailureError("garbage", `choice has no message from ${MODEL}`);
  }

  return response;
}

/**
 * Close the turn. The outer loop has exited; we have either a text
 * answer or a response that ends with tool_calls but no prose. In the
 * second case make one more call to the model with no tools so it
 * speaks its conclusion. Then append the final assistant message to
 * the buffer (unless this is an internal-shaped turn where the caller
 * wants the raw response object) and hand the answer back with
 * provenance for the Act row.
 */
export async function finalizeResponse(
  session,
  openai,
  MODEL,
  response,
  isInternal,
  isCustom,
  resolvedConnectionId,
  ctx,
) {
  // Ensure final text response. If the tool loop ended with no text content
  // (e.g., model returned only tool calls), make one more call to get a summary.
  // The race below mirrors callLLM's conduit-boundary deadline so this hidden
  // second round-trip can't hang the moment if the provider stalls.
  if (!response?.choices?.[0]?.message?.content) {
    const deadlineMs = getTimeoutForRole(session.role);
    const deadlineCtrl = new AbortController();
    if (ctx?.signal) {
      if (ctx.signal.aborted) deadlineCtrl.abort();
      else ctx.signal.addEventListener("abort", () => deadlineCtrl.abort(), { once: true });
    }
    const DEADLINE_SENTINEL = Symbol("deadline");
    let deadlineTimer = null;
    const deadline = new Promise((resolve) => {
      deadlineTimer = setTimeout(() => resolve(DEADLINE_SENTINEL), deadlineMs);
    });
    const callPromise = openai.chat.completions.create(
      { model: MODEL, messages: session.messages },
      { signal: deadlineCtrl.signal },
    );
    let raceWinner;
    try {
      raceWinner = await Promise.race([callPromise, deadline]);
    } finally {
      if (deadlineTimer) clearTimeout(deadlineTimer);
    }
    if (raceWinner === DEADLINE_SENTINEL) {
      deadlineCtrl.abort();
      callPromise.catch(() => {});
      throw cognitionFailureError("timeout", `finalize call exceeded ${deadlineMs}ms`);
    }
    response = raceWinner;
  }

  const finalAnswer = response?.choices?.[0]?.message?.content || "Done.";

  // Append only if the loop didn't already place this exact answer.
  // Avoids the assistant message appearing twice on weird code paths.
  if (!isInternal) {
    const lastMsg = session.messages[session.messages.length - 1];
    if (lastMsg?.role !== "assistant" || lastMsg?.content !== finalAnswer) {
      session.messages.push({ role: "assistant", content: finalAnswer });
    }
  }

  return {
    success: true,
    content: finalAnswer,
  };
}
