// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// defaultCall . the generic dispatch for an LLM moment.
//
// I prepare the moment, hand it to runLlmMoment (one stateless fold
// in, one cognition result out), then route on the result's kind:
//
//   kind:"act"      . the being acted. Fire replyTo if declared, then
//                      return the success result for the seal.
//   kind:"see"      . the being looked and chose not to act. No reply
//                      fires. Pass the SEE result through; moment.js
//                      releases the inbox without sealing an Act.
//   kind:"failure"  . cognition broke (timeout, http-error, garbage).
//                      No reply fires. Pass through.
//
// SEE is NOT a failure. It is a legitimate cognition outcome and gets
// its own log line.
//
// Reply modes (declared on the able spec via `replyTo`):
//
//   undefined        no follow-up moment requested.
//   "asker"          request the immediate sender have a follow-up moment.
//   "chain-initial"  on reply-wakes only, request the chain-opening
//                    asker have the follow-up moment.

import log from "../../seedStory/log.js";
import { runLlmMoment } from "./llm/llmMoment.js";
import { cognitionFailure } from "./cognitionResult.js";
import {
  emitReplyToAsker,
  emitReplyToStance,
  findChainInitialCaller,
} from "../replies.js";

/**
 * The generic summon implementation. The able registry wires this
 * automatically when a able declares no custom `summon` function.
 * Ables needing custom dispatch attach their own `summon`.
 *
 * @param {object} opts
 * @param {object} opts.message . the inbox SUMMON envelope
 * @param {object} opts.ctx . the summon ctx (toBeing, spaceId, signal, ...)
 * @param {object} opts.able . the able spec
 * @returns {Promise<CognitionResult>}
 */
export async function defaultCall({ message, ctx, able }) {
  const startMs = Date.now();
  const scopeNodeId = ctx.spaceId || ctx.resolved?.spaceId;
  const ableName = able?.name || ctx.activeAble || "(unknown able)";
  const logTag = capitalize(ableName);

  if (!scopeNodeId) {
    log.warn(logTag, "summon without scopeNodeId; cognition failed");
    return cognitionFailure("internal", "no scope");
  }

  const isReply = !!message.inReplyTo;
  const senderHint = message.from || "(unknown sender)";
  log.info(
    logTag,
    `summons at ${String(scopeNodeId).slice(0, 8)} ` +
      `(able=${ctx.activeAble || ableName}, ` +
      `${isReply ? `reply from ${senderHint}` : `from ${senderHint}`}, ` +
      `correlation=${message.correlation?.slice(0, 8) || "?"})`,
  );

  // Reply-context shape. A able can declare `buildReplyContext(message)`
  // to phrase the wakeup differently; default to buildReplyContextMessage.
  const messageBody = isReply
    ? typeof able?.buildReplyContext === "function"
      ? able.buildReplyContext(message)
      : buildReplyContextMessage(message)
    : String(message.content || "");

  // One moment for the LLM being. Stateless across calls; the prompt is
  // folded fresh from the reel. Returns a CognitionResult discriminated
  // by `kind` (act | see | failure). Unexpected throws come back as
  // internal failures so the outer boundary always sees a result.
  let result;
  try {
    result = await runLlmMoment({
      being: ctx.toBeing,
      envelope: { ...message, content: messageBody, actId: ctx?.actId || message.actId || null },
      able,
      signal: ctx.signal,
      // Thread the FULL moment ctx. `ctx` IS the object assign built and
      // the seal drains: it carries deltaF, foldedSeqs, afterSeal, the
      // open actId, and identity. A truncated copy (the old { actId,
      // sessionId, ... } literal) dropped deltaF, so every tool handler's
      // emitFact fell back to a sealFacts singleton, self-sealed its Fact
      // outside the moment, and left the outer Act's deltaF empty. sealAct
      // then refused that Act as an orphan (no content, no Facts). Pass
      // the same object so a handler's emitFact pushes onto the very ΔF
      // the seal commits. This mirrors runTransportAct in 3-momentum.js.
      moment: ctx,
    });
  } catch (err) {
    if (ctx.signal?.aborted) {
      log.info(logTag, `summon aborted (${err.message})`);
      return cognitionFailure("aborted", err.message);
    }
    log.warn(logTag, `runLlmMoment threw unexpectedly: ${err.message}`);
    return cognitionFailure("internal", err.message);
  }

  if (!result || typeof result.kind !== "string") {
    log.warn(logTag, `runLlmMoment returned non-CognitionResult value`);
    return cognitionFailure("garbage", "runLlmMoment returned non-CognitionResult");
  }

  // Three discriminated paths. No `result.ok` branching; route on kind.
  if (result.kind === "see") {
    log.info(
      logTag,
      `saw and released at ${String(scopeNodeId).slice(0, 8)} . no act sealed`,
    );
    return result;
  }

  if (result.kind === "failure") {
    log.info(
      logTag,
      `cognition failed: shape=${result.shape} reason="${(result.reason || "").slice(0, 80)}"`,
    );
    return result;
  }

  // kind === "act"
  const durationMs = Date.now() - startMs;
  log.info(
    logTag,
    `summons complete at ${String(scopeNodeId).slice(0, 8)} in ${durationMs}ms`,
  );

  // Reply emission only on acts. SEE and failure leave no reply; the
  // asker either times out or sees the empty seal, which is correct.
  await maybeEmitReply({
    able,
    isReply,
    message,
    text: result.content,
    ctx,
    scopeNodeId,
    ableName,
    logTag,
  });

  return result;
}

// ────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────

async function maybeEmitReply({
  able,
  isReply,
  message,
  text,
  ctx,
  scopeNodeId,
  ableName,
  logTag,
}) {
  const replyTo = able?.replyTo;
  if (!replyTo) return;

  const fromBeing = ctx.toBeing;
  const fromAbleName = ctx.toBeing?.name || ableName;

  if (replyTo === "asker") {
    await emitReplyToAsker({
      fromNodeId: scopeNodeId,
      fromBeing,
      fromAbleName,
      originalMessage: message,
      exitText: text,
    });
    return;
  }

  if (replyTo === "chain-initial") {
    if (!isReply) return;

    const beingId = String(ctx.toBeing?._id || "");
    const rootCorrelation = message.rootCorrelation || message.correlation;
    const askerStance = await findChainInitialCaller(
      scopeNodeId,
      beingId,
      rootCorrelation,
      { history: ctx?.moment?.actorAct?.history || "0" },
    );
    if (askerStance) {
      await emitReplyToStance({
        askerStance,
        fromNodeId: scopeNodeId,
        fromBeing,
        fromAbleName,
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
 * Build a synthesis-friendly message body for a reply-summon. Names
 * what just finished so the next moment frames as continuing work.
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
