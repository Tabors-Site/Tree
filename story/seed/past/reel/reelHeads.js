// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Per-reel seq allocation. The write-side contract the fold rests on.
//
// Every fact lives on exactly one aggregate's reel. The reel needs
// a per-reel monotonic seq, allocated atomically at append time so
// the fold can sort and never invert. `allocSeq(type, id)` is that
// allocator: single-doc `$inc` with upsert, atomic by Mongo
// construction, microscopic critical section.
//
// See [STAMPER.md](../factory/stamper/STAMPER.md) — "Decision: seq is
// a per-reel monotonic counter, allocated atomically at append."
//
// Note: allocSeq alone does NOT close the transient-gap window
// between (allocate seq) and (insert fact). The full append flow in
// emitFact pairs them under a per-reel append lock. This module
// only owns the counter; the lock lives with the append flow.

import ReelHead from "./reelHead.js";
import { getBranchPoint, isMain, MAIN } from "../../materials/history/histories.js";

const VALID_TYPES = new Set(["being", "space", "matter", "name"]);

// `_id` shape is `<history>:<type>:<id>` for all histories. Main is `"0"`
// — explicit, not implicit-by-absence — so queries that filter on
// history don't need an OR-with-$exists clause for the head doc. (The
// equivalent clause IS still needed on Fact reads where legacy data
// exists without the field.)
export function reelKey(history, type, id) {
  return `${history}:${type}:${id}`;
}

/**
 * Atomically allocate the next seq for an aggregate's reel in the
 * given history. Single-doc `$inc` + upsert.
 *
 * The history's first fact on a reel needs to pick up where the
 * parent's reel left off at branch time (so seq stays monotonic
 * across the inherited prefix). For now this is handled at the
 * branch-creation level: when a history is branched, its reelheads are
 * seeded with the parent's heads as their starting `head`. Subsequent
 * allocs in the history advance from there. The branch-creation op
 * (Pass 3) does the seeding; Pass 2 just owns the schema and the
 * lineage-aware allocator path.
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} id  aggregate id
 * @param {object} [opts]
 * @param {string}        [opts.history="0"] history path; defaults to main
 * @param {ClientSession} [opts.session]    Mongo session for transactional participation
 * @returns {Promise<number>} the allocated seq (always >= 1)
 * @throws when type or id is missing/invalid
 */
export async function allocSeq(type, id, opts = {}) {
  if (!VALID_TYPES.has(type)) {
    throw new Error(`allocSeq: type must be one of ${[...VALID_TYPES].join("|")}, got "${type}"`);
  }
  if (!id || typeof id !== "string") {
    throw new Error(`allocSeq: id must be a non-empty string`);
  }

  const history = typeof opts.history === "string" && opts.history.length > 0
    ? opts.history
    : MAIN;
  const key = reelKey(history, type, id);

  const baseOpts = opts.session ? { session: opts.session } : {};

  // Main short-circuit: upsert + $inc in one round trip. First fact
  // on a reel starts at seq 1; subsequent facts increment.
  if (isMain(history)) {
    const doc = await ReelHead.findOneAndUpdate(
      { _id: key },
      {
        $inc: { head: 1 },
        $setOnInsert: { history, type, id },
      },
      { upsert: true, returnDocument: "after", lean: true, ...baseOpts },
    );
    return doc.head;
  }

  // Non-main histories inherit seqs from the parent's reel at branch
  // time. A history's first fact on reel R starts at branchPoint[R] + 1
  // so the seq stays monotonic across the inherited-prefix + divergent-
  // tail combination.
  //
  // Two-step pattern to avoid race conditions on lazy init:
  //   1. Try $inc on an existing head. If found, return.
  //   2. No head yet: read branchPoint from the Branch row, $setOnInsert
  //      head=branchPoint (NOT branchPoint+1 — we want $inc to produce
  //      branchPoint+1 for the first caller, branchPoint+2 for the
  //      second, etc.). Then $inc and return.
  // The $setOnInsert + subsequent $inc separates "create" from
  // "allocate" so concurrent first-writers don't each $setOnInsert head=N
  // and collide.
  const existing = await ReelHead.findOneAndUpdate(
    { _id: key },
    { $inc: { head: 1 } },
    { returnDocument: "after", lean: true, ...baseOpts },
  );
  if (existing) return existing.head;

  // No head yet for (history, reel). Seed from parent's branchPoint.
  const seedHead = await getBranchPoint(history, type, id) || 0;
  await ReelHead.findOneAndUpdate(
    { _id: key },
    { $setOnInsert: { history, type, id, head: seedHead } },
    { upsert: true, ...baseOpts },
  );
  // After $setOnInsert: head exists (either at seedHead, or already
  // advanced by a concurrent caller). $inc to claim our seq.
  const incremented = await ReelHead.findOneAndUpdate(
    { _id: key },
    { $inc: { head: 1 } },
    { returnDocument: "after", lean: true, ...baseOpts },
  );
  return incremented.head;
}

/**
 * Read the current head for an aggregate's reel in the given history
 * without advancing it. Returns 0 when no facts have been allocated.
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} id
 * @param {object} [opts]
 * @param {string} [opts.history="0"]
 * @returns {Promise<number>}
 */
export async function readHead(type, id, opts = {}) {
  if (!VALID_TYPES.has(type)) return 0;
  if (!id || typeof id !== "string") return 0;
  const history = typeof opts.history === "string" && opts.history.length > 0
    ? opts.history
    : "0";
  const doc = await ReelHead.findById(reelKey(history, type, id)).select("head").lean();
  return doc?.head || 0;
}

/**
 * Set the head to a specific value if the current head is lower.
 * Migration-time helper for backfilling from existing facts; also
 * used at branch creation to seed the history's heads from the
 * parent's branchPoint snapshot. Never regresses the head.
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} id
 * @param {number} minHead
 * @param {object} [opts]
 * @param {string} [opts.history="0"]
 * @returns {Promise<number>}
 */
export async function ensureHeadAtLeast(type, id, minHead, opts = {}) {
  if (!VALID_TYPES.has(type)) {
    throw new Error(`ensureHeadAtLeast: invalid type "${type}"`);
  }
  if (!id || typeof id !== "string") {
    throw new Error(`ensureHeadAtLeast: id must be a non-empty string`);
  }
  if (!Number.isInteger(minHead) || minHead < 0) {
    throw new Error(`ensureHeadAtLeast: minHead must be a non-negative integer`);
  }
  const history = typeof opts.history === "string" && opts.history.length > 0
    ? opts.history
    : "0";
  const key = reelKey(history, type, id);
  const doc = await ReelHead.findOneAndUpdate(
    { _id: key, head: { $lt: minHead } },
    { $set: { head: minHead, history, type, id } },
    { upsert: false, returnDocument: "after", lean: true },
  );
  if (doc) return doc.head;
  const existing = await ReelHead.findById(key).select("head").lean();
  if (existing) return existing.head;
  const created = await ReelHead.findOneAndUpdate(
    { _id: key },
    { $setOnInsert: { history, type, id, head: minHead } },
    { upsert: true, returnDocument: "after", lean: true },
  );
  return created.head;
}
