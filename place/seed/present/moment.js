// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// moment.js — one moment, start to finish.
//
// A moment is the atom (see philosophy/MOMENT.md). It has exactly
// four beats:
//
//   1. assign     — open the moment, resolve the being (assign.js)
//   2. fold       — mount the face (fold/)
//   3. momentum   — the being's act (momentum.js)
//   4. stamped    — seal; facts hit reels (stamped.js)
//
// moment.js is the conductor — it walks the four beats in order
// and routes the moment's outcome (raw verb result for transport
// acts; SUMMON-reply row for received SUMMONs) back to whoever's
// waiting. It owns no business logic of its own; each beat is its
// own file.
//
// fold runs inside assign today (assign returns the prepared
// `summonCtx` which carries the folded face). Materializing fold
// as a distinct beat is on the roadmap; the orchestrator below
// will gain a fold() call between assign and momentum then.
//
// The intake queue and per-being serial behavior live in
// intake/scheduler.js; the scheduler calls runMoment() once per
// pending intake entry and is otherwise out of the moment's
// business. The run loop that strings many moments together for
// one summon lives in run.js.

import log from "../system/log.js";
import { assign }   from "./assign.js";
import { momentum } from "./momentum.js";
import { stamp }    from "./stamped.js";
import { markIntakeRunning, markIntakeComplete } from "./intake/intake.js";
import { buildResponseEntry } from "./intake/replies.js";

/**
 * Run one moment for a being. Walks all four beats; never throws —
 * errors land in the seal as `stopped: true` + content "Error: ...".
 *
 * @param {object} opts
 * @param {string} opts.beingId        the acting being's id
 * @param {string} opts.spaceId        the intake-storing space
 * @param {object} opts.entry          the intake entry (kind, correlation, ...)
 * @param {number} opts.index          the entry's array index (for intake state)
 * @param {object} [opts.handoff]      runtime context stashed at SUMMON-time
 * @param {AbortController} opts.controller  the abort signal that propagates into the act
 * @returns {Promise<{ actId: string|null, result: any, responseEntry: object|null }>}
 */
export async function runMoment({ beingId, spaceId, entry, index, handoff = null, controller } = {}) {
  if (!controller) throw new Error("runMoment requires an AbortController");

  const isTransportAct = entry.kind === "transport-act";

  await markIntakeRunning(spaceId, beingId, index);

  let actId = null;
  let rawResult = null;
  let responseEntry = null;
  let sealContent = null;
  let sealError = null;

  try {
    // ── Beat 1: assign opens the moment, resolves the being. ─────
    // fold rides inside assign for now (the prepared summonCtx
    // carries the folded face).
    const setup = await assign({
      beingId,
      spaceId,
      entry,
      handoff,
      signal: controller.signal,
    });
    if (setup.skipped) {
      // The factory couldn't run this entry (being missing, role
      // not carried, role not registered). Already logged inside
      // assign. assign returned no actId so there's nothing to
      // seal.
      return { actId: null, result: null, responseEntry: null };
    }

    actId = setup.actId || null;

    // ── Beat 3: momentum runs the act. ─────────────────────────
    const outcome = await momentum(setup);
    if (outcome?.result) {
      rawResult = outcome.result;
      if (isTransportAct) {
        // Transport-act results are raw verb returns. Don't shape
        // them as SUMMON-reply rows — the wire layer wants the
        // verb's return value verbatim. Seal content stays null;
        // the act itself is what's audited.
      } else {
        responseEntry = buildResponseEntry({
          result: outcome.result,
          handoff,
          originalEntry: entry,
        });
        // Seal content is the voice's response text. Roles that
        // return null seal with null content; the human's eventual
        // response opens its own Act via a fresh SUMMON.
        sealContent = outcome.result.text
          ?? outcome.result.content
          ?? outcome.result.answer
          ?? null;
      }
    }
  } catch (err) {
    sealError = err;
    if (controller.signal.aborted) {
      log.info(
        "Moment",
        `aborted being=${beingId.slice(0, 8)} corr=${entry.correlation.slice(0, 8)}: ${err.message}`,
      );
      // Aborted is a finalization. Role templates that need to
      // inform the sender about cancellation emit their own SUMMON;
      // the conductor stays out of policy.
    } else {
      log.error(
        "Moment",
        `errored being=${beingId.slice(0, 8)}: ${err.message}`,
      );
      if (handoff?.onError) {
        try { handoff.onError(err, entry); } catch {}
      }
    }
  } finally {
    // ── Beat 4: stamped seals the moment. ──────────────────────
    // assign opened the row; this is the symmetric close.
    // stamp() is idempotent: a second seal is a no-op if the
    // voice already sealed itself.
    if (actId) {
      const stopped = controller.signal.aborted;
      const content = stopped
        ? null
        : (sealError ? `Error: ${sealError.message}` : sealContent);
      try {
        await stamp({ actId, content, stopped });
      } catch (err) {
        log.warn("Moment", `seal failed: ${err.message}`);
      }
    }

    // Mark intake complete and fire the handoff with the result.
    try {
      await markIntakeComplete(spaceId, beingId, [entry.correlation], {
        responseId: responseEntry?.correlation || null,
        actId:      responseEntry?.actId || actId || null,
      });
    } catch (err) {
      log.warn("Moment", `markIntakeComplete failed: ${err.message}`);
    }
    if (handoff?.onResponse) {
      try {
        if (isTransportAct) {
          handoff.onResponse({ result: rawResult, actId });
        } else if (responseEntry) {
          handoff.onResponse(responseEntry);
        }
      } catch {}
    }
  }

  return { actId, result: rawResult, responseEntry };
}
