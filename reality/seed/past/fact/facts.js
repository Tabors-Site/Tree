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
const VALID_VERBS = new Set(["do", "be"]);
const VALID_TARGET_KINDS = new Set([
  "space",
  "matter",
  "being",
  "place",
  "stance",
]);

/**
 * Act a Fact onto the reel.
 *
 * @param {object} params           the fact spec (see fields below)
 * @param {string} params.beingId   actor (I_AM for scaffold flows)
 * @param {string} params.action    operation or sub-event name
 * @param {string} [params.verb="do"]   "do" | "be"
 * @param {{kind:string,id:string}|null} [params.target]  what was acted on
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

  if (!beingId || !action) {
    throw new Error("logFact requires beingId and action");
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
      const seq = await allocSeq(finalTarget.kind, finalTarget.id, { session });

      // INTEGRITY chain: read prev fact's h. seq is monotonic per
      // reel; under this lock, prev sits at exactly seq-1. A missing
      // prev (legacy pre-INTEGRITY row, or a true gap from a crashed
      // alloc) falls back to GENESIS_PREV.
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
      if (session) {
        // sealFacts already holds the reel lock for this reel.
        // withReelLock is non-reentrant; calling it here would
        // deadlock. Trust the caller (sealFacts) to have acquired
        // every needed lock up front.
        await runAppend();
      } else {
        await withReelLock(finalTarget.kind, finalTarget.id, runAppend);
      }
    } catch (err) {
      log.error("DB", `Fact append failed (${action} on ${finalTarget.kind}:${finalTarget.id}): ${err.message}`);
      throw new Error("Failed to stamp Fact");
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
        await fold(finalTarget.kind, finalTarget.id);
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
 * Append a ΔF inside an already-open Mongo session/transaction.
 *
 * The caller (sealFacts or sealAct) opens the session and the
 * withTransaction; this helper does the work inside it:
 *   - groups facts by reel,
 *   - sorts the reels by key (deadlock-free lock ordering),
 *   - acquires per-reel locks in sorted order via nested withReelLock,
 *   - appends each fact in its reel (logFact with the session passed
 *     through; logFact skips its own withReelLock when session is
 *     present because this caller already holds it).
 *
 * Returns metadata the outer caller uses for post-commit fold runs.
 *
 * @param {Array<object>} deltaF      fact specs (same shape logFact takes)
 * @param {ClientSession} session     Mongo session held by the outer txn
 * @returns {Promise<{ sortedReels: Array<{kind,id,facts}> }>}
 */
export async function appendDeltaFInSession(deltaF, session) {
  // Group facts by reel. Non-reel-bearing facts (place/stance,
  // target-less) commit too but don't take reel locks — they go
  // into the same transaction as a degenerate "no-lock" reel.
  const factsByReel = new Map(); // "kind:id" → { kind, id, facts: [] }
  const orphanFacts = [];        // non-reel-bearing
  for (const spec of deltaF) {
    const target = spec?.target;
    if (target && REEL_KINDS.has(target.kind) && target.id) {
      const key = `${target.kind}:${target.id}`;
      const entry = factsByReel.get(key)
        || { kind: target.kind, id: String(target.id), facts: [] };
      entry.facts.push(spec);
      factsByReel.set(key, entry);
    } else {
      orphanFacts.push(spec);
    }
  }

  // Deterministic lock-acquisition order: sort by reel key. Two
  // concurrent callers touching reels A and B acquire in the same
  // order, so they can't deadlock by taking opposite orders.
  const sortedKeys = [...factsByReel.keys()].sort();
  const sortedReels = sortedKeys.map(k => factsByReel.get(k));

  const acquireAndAppend = async (i) => {
    if (i === sortedReels.length) {
      for (const reel of sortedReels) {
        for (const spec of reel.facts) {
          await logFact(spec, { session, skipEagerFold: true });
        }
      }
      for (const spec of orphanFacts) {
        await logFact(spec, { session, skipEagerFold: true });
      }
      return;
    }
    const reel = sortedReels[i];
    await withReelLock(reel.kind, reel.id, () => acquireAndAppend(i + 1));
  };

  await acquireAndAppend(0);
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
        await fold(reel.kind, reel.id);
      } catch (err) {
        log.debug("Fold", `post-seal fold failed for ${reel.kind}:${reel.id}: ${err.message}`);
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

  // Singleton ΔF — no transaction needed unless caller explicitly
  // requested one (test path). logFact's per-reel atomic commit
  // covers single-fact correctness on standalone Mongo. Used by
  // boot/migration callers that have no surrounding Act (sealAct
  // is the moment's seal boundary; sealFacts standalone is for
  // material helpers called outside a moment).
  if (deltaF.length === 1 && !opts.requireTransaction) {
    await logFact(deltaF[0]);
    return { committed: 1, txn: false };
  }

  // Multi-fact (or explicitly-requested-transactional singleton):
  // requires replica set. Fail loud per the hard prerequisite.
  if (!isReplicaSetCluster()) {
    throw new Error("sealFacts: " + REPLICA_SET_REQUIRED_MSG);
  }

  const session = await mongoose.startSession();
  let result;
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
}) {
  if (!spaceId) throw new Error("Missing required parameter: spaceId");

  if (beingId) {
    const access = await resolveSpaceAccess(spaceId, beingId);
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
