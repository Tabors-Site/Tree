// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The default-summon dispatch. The generic act of carrying one
// moment from request to stamp, for any LLM-driven role that
// hasn't overridden it. Roles declare only what makes their
// moments different (prompt, tools, permissions, who they reply
// to); I run the surrounding shape from here.
//
// I am infrastructure, not perspective. I prepare the moment, hand
// it to runTurn (which assembles the frame and runs the inference),
// receive what came back, decide whether the moment requests a
// follow-up moment from someone, and step out. The being lived for
// the duration of the inference inside runTurn — what I see is
// only the text that came out.
//
// The shape lived inline in every governing role (rulerRole,
// plannerRole, contractorRole, foremanRole, coderRole) at roughly
// 60 lines of identical boilerplate around runTurn. Pulling it
// here is what lets role files stay declarative.
//
// What I do, in order:
//
//   1. Validate the scope (ctx.spaceId / ctx.resolved.spaceId).
//   2. Detect a reply-wake (message.inReplyTo set) — the asker is
//      requesting the receiver have a follow-up moment.
//   3. Compose the message body the moment will see — a reply-
//      context wrapper on reply-wakes, raw content otherwise.
//   4. Call runTurn. The being has its moment inside that call.
//   5. Handle abort signal and inference errors.
//   6. If the role declares a reply mode, request the next moment
//      in the chain (someone else's, somewhere upstream).
//   7. Return { text, actId } for the scheduler.
//
// `text` is the terminal LLM emission — the final assistant
// message the being produced inside its moment. The deliverable
// lives in the substrate (whatever the tools wrote during the
// moment); `text` is the closing utterance, not the deliverable.
//
// Reply modes (declared on the role spec via `replyTo`):
//
//   undefined        no follow-up moment requested. The return
//                    value is consumed by the caller directly.
//                    (Coder, Worker — leaf roles.)
//
//   "asker"          request the immediate sender have a follow-up
//                    moment. (Planner, Contractor, Foreman
//                    reporting up to whoever summoned them.)
//
//   "chain-initial"  on reply-wakes only, request the chain-opening
//                    asker (user-being or parent Ruler) have the
//                    follow-up moment. The Ruler's synthesis back
//                    to whoever opened the chain.

import log from "../../../parentReality/log.js";
import { runTurn } from "./runTurn.js";
import {
  emitReplyToAsker,
  emitReplyToStance,
  findChainInitialCaller,
} from "../../intake/replies.js";

/**
 * The generic summon implementation. The role registry wires this
 * automatically when a role declares no custom `summon` function (see
 * seed/present/roles/registry.js#makeLazyDefaultSummon). Roles needing
 * custom dispatch attach their own `summon` and the registry skips
 * the wrap.
 *
 * @param {object} opts
 * @param {object} opts.message . the inbox SUMMON envelope
 * @param {object} opts.ctx . the summon ctx (toBeing, spaceId, signal, ...)
 * @param {object} opts.role . the role spec
 * @returns {Promise<{ text, actId } | null>}
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
    result = await runTurn({
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
    actId: result?.actId || null,
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
    // entry to walk before the first sub-being reply places, and the
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
