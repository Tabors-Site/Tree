// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Per-(story, history, being) act-chain lock. IN-PROCESS ONLY — the same
// scope warning as past/reel/appendLock.js applies verbatim.
//
// An act's identity chains off the head (`p` = ActHead.headHash at
// open; the next head = the sealed act's _id). Anything that opens
// and seals acts therefore runs a read-compute-write on the chain:
//   readActHead → computeActId → ... → sealAct(advance)
// Two concurrent openers on the same (history, being) both read the
// same head, both compute children of the same `p`, and the second
// seal silently FORKS the chain (last-writer-wins head).
//
// Two writer families exist:
//
//   1. The scheduler's moments — already serial per being (one
//      moment at a time), and NOT wrapped here: a moment's handler
//      may legitimately call withBeingFact for the SAME being (graft
//      steps inside an operator's moment), which would self-deadlock
//      on a held lock. Their guard is the seal-time CAS in
//      advanceActHead — a stale seal aborts loudly and the moment
//      retries from the new head.
//
//   2. The direct helpers (withIAmAct / withBeingFact) — genesis
//      steps, position persists, manifest writes, circuit trips,
//      graft steps, host lanes. These are short (code cognition, no
//      LLM wait) and DO race each other on the I-Am's chain today.
//      sprout.js wraps each helper's open→seal in this lock so they
//      serialize among themselves.
//
// Reentrancy: a helper's fn may (transitively) open another act for
// the same being — that is two acts, sequentially legitimate. The
// AsyncLocalStorage held-set makes the inner call run immediately
// instead of deadlocking on its own outer hold. The inner act then
// seals FIRST and the outer seal re-chains via its CAS failure —
// loud, never silent.

import { AsyncLocalStorage } from "async_hooks";

const _tails = new Map(); // chainKey -> Promise (tail of the chain)
const _held = new AsyncLocalStorage(); // Set<chainKey> held by this async context

function chainKey(story, history, beingId) {
  return `${story}:${history}:${beingId}`;
}

/**
 * Run `fn` while holding the act-chain lock for (history, beingId).
 * Callers serialize per chain; different beings — and the same being
 * on different histories (per-history presents) — run in parallel.
 * Reentrant within one async context (see header).
 *
 * @template T
 * @param {string} story
 * @param {string} history
 * @param {string} beingId
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withActChainLock(story, history, beingId, fn) {
  const key = chainKey(story, history, String(beingId));
  const held = _held.getStore();
  if (held?.has(key)) return fn(); // reentrant: already ours

  const prev = _tails.get(key) || Promise.resolve();
  let release;
  const next = new Promise((resolve) => { release = resolve; });
  _tails.set(key, next);

  await prev;
  try {
    const nextHeld = new Set(held || []);
    nextHeld.add(key);
    return await _held.run(nextHeld, fn);
  } finally {
    release();
    if (_tails.get(key) === next) {
      _tails.delete(key);
    }
  }
}

/** Diagnostic. Number of chains with an in-flight or pending lock. */
export function getLockedActChainCount() {
  return _tails.size;
}
