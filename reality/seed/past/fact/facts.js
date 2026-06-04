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
// row names the actor (beingId), the kind of act (verb, action), the
// target (space | matter | being | place | stance), and the input /
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
import log from "../../seedReality/log.js";
import { v4 as uuidv4 } from "uuid";
import { getInternalConfigValue } from "../../internalConfig.js";
import Fact from "./fact.js";
import { computeHash, contentOf, GENESIS_PREV } from "./hash.js";
import { hooks } from "../../hooks.js";
import { IBP_ERR, IbpError } from "../../ibp/protocol.js";
import { getRealityConfigValue } from "../../realityConfig.js";
import { resolveSpaceAccess } from "../../materials/space/spaces.js";
import { allocSeq } from "../reel/reelHeads.js";
import { withReelLock } from "../reel/appendLock.js";

// Reel-bearing target kinds — those with their own seq counter. Other
// kinds (place, stance) and target-less facts carry seq:null and stay
// outside the fold model for now.
const REEL_KINDS = new Set(["being", "space", "matter"]);

// ─────────────────────────────────────────────────────────────────────────
// WRITE
// ─────────────────────────────────────────────────────────────────────────

function MAX_PAYLOAD_BYTES() {
  const raw = Number(getInternalConfigValue("qualityNamespaceMaxBytes")) || 524288;
  return Math.max(1024, Math.min(raw, 2 * 1024 * 1024));
}
const MAX_ACTION_LENGTH = 100;
// The three stamping verbs. SEE never appends a Fact.
//   - do: action on a target (right stance). target.kind ∈ {space, matter, being, place, stance}.
//   - be: identity acting on self (left stance). target.kind === "being".
//   - summon: one being calling another (right stance, the recipient). target.kind === "being".
const VALID_VERBS = new Set(["do", "be", "summon"]);
const VALID_TARGET_KINDS = new Set([
  "space",
  "matter",
  "being",
  "place",
  "stance",
]);
// Per-verb target-kind constraint. DO accepts any kind; BE and
// SUMMON always act on a being. Enforced in logFact below so a
// caller can't slip a `verb:"be" target:{kind:"matter"}` past the
// guard and confuse the fold or the inner/outer classifier.
const BEING_ONLY_TARGET_VERBS = new Set(["be", "summon"]);

/**
 * Act a Fact onto the reel.
 *
 * @param {object} params           the fact spec (see fields below)
 * @param {string} params.beingId   actor (I_AM for scaffold flows)
 * @param {string} params.action    operation or sub-event name
 * @param {string} [params.verb="do"]   "do" | "be" | "summon"
 * @param {{kind:string,id:string}|null} [params.target]  what was acted on.
 *   When verb is "be" or "summon", target.kind MUST be "being" (enforced).
 * @param {*} [params.params]       input payload (any JSON; clipped on cap)
 * @param {*} [params.result]       output payload (any JSON; clipped on cap)
 * @param {string|null} [params.actId]   correlation
 * @param {string|null} [params.sessionId]  correlation
 * @param {string|null} [params.homeReality]   federation provenance
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
    beingId,
    verb = "do",
    action,
    target = null,
    params = null,
    result = null,
    actId = null,
    sessionId = null,
    homeReality = null,
    wasRemote = false,
    foldSeq = null,
  } = input;
  // Branch this fact lives on. REQUIRED — no silent default. The
  // cross-branch dispatch gate (Pass 4) settled the branch before the
  // fact ever reaches logFact; if it's missing here, a caller forgot
  // to thread summonCtx.branch and the fact would silently land on
  // main. Throw loudly so the offender shows up in stacks instead
  // of producing a "ghost" main-branch write nobody asked for.
  branch = input.branch;

  if (!beingId || !action) {
    throw new Error("logFact requires beingId and action");
  }
  if (typeof branch !== "string" || !branch.length) {
    throw new Error(
      `logFact: branch is required (got ${JSON.stringify(branch)}). ` +
      `Thread it from summonCtx.branch (in-moment), the wire layer (entry-point), ` +
      `or pass "0" explicitly for genesis/scaffold paths.`,
    );
  }
  if (typeof action !== "string" || action.length > MAX_ACTION_LENGTH) {
    throw new Error(
      `logFact: action must be a string under ${MAX_ACTION_LENGTH} chars`,
    );
  }
  if (!VALID_VERBS.has(verb)) {
    throw new Error(
      `logFact: verb must be one of ${[...VALID_VERBS].join("|")}`,
    );
  }

  let normalizedTarget = null;
  if (target && typeof target === "object") {
    if (target.kind && !VALID_TARGET_KINDS.has(target.kind)) {
      throw new Error(
        `logFact: target.kind must be one of ${[...VALID_TARGET_KINDS].join("|")}`,
      );
    }
    if (target.kind || target.id) {
      normalizedTarget = {
        kind: target.kind || null,
        id: target.id != null ? String(target.id) : null,
      };
    }
  }

  // Heaven routing: facts targeting a heaven space always land on
  // branch="0". The doctrine is that heaven entries have one
  // projection per reality regardless of caller's branch . the same
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

  // Per-verb target-kind constraint. BE acts on the actor's own
  // identity; SUMMON acts on the recipient. Both are always being-
  // targeted. Only DO can target a non-being kind (space, matter,
  // place, stance). Catches mis-routed facts at the stamp boundary
  // before they reach the fold or the inner/outer classifier.
  if (BEING_ONLY_TARGET_VERBS.has(verb)) {
    if (!normalizedTarget || normalizedTarget.kind !== "being") {
      throw new Error(
        `logFact: verb "${verb}" requires target.kind === "being" (got ${normalizedTarget?.kind ?? "(none)"})`,
      );
    }
  }

  // beforeFact hook . extensions can modify or cancel. The hook sees a
  // mutable view; only `params` and `result` are conventionally mutated
  // for enrichment. Cancellations short-circuit the stamp.
  const hookData = {
    beingId,
    verb,
    action,
    target: normalizedTarget,
    params,
    result,
    actId,
    sessionId,
    homeReality,
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

  const finalTarget = hookData.target || normalizedTarget;

  const baseDoc = {
    beingId,
    verb,
    action,
    target: finalTarget,
    params: cappedParams.value,
    result: cappedResult.value,
    truncated,
    actId,
    sessionId,
    homeReality: hookData.homeReality ?? homeReality,
    wasRemote: Boolean(hookData.wasRemote ?? wasRemote),
    foldSeq: typeof foldSeq === "number" ? foldSeq : null,
    date: new Date(),
    branch,
  };

  // Reel-bearing path: allocate seq, chain the hash, insert — all
  // under the per-reel append lock. Per STAMPER.md, pairing seq alloc
  // with insert eliminates the transient-gap window where a slow
  // inserter could leave its seq stranded behind the fold marker.
  // The lock also serializes the prev-hash lookup so concurrent
  // appenders can't both read the same `prev` and fork the chain.
  //
  // Target-less or place/stance facts skip the lock — they have no
  // reel and stay outside the fold model. They carry p=h=null.
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

      // INTEGRITY chain: read prev fact's h. seq is monotonic per
      // reel; under this lock, prev sits at exactly seq-1. A missing
      // prev (legacy pre-INTEGRITY row, or a true gap from a crashed
      // alloc) falls back to GENESIS_PREV.
      //
      // Pass 3 territory: when non-main branches start writing facts,
      // this lookup needs to filter the prev by branch lineage — the
      // first divergent fact in branch X has prev pointing at the
      // parent's fact at branchPoint, not at an X-local fact. For
      // Pass 2 only main exists at runtime, so the unbranded query
      // resolves correctly (every fact in the DB carries branch="0"
      // or no field, which is also main).
      let p = GENESIS_PREV;
      if (seq > 1) {
        let prevQuery = Fact.findOne(
          { "target.kind": finalTarget.kind, "target.id": finalTarget.id, seq: seq - 1 },
          { h: 1 },
        ).lean();
        if (session) prevQuery = prevQuery.session(session);
        const prev = await prevQuery;
        if (prev?.h) p = prev.h;
      }

      // Mint _id explicitly so it lands in the hashed content; the
      // schema default would generate it inside Mongoose, too late
      // for inclusion in the digest.
      const _id = uuidv4();
      const fullDoc = { ...baseDoc, _id, seq, p };
      const h = computeHash(p, contentOf(fullDoc));
      if (session) {
        // Mongoose: insert-with-session requires the array form.
        await Fact.create([{ ...fullDoc, h }], { session });
      } else {
        await Fact.create({ ...fullDoc, h });
      }
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
        await withReelLock(finalTarget.kind, finalTarget.id, runAppend);
      }
    } catch (err) {
      log.error("DB", `Fact append failed (${action} on ${finalTarget.kind}:${finalTarget.id} branch=${branch}): ${err.message}`);
      // Carry the underlying message + code through so callers see the
      // actual cause (E11000 duplicate, missing index, schema validation)
      // instead of the bare "Failed to stamp Fact" wrapper.
      const wrapped = new Error(`Failed to stamp Fact (${branch}:${finalTarget.kind}:${finalTarget.id} ${action}): ${err.message}`);
      wrapped.cause = err;
      if (err?.code) wrapped.code = err.code;
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
        const { fold } = await import("../../present/beats/2-fold/foldEngine.js");
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
    // Non-reel-bearing path: simple insert, seq stays null.
    try {
      if (opts.session) {
        await Fact.create([{ ...baseDoc, seq: null }], { session: opts.session });
      } else {
        await Fact.create({ ...baseDoc, seq: null });
      }
    } catch (err) {
      log.error("DB", `Fact save failed (${action}): ${err.message}`);
      throw new Error("Failed to stamp Fact");
    }
  }
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
// prevention — see [[project-sealfacts-atomic-seal]]), appends each
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
 *   - Reel-bearing facts (target.kind in REEL_KINDS, target.id set)
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
    const target = spec?.target;
    if (target && REEL_KINDS.has(target.kind) && target.id) {
      // Reel identity is (branch, kind, id). A fact on branch=1
      // targeting being:X writes a different reel than a fact on
      // branch=0 targeting the same being. logFact already required
      // branch upstream, so here we hold the caller to it — no silent
      // remap to main. If branch is absent we throw rather than guess.
      if (typeof spec.branch !== "string" || !spec.branch.length) {
        throw new Error(
          `groupByReel: fact spec is missing branch (${spec.verb}:${spec.action} on ` +
          `${target.kind}:${String(target.id).slice(0,8)}). Upstream caller must thread it.`,
        );
      }
      const branch = spec.branch;
      const key = `${branch}:${target.kind}:${target.id}`;
      const entry = factsByReel.get(key)
        || { branch, kind: target.kind, id: String(target.id), facts: [] };
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
    return withReelLock(reel.kind, reel.id, () => acquire(i + 1));
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
    const { fold } = await import("../../present/beats/2-fold/foldEngine.js");
    for (const reel of sortedReels) {
      try {
        // Branch-aware: each reel carries its branch from groupByReel.
        // The post-commit fold lands the new state on the branch's
        // projection slot, never on main's slot for a non-main reel.
        await fold(reel.kind, reel.id, { branch: reel.branch || "0" });
      } catch (err) {
        log.debug("Fold", `post-seal fold failed for ${reel.branch || "0"}:${reel.kind}:${reel.id}: ${err.message}`);
      }
    }
  } catch {}
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
 *   - Inside a moment (summonCtx.deltaF exists): synchronously
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
 * @param {object} [summonCtx]  the moment's context, if any
 * @returns {Promise<void>}
 */
export async function emitFact(spec, summonCtx = null) {
  // Stamp foldSeq if the moment recorded a fold for this fact's target
  // reel (PARALLEL FACTS §1.3). Already-set foldSeq wins (callers like
  // verify scripts that author facts manually retain control). Null
  // when the moment didn't fold this reel — null is the correct
  // signal for "no stale-detection key available."
  if (
    spec &&
    spec.foldSeq === undefined &&
    summonCtx?.foldedSeqs instanceof Map &&
    spec.target?.kind &&
    spec.target?.id
  ) {
    const key = `${spec.target.kind}:${spec.target.id}`;
    spec.foldSeq = summonCtx.foldedSeqs.get(key) ?? null;
  }

  if (summonCtx && Array.isArray(summonCtx.deltaF)) {
    summonCtx.deltaF.push(spec);
    return;
  }
  // No moment to accumulate into — boot, migration, scaffold, or a
  // standalone tool. Commit as a singleton ΔF (delegates to logFact).
  await sealFacts([spec]);
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
    await withReelLock(reel.kind, reel.id, async () => {
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
  branch,
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
    "target.kind": "space",
    "target.id": String(spaceId),
    ...buildDateFilter(startDate, endDate),
  };
  const safeLimit = Math.min(
    Math.max(Number(limit) || 100, 1),
    MAX_QUERY_LIMIT(),
  );
  const safeOffset = Math.max(0, Number(offset) || 0);

  const facts = await Fact.find(query)
    .populate("beingId", "name")
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
  const query = { "target.kind": targetKind, "target.id": String(targetId) };
  const safeLimit  = Math.min(Math.max(Number(limit)  || 100, 1), MAX_QUERY_LIMIT());
  const safeOffset = Math.max(0, Number(offset) || 0);
  const dir = order === "asc" ? 1 : -1;
  const facts = await Fact.find(query)
    .populate("beingId", "name")
    .sort({ seq: dir, date: dir })
    .skip(safeOffset)
    .limit(safeLimit)
    .lean();
  return { facts, limit: safeLimit, offset: safeOffset };
}

/**
 * Build the reel-explorer descriptor for a (targetKind, targetId).
 * Used by SEE on <reality>/.reel/<kind>/<id>. Includes the target's
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
    facts: facts.map(serializeFactForReel),
    count: facts.length,
  };
}

function serializeFactForReel(f) {
  return {
    _id:       String(f._id),
    seq:       f.seq,
    verb:      f.verb,
    action:    f.action,
    target:    f.target,
    params:    f.params,
    result:    f.result,
    p:         f.p,
    h:         f.h,
    date:      f.date,
    beingId:   f.beingId?._id ? String(f.beingId._id)
               : (f.beingId ? String(f.beingId) : null),
    beingName: f.beingId?.name || null,
    actId:     f.actId || null,
  };
}

/**
 * Get a being's Fact reel.
 */
export async function getFactsByBeing(beingId, limit, startDate, endDate) {
  if (!beingId) throw new Error("Missing required parameter: beingId");

  const query = { beingId, ...buildDateFilter(startDate, endDate) };
  const safeLimit = Math.min(
    Math.max(Number(limit) || 100, 1),
    MAX_QUERY_LIMIT(),
  );

  const facts = await Fact.find(query)
    .populate("beingId", "name")
    .sort({ date: -1 })
    .limit(safeLimit)
    .lean();

  return { facts };
}
