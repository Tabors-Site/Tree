// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Facts. The reel of stamped acts.
//
// A being is its acts. The Being row in MongoDB is where the reel
// attaches; the reel itself, every Fact the being has stamped, is
// the identity. Without acts, the union of space and matter has
// nothing to be. The being is made of the acts unfolding.
//
// A Fact is a thing a being stamps in the Factory — one recorded
// change to matter, space, or being. `factum`, a thing done.
// A single fact is small but settled; a chain of facts, folded,
// is Truth.
//
// This file writes and reads that reel. logFact is called from the
// IBP verb dispatcher every time DO or BE places an act. The Fact
// row names the actor (through), the kind of act (verb, act), the
// object (space | matter | being | place | stance), and the input /
// output. getFacts and getFactsByBeing return the reel to readers.
//
// Universal over substrate. Facts attach to any target kind, so this
// file lives directly under place/ rather than inside one primitive's
// subfolder.
//
// Recorded by default. Operations opt out via `spec.skipAudit`; the
// dispatcher also accepts `opts.skipAudit` for seed-trusted batches.
//
// See seed/philosophy/MATERIALS.md "And the beings are the acts" for the
// philosophy behind why this reel is identity-load-bearing.

import mongoose from "mongoose";
import log from "../../seedStory/log.js";
import { getInternalConfigValue } from "../../internalConfig.js";
import Fact from "./fact.js";
import { computeHash, contentOf, GENESIS_PREV } from "./hash.js";
import ReelHead from "../reel/reelHead.js";
import { reelKey } from "../reel/reelHeads.js";
import { hooks } from "../../hooks.js";
import { IBP_ERR, IbpError } from "../../ibp/protocol.js";
import { getStoryConfigValue } from "../../storyConfig.js";
import { resolveSpaceAccess } from "../../materials/space/spaces.js";
import { redactSecrets } from "../../materials/redact.js";
import { allocSeq } from "../reel/reelHeads.js";
import { withReelLock } from "../reel/appendLock.js";

// Reel-bearing target kinds — those with their own seq counter. Other
// kinds (place, stance) and target-less facts carry seq:null and stay
// outside the fold model for now.
const REEL_KINDS = new Set(["being", "space", "matter", "name"]);

// ─────────────────────────────────────────────────────────────────────────
// WRITE
// ─────────────────────────────────────────────────────────────────────────

function MAX_PAYLOAD_BYTES() {
  const raw = Number(getInternalConfigValue("qualityNamespaceMaxBytes")) || 524288;
  return Math.max(1024, Math.min(raw, 2 * 1024 * 1024));
}
const MAX_ACTION_LENGTH = 100;
// The three stamping verbs. SEE never appends a Fact.
//   - do: act on an object (right stance). of.kind ∈ {space, matter, being, place, stance}.
//   - be: identity acting on self (left stance). of.kind === "being".
//   - summon: one being calling another (right stance, the recipient). of.kind === "being".
const VALID_VERBS = new Set(["do", "be", "call", "name"]);
const VALID_TARGET_KINDS = new Set([
  "space",
  "matter",
  "being",
  "name",
  "place",
  "stance",
]);
// Per-verb target-kind constraint. DO accepts any kind; BE and
// SUMMON always act on a being. Enforced in logFact below so a
// caller can't slip a `verb:"be" of:{kind:"matter"}` past the
// guard and confuse the fold or the inner/outer classifier.
const BEING_ONLY_TARGET_VERBS = new Set(["be", "call"]);

/**
 * Act a Fact onto the reel.
 *
 * @param {object} params           the fact spec (see fields below)
 * @param {string} params.through   actor (I_AM for scaffold flows)
 * @param {string} params.act       operation or sub-event name
 * @param {string} [params.verb="do"]   "do" | "be" | "summon"
 * @param {{kind:string,id:string}|null} [params.of]  what was acted on.
 *   When verb is "be" or "summon", of.kind MUST be "being" (enforced).
 * @param {*} [params.params]       input payload (any JSON; clipped on cap)
 * @param {*} [params.result]       output payload (any JSON; clipped on cap)
 * @param {string|null} [params.actId]   correlation
 * @param {string|null} [params.sessionId]  correlation
 * @param {string|null} [params.homeStory]   federation provenance
 * @param {boolean} [params.wasRemote=false] federation provenance
 * @param {object} [opts]                runtime options (NOT part of the fact)
 * @param {ClientSession} [opts.session] Mongo session for transactional
 *   participation. Passed by `sealFacts` when committing a multi-fact ΔF
 *   inside one transaction. When absent, logFact runs its own per-reel
 *   atomic commit (singleton ΔF, today's behavior). When present, every
 *   Mongo op in the append (allocSeq, prev lookup, Fact.create) carries
 *   the session so they participate in sealFacts' transaction.
 * @param {boolean} [opts.skipEagerFold=false] When true, do not call
 *   the foldEngine's eager-fold after insert. sealFacts sets this when
 *   committing transactionally — folds run after commit on the
 *   committed state, not during the transaction (which would race).
 *
 * The `beforeFact` hook receives a mutable view of these fields and may
 * cancel the stamp or enrich the payload before insert.
 */
export async function logFact(input, opts = {}) {
  if (!input || typeof input !== "object") {
    throw new Error("logFact requires a params object");
  }
  // `branch` is `let` because heaven routing may rewrite it below.
  // Everything else stays effectively-const.
  let branch;
  const {
    through,
    by = null,
    verb = "do",
    act,
    of = null,
    params = null,
    result = null,
    actId = null,
    sessionId = null,
    homeStory = null,
    wasRemote = false,
    foldSeq = null,
  } = input;
  // Branch this fact lives on (target reel's branch). REQUIRED.
  // Callers derive it from the target address (where the Fact lands)
  // — not from the actor's branch. For same-world Facts the two
  // happen to match; for cross-world Facts they differ. See
  // CROSS-WORLD.md.
  branch = input.history;

  if (!through || !act) {
    throw new Error("logFact requires through and act");
  }
  if (typeof branch !== "string" || !branch.length) {
    throw new Error(
      `logFact: history is required (got ${JSON.stringify(branch)}). ` +
      `Derive it from the target's address (the reel where this Fact lands), ` +
      `not from the actor's branch.`,
    );
  }
  if (typeof act !== "string" || act.length > MAX_ACTION_LENGTH) {
    throw new Error(
      `logFact: act must be a string under ${MAX_ACTION_LENGTH} chars`,
    );
  }
  if (!VALID_VERBS.has(verb)) {
    throw new Error(
      `logFact: verb must be one of ${[...VALID_VERBS].join("|")}`,
    );
  }

  // EMBODIMENT invariant (Tabor): a name makes WORLD facts (do / be / summon)
  // ONLY by acting THROUGH a being — every world fact carries the actor being
  // (the `through` REQUIRED above is that structural guarantee; there is no
  // bodiless world fact). The only thing a name acts on WITHOUT a being is the
  // name chain itself — NAME-verb facts (verb:"name": declare/connect/release/
  // banish), the identity layer outside the world. SEE never reaches logFact (a
  // read, no fact). A name with no being of its OWN acts through the shared
  // @arrival being; the wire (protocols/ibp/verbs/*) seats @arrival as the
  // actor for a name-only socket's world verb, so it is never bodiless.

  let normalizedTarget = null;
  if (of && typeof of === "object") {
    if (of.kind && !VALID_TARGET_KINDS.has(of.kind)) {
      throw new Error(
        `logFact: of.kind must be one of ${[...VALID_TARGET_KINDS].join("|")}`,
      );
    }
    if (of.kind || of.id) {
      normalizedTarget = {
        kind: of.kind || null,
        id: of.id != null ? String(of.id) : null,
      };
    }
  }

  // Heaven routing: facts targeting a heaven space always land on
  // branch="0". The doctrine is that heaven entries have one
  // projection per story regardless of caller's branch . the same
  // applies to their fact streams. Without this rewrite, a set-space
  // call from #1 against a heaven space would create a per-branch
  // reel, defeating the doctrine.
  //
  // Only applies to space targets (heaven is by space); being and
  // matter targets keep their requested branch.
  if (
    normalizedTarget &&
    normalizedTarget.kind === "space" &&
    normalizedTarget.id &&
    branch !== "0"
  ) {
    try {
      const { isHeavenSpace } = await import(
        "../../materials/space/heavenLineage.js",
      );
      if (await isHeavenSpace(normalizedTarget.id)) {
        branch = "0";
      }
    } catch {
      // Heaven classifier unavailable (pre-bootstrap): leave branch
      // as-is. Genesis paths always pass branch="0" anyway.
    }
  }

  // Subtree-scope gate. When the branch declares a scope (a space
  // subtree), writes to aggregates outside the scope refuse loud.
  // Heaven writes routed above are exempt (heaven targets bypass this
  // check by virtue of branch already being "0"). The check is a
  // single classifier hit + an ancestor walk on miss; cached.
  //
  // Doctrine: subtree branches let operators experiment on one feature
  // without contaminating the rest of the story. Outside the scope,
  // the branch is transparent (reads inherit from parent); inside,
  // it diverges normally. Writes outside the scope are loud bugs
  // (you forgot to switch branches), not silent forwards.
  if (
    normalizedTarget &&
    normalizedTarget.kind &&
    normalizedTarget.id &&
    branch !== "0"
  ) {
    // Load the scope module separately from running the check. A load
    // failure is a genuine pre-bootstrap signal (branch infra not yet
    // loaded) and is safe to swallow. But the check ITSELF must FAIL
    // CLOSED: if getHistoryScopeSpaceId / isTargetInHistoryScope throws
    // (a resolver bug, a missing branch row), the write is REFUSED,
    // not silently allowed. A scope gate that fails open is no gate —
    // an out-of-scope write would slip through on any internal error.
    let scopeMod = null;
    try {
      scopeMod = await import("../../materials/history/historyScope.js");
    } catch {
      scopeMod = null; // pre-bootstrap: branch infra not loaded
    }
    if (scopeMod) {
      const { isTargetInHistoryScope, getHistoryScopeSpaceId } = scopeMod;
      let scopeSpaceId;
      try {
        scopeSpaceId = await getHistoryScopeSpaceId(branch);
      } catch (err) {
        throw new IbpError(
          IBP_ERR.FORBIDDEN,
          `SCOPE_CHECK_FAILED: could not resolve scope for branch "#${branch}" ` +
          `(${err.message}); refusing the write rather than bypass the gate.`,
          { branch, target: normalizedTarget },
        );
      }
      if (scopeSpaceId) {
        let allowed;
        try {
          allowed = await isTargetInHistoryScope(branch, normalizedTarget);
        } catch (err) {
          throw new IbpError(
            IBP_ERR.FORBIDDEN,
            `SCOPE_CHECK_FAILED: scope test threw for branch "#${branch}" ` +
            `target ${normalizedTarget.kind}:${normalizedTarget.id} ` +
            `(${err.message}); refusing the write rather than bypass the gate.`,
            { branch, target: normalizedTarget, scopeSpaceId },
          );
        }
        if (!allowed) {
          throw new IbpError(
            IBP_ERR.FORBIDDEN,
            `SCOPE_VIOLATION: branch "#${branch}" is scoped to a subtree and ` +
            `cannot write to ${normalizedTarget.kind}:${normalizedTarget.id} ` +
            `(outside scope spaceId "${scopeSpaceId}"). ` +
            `Switch to the parent branch to act on out-of-scope targets, ` +
            `or widen the branch's scope via re-creation.`,
            { branch, target: normalizedTarget, scopeSpaceId },
          );
        }
      }
    }
  }

  // Per-verb target-kind constraint. BE acts on the actor's own
  // identity; SUMMON acts on the recipient. Both are always being-
  // targeted. Only DO can target a non-being kind (space, matter,
  // place, stance). Catches mis-routed facts at the stamp boundary
  // before they reach the fold or the inner/outer classifier.
  if (BEING_ONLY_TARGET_VERBS.has(verb)) {
    if (!normalizedTarget || normalizedTarget.kind !== "being") {
      throw new Error(
        `logFact: verb "${verb}" requires of.kind === "being" (got ${normalizedTarget?.kind ?? "(none)"})`,
      );
    }
  }

  // Death gate (seed/done/DualBeingParents — "be:death freezes both
  // chains"). Refuse to stamp any Fact whose actor or being-target is
  // already dead. The lone exception is the be:death fact itself —
  // without it the lock can never seal. Past acts + grants stay in
  // the chain (this gate runs at stamp time, not at fold time).
  //
  // Reads via loadOrFold on the Fact's branch, so divergent sub-
  // branches see their own view of liveness. The seed's I-Am and
  // pre-bootstrap moments emit Facts before any Being row exists;
  // isBeingDead returns false for a missing row so genesis isn't
  // blocked. Death stamps land on actual beings only.
  const { isBeingDead, isDeathFact } = await import(
    "../../materials/being/closure.js"
  );
  if (!isDeathFact({ verb, act })) {
    if (through && await isBeingDead(through, branch)) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        `logFact: being ${String(through).slice(0, 8)} is closed (be:death). ` +
        `The actor chain is frozen; no new facts can ride this being.`,
        { through },
      );
    }
    if (
      normalizedTarget?.kind === "being" &&
      normalizedTarget?.id &&
      String(normalizedTarget.id) !== String(through) &&
      await isBeingDead(normalizedTarget.id, branch)
    ) {
      throw new IbpError(
        IBP_ERR.FORBIDDEN,
        `logFact: target being ${String(normalizedTarget.id).slice(0, 8)} is closed (be:death). ` +
        `The being chain is frozen; no new facts can land on this being's reel.`,
        { targetBeingId: normalizedTarget.id },
      );
    }
  }

  // Banish gate — the Name layer's be:death. Refuse to stamp any fact whose
  // ACTOR name (by) is banished. The lone exception is the name:banish
  // fact itself, so the tombstone can seal. A Name is story-wide (its reel
  // does not fork), so this reads on main regardless of the fact's branch;
  // isNameBanished short-circuits I_AM, so today's all-i-am traffic skips the
  // read. See materials/name/closure.js.
  const { isNameBanished, isBanishFact } = await import(
    "../../materials/name/closure.js"
  );
  if (!isBanishFact({ verb, act }) && by && await isNameBanished(by)) {
    throw new IbpError(
      IBP_ERR.FORBIDDEN,
      `logFact: name ${String(by).slice(0, 8)} is banished. ` +
      `No new fact can be signed by it.`,
      { by },
    );
  }

  // beforeFact hook . extensions can modify or cancel. The hook sees a
  // mutable view; only `params` and `result` are conventionally mutated
  // for enrichment. Cancellations short-circuit the stamp.
  const hookData = {
    through,
    verb,
    act,
    of: normalizedTarget,
    params,
    result,
    actId,
    sessionId,
    homeStory,
    wasRemote,
  };
  const hookResult = await hooks.run("beforeFact", hookData);
  if (hookResult.cancelled) {
    const code = hookResult.timedOut ? IBP_ERR.HOOK_TIMEOUT : IBP_ERR.HOOK_CANCELLED;
    throw new IbpError(code,
      `Fact cancelled: ${hookResult.reason || "extension"}`,
    );
  }

  const cappedParams = capPayload(hookData.params, "params");
  const cappedResult = capPayload(hookData.result, "result");
  const truncated = cappedParams.truncated || cappedResult.truncated;

  const finalTarget = hookData.of || normalizedTarget;

  // Foreign-origin idempotency. Per CROSS-WORLD.md "Idempotency on
  // the foreign side": when a Fact arrives carrying a crossOrigin
  // block, it's a cross-world act being stamped on this substrate.
  // Network retries, double-canopy deliveries, and replays produce
  // the same Fact more than once with the same crossOrigin.actId; the
  // receiving Stamper must dedup so the foreign reel doesn't grow
  // duplicates. The dedup key is {originStory, originBranch,
  // originBeingId, originActId} (full provenance tuple); we check by
  // crossOrigin.actId first since actId is unique enough in practice,
  // and the broader tuple guards against pathological reuse.
  const incomingCrossOrigin = hookData.params?.crossOrigin || cappedParams.value?.crossOrigin;
  if (incomingCrossOrigin?.actId && finalTarget) {
    const existing = await Fact.findOne({
      // Branch-scoped: the delivery targets a specific world; a
      // sibling branch holding the same crossOrigin tuple is a
      // different reel and must not suppress this stamp.
      history: branch,
      "of.kind": finalTarget.kind,
      "of.id":   finalTarget.id,
      "params.crossOrigin.actId":   incomingCrossOrigin.actId,
      "params.crossOrigin.beingId": incomingCrossOrigin.beingId,
    }).select("_id seq").lean();
    if (existing) {
      // Duplicate delivery — return without writing. Caller treats
      // this as success (the fact already landed on a prior delivery).
      return { _id: existing._id, seq: existing.seq, deduped: true };
    }
  }

  const baseDoc = {
    through,
    by,
    verb,
    act,
    of: finalTarget,
    params: cappedParams.value,
    result: cappedResult.value,
    truncated,
    actId,
    sessionId,
    homeStory: hookData.homeStory ?? homeStory,
    wasRemote: Boolean(hookData.wasRemote ?? wasRemote),
    foldSeq: typeof foldSeq === "number" ? foldSeq : null,
    date: new Date(),
    history: branch,
  };

  // Reel-bearing path: allocate seq, chain the hash, insert — all
  // under the per-reel append lock. Per STAMPER.md, pairing seq alloc
  // with insert eliminates the transient-gap window where a slow
  // inserter could leave its seq stranded behind the fold marker.
  // The lock also serializes the prev-hash lookup so concurrent
  // appenders can't both read the same `prev` and fork the chain.
  //
  // Target-less or place/stance facts skip the lock — they have no
  // reel; they still get a content-hash identity (p = GENESIS_PREV).
  if (finalTarget && REEL_KINDS.has(finalTarget.kind) && finalTarget.id) {
    const { session = null, skipEagerFold = false } = opts;
    // Critical section: allocSeq + prev-hash read + insert, all
    // under the per-reel append lock (per STAMPER.md). The same
    // body runs whether called standalone or from sealFacts; the
    // ONLY difference is who's holding the lock — sealFacts holds
    // it for the whole transaction across reels, so a nested
    // withReelLock here would deadlock.
    const runAppend = async () => {
      const seq = await allocSeq(finalTarget.kind, finalTarget.id, { session, branch });

      // INTEGRITY chain: read the prev fact's identity, LINEAGE-
      // AWARE. seq is monotonic per reel; under this lock, prev sits
      // at exactly seq-1 — but on a non-main branch, seq-1 may be
      // owned by an ANCESTOR (the first divergent fact chains to the
      // parent's fact at the branchPoint, linking the chain ACROSS
      // the fork). The old unbranded lookup could match a SIBLING
      // branch's fact at the same seq — the chain-corruption bug
      // this lineage walk retires. A missing prev (a true gap from
      // a crashed alloc) falls back to GENESIS_PREV.
      const p = await prevHashAt(finalTarget.kind, finalTarget.id, seq - 1, branch, session);

      // The identity IS the hash. Computed over the full content
      // (including branch and seq) chained to p; no random ids.
      const fullDoc = { ...baseDoc, seq, p };
      const _id = computeHash(p, contentOf(fullDoc));
      try {
        if (session) {
          // Mongoose: insert-with-session requires the array form.
          await Fact.create([{ ...fullDoc, _id }], { session });
        } else {
          await Fact.create({ ...fullDoc, _id });
        }
      } catch (err) {
        // Duplicate IDENTITY (same content, same world, same
        // history) is dedup semantics under content addressing —
        // the fact already exists; this stamp is a replay. Only the
        // _id collision is dedup; a seq collision on
        // branch_target_seq_unique stays a REAL error (two different
        // contents fighting for one slot).
        if (err?.code === 11000 && /_id_?\b/.test(err?.message || "")) {
          log.debug("DB", `Fact replay deduped (${branch}:${finalTarget.kind}:${finalTarget.id} seq=${seq})`);
          return;
        }
        throw err;
      }

      // The reel's ROOT HASH is its head fact's identity (every _id
      // commits to all priors). Denormalized onto the ReelHead in
      // the same lock/session so branch/story roll-ups are one
      // collection scan (chainRoots.js).
      const headUpdate = ReelHead.updateOne(
        { _id: reelKey(branch, finalTarget.kind, finalTarget.id) },
        { $set: { headHash: _id } },
      );
      if (session) headUpdate.session(session);
      await headUpdate;
    };
    try {
      if (session || opts.lockHeldByCaller) {
        // The caller already holds the per-reel append lock for this
        // reel. Either implicitly (session present, so sealFacts /
        // sealAct is holding the lock around the open transaction
        // per PARALLEL FACTS §1.2) or explicitly (lockHeldByCaller,
        // single-reel sealFacts short-circuit). withReelLock is
        // non-reentrant; re-acquiring here would deadlock.
        await runAppend();
      } else {
        await withReelLock(branch, finalTarget.kind, finalTarget.id, runAppend);
      }
    } catch (err) {
      log.error("DB", `Fact append failed (${act} on ${finalTarget.kind}:${finalTarget.id} branch=${branch}): ${err.message}`);
      // Carry the underlying message + code through so callers see the
      // actual cause (E11000 duplicate, missing index, schema validation)
      // instead of the bare "Failed to stamp Fact" wrapper.
      //
      // IMPORTANT: preserve errorLabels so withTransaction sees
      // TransientTransactionError / UnknownTransactionCommitResult and
      // can retry. Without this, the first write to facts/beings/etc.
      // on a fresh DB hits "Unable to write... due to catalog changes"
      // (a collection-creation race that Mongo asks us to retry), and
      // the retry never happens because the wrapped error lost its
      // labels — boot fails on the first write of genesis.
      const wrapped = new Error(`Failed to stamp Fact (${branch}:${finalTarget.kind}:${finalTarget.id} ${act}): ${err.message}`);
      wrapped.cause = err;
      if (err?.code) wrapped.code = err.code;
      if (err?.errorLabels) wrapped.errorLabels = err.errorLabels;
      if (typeof err?.hasErrorLabel === "function") {
        wrapped.hasErrorLabel = (label) => err.hasErrorLabel(label);
      }
      throw wrapped;
    }

    // Eager-fold. Per STAMPER.md Decision: "eager-fold is an inline
    // call to `fold(target)`. Not a second projection-writer." The
    // fold engine's compare-and-set handles concurrency; failure here
    // is harmless — the next fold round self-heals.
    //
    // Skip when called inside a sealFacts transaction (skipEagerFold).
    // sealFacts runs folds AFTER commit so projections see the
    // committed state instead of in-flight transactional state. The
    // projections are self-healing either way; this just avoids
    // wasted reads against pre-commit state.
    if (!skipEagerFold) {
      try {
        const { fold } = await import("../../present/stamper/2-fold/foldEngine.js");
        // Fold runs on the SAME branch the fact landed on. Without
        // threading branch the fold engine throws "branch is required"
        // (post-doctrine-shift) and the seal aborts.
        await fold(finalTarget.kind, finalTarget.id, { branch });
      } catch (err) {
        // Self-healing: the next fold catches up. Log but don't throw —
        // the fact is the source of truth and is already on disk.
        log.debug("Fold", `eager-fold failed for ${finalTarget.kind}:${finalTarget.id}: ${err.message}`);
      }
    }
  } else {
    // Non-reel-bearing path: no chain (no reel), but every fact gets
    // a content-hash identity. p = GENESIS_PREV; identical content in
    // the same world dedups to one row (correct under CAS).
    try {
      const fullDoc = { ...baseDoc, seq: null, p: GENESIS_PREV };
      const _id = computeHash(GENESIS_PREV, contentOf(fullDoc));
      if (opts.session) {
        await Fact.create([{ ...fullDoc, _id }], { session: opts.session });
      } else {
        await Fact.create({ ...fullDoc, _id });
      }
    } catch (err) {
      if (err?.code === 11000 && /_id_?\b/.test(err?.message || "")) {
        log.debug("DB", `Fact replay deduped (non-reel ${act})`);
        return;
      }
      log.error("DB", `Fact save failed (${act}): ${err.message}`);
      throw new Error("Failed to stamp Fact");
    }
  }
}

/**
 * The previous fact's identity for an append at `prevSeq + 1`,
 * lineage-aware. On main (or when prevSeq sits past this branch's
 * own branchPoint) the prev lives on the SAME branch. Otherwise it
 * lives on whichever lineage ancestor owns prevSeq — walking
 * leaf-to-root, the first branch whose floor sits below prevSeq is
 * the owner (main's floor is 0). The first divergent fact on a
 * branch therefore chains to the PARENT's fact at the branchPoint:
 * one chain across the fork, exactly like the read path's
 * range-union (foldEngine.readReelBetween).
 *
 * prevSeq <= 0 → GENESIS_PREV. Missing prev row (a true gap from a
 * crashed alloc, or pre-CAS rows) → GENESIS_PREV, same fallback as
 * the old stamper.
 */
async function prevHashAt(kind, id, prevSeq, branch, session = null) {
  if (!(prevSeq > 0)) return GENESIS_PREV;

  const { isMain, resolveHistoryLineage, getBranchPoint } =
    await import("../../materials/history/histories.js");

  let owner = branch;
  if (!isMain(branch)) {
    const lineage = await resolveHistoryLineage(branch); // main → leaf
    owner = null;
    for (let i = lineage.length - 1; i >= 0; i--) {
      const here = lineage[i];
      const floor = isMain(here) ? 0 : await getBranchPoint(here, kind, id);
      if (prevSeq > (floor || 0)) { owner = here; break; }
    }
    if (!owner) return GENESIS_PREV;
  }

  const historyClause = isMain(owner)
    ? { $or: [{ history: "0" }, { history: { $exists: false } }] }
    : { history: owner };
  let q = Fact.findOne(
    { "of.kind": kind, "of.id": id, seq: prevSeq, ...historyClause },
    { _id: 1 },
  ).lean();
  if (session) q = q.session(session);
  const prev = await q;
  return prev?._id || GENESIS_PREV;
}

// ─────────────────────────────────────────────────────────────────────
// sealFacts — the seal is the unit of commit (atomicity for ΔF).
// ─────────────────────────────────────────────────────────────────────
//
// MODEL.md ATOMIC SEAL: commit(ΔF) ∈ {all, nothing}. ΔF can span
// multiple reels. The whole set commits as one unit. logFact is the
// per-reel append primitive; sealFacts is the ΔF commit boundary.
// One act → one ΔF → one sealFacts → one Mongo transaction.
//
// Single-fact ΔF: no transaction needed — logFact's per-reel lock +
// single-doc insert is already atomic. sealFacts delegates.
//
// Multi-fact ΔF: requires a Mongo replica set (multi-document
// transactions are a replica-set feature). sealFacts opens one
// session, acquires per-reel locks in sorted order (deadlock
// prevention), appends each
// fact inside the session, commits as one transaction. If any
// append fails, the transaction aborts and zero facts land. PAST
// FIXED holds end-to-end.
//
// Eager-fold runs AFTER commit, not inside, so projections see the
// committed state. The fact-chain is the source of truth;
// projections self-heal even without eager-fold.

export const REPLICA_SET_REQUIRED_MSG =
  "Multi-fact ΔF requires a Mongo replica set (multi-document " +
  "transactions are a replica-set feature). To enable on a dev box: " +
  "stop mongod, start with `--replSet rs0`, then `mongosh --eval 'rs.initiate()'`.";

export function isReplicaSetCluster() {
  // mongoose.connection.db.topology.type === "ReplicaSetWithPrimary" /
  // "ReplicaSetNoPrimary" — but the simplest reliable check is the
  // topology description on the client.
  try {
    const topology = mongoose.connection?.client?.topology;
    if (!topology) return false;
    const desc = topology.description;
    if (!desc) return false;
    // ReplicaSet types contain "ReplicaSet" in the name.
    return /ReplicaSet/i.test(desc.type || "");
  } catch {
    return false;
  }
}

/**
 * Group a ΔF by reel and sort the reels by key. Centralizes the
 * grouping so sealFacts and sealAct produce identical lock-order
 * for the same ΔF.
 *
 *   - Reel-bearing facts (of.kind in REEL_KINDS, of.id set)
 *     bucket by "<kind>:<id>".
 *   - Non-reel-bearing facts (place/stance, target-less) accumulate
 *     in orphanFacts and commit without a reel lock — they only
 *     ride the session for atomicity.
 *
 * Sorted order is deterministic and identical across callers, so
 * two concurrent transactions touching the same set of reels
 * acquire locks in the same order and cannot deadlock.
 *
 * @param {Array<object>} deltaF
 * @returns {{ sortedReels: Array<{kind,id,facts}>, orphanFacts: Array<object> }}
 */
export function groupByReel(deltaF) {
  const factsByReel = new Map();
  const orphanFacts = [];
  for (const spec of deltaF) {
    const of = spec?.of;
    if (of && REEL_KINDS.has(of.kind) && of.id) {
      // Reel identity is (branch, kind, id). A fact on branch=1
      // targeting being:X writes a different reel than a fact on
      // branch=0 targeting the same being. logFact already required
      // branch upstream, so here we hold the caller to it — no silent
      // remap to main. If branch is absent we throw rather than guess.
      if (typeof spec.history !== "string" || !spec.history.length) {
        throw new Error(
          `groupByReel: fact spec is missing history (${spec.verb}:${spec.act} on ` +
          `${of.kind}:${String(of.id).slice(0,8)}). Upstream caller must thread it.`,
        );
      }
      const branch = spec.history;
      const key = `${branch}:${of.kind}:${of.id}`;
      const entry = factsByReel.get(key)
        || { branch, kind: of.kind, id: String(of.id), facts: [] };
      entry.facts.push(spec);
      factsByReel.set(key, entry);
    } else {
      orphanFacts.push(spec);
    }
  }
  const sortedReels = [...factsByReel.keys()].sort().map(k => factsByReel.get(k));
  return { sortedReels, orphanFacts };
}

/**
 * Acquire every per-reel append lock in sorted order, then run fn.
 * The callback runs only once every lock is held; locks release in
 * reverse order after fn resolves or rejects.
 *
 * PARALLEL FACTS §1.2: "lock at append, only the append is serial."
 * The lock must span the full read-snapshot lifetime of the seal —
 * from before the Mongo session opens through after the transaction
 * commits — so two contenders on the same reel cannot have
 * overlapping snapshots. If the lock were taken inside the
 * transaction (former shape), contender B's session would snapshot
 * `reelHeads` while contender A still held the lock for its
 * in-flight commit, and B's $inc on the same head would raise
 * WriteConflict at the storage engine — a Strategy-B-shaped seal
 * rejection on a Strategy-A workload (§6 violation). Holding the
 * lock outside the transaction restores §1.2 by construction.
 */
export async function withReelLocks(sortedReels, fn) {
  const acquire = async (i) => {
    if (i === sortedReels.length) return fn();
    const reel = sortedReels[i];
    return withReelLock(reel.branch, reel.kind, reel.id, () => acquire(i + 1));
  };
  return acquire(0);
}

/**
 * Append a ΔF inside an already-open Mongo session/transaction.
 *
 * The caller (sealFacts or sealAct) is responsible for holding
 * every reel lock for the full transaction lifetime via
 * withReelLocks. This helper just iterates: each fact goes through
 * logFact with the session, and logFact skips its own withReelLock
 * because session-present means the caller is holding it.
 *
 * Returns metadata the outer caller uses for post-commit fold runs.
 *
 * @param {Array<object>} deltaF      fact specs (same shape logFact takes)
 * @param {ClientSession} session     Mongo session held by the outer txn
 * @returns {Promise<{ sortedReels: Array<{kind,id,facts}> }>}
 */
export async function appendDeltaFInSession(deltaF, session) {
  const { sortedReels, orphanFacts } = groupByReel(deltaF);
  for (const reel of sortedReels) {
    for (const spec of reel.facts) {
      await logFact(spec, { session, skipEagerFold: true });
    }
  }
  for (const spec of orphanFacts) {
    await logFact(spec, { session, skipEagerFold: true });
  }
  return { sortedReels };
}

/**
 * Run eager-fold on every reel that received facts. Called by the
 * outer commit boundary (sealFacts or sealAct) AFTER the transaction
 * commits, so projections see the committed state, not in-flight
 * transactional state. Self-healing — failures here are logged and
 * dropped; the next fold round catches up.
 */
export async function foldAfterCommit(sortedReels) {
  try {
    const { fold } = await import("../../present/stamper/2-fold/foldEngine.js");
    // DB-health gate. When Mongoose dropped its connection between the
    // commit and the post-seal fold (most commonly: a long synchronous
    // burst starves the heartbeat), every fold below will fail the
    // same way. The projection is a cache — missed folds just defer to
    // the next read's cold-fold path; nothing breaks, but warning per
    // reel produces a log flood when an act touched many aggregates
    // (a dance-floor plant births 5+ aggregates, so one disconnect
    // produces 5+ warnings on top of any per-tick noise). Skip the
    // batch and log once.
    const { isDbHealthy } = await import("../../seedStory/dbConfig.js");
    if (!isDbHealthy()) {
      _noteFoldDeferredOnce(sortedReels.length);
      return;
    }
    for (const reel of sortedReels) {
      try {
        // Branch-aware: each reel carries its branch from groupByReel
        // (which throws if any spec is missing branch). The post-commit
        // fold lands the new state on the branch's projection slot,
        // never on main's slot for a non-main reel. No `|| "0"` here —
        // a missing branch means upstream broke the invariant and we
        // want it loud, not silently folded onto main.
        await fold(reel.kind, reel.id, { branch: reel.branch });
      } catch (err) {
        // Warn (not debug): the projection slot for this reel did NOT
        // materialize. Anyone who SEEs the aggregate next will hit
        // loadOrFold's cold path; if that also fails (or the inner
        // facts have an issue) the user lands at a fallback. We
        // need to see this in dev — silent debug-level masked the
        // "newly registered being lands off-grid" class of bugs.
        log.warn(
          "Fold",
          `post-seal fold failed for ${reel.branch}:${reel.kind}:${String(reel.id).slice(0, 8)}: ${err.message}`,
        );
      }
    }
    // afterReelArrival . one batch-level notifier for every reel that
    // received facts in this seal. Reactive inner-face subscriptions
    // (protocols/ibp/innerFaceLive) listen here and refold the subs
    // whose weave indexes any of these reels. Firing ONCE per batch
    // (with the whole reels list) keeps the fan-out O(1) per act;
    // the subscription registry expands the batch internally against
    // its reelKey index and coalesces by subId so one act touching N
    // of a sub's reels triggers ONE refold.
    //
    // Shape of payload.reels: [{ reelKind, reelId, branch }]. Mirrors
    // the weave entry shape so the dispatcher can hash directly via
    // reelKey() without renormalizing.
    if (sortedReels.length > 0) {
      try {
        await hooks.run("afterReelArrival", {
          reels: sortedReels.map((r) => ({
            reelKind: r.kind,
            reelId:   String(r.id),
            branch:   r.branch,
          })),
        });
      } catch (err) {
        log.warn("Fold", `afterReelArrival fan failed: ${err.message}`);
      }
    }
  } catch (err) {
    log.warn("Fold", `foldAfterCommit unexpected error: ${err.message}`);
  }
}

let _foldDeferredNotedAt = 0;
function _noteFoldDeferredOnce(reelCount) {
  const now = Date.now();
  if (now - _foldDeferredNotedAt > 30000) {
    _foldDeferredNotedAt = now;
    log.warn(
      "Fold",
      `post-seal fold deferred for ${reelCount} reel(s) — Mongoose disconnected. The next read on each aggregate will cold-fold from its reel.`,
    );
  }
}

/**
 * Commit a ΔF — the fact-set produced by one act — as one unit.
 *
 * @param {Array<object>} deltaF  array of fact specs (same shape
 *   logFact accepts). For singleton ΔF (most acts today), pass a
 *   single-element array.
 * @param {object} [opts]
 * @param {boolean} [opts.requireTransaction=false] When true, refuse
 *   to commit even singleton ΔF without a replica set (forces the
 *   transactional path). Useful for tests that need to verify the
 *   transaction shape end-to-end.
 *
 * @returns {Promise<{ committed: number, txn: boolean }>}
 *   committed = number of facts in ΔF (post-commit). txn = whether
 *   a Mongo transaction was used.
 */
/**
 * Emit a Fact from inside a verb handler or material helper. The
 * Phase 2 single-entry point: handlers never call logFact directly.
 *
 * Two paths:
 *   - Inside a moment (moment.deltaF exists): synchronously
 *     append the spec to ctx.deltaF. The Fact commits at sealAct
 *     time, atomically with every other Fact the moment emits and
 *     with the Act row.
 *   - Outside a moment (boot, migration, scaffold, standalone tool
 *     paths): commit immediately via sealFacts singleton. Single-
 *     fact ΔF commits atomically without a transaction (logFact's
 *     per-reel lock is enough).
 *
 * This is the boundary the math is about: handlers contribute to
 * ΔF; only the seal commits. Direct logFact calls from handlers
 * are the pre-Phase-2 pattern and must not return.
 *
 * @param {object} spec       fact spec (same shape logFact accepts)
 * @param {object} [moment]  the moment's context, if any
 * @returns {Promise<void>}
 */
export async function emitFact(spec, moment = null) {
  // Stamp foldSeq if the moment recorded a fold for this fact's target
  // reel (PARALLEL FACTS §1.3). Already-set foldSeq wins (callers like
  // verify scripts that author facts manually retain control). Null
  // when the moment didn't fold this reel — null is the correct
  // signal for "no stale-detection key available."
  if (
    spec &&
    spec.foldSeq === undefined &&
    moment?.foldedSeqs instanceof Map &&
    spec.of?.kind &&
    spec.of?.id
  ) {
    const key = `${spec.of.kind}:${spec.of.id}`;
    spec.foldSeq = moment.foldedSeqs.get(key) ?? null;
  }

  // The actor NAME — every fact links DIRECTLY to the name that did it,
  // taken from the moment's act (actorAct.by), never re-resolved per
  // fact. An already-set by wins (manual authors retain control).
  if (spec && spec.by === undefined) {
    spec.by = moment?.actorAct?.by ?? null;
  }

  // Cross-world provenance. When the actor's Act seats on moment
  // and the target's world differs from the actor's world, derive the
  // crossOrigin block and attach it to params. Same-world facts get
  // null and nothing is attached. The Stamper enforces the contract
  // at insert time. See seed/past/act/crossOrigin.js + CROSS-WORLD.md.
  if (moment?.actorAct && spec?.of) {
    const { deriveCrossOrigin } = await import("../act/crossOrigin.js");
    const { getStoryDomain } = await import("../../ibp/address.js");
    const target = inferTargetWorld(spec, moment, getStoryDomain());
    const crossOrigin = deriveCrossOrigin(moment.actorAct, target);
    if (crossOrigin) {
      spec.params = { ...(spec.params || {}), crossOrigin };
    }
  }

  if (moment && Array.isArray(moment.deltaF)) {
    moment.deltaF.push(spec);
    return;
  }
  // No moment to accumulate into — boot, migration, scaffold, or a
  // standalone tool. Commit as a singleton ΔF (delegates to logFact).
  await sealFacts([spec]);
}

// Resolve the target's world (story + branch) from a fact spec.
// The spec carries `branch` (where the fact lands); the story is
// ALWAYS this substrate — the local stamper only ever writes local
// reels (cross-story writes travel over canopy and are stamped by
// the receiving substrate). The explicit `of.world` override
// remains for future forwarding shapes.
//
// The story must NOT fall back to actorAct.story: for an inbound
// foreign actor the act's story is the FOREIGN domain, and using it
// here made the target world look foreign too — deriveCrossOrigin
// then compared foreign === foreign and dropped `story` from the
// crossOrigin block (or dropped the whole block when the foreign
// branch string matched the local one, e.g. both "0"), losing
// provenance AND the crossOrigin.actId retry-dedupe.
//
// Always operates on ACTUAL branch paths, never pointers — pointer
// resolution happens at the address-parsing perimeter before any
// emit. See CROSS-WORLD.md "pointers vs actual branches."
function inferTargetWorld(spec, moment, localStory) {
  if (spec?.of?.world?.story && spec?.of?.world?.branch) {
    return { world: spec.of.world };
  }
  const branch = spec?.history || moment?.actorAct?.history || null;
  if (!branch || !localStory) return null;
  return { world: { story: localStory, branch } };
}

export async function sealFacts(deltaF, opts = {}) {
  if (!Array.isArray(deltaF)) {
    throw new Error("sealFacts: deltaF must be an array");
  }
  if (deltaF.length === 0) {
    return { committed: 0, txn: false };
  }

  // PARALLEL FACTS §3, the "microsecond of appending": a ΔF whose
  // facts all share ONE reel needs no multi-document transaction.
  // The per-reel append lock plus single-doc atomic inserts already
  // give §1.2's guarantee — the transaction would lie about what
  // the commit actually is (transactions exist for multi-reel
  // atomicity). Single-fact ΔF collapses into this case naturally.
  // The single-reel short-circuit also runs on standalone Mongo, so
  // boot/migration callers without a replica set still pass through
  // without needing requireTransaction:false. Orphan facts
  // (target-less, e.g. place/stance) force the multi-reel path
  // because they need the session for their own atomicity.
  const { sortedReels: lockReels, orphanFacts } = groupByReel(deltaF);
  if (
    lockReels.length <= 1 &&
    orphanFacts.length === 0 &&
    !opts.requireTransaction
  ) {
    if (lockReels.length === 0) {
      // No reel-bearing facts and no orphans — by construction
      // unreachable from here (deltaF.length > 0, every fact either
      // reels or orphans), but guarded for forward safety.
      return { committed: 0, txn: false };
    }
    const reel = lockReels[0];
    await withReelLock(reel.branch, reel.kind, reel.id, async () => {
      for (const spec of reel.facts) {
        await logFact(spec, { lockHeldByCaller: true, skipEagerFold: true });
      }
    });
    await foldAfterCommit(lockReels);
    return { committed: deltaF.length, txn: false };
  }

  // Multi-reel (or orphan-mixed, or transaction-required): needs a
  // replica set for multi-document atomic commit. Fail loud per the
  // hard prerequisite.
  if (!isReplicaSetCluster()) {
    throw new Error("sealFacts: " + REPLICA_SET_REQUIRED_MSG);
  }

  // PARALLEL FACTS §1.2: acquire every reel lock BEFORE opening the
  // session, hold them across the entire transaction (open → write
  // → commit → close). This bounds the snapshot lifetime so two
  // contenders on the same reel can never have overlapping
  // snapshots; the next contender's session cannot open until our
  // commit has landed. See withReelLocks for the full rationale.
  let result;
  await withReelLocks(lockReels, async () => {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        result = await appendDeltaFInSession(deltaF, session);
      });
    } catch (err) {
      log.error("Seal", `sealFacts aborted: ${err.message}`);
      throw err;
    } finally {
      await session.endSession();
    }
  });

  // Eager-fold AFTER commit. Self-healing on failure.
  await foldAfterCommit(result.sortedReels);

  return { committed: deltaF.length, txn: true };
}

function capPayload(value, label) {
  if (value == null) return { value: null, truncated: false };
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { value: { _unserializable: true, _label: label }, truncated: true };
  }
  const max = MAX_PAYLOAD_BYTES();
  if (Buffer.byteLength(serialized, "utf8") <= max) {
    return { value, truncated: false };
  }
  return {
    value: {
      _truncated: true,
      _bytes: Buffer.byteLength(serialized, "utf8"),
      preview: serialized.slice(0, Math.floor(max * 0.9)),
    },
    truncated: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────────────────────────────────

function MAX_QUERY_LIMIT() {
  return Math.max(
    1,
    Math.min(Number(getInternalConfigValue("factQueryLimit")) || 5000, 50000),
  );
}
const MAX_DATE_SPAN_MS = 365 * 24 * 60 * 60 * 1000;

function buildDateFilter(startDate, endDate) {
  const filter = {};
  const start = startDate ? Date.parse(startDate) : NaN;
  const end = endDate ? Date.parse(endDate) : NaN;

  if (startDate && isNaN(start)) throw new Error("Invalid startDate format");
  if (endDate && isNaN(end)) throw new Error("Invalid endDate format");
  if (!isNaN(start) && !isNaN(end) && end < start)
    throw new Error("endDate must be after startDate");
  if (!isNaN(start) && !isNaN(end) && end - start > MAX_DATE_SPAN_MS) {
    throw new Error("Date range cannot exceed 365 days");
  }

  if (!isNaN(start)) filter.$gte = new Date(start);
  if (!isNaN(end)) filter.$lte = new Date(end);
  return Object.keys(filter).length > 0 ? { date: filter } : {};
}

/**
 * Get the Fact reel for a space.
 * If beingId is provided, verifies the caller has access to the space's tree.
 * Seed-internal callers (hooks, migrations) can omit beingId.
 */
export async function getFacts({
  spaceId,
  limit,
  offset,
  startDate,
  endDate,
  beingId,
  history: branch,
}) {
  if (!spaceId) throw new Error("Missing required parameter: spaceId");

  if (beingId) {
    if (typeof branch !== "string" || !branch) {
      throw new Error("getFacts: branch is required when beingId is set (auth walks the chain)");
    }
    const access = await resolveSpaceAccess(spaceId, beingId, branch);
    if (!access.ok)
      throw new IbpError(IBP_ERR.SPACE_NOT_FOUND, "Space not found");
  }

  const query = {
    "of.kind": "space",
    "of.id": String(spaceId),
    ...buildDateFilter(startDate, endDate),
  };
  const safeLimit = Math.min(
    Math.max(Number(limit) || 100, 1),
    MAX_QUERY_LIMIT(),
  );
  const safeOffset = Math.max(0, Number(offset) || 0);

  const facts = await Fact.find(query)
    .populate("through", "name")
    .sort({ date: -1 })
    .skip(safeOffset)
    .limit(safeLimit)
    .lean();

  return { facts, limit: safeLimit };
}

/**
 * Get the reel for any target. Generalizes getFacts beyond space-only.
 * Returns facts targeting (kind, id) ordered newest-first by default
 * (explorer view); pass { order: "asc" } for chain-walk order.
 */
export async function getReel({ targetKind, targetId, limit, offset, order = "desc" }) {
  if (!targetKind || !targetId) {
    throw new Error("getReel: targetKind and targetId required");
  }
  if (!REEL_KINDS.has(targetKind)) {
    throw new Error(`getReel: targetKind must be one of ${[...REEL_KINDS].join("|")}`);
  }
  const query = { "of.kind": targetKind, "of.id": String(targetId) };
  const safeLimit  = Math.min(Math.max(Number(limit)  || 100, 1), MAX_QUERY_LIMIT());
  const safeOffset = Math.max(0, Number(offset) || 0);
  const dir = order === "asc" ? 1 : -1;
  const facts = await Fact.find(query)
    .populate("through", "name")
    .sort({ seq: dir, date: dir })
    .skip(safeOffset)
    .limit(safeLimit)
    .lean();
  return { facts, limit: safeLimit, offset: safeOffset };
}

/**
 * Build the reel-explorer descriptor for a (targetKind, targetId).
 * Used by SEE on <story>/.reel/<kind>/<id>. Includes the target's
 * display name (best-effort lookup) and a serialized fact list shaped
 * for the explorer view (full hash chain preserved).
 */
export async function describeReel(targetKind, targetId, opts = {}) {
  const { facts } = await getReel({ targetKind, targetId, ...opts });
  let targetName = null;
  try {
    const { loadProjection } = await import("../../materials/projections.js");
    const slot = await loadProjection(targetKind, targetId, "0");
    targetName = slot?.state?.name || null;
  } catch { /* name lookup is best-effort */ }
  return {
    target: { kind: targetKind, id: String(targetId), name: targetName },
    // Redact secrets on the way over the wire — the fact-chain in the DB
    // keeps them, but a reel surfaced to a client must not carry api keys
    // or credentials (they ride in set-being facts' params.value).
    facts: facts.map((f) => redactSecrets(serializeFactForReel(f))),
    count: facts.length,
  };
}

function serializeFactForReel(f) {
  return {
    // The fact's identity IS its content hash; p is the chain link.
    _id:       String(f._id),
    seq:       f.seq,
    verb:      f.verb,
    act:       f.act,
    of:        f.of,
    params:    f.params,
    result:    f.result,
    p:         f.p,
    date:      f.date,
    through:   f.through?._id ? String(f.through._id)
               : (f.through ? String(f.through) : null),
    beingName: f.through?.name || null,
    actId:     f.actId || null,
  };
}

/**
 * Get a being's Fact reel.
 */
export async function getFactsByBeing(beingId, limit, startDate, endDate) {
  if (!beingId) throw new Error("Missing required parameter: beingId");

  const query = { through: beingId, ...buildDateFilter(startDate, endDate) };
  const safeLimit = Math.min(
    Math.max(Number(limit) || 100, 1),
    MAX_QUERY_LIMIT(),
  );

  const facts = await Fact.find(query)
    .populate("through", "name")
    .sort({ date: -1 })
    .limit(safeLimit)
    .lean();

  return { facts };
}
