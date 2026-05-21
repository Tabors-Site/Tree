// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// defaultSummon . the generic dispatch every LLM-driven role used to
// write by hand. Roles now declare what makes them different (prompt,
// tools, permissions, reply mode) and the seed handles the rest.
//
// The pattern extracted here lived inline in extensions/governing/
// roles/rulerRole.js, plannerRole.js, contractorRole.js,
// foremanRole.js, coderRole.js, etc. Each was ~60 lines of identical
// boilerplate around runChat. This module is the single home for that
// shape so role files become declarative.
//
// What the dispatch does, in order:
//   1. Validate scope (ctx.spaceId / ctx.resolved.spaceId).
//   2. Detect reply-wake (message.inReplyTo set).
//   3. Build the LLM-facing message body (reply context wrapper on
//      reply-wakes, raw content otherwise).
//   4. Call runChat with the role spec.
//   5. Handle abort signal and LLM errors.
//   6. Emit a reply if the role declares one of the reply modes.
//   7. Return { text, summonId } for the scheduler.
//
// `text` is the terminal LLM turn — the final assistant message after
// every tool call settled. Deliverables live in substrate (state that
// tools wrote); `text` is the closing turn, not the deliverable.
//
// Reply modes (declared on the role spec via `replyTo`):
//   undefined           no reply emission; return value is the only output.
//                       (Coder, Worker, anyone whose result is consumed
//                       directly by the caller.)
//   "asker"             reply lands in the immediate sender's inbox.
//                       (Planner, Contractor, Foreman . reports up to
//                       whoever summoned them.)
//   "chain-initial"     on reply-wakes only, reply lands at the chain-
//                       opening asker (user-being or parent Ruler).
//                       (Ruler . synthesis back to whoever opened this
//                       turn.)
//
// See [[project_card_is_a_summon]], [[project_role_subsumes_mode]], and
// [[project_four_verbs_one_execution]].

import log from "../system/log.js";
import { runChat } from "./runChat.js";
import {
  emitReplyToAsker,
  emitReplyToStance,
  findChainInitialCaller,
} from "./replyEmission.js";

/**
 * The generic summon implementation. The role registry wires this
 * automatically when a role declares no custom `summon` function (see
 * seed/cognition/roles/registry.js#makeLazyDefaultSummon). Roles needing
 * custom dispatch attach their own `summon` and the registry skips
 * the wrap.
 *
 * @param {object} opts
 * @param {object} opts.message . the inbox SUMMON envelope
 * @param {object} opts.ctx . the summon ctx (toBeing, spaceId, signal, ...)
 * @param {object} opts.role . the role spec
 * @returns {Promise<{ text, summonId } | null>}
 */
export async function defaultSummon({ message, ctx, role }) {
  const startMs = Date.now();
  const scopeNodeId = ctx.spaceId || ctx.resolved?.spaceId;
  const roleName = role?.name || ctx.activeRole || "(unknown role)";
  const logTag = capitalize(roleName);

  if (!scopeNodeId) {
    log.warn(logTag, "summon without scopeNodeId; returning empty");
    return { text: "Internal error: no scope." };
  }

  const isReply = !!message.inReplyTo;
  const senderHint = message.from || "(unknown sender)";
  log.info(
    logTag,
    `summons at ${String(scopeNodeId).slice(0, 8)} ` +
      `(role=${ctx.activeRole || roleName}, ` +
      `${isReply ? `reply from ${senderHint}` : `from ${senderHint}`}, ` +
      `correlation=${message.correlation?.slice(0, 8) || "?"})`,
  );

  // Reply-context shape. Most roles want the default "[wakeup] X
  // replied:" prefix, but a role can declare its own
  // `buildReplyContext(message)` to phrase the wakeup differently
  // (Ruler: "X advanced state to Y; consider Z." Foreman: judgment-
  // framed. etc). Default falls back to buildReplyContextMessage.
  const messageBody = isReply
    ? typeof role?.buildReplyContext === "function"
      ? role.buildReplyContext(message)
      : buildReplyContextMessage(message)
    : String(message.content || "");

  let result;
  try {
    result = await runChat({
      being: ctx.toBeing,
      envelope: { ...message, content: messageBody },
      role,
      signal: ctx.signal,
    });
  } catch (err) {
    if (ctx.signal?.aborted) {
      log.info(logTag, `summon aborted (${err.message})`);
      return null;
    }
    log.warn(logTag, `LLM call failed: ${err.message}`);
    return { text: `${logTag} error: ${err.message}` };
  }

  const durationMs = Date.now() - startMs;
  const text = result?.text || "(no response)";
  log.info(
    logTag,
    `summons complete at ${String(scopeNodeId).slice(0, 8)} in ${durationMs}ms`,
  );

  // Reply emission. The role spec's `replyTo` selects which shape.
  // "asker" and "chain-initial" both flow through the seed reply
  // helpers; they differ only in which stance receives the reply.
  await maybeEmitReply({
    role,
    isReply,
    message,
    text,
    ctx,
    scopeNodeId,
    roleName,
    logTag,
  });

  return {
    text,
    summonId: result?.summonId || null,
  };
}

// ────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────

async function maybeEmitReply({
  role,
  isReply,
  message,
  text,
  ctx,
  scopeNodeId,
  roleName,
  logTag,
}) {
  const replyTo = role?.replyTo;
  if (!replyTo) return;

  const fromBeing = ctx.toBeing;
  const fromRoleName = ctx.toBeing?.name || roleName;

  if (replyTo === "asker") {
    await emitReplyToAsker({
      fromNodeId: scopeNodeId,
      fromBeing,
      fromRoleName,
      originalMessage: message,
      exitText: text,
    });
    return;
  }

  if (replyTo === "chain-initial") {
    // Only emit on reply-wakes. The chain-initial caller has no inbox
    // entry to walk before the first sub-being reply lands, and the
    // entry-scope return path covers the initial response.
    if (!isReply) return;

    const beingId = String(ctx.toBeing?._id || "");
    const rootCorrelation = message.rootCorrelation || message.correlation;
    const askerStance = await findChainInitialCaller(
      scopeNodeId,
      beingId,
      rootCorrelation,
    );
    if (askerStance) {
      await emitReplyToStance({
        askerStance,
        fromNodeId: scopeNodeId,
        fromBeing,
        fromRoleName,
        exitText: text,
        rootCorrelation,
      });
    } else {
      log.warn(
        logTag,
        `no chain-initial caller resolvable at ${String(scopeNodeId).slice(0, 8)} ` +
          `(root=${rootCorrelation?.slice(0, 8) || "?"}); reply dropped`,
      );
    }
    return;
  }

  log.warn(logTag, `unknown replyTo mode "${replyTo}"; reply dropped`);
}

/**
 * Build a synthesis-friendly message body for a reply-summon. The LLM
 * reads this alongside the snapshot block buildSystemPrompt added.
 * Names what just finished so the next turn frames as "continuing in-
 * progress work" rather than "answering a fresh question."
 */
export function buildReplyContextMessage(message) {
  const sender = message.from || "(sub-being)";
  const exitText =
    typeof message.content === "string"
      ? message.content
      : JSON.stringify(message.content);

  return [
    `[wakeup] ${sender} replied:`,
    "",
    exitText,
    "",
    `Read your snapshot for the current state and decide the next step.`,
  ].join("\n");
}

function capitalize(s) {
  if (!s || typeof s !== "string") return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
