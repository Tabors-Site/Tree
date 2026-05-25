// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// stamped.js — the post stamping. The closing press.
//
// An Act is a frame on the act-chain. assign minted the actId and
// PLANNED the row (computed ibpAddress, rootCorrelation,
// parentThread, etc.) at beat 1. This file presses the closing
// face — endMessage — onto a row that is WRITTEN HERE for the
// first time. The row does not exist in Mongo before this call.
//
// **Round 5 restructure.** The Act used to be written at beat 1
// (assign) and updated at beat 4 (here). That left failed cognitions
// with a sealed-but-empty Act row, a fourth shape the model doesn't
// have (MODEL.md has SEE = a=∅ = no seal, and DO/BE = a≠∅ = seal).
// The fix is structural: an Act row exists only when cognition
// returned ok:true. ok:false → moment.js doesn't call sealAct →
// no Act row ever materializes → the InboxProjection stays open
// (no answering Act exists to close it). Zero trace; the being's
// reel and act-chain are byte-identical to before the failed
// moment.
//
// This file owns the create-the-row-fully step. The four-beat
// orchestration around it lives in moment.js. closeInboxOnAnswer
// and noteActSealOnThread fire here because they hang off the Act
// landing — they're side effects of "an Act with answers:C now
// exists," and that only happens here.
//
// Public surface:
//   sealAct          — write the Act row (full data) and fire closures
//   capContent       — shared content-cap helper (also used by assign)

import { getInternalConfigValue } from "../internalConfig.js";
import Act from "../past/act/act.js";
import { closeInboxOnAnswer } from "../past/act/inboxProjectionFold.js";
import { noteActSealOnThread } from "../past/act/threadsProjectionFold.js";
import log from "../seedReality/log.js";

function MAX_CHAT_CONTENT_BYTES() {
  return Math.max(
    10000,
    Math.min(
      Number(getInternalConfigValue("maxChatContentBytes")) || 100000,
      1000000,
    ),
  );
}

export function capContent(s) {
  if (typeof s !== "string") return s;
  const max = MAX_CHAT_CONTENT_BYTES();
  return s.length > max ? s.slice(0, max) + "... (truncated)" : s;
}

/**
 * Write the Act row for a sealed moment. Called by moment.js only
 * when cognition returned ok:true (or for the abort path, which
 * still produces an Act with content=null and stopped=true — that
 * remains the legacy shape until the abort path also converts to
 * release-with-no-Act).
 *
 * The plannedAct came from assign.planActRow and carries all the
 * derived fields (ibpAddress, rootCorrelation, parentThread,
 * answers, startMessage, etc.). This function adds endMessage and
 * inserts.
 *
 * Side effects (fire only when the Act lands):
 *   - closeInboxOnAnswer(answers)  evicts the matching
 *     InboxProjection row
 *   - noteActSealOnThread(rootCorrelation) bumps the
 *     ThreadsProjection's lastAct
 *
 * On a failed cognition (ok:false), moment.js does not call this
 * function. The Act row never materializes. Both projection side
 * effects therefore never fire — the InboxProjection stays open
 * (correctly, the summon was not answered) and the ThreadsProjection
 * is not bumped (correctly, the thread did not advance).
 *
 * Idempotency: the Act._id is a uuid minted at assign-time. A second
 * sealAct call with the same plannedAct would collide on _id; that's
 * a programmer error (moment.js should only call this once per
 * moment), not a runtime case to handle gracefully.
 *
 * @param {object} plannedAct  — the row to create (from planActRow)
 * @param {object} opts
 * @param {string|null} opts.content  — endMessage text. null for
 *   transport-acts and aborts.
 * @param {boolean} [opts.stopped=false]  — abort marker.
 * @returns {Promise<object|null>}  the inserted row, or null on
 *   collision/failure.
 */
export async function sealAct(plannedAct, { content = null, stopped = false } = {}) {
  if (!plannedAct?._id) {
    log.warn("Stamped", "sealAct called without plannedAct._id; nothing sealed");
    return null;
  }
  const endTime = new Date();
  const safeContent = content != null ? capContent(content) : null;

  let inserted;
  try {
    inserted = await Act.create({
      ...plannedAct,
      endMessage: {
        content: safeContent,
        time:    endTime,
        stopped,
      },
    });
  } catch (err) {
    // Duplicate-key on _id would mean moment.js sealed twice for the
    // same actId — programmer error. Log loudly; return null so the
    // caller can react if needed.
    log.error("Stamped", `sealAct insert failed (actId=${String(plannedAct._id).slice(0, 8)}): ${err.message}`);
    return null;
  }

  // Side effects fire AFTER the Act lands. The Act's existence is
  // the source of truth for "this moment sealed"; the projections
  // hang off that.
  if (inserted.answers) {
    try { await closeInboxOnAnswer(inserted.answers); } catch {}
  }
  if (inserted.rootCorrelation) {
    try { await noteActSealOnThread(inserted.rootCorrelation, endTime); } catch {}
  }

  return inserted;
}

