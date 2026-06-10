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
import { assertBranchOrThrow } from "../../materials/projections.js";
import { closeInboxOnAnswer } from "../../past/projections/inbox/inboxProjectionFold.js";
import { noteActSealOnThread } from "../../past/projections/threads/threadsProjectionFold.js";
import {
  appendDeltaFInSession,
  foldAfterCommit,
  groupByReel,
  isReplicaSetCluster,
  REPLICA_SET_REQUIRED_MSG,
  withReelLocks,
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
 * cognition returned `kind:"act"` AND produced at least one of:
 * non-empty endMessage content, or a Fact on some reel. Both
 * structurally enforced below.
 *
 * The plannedAct came from assign.planActRow and carries all the
 * derived fields (ibpAddress, rootCorrelation, parentThread,
 * answers, startMessage, etc.). This function adds endMessage and
 * inserts INSIDE the same Mongo transaction that commits ΔF, so
 * the moment's full record (every Fact + the Act) lands as one
 * unit. PAST FIXED on the whole moment, not just the Act.
 *
 * Three commit shapes:
 *   - ΔF=0 (content-only act, e.g. an LLM that emitted prose via a
 *     speech tool): single-doc Act.create. No transaction needed.
 *   - ΔF=1, no replica set: logFact-then-Act.create. Two writes,
 *     each individually atomic. The moment's atomicity reduces to
 *     "both happened or neither" only via the per-reel lock for the
 *     fact + the Act's unique _id.
 *   - ΔF≥1, replica set: one session, withTransaction, append the
 *     whole ΔF + Act.create inside. All-or-nothing across the moment.
 *
 * Side effects (fire only after the Act lands):
 *   - closeInboxOnAnswer(answers)  evicts the matching
 *     InboxProjection row
 *   - noteActSealOnThread(rootCorrelation) bumps the
 *     ThreadsProjection's lastAct
 *
 * On a failed cognition (ok:false), or on a SEE outcome, moment.js
 * does not call this function. The Act row never materializes;
 * ΔF never commits. Zero trace; the InboxProjection stays open
 * (no answering Act exists); the ThreadsProjection is not bumped.
 *
 * Invariant — structurally enforced.
 *   Every Act row in the database has either non-empty endMessage
 *   content OR one or more Facts under its actId. An Act with
 *   neither is a substrate violation: it means a moment that should
 *   have been SEE (a(Φ) = ∅) leaked an Act row anyway. The gate at
 *   the top of this function refuses such a write loudly. New
 *   callers that hit this throw should be returning SEE upstream.
 *
 * Idempotency: the Act._id is a uuid minted at assign-time. A second
 * sealAct call with the same plannedAct would collide on _id; that's
 * a programmer error (moment.js should only call this once per
 * moment), not a runtime case to handle gracefully.
 *
 * @param {object} plannedAct        — the row to create (from planActRow)
 * @param {object} opts
 * @param {string|null} opts.content — endMessage text. Null for
 *   transport-acts (the verb call IS the act; the prose channel
 *   is unused). In that case ΔF must be non-empty.
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
export async function sealAct(plannedAct, { content = null, deltaF = [], afterSeal = [], opCount = null } = {}) {
  if (!plannedAct?._id) {
    log.warn("Stamped", "sealAct called without plannedAct._id; nothing sealed");
    return null;
  }

  // Invariant gate. Refuse to write an Act that would be an orphan
  // (no output and no Facts). Such a moment is doctrinally SEE; the
  // caller should not have reached this function. The check lives in
  // code, not just doctrine, so a regression in any future tool that
  // succeeds without stamping a Fact fails loudly here on first run
  // instead of silently filling the Act collection.
  const hasContent = typeof content === "string" && content.trim().length > 0;
  const hasFacts   = Array.isArray(deltaF) && deltaF.length > 0;
  if (!hasContent && !hasFacts) {
    throw new Error(
      `sealAct: refusing to seal Act ${String(plannedAct._id).slice(0, 8)} ` +
      `with no endMessage content and no Facts — that's a SEE moment, ` +
      `not an act. Caller (likely moment.js or a tool path) should ` +
      `return cognitionSee() instead of invoking sealAct.`,
    );
  }

  // One-moment-one-act invariant (philosophy/MOMENT.md "Moment, act,
  // batch"). The discipline is unconditional: a moment seals exactly
  // one top-level operation (one DO, one BE, one SUMMON). An op's
  // handler is free to emit as many facts as it needs — multi-reel,
  // even multiple writes to the same reel — but you don't pack
  // multiple unrelated ops into one moment.
  //
  // How counting works: doVerb / beVerb / summonVerb at the entry
  // layer bumps `summonCtx._opCount` once per top-level call.
  // Recursive DO dispatches (set-render → set-being) are gated by
  // `summonCtx._inOp` and don't re-count. At seal time, opCount > 1
  // means the moment ran multiple top-level operations — that's a
  // bug, not a configuration.
  //
  // Cross-moment atomicity (federation pull, cross-reel transfer)
  // belongs in a future `withBatch` primitive (a grouping of moments
  // that share a Mongo session); it never expands a single moment to
  // hold many ops. Genesis is a SEQUENCE of moments, not a batch —
  // see seed/done/IamToActs.md.
  //
  // Structural: this is a hard throw, not a warn. The discipline is
  // unconditional.
  if (
    hasFacts &&
    typeof opCount === "number" &&
    opCount > 1
  ) {
    throw new Error(
      `sealAct: Act ${String(plannedAct._id).slice(0, 8)} (${plannedAct.beingOut?.slice?.(0, 8) || "?"}) ` +
      `would seal ${opCount} top-level operations (${deltaF.length} facts). ` +
      `Doctrine (philosophy/MOMENT.md): one moment = one DO/BE/SUMMON. ` +
      `Split into separate moments — open each in its own withIAmAct / withBeingAct.`,
    );
  }

  const endTime = new Date();
  const safeContent = content != null ? capContent(content) : null;
  // Stamper seats the Act's initial status. Cross-world doctrine: an
  // Act starts at "attempted" when the actor's local chain seals;
  // transitions exactly once to a terminal state when the target's
  // world confirms. For same-world moments where the Stamper IS the
  // target, the post-commit transition happens inline below; for
  // cross-reality moments awaiting a canopy round-trip, the Act stays
  // at "attempted" until the response arrives via updateActStatus.
  // See CROSS-WORLD.md "Act lifecycle and status."
  const actDoc = {
    ...plannedAct,
    endMessage: { content: safeContent, time: endTime, stopped: false },
    status: "attempted",
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

    // PARALLEL FACTS §1.2: acquire every reel lock BEFORE opening
    // the session, hold them across the entire transaction. This
    // bounds the snapshot lifetime so two contenders on the same
    // reel can never have overlapping snapshots. See withReelLocks
    // for the full rationale; both sealFacts and sealAct follow
    // this shape.
    const { sortedReels: lockReels } = groupByReel(deltaF);
    try {
      await withReelLocks(lockReels, async () => {
        const session = await mongoose.startSession();
        try {
          await session.withTransaction(async () => {
            // Reset on retry (withTransaction may retry on transient errors).
            inserted = null;
            sortedReels = [];

            // 1. Append every Fact in ΔF (caller holds the locks).
            const result = await appendDeltaFInSession(deltaF, session);
            sortedReels = result.sortedReels;

            // 2. Insert the Act row in the same session.
            const docs = await Act.create([actDoc], { session });
            inserted = docs[0];
          });
        } finally {
          await session.endSession();
        }
      });
    } catch (err) {
      log.error("Stamped", `sealAct aborted (actId=${String(plannedAct._id).slice(0, 8)}): ${err.message}`);
      throw err;
    }

    // Eager-fold AFTER commit (projections see the committed state).
    await foldAfterCommit(sortedReels);
  }

  if (!inserted) return null;

  // Status transition: attempted → landed. For same-world and
  // same-reality cross-branch moments the local Stamper IS the
  // target — by the time the transaction committed, the facts
  // landed and the Act can move to "landed" inline here. For
  // cross-reality moments the Act is created directly by
  // crossRealityDispatch (not sealAct) with no deltaF, and its
  // status transitions when the canopy reply arrives via
  // handleCrossWorldResponse → updateActStatus. So the only path
  // through here is same-reality; the foreign-reality check is a
  // belt-and-suspenders guard against a future caller routing a
  // cross-reality moment through sealAct. See CROSS-WORLD.md +
  // crossWorld.js.
  const hasForeignRealityFact = Array.isArray(deltaF) && deltaF.some(
    (f) => f?.params?.crossOrigin?.reality
  );
  if (!hasForeignRealityFact) {
    try {
      await Act.updateOne(
        { _id: inserted._id, status: "attempted" },
        { $set: { status: "landed" } },
      );
      inserted.status = "landed";
    } catch (err) {
      log.warn("Stamped", `sealAct: status→landed update failed (actId=${String(inserted._id).slice(0, 8)}): ${err.message}`);
    }
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
      if (f?.verb !== "do") continue;
      const action = f.action;
      const target = f.target ? { kind: f.target.kind, id: String(f.target.id) } : null;
      const baseBeing = f.beingId ? String(f.beingId) : null;
      const baseActId = f.actId ? String(f.actId) : null;

      // Set-* writes. Qualities paths get their own seam (namespace-
      // aware); other scalar writes (coord, size, name, type, parent,
      // ...) fire afterFieldWrite for live-SEE invalidation.
      if (
        (action === "set-space" || action === "set-being" || action === "set-matter") &&
        typeof f?.params?.field === "string"
      ) {
        const field = f.params.field;
        // Fact must carry branch (perimeter doctrine: every fact-emitter
        // attaches it). assertBranchOrThrow surfaces a missing-branch
        // fact at the seal-time fan-out site rather than silently
        // invalidating subscribers on the wrong branch.
        const factBranch = assertBranchOrThrow(f?.branch, "stamped(afterFieldWrite fan)");
        const spaceId = await resolveSpaceForLiveSee(target, factBranch);
        // Position changes need BOTH the old and new rooms to invalidate
        // so the room the being LEFT also refreshes. set-being's handler
        // captures the prior position into params.fromPosition; the
        // fold by this point has already updated the slot to the new
        // value, so resolveSpaceForLiveSee returns the new room.
        const isPositionChange =
          action === "set-being" && field === "position";
        const fromSpaceId = isPositionChange ? (f?.params?.fromPosition || null) : null;
        const spaceIds = fromSpaceId && fromSpaceId !== spaceId
          ? [spaceId, fromSpaceId]
          : [spaceId];
        for (const sid of spaceIds) {
          const payload = {
            target,
            field,
            value: f.params.value,
            beingId: baseBeing,
            actId: baseActId,
            spaceId: sid,
            // Branch this write happened on. Live-SEE subscribers filter
            // by branch on their end so a write on #1 doesn't invalidate
            // subscribers viewing main, and vice versa.
            branch: factBranch,
          };
          try {
            if (field.startsWith("qualities.")) {
              payload.ns = field.slice("qualities.".length).split(".")[0];
              await hooks.run("afterQualityWrite", payload);
            } else {
              await hooks.run("afterFieldWrite", payload);
            }
          } catch (err) {
            log.warn("Stamped", `field-write hook fan failed: ${err.message}`);
          }
        }
        continue;
      }

      // Move. Two modes, both covered by the same hook fan:
      //
      //   coord mode (params.coord) — repositioning within the same
      //     container. Source == destination, so one invalidate fires
      //     on params.fromSpaceId (the container both before and
      //     after). The container's descriptor refreshes; the moved
      //     mesh re-renders at the new coord.
      //
      //   container mode (params.to) — the subject changed parent /
      //     spaceId. Source and destination differ. Both descriptors
      //     invalidate so each end's view reconciles.
      //
      // We fire field:"moved" rather than field:"coord". The live-SEE
      // listener suppresses coord writes (humans walk at 10Hz; full
      // refetches would clobber the scene). `moved` is the explicit
      // signal that something changed enough to warrant a refetch,
      // bypassing the coord-skip without losing the optimization.
      if (action === "move") {
        const from = f.params?.fromSpaceId ? String(f.params.fromSpaceId) : null;
        const to   = f.params?.to ? String(f.params.to) : null;
        const seen = new Set();
        for (const spaceId of [from, to]) {
          if (!spaceId || seen.has(spaceId)) continue;
          seen.add(spaceId);
          try {
            await hooks.run("afterFieldWrite", {
              target,
              field: "moved",
              value: null,
              beingId: baseBeing,
              actId: baseActId,
              spaceId,
            });
          } catch (err) {
            log.warn("Stamped", `move hook fan failed: ${err.message}`);
          }
        }
        continue;
      }

      // create-space / end-space inside a moment fire afterSpaceCreate /
      // afterSpaceDelete here, post-seal — the in-moment helper in
      // spaces.js can't fire them inline because the row isn't yet
      // materialized at that point and subscribers refetching too early
      // would miss it. The protocols/ibp/index.js handler reads
      // `space.parent` off the payload to invalidate the parent's
      // descriptor — the spec carries it, so we don't need the slot.
      if (action === "create-space" && f?.params) {
        try {
          await hooks.run("afterSpaceCreate", {
            space: {
              _id:    String(target.id),
              parent: f.params.parent ?? null,
              name:   f.params.name ?? null,
            },
            beingId: baseBeing,
            // Branch the create happened on. Live-SEE filters by branch
            // so a #1 create doesn't invalidate main subscribers.
            branch:  assertBranchOrThrow(f?.branch, "stamped(afterSpaceCreate)"),
          });
        } catch (err) {
          log.warn("Stamped", `afterSpaceCreate hook fan failed: ${err.message}`);
        }
        continue;
      }
      if (action === "end-space") {
        try {
          await hooks.run("afterSpaceDelete", {
            space: { _id: String(target.id) },
            beingId: baseBeing,
            branch:  assertBranchOrThrow(f?.branch, "stamped(afterSpaceDelete)"),
          });
        } catch (err) {
          log.warn("Stamped", `afterSpaceDelete hook fan failed: ${err.message}`);
        }
        continue;
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

  // afterAct: the moment is now sealed and visible. Live listeners
  // (descriptor invalidate, activity-bubble refresh, telemetry) attach
  // here. Mid-moment hooks (afterToolCall, afterFieldWrite) cover
  // intra-moment changes; this is the per-moment boundary.
  try {
    await hooks.run("afterAct", {
      actId: String(inserted._id),
      beingOut: inserted.beingOut ? String(inserted.beingOut) : null,
      beingIn: inserted.beingIn ? String(inserted.beingIn) : null,
      activeRole: inserted.activeRole || null,
      endMessage: inserted.endMessage || null,
      stoppedAt: endTime,
    });
  } catch (err) {
    log.warn("Stamped", `afterAct hook fan failed: ${err.message}`);
  }

  return inserted;
}

// Resolve the descriptor-space affected by a quality write. Used to
// route live-SEE invalidations on afterQualityWrite. Returns null when
// the affected space can't be determined (live-SEE then no-ops).
async function resolveSpaceForLiveSee(target, branch = "0") {
  if (!target || !target.id) return null;
  if (target.kind === "space") return String(target.id);
  // loadOrFold (not loadProjection): on a sub-branch with an inherited
  // being/matter, the slot only materializes via lineage cold-fold.
  // Bare loadProjection returns null, this function returns null, the
  // live-SEE invalidation no-ops, and portals subscribed to the
  // descriptor never get the "world changed" event. That's why beings
  // appeared frozen in the 3D/flat portals on non-main branches even
  // though facts were landing correctly.
  if (target.kind === "being") {
    try {
      const { loadOrFold } = await import("../../materials/projections.js");
      const slot = await loadOrFold("being", target.id, branch);
      return slot?.position ? String(slot.position) : null;
    } catch { return null; }
  }
  if (target.kind === "matter") {
    try {
      const { loadOrFold } = await import("../../materials/projections.js");
      const slot = await loadOrFold("matter", target.id, branch);
      return slot?.state?.spaceId ? String(slot.state.spaceId) : null;
    } catch { return null; }
  }
  return null;
}

