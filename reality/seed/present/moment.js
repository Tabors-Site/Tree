// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// moment.js — one moment, start to finish.
//
// A moment is the atom (see philosophy/MOMENT.md). It has exactly
// four beats:
//
//   1. assign     — mint actId, plan the Act, resolve who acts
//                   (assign.js). DOES NOT WRITE the Act row.
//   2. fold       — mount the face (fold/)
//   3. momentum   — the being's act (momentum.js). Returns a
//                   CognitionResult: { ok: true, content } or
//                   { ok: false, shape, reason }.
//   4. stamped    — IF ok:true: write the Act row (seal). IF
//                   ok:false: no Act row, no seal, release.
//
// moment.js is the conductor — it walks the four beats in order
// and routes the moment's outcome (raw verb result for transport
// acts; SUMMON-reply row for received SUMMONs) back to whoever's
// waiting. It owns no business logic of its own; each beat is its
// own file.
//
// **Round 5 structural change.** The seal is GATED on
// CognitionResult.ok. Cognition cannot produce text — it produces
// a discriminated result whose type makes failure unrepresentable
// at the seal. A failed cognition is a moment whose act is ∅
// (MODEL.md: SEE = a=∅ = seals nothing). No Act row is written.
// The InboxProjection stays open automatically — no answering Act
// exists to close it. The being's reel and act-chain are byte-
// identical to before the failed moment. Zero trace.
//
// See seed/present/cognitionResult.js for the CognitionResult contract.
//
// The intake queue and per-being serial behavior live in
// intake/scheduler.js; the scheduler calls runMoment() once per
// pending intake entry and is otherwise out of the moment's
// business.

import log from "../seedReality/log.js";
import { assign }   from "./beats/1-assign.js";
import { momentum } from "./beats/3-momentum.js";
import { sealAct }  from "./beats/4-stamped.js";
import { markIntakeRunning, markIntakeComplete } from "./intake/intake.js";
import { buildResponseEntry } from "./replies.js";

/**
 * Run one moment for a being. Walks all four beats; never throws —
 * errors land as a CognitionResult({ ok:false, shape:"internal" })
 * and the moment releases with no Act row.
 *
 * @param {object} opts
 * @param {string} opts.beingId        the acting being's id
 * @param {string} opts.spaceId        the intake-storing space
 * @param {object} opts.entry          the intake entry (kind, correlation, ...)
 * @param {number} opts.index          the entry's array index (for intake state)
 * @param {object} [opts.handoff]      runtime context stashed at SUMMON-time
 * @param {AbortController} opts.controller  the abort signal that propagates into the act
 * @returns {Promise<{ actId: string|null, result: any, responseEntry: object|null }>}
 *   actId is non-null only when the Act row materialized (cognition
 *   ok:true OR abort path). On ok:false failure, actId is null and
 *   no Mongo state changed.
 */
export async function runMoment({ beingId, spaceId, entry, index, handoff = null, controller } = {}) {
  if (!controller) throw new Error("runMoment requires an AbortController");

  const isTransportAct = entry.kind === "transport-act";

  await markIntakeRunning(spaceId, beingId, index);

  let setup = null;
  let cognition = null;       // CognitionResult
  let rawResult = null;       // transport-act verb return (ride-along)
  let responseEntry = null;
  let actInserted = null;     // the Act row, when one materializes

  try {
    // ── Beat 1: assign mints actId + plans the Act. No Mongo write. ──
    setup = await assign({
      beingId,
      spaceId,
      entry,
      handoff,
      signal: controller.signal,
    });
    if (setup.skipped) {
      // assign couldn't run this entry (being missing, role not
      // carried, role not registered). Already logged inside assign.
      // No actId, no Act row, no inbox close.
      return { actId: null, result: null, responseEntry: null };
    }

    // ── Beat 3: momentum runs the act. Returns CognitionResult. ──
    cognition = await momentum(setup);
  } catch (err) {
    // Conductor-level failure (assign threw, momentum threw before
    // its own try/catch). Treat as cognition failure: no Act row.
    if (controller.signal.aborted) {
      log.info("Moment", `aborted being=${beingId.slice(0, 8)} corr=${entry.correlation.slice(0, 8)}: ${err.message}`);
      cognition = { ok: false, shape: "aborted", reason: err.message };
    } else {
      log.error("Moment", `errored being=${beingId.slice(0, 8)}: ${err.message}`);
      cognition = { ok: false, shape: "internal", reason: err.message };
      if (handoff?.onError) {
        try { handoff.onError(err, entry); } catch {}
      }
    }
  }

  // ── Beat 4: seal-gate. ──
  // The structural rule: an Act row is written ONLY when cognition
  // returned ok:true. ok:false → no Act, the InboxProjection stays
  // open because no answering Act exists to close it.
  //
  // One legacy exception: abort path still produces an Act with
  // content=null + stopped=true. That's the pre-CognitionResult
  // shape; future work converts abort to release-with-no-Act too
  // (noted in run.js doctrine). For now: aborted → seal with null.
  try {
    if (setup?.plannedAct && cognition?.ok === true) {
      // ── Cognition succeeded. Build seal content + seal the Act. ──
      let sealContent;
      if (isTransportAct) {
        // Transport-act: the act IS the verb call. endMessage.content
        // is null (no closing utterance); the verb's return rides on
        // cognition.verbResult for the handoff.
        sealContent = null;
        rawResult = cognition.verbResult ?? null;
      } else {
        sealContent = cognition.content;
        responseEntry = buildResponseEntry({
          result: { text: cognition.content },
          handoff,
          originalEntry: entry,
        });
      }

      actInserted = await sealAct(setup.plannedAct, {
        content: sealContent,
        stopped: false,
        deltaF:    setup.summonCtx?.deltaF    || [],
        afterSeal: setup.summonCtx?.afterSeal || [],
      });
    } else if (setup?.plannedAct && cognition?.shape === "aborted") {
      // Abort path. Legacy: still produces an Act with content=null
      // and stopped=true. To be converted to release-with-no-Act
      // in a future pass (see run.js doctrine). On abort we still
      // commit whatever ΔF accumulated before the abort — those
      // facts happened and PAST FIXED applies.
      actInserted = await sealAct(setup.plannedAct, {
        content: null,
        stopped: true,
        deltaF:    setup.summonCtx?.deltaF    || [],
        afterSeal: setup.summonCtx?.afterSeal || [],
      });
    } else if (setup?.plannedAct) {
      // ok:false (and not aborted). NO Act row. NO inbox close.
      // The summon stays open in the InboxProjection because no
      // answering Act exists.
      log.info(
        "Moment",
        `released being=${beingId.slice(0, 8)} ` +
        `shape=${cognition?.shape || "unknown"} ` +
        `reason="${(cognition?.reason || "").slice(0, 80)}" — no Act written`,
      );
    }
  } catch (err) {
    log.warn("Moment", `seal failed: ${err.message}`);
  }

  // ── Bookkeeping. ──
  // markIntakeComplete is a no-op tombstone today (see intake.js)
  // but we still call it for any callers that haven't migrated.
  try {
    await markIntakeComplete(spaceId, beingId, [entry.correlation], {
      responseId: responseEntry?.correlation || null,
      actId:      responseEntry?.actId || (actInserted ? String(actInserted._id) : null),
    });
  } catch (err) {
    log.warn("Moment", `markIntakeComplete failed: ${err.message}`);
  }

  // Handoff: only fire onResponse when something actually happened.
  // For transport-act: fire with the verb return + actId (when sealed).
  // For summon: fire with the response entry (built only on ok:true).
  // For ok:false: no handoff fires — the asker's onResponse is for
  // delivering an answer, and there is no answer.
  if (handoff?.onResponse && actInserted) {
    try {
      if (isTransportAct) {
        handoff.onResponse({ result: rawResult, actId: String(actInserted._id) });
      } else if (responseEntry) {
        handoff.onResponse(responseEntry);
      }
    } catch {}
  }

  return {
    actId: actInserted ? String(actInserted._id) : null,
    result: rawResult,
    responseEntry,
  };
}
