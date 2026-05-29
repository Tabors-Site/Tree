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
// **Phase 2 (this round).** sealAct is the moment's commit boundary.
// One act → one ΔF → one transaction. The Act row AND every Fact
// emitted during the moment (summonCtx.deltaF) commit together or
// not at all. Verb handlers contribute Facts to ctx.deltaF; sealAct
// drains the array, appends inside one withTransaction along with
// the Act.create, and runs eager-folds after commit. ΔF=0 moments
// (LLM with no tool calls) skip the transaction — single-doc Act
// insert is already atomic.
//
// This file owns the create-the-row-fully step AND the moment-wide
// commit boundary. The four-beat orchestration around it lives in
// moment.js. closeInboxOnAnswer and noteActSealOnThread fire here
// because they hang off the Act landing — side effects of "an Act
// with answers:C now exists," and that only happens here.
//
// Public surface:
//   sealAct          — atomically commit ΔF + Act row, fire closures
//   capContent       — shared content-cap helper (also used by assign)

import mongoose from "mongoose";
import { getInternalConfigValue } from "../../internalConfig.js";
import Act from "../../past/act/act.js";
import { closeInboxOnAnswer } from "../../past/act/inboxProjectionFold.js";
import { noteActSealOnThread } from "../../past/act/threadsProjectionFold.js";
import {
  appendDeltaFInSession,
  foldAfterCommit,
  isReplicaSetCluster,
  REPLICA_SET_REQUIRED_MSG,
} from "../../past/fact/facts.js";
import { hooks } from "../../hooks.js";
import log from "../../seedReality/log.js";

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
 * Atomically commit one moment: ΔF (the Facts the moment produced)
 * + the Act row that frames them. Called by moment.js only when
 * cognition returned ok:true (or for the abort path, which still
 * produces an Act with content=null and stopped=true — legacy
 * shape until abort also converts to release-with-no-Act).
 *
 * The plannedAct came from assign.planActRow and carries all the
 * derived fields (ibpAddress, rootCorrelation, parentThread,
 * answers, startMessage, etc.). This function adds endMessage and
 * inserts INSIDE the same Mongo transaction that commits ΔF, so
 * the moment's full record (every Fact + the Act) lands as one
 * unit. PAST FIXED on the whole moment, not just the Act.
 *
 * Three commit shapes:
 *   - ΔF=0: single-doc Act.create. No transaction needed.
 *   - ΔF=1, no replica set: logFact-then-Act.create. Two writes,
 *     each individually atomic. The moment's atomicity reduces to
 *     "both happened or neither" only via the per-reel lock for the
 *     fact + the Act's unique _id. (Today, this path is dead in
 *     practice once Phase 2 lands because all moments either emit
 *     facts under replica set or emit none.)
 *   - ΔF≥1, replica set: one session, withTransaction, append the
 *     whole ΔF + Act.create inside. All-or-nothing across the moment.
 *
 * Side effects (fire only after the Act lands):
 *   - closeInboxOnAnswer(answers)  evicts the matching
 *     InboxProjection row
 *   - noteActSealOnThread(rootCorrelation) bumps the
 *     ThreadsProjection's lastAct
 *
 * On a failed cognition (ok:false), moment.js does not call this
 * function. The Act row never materializes; ΔF never commits. Zero
 * trace; the InboxProjection stays open (no answering Act exists);
 * the ThreadsProjection is not bumped.
 *
 * Idempotency: the Act._id is a uuid minted at assign-time. A second
 * sealAct call with the same plannedAct would collide on _id; that's
 * a programmer error (moment.js should only call this once per
 * moment), not a runtime case to handle gracefully.
 *
 * @param {object} plannedAct        — the row to create (from planActRow)
 * @param {object} opts
 * @param {string|null} opts.content — endMessage text. null for
 *   transport-acts and aborts.
 * @param {boolean} [opts.stopped=false]  — abort marker.
 * @param {Array<object>} [opts.deltaF=[]] — Fact specs the moment
 *   produced (verb handlers and material helpers pushed onto
 *   summonCtx.deltaF during cognition). Committed atomically with
 *   the Act row.
 * @param {Array<Function>} [opts.afterSeal=[]] — callbacks the moment
 *   queued for post-commit firing (e.g. scheduler wakes that need
 *   the InboxProjection row to materialize first). Fired after
 *   foldAfterCommit, in queue order. Errors are caught and logged;
 *   they do not unwind the seal.
 * @returns {Promise<object|null>}   the inserted row, or null on
 *   collision/failure.
 */
export async function sealAct(plannedAct, { content = null, stopped = false, deltaF = [], afterSeal = [] } = {}) {
  if (!plannedAct?._id) {
    log.warn("Stamped", "sealAct called without plannedAct._id; nothing sealed");
    return null;
  }
  const endTime = new Date();
  const safeContent = content != null ? capContent(content) : null;
  const actDoc = {
    ...plannedAct,
    endMessage: { content: safeContent, time: endTime, stopped },
  };

  let inserted = null;
  let sortedReels = [];

  // ── ΔF=0: pure single-doc Act insert. No transaction needed. ──
  if (!Array.isArray(deltaF) || deltaF.length === 0) {
    try {
      inserted = await Act.create(actDoc);
    } catch (err) {
      log.error("Stamped", `sealAct insert failed (actId=${String(plannedAct._id).slice(0, 8)}): ${err.message}`);
      return null;
    }
  } else {
    // ── ΔF≥1: atomic commit of ΔF + Act inside one transaction. ──
    // The whole moment commits or nothing does. This is the seal
    // boundary the math is about.
    if (!isReplicaSetCluster()) {
      throw new Error("sealAct: " + REPLICA_SET_REQUIRED_MSG);
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // Reset on retry (withTransaction may retry on transient errors).
        inserted = null;
        sortedReels = [];

        // 1. Append every Fact in ΔF (in sorted-reel order under
        //    nested per-reel locks; the helper handles the dance).
        const result = await appendDeltaFInSession(deltaF, session);
        sortedReels = result.sortedReels;

        // 2. Insert the Act row in the same session.
        const docs = await Act.create([actDoc], { session });
        inserted = docs[0];
      });
    } catch (err) {
      log.error("Stamped", `sealAct aborted (actId=${String(plannedAct._id).slice(0, 8)}): ${err.message}`);
      throw err;
    } finally {
      await session.endSession();
    }

    // Eager-fold AFTER commit (projections see the committed state).
    await foldAfterCommit(sortedReels);
  }

  if (!inserted) return null;

  // Side effects fire AFTER the Act lands. The Act's existence is
  // the source of truth for "this moment sealed"; the projections
  // hang off that.
  if (inserted.answers) {
    try { await closeInboxOnAnswer(inserted.answers); } catch {}
  }
  if (inserted.rootCorrelation) {
    try { await noteActSealOnThread(inserted.rootCorrelation, endTime); } catch {}
  }

  // Fire afterQualityWrite for every committed qualities set/merge fact.
  // The hook is declared in seed/hooks.js but historically had no fire
  // site; this seam wires every do.set on qualities.<ns>[.inner] through
  // it. Listeners include the live-SEE handler (which invalidates
  // descriptors of subscribers viewing the affected space) and DO-
  // trigger fan-out (subscriptions.js).
  //
  // Payload shape:
  //   target  : { kind, id } — being | space | matter
  //   ns      : "<namespace>" — first segment after "qualities."
  //   field   : full field path that was set
  //   value   : the value written
  //   beingId : the actor that wrote it
  //   actId   : the moment-frame
  //   spaceId : space-id-for-live-see — the space whose descriptor needs
  //             to invalidate when this write changes visible state
  //             (target itself for spaces, currentSpace for beings,
  //             spaceId for matter). Lookups run lazily; only fired when
  //             at least one listener is registered.
  if (Array.isArray(deltaF) && deltaF.length > 0) {
    for (const f of deltaF) {
      if (
        f?.verb !== "do" ||
        (f?.action !== "set-space" &&
          f?.action !== "set-being" &&
          f?.action !== "set-matter") ||
        typeof f?.params?.field !== "string" ||
        !f.params.field.startsWith("qualities.")
      ) continue;
      const ns = f.params.field.slice("qualities.".length).split(".")[0];
      const target = f.target ? { kind: f.target.kind, id: String(f.target.id) } : null;
      const spaceId = await resolveSpaceForLiveSee(target);
      try {
        await hooks.run("afterQualityWrite", {
          target,
          ns,
          field: f.params.field,
          value: f.params.value,
          beingId: f.beingId ? String(f.beingId) : null,
          actId: f.actId ? String(f.actId) : null,
          spaceId,
        });
      } catch (err) {
        log.warn("Stamped", `afterQualityWrite hook fan failed: ${err.message}`);
      }
    }
  }

  // Post-seal callbacks. Verb handlers queued these for side effects
  // that depend on the seal having committed (most commonly: scheduler
  // wakes that need the InboxProjection row to materialize from the
  // cross-cutting fold). Fire in queue order; errors are logged, not
  // rethrown (the seal already landed; one bad callback shouldn't
  // unwind it).
  if (Array.isArray(afterSeal) && afterSeal.length > 0) {
    for (const cb of afterSeal) {
      try { await cb(); }
      catch (err) {
        log.warn("Stamped", `afterSeal callback failed: ${err.message}`);
      }
    }
  }

  return inserted;
}

// Resolve the descriptor-space affected by a quality write. Used to
// route live-SEE invalidations on afterQualityWrite. Returns null when
// the affected space can't be determined (live-SEE then no-ops).
async function resolveSpaceForLiveSee(target) {
  if (!target || !target.id) return null;
  if (target.kind === "space") return String(target.id);
  if (target.kind === "being") {
    try {
      const Being = mongoose.model("Being");
      const b = await Being.findById(target.id).select("currentSpace").lean();
      return b?.currentSpace ? String(b.currentSpace) : null;
    } catch { return null; }
  }
  if (target.kind === "matter") {
    try {
      const Matter = mongoose.model("Matter");
      const m = await Matter.findById(target.id).select("spaceId").lean();
      return m?.spaceId ? String(m.spaceId) : null;
    } catch { return null; }
  }
  return null;
}

