// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// reactorCall . the CALL dispatch for a reactive SCRIPTED being.
//
// The scripted parallel to cognition/defaultCall.js. Where defaultCall hands
// the moment to runLlmMoment (an LLM emits a Word), reactorCall hands it to
// runReactorMoment (the able's triggers react to the completed face and emit
// a Word). Both return a CognitionResult, routed identically by the caller
// (act -> seal, see -> release, failure -> pass through).
//
// (CALL is the verb -- "summon" is the drift term being retired; a being is
// CALLED. See / do / be / call / name.)
//
// A reactive able wires this by declaring it as its call dispatch and a
// `triggers` list (see cognition/scripted/reactor.js for the trigger shape:
// { when(state) -> bool, then(state) -> a do as a WORD string }, evaluated
// once on the finished face). The able registry uses a able's own call
// function when present (defaultCall is only the fallback), so no soul-type
// switch is needed -- the able's choice of call dispatch IS its soul: llm
// beings take defaultCall, reactive script beings take reactorCall, both over
// the one rasterized face, both acting on its completion.
//
// Replies (defaultCall's replyTo) are a noted follow-up; a reactive being
// that needs to answer its caller would reuse the same maybeEmitReply path.

import log from "../../../seedStory/log.js";
import { cognitionFailure } from "../cognitionResult.js";
import { runReactorMoment } from "./reactor.js";

/**
 * @param {object} opts
 * @param {object} opts.message  the inbox call envelope
 * @param {object} opts.ctx      the call ctx (toBeing, spaceId, signal, ...) -- IS the moment
 * @param {object} opts.able     the able spec; carries `triggers`
 * @returns {Promise<CognitionResult>}
 */
export async function reactorCall({ message, ctx, able } = {}) {
  const ableName = able?.name || ctx?.activeAble || "(reactor)";
  const triggers = Array.isArray(able?.triggers) ? able.triggers : [];
  if (triggers.length === 0) {
    log.warn(ableName, "reactor call with no triggers; the moment can only be a see");
  }
  const being = ctx?.toBeing;
  try {
    return await runReactorMoment(triggers, {
      able,
      moment: ctx,
      beingId: being?._id != null ? String(being._id) : null,
      username: being?.name || null,
      history: ctx?.actorAct?.history || ctx?.moment?.actorAct?.history || "0",
    });
  } catch (err) {
    if (ctx?.signal?.aborted) return cognitionFailure("aborted", err.message);
    log.warn(ableName, `reactorCall threw unexpectedly: ${err.message}`);
    return cognitionFailure("internal", err.message);
  }
}
