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

import * as fileStore from "../fileStore.js";
import { getBranchPoint, isMain, MAIN } from "../../materials/history/histories.js";

const VALID_TYPES = new Set(["being", "space", "matter", "name", "library"]);

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

  // The seq is DERIVED from the reel's .head, not an atomic $inc.
  // FileStore is single-writer (the commitMoment mutex), so the head
  // read here and the head advance at stamp time can't interleave; the
  // next seq is simply head+1. (allocSeq itself does not advance the
  // head — the stamp does, when the fact line lands on the reel.)
  const { head } = fileStore.readReelHead(history, type, id);

  // Main: an empty reel's first fact is seq 1, so head 0 → 1.
  if (isMain(history)) {
    return head + 1;
  }

  // Non-main histories inherit seqs from the parent's reel at branch
  // time. A history's first fact on reel R starts at branchPoint[R] + 1
  // so the seq stays monotonic across the inherited-prefix + divergent-
  // tail combination. When this history's own head is still empty
  // (head 0 and no facts of its own), seed the first alloc from the
  // parent's branchPoint so the first divergent fact gets
  // branchPoint+1; otherwise the head already carries the divergent
  // tail and head+1 continues it.
  if (head > 0) return head + 1;
  const seedHead = (await getBranchPoint(history, type, id)) || 0;
  return seedHead + 1;
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
  return fileStore.readReelHead(history, type, id).head || 0;
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

  // Never regress: when the reel's .head already sits at/above minHead,
  // it's satisfied. Otherwise seed the head up to minHead. forkReel is
  // FileStore's head-seeder: it writes head=minHead with the reel's
  // fact@minHead as the chain root (GENESIS_PREV when the reel is
  // empty) — exactly the branch-creation seed-from-branchPoint this
  // helper serves. forkReel is idempotent (no-op once a head exists),
  // so a no-op seed leaves the existing head untouched and we return it.
  const cur = fileStore.readReelHead(history, type, id).head || 0;
  if (cur >= minHead) return cur;
  fileStore.forkReel(history, history, type, id, minHead);
  return fileStore.readReelHead(history, type, id).head || 0;
}
