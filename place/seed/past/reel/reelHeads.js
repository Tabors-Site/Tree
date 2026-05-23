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

import ReelHead from "../past/reel/reelHead.js";

const VALID_TYPES = new Set(["being", "space", "matter"]);

function reelKey(type, id) {
  return `${type}:${id}`;
}

/**
 * Atomically allocate the next seq for an aggregate's reel.
 * Single-doc `$inc` + upsert. Returns the newly-allocated seq.
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} id  aggregate id
 * @returns {Promise<number>} the allocated seq (always >= 1)
 * @throws when type or id is missing/invalid
 */
export async function allocSeq(type, id) {
  if (!VALID_TYPES.has(type)) {
    throw new Error(`allocSeq: type must be one of ${[...VALID_TYPES].join("|")}, got "${type}"`);
  }
  if (!id || typeof id !== "string") {
    throw new Error(`allocSeq: id must be a non-empty string`);
  }

  const doc = await ReelHead.findOneAndUpdate(
    { _id: reelKey(type, id) },
    {
      $inc: { head: 1 },
      $setOnInsert: { type, id },
    },
    { upsert: true, new: true, lean: true },
  );
  return doc.head;
}

/**
 * Read the current head for an aggregate's reel without advancing it.
 * Returns 0 when no facts have been allocated for the reel yet.
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} id
 * @returns {Promise<number>}
 */
export async function readHead(type, id) {
  if (!VALID_TYPES.has(type)) return 0;
  if (!id || typeof id !== "string") return 0;
  const doc = await ReelHead.findById(reelKey(type, id)).select("head").lean();
  return doc?.head || 0;
}

/**
 * Set the head to a specific value if the current head is lower.
 * Migration-time helper for backfilling from existing facts. Never
 * regresses the head. Returns the resulting head value.
 *
 * @param {"being"|"space"|"matter"} type
 * @param {string} id
 * @param {number} minHead  the head must be at least this value
 * @returns {Promise<number>}
 */
export async function ensureHeadAtLeast(type, id, minHead) {
  if (!VALID_TYPES.has(type)) {
    throw new Error(`ensureHeadAtLeast: invalid type "${type}"`);
  }
  if (!id || typeof id !== "string") {
    throw new Error(`ensureHeadAtLeast: id must be a non-empty string`);
  }
  if (!Number.isInteger(minHead) || minHead < 0) {
    throw new Error(`ensureHeadAtLeast: minHead must be a non-negative integer`);
  }
  const key = reelKey(type, id);
  const doc = await ReelHead.findOneAndUpdate(
    { _id: key, head: { $lt: minHead } },
    { $set: { head: minHead, type, id } },
    { upsert: false, new: true, lean: true },
  );
  if (doc) return doc.head;
  // Either head was already >= minHead, or no doc exists yet.
  const existing = await ReelHead.findById(key).select("head").lean();
  if (existing) return existing.head;
  // No doc and we need to seed one.
  const created = await ReelHead.findOneAndUpdate(
    { _id: key },
    { $setOnInsert: { type, id, head: minHead } },
    { upsert: true, new: true, lean: true },
  );
  return created.head;
}
