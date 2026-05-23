// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Per-reel append lock. The critical-section primitive the write side
// stands on.
//
// `allocSeq` is atomic on its own (single-doc `$inc`). `Fact.create`
// is atomic on its own (single-doc insert). But between them is a
// window: two concurrent appends to the same reel can interleave —
// caller A allocates seq 5 but is slow to insert; caller B allocates
// seq 6 and inserts first; a fold catching up sees seq 6, advances
// past 5, strands it.
//
// The lock collapses (allocSeq, insertFact) into one ordered op per
// reel. Transient gaps vanish. Permanent gaps from crashes remain
// (a process dying between allocSeq and insert leaves a hole), but
// the fold sorts by seq and applies whatever exists — missing numbers
// strand nothing.
//
// Per [STAMPER.md](../factory/stamper/STAMPER.md):
//   - This lock is needed for material reels (space, matter) where
//     multiple beings' moments concurrently target the same aggregate.
//   - A being's own reel is doctrinally single-writer (the scheduler's
//     one-moment-per-being guarantee). The lock applied to a being-reel
//     is a no-op in steady state — held by one caller, contended by no
//     one. We acquire it anyway for safety during the reformation.
//
// Single-process semantics. This module uses an in-process Map of
// promise chains. Sufficient for one Node process. If multi-process
// writes to the same DB ever become real, a Mongo-backed advisory
// lock would replace this — same call shape.

const _tails = new Map(); // reelKey -> Promise (tail of the chain)

function reelKey(type, id) {
  return `${type}:${id}`;
}

/**
 * Run `fn` while holding the per-reel append lock. Callers serialize
 * on a given reel; different reels run in parallel. The lock is
 * release-on-return — `fn` runs to completion (resolves or rejects)
 * before the next waiter proceeds.
 *
 * @template T
 * @param {"being"|"space"|"matter"} type
 * @param {string} id
 * @param {() => Promise<T>} fn  the critical section
 * @returns {Promise<T>}
 */
export async function withReelLock(type, id, fn) {
  const key = reelKey(type, id);
  const prev = _tails.get(key) || Promise.resolve();
  let release;
  const next = new Promise((resolve) => { release = resolve; });
  _tails.set(key, next);

  // Wait for the previous holder. The `set(key, next)` above ran
  // synchronously before any `await`, so any concurrent caller's
  // `_tails.get(key)` will see `next`, not `prev`. Chain is intact.
  await prev;
  try {
    return await fn();
  } finally {
    release();
    // GC: if no one chained after us, drop the entry so the Map
    // doesn't grow unboundedly across distinct reels touched.
    if (_tails.get(key) === next) {
      _tails.delete(key);
    }
  }
}

/**
 * Diagnostic. Number of reels with an in-flight or pending lock.
 */
export function getLockedReelCount() {
  return _tails.size;
}
