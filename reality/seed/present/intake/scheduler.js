// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The line orchestrator. I am not alive. I am the dumb mechanism
// that drives the assembly line: when a request for a moment is
// queued on a being's inbox, I pick it by priority and hand it
// down the line to the role's summon() — which will assemble and
// run the frame the being becomes. I do not think. I sequence.
//
// Three rules that hold:
//
//   1. One moment per being at a time. A being cannot be two
//      moments simultaneously. Concurrent SUMMONs to the same
//      being queue up and have their moments in order.
//   2. Priority ordering on each pull. I pick the highest-priority
//      pending (not consumed, not cancelled, not severed) request
//      on every step. Ties break to oldest. A higher-priority
//      SUMMON that lands while lower-priority ones wait jumps
//      ahead — its moment comes first.
//   3. Parallel across beings. Each being has its own line. I
//      don't serialize across beings — Ruler and Planner can have
//      their moments concurrently when each has work waiting.
//
// Backpressure (per-being inbox depth, summons-per-second) reads
// from each being's qualities, falling back to place defaults.
// When tripped, I log and drop the lowest-priority pending
// requests; role templates can override that policy by inspecting
// their own inbox before allowing append.
//
// State. Per-being runtime state lives in memory. On crash the
// state vanishes but inboxes persist in Mongo, so re-wakes catch
// up. A boot-time recovery pass that scans inboxes for unstamped
// requests and resumes them is on the roadmap.

import log from "../../seedReality/log.js";
import { getInternalConfigValue } from "../../internalConfig.js";
import { pickNextIntake } from "./intake.js";
import { runMoment } from "../moment.js";
import { getRealityConfigValue } from "../../realityConfig.js";

// Per-being scheduler state.
//
//   beingId -> {
//     running:        boolean,         // true while runLoop is processing
//     controller:     AbortController, // signal for the current Act
//     currentRoot:    string | null,   // rootCorrelation of the running Act
//     wakeQueue:      Set<spaceId>,     // positions known to have pending work
//   }
const _state = new Map();

// Backpressure defaults. Per-being overrides live on Being.qualities.scheduler
// (not yet wired); place-wide overrides come from .config. Each accessor
// reads at use time so live `treeos config set` propagates immediately.
//
// Currently only summonsPerSecond is enforced (token bucket in _checkRate).
// summonInboxDepth + summonMaxAgeSeconds are declared so the planned
// inbox-pressure + stale-entry sweeps place without another config pass.
function CFG_INBOX_DEPTH() {
  const v = Number(getInternalConfigValue("summonInboxDepth"));
  return Number.isFinite(v) && v > 0 ? v : 100;
}
function CFG_SUMMONS_PER_SECOND() {
  const v = Number(getInternalConfigValue("summonsPerSecond"));
  // Default raised from 10 to 60 once movement landed as a first-class
  // fact stream. A walking human emits one set-being:coord transport-
  // act per cell crossing; the trail is real and goes through the
  // stamper just like LLM cognition does. The old 10/sec cap was
  // tuned for an LLM-era world where one summon = one expensive
  // turn; with cheap transport-acts in the mix it floors the human
  // experience at "deferred" the moment they start walking.
  // Operators can tune via .config (summonsPerSecond).
  return Number.isFinite(v) && v > 0 ? v : 60;
}
function CFG_MAX_AGE_SECONDS() {
  const v = Number(getInternalConfigValue("summonMaxAgeSeconds"));
  return Number.isFinite(v) && v > 0 ? v : 3600;
}

// Token bucket per being for the summons-rate limit. Created lazily.
//
//   beingId -> { tokens, lastRefillMs }
const _rate = new Map();

// Backoff window on rate-limit. At cap=60/sec refill is one token per
// ~17ms; 50ms is three tokens, enough headroom to make progress on the
// retry without spinning, and short enough that the user doesn't feel
// the backoff during normal traffic.
const RATE_LIMIT_BACKOFF_MS = 50;

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

/**
 * Tell the scheduler a being has new pending work. If the being is
 * idle, runs its inbox loop until empty. If the being is already
 * processing, the new wake folds into the running loop's next iteration
 * (the loop re-reads the inbox after each Act).
 *
 * Calls are cheap; SUMMON handlers can fire this without awaiting.
 *
 * @param {string} beingId
 * @param {string} spaceId   position whose inbox just received the entry
 */
export function wake(beingId, spaceId) {
  if (!beingId || !spaceId) return;
  const state = _ensureState(beingId);
  state.wakeQueue.add(String(spaceId));
  if (!state.running) {
    state.running = true;
    // Fire and forget — runLoop owns its own error handling.
    runLoop(beingId).catch((err) => {
      log.error(
        "Scheduler",
        `runLoop crashed for being ${beingId.slice(0, 8)}: ${err.message}`,
      );
      const s = _state.get(beingId);
      if (s) {
        s.running = false;
        s.controller = null;
        s.currentRoot = null;
      }
    });
  }
}

/**
 * Abort the currently-running Act for this being. The AbortSignal
 * propagates into the being's summon() call. Returns true when an
 * abort was actually fired (something was running and not already
 * aborted), false otherwise.
 *
 * Role templates use this when they decide to cascade a cancellation
 * downstream — typically alongside cancelIntakeByRoot on the being's
 * intake to also drop queued entries.
 *
 * @param {string} beingId
 * @param {string} [reason]
 */
export function abortCurrent(beingId, reason = "cancelled") {
  const state = _state.get(beingId);
  if (!state || !state.controller || state.controller.signal.aborted)
    return false;
  try {
    state.controller.abort(new Error(reason));
    return true;
  } catch {
    return false;
  }
}

/**
 * Inspect a being's currently-running Act root correlation. Used by
 * role templates to decide whether an incoming cancel SUMMON applies
 * to the work in flight. Returns null when idle.
 */
export function getCurrentRootCorrelation(beingId) {
  const state = _state.get(beingId);
  return state?.currentRoot || null;
}

/**
 * Abort every in-flight Act across all beings whose currentRoot
 * matches one of the supplied rootCorrelations. Returns the count of
 * aborts actually fired.
 *
 * Cancel-button surface: the caller computes the set of rootCorrelations
 * the user originated (via Act.find({ beingIn: user, "endMessage.time": null })
 * and walking rootCorrelation), then calls this to halt the chain
 * cascade in one sweep. Pending intake entries get cleaned separately
 * via cancelIntakeByRoot per (spaceId, beingId).
 *
 * @param {Iterable<string>} rootCorrelations
 * @param {string} [reason]
 */
export function abortByRootCorrelations(
  rootCorrelations,
  reason = "cancelled",
) {
  const set =
    rootCorrelations instanceof Set
      ? rootCorrelations
      : new Set(rootCorrelations);
  if (!set.size) return 0;
  let aborted = 0;
  for (const [beingId, state] of _state) {
    if (!state?.currentRoot) continue;
    if (!set.has(String(state.currentRoot))) continue;
    if (abortCurrent(beingId, reason)) aborted++;
  }
  return aborted;
}

/**
 * Diagnostic snapshot of scheduler state. Used by tests and the
 * health-check dashboard.
 */
export function getStats() {
  const out = {};
  for (const [beingId, state] of _state) {
    out[beingId] = {
      running: state.running,
      currentRoot: state.currentRoot,
      queueDepth: state.wakeQueue.size,
    };
  }
  return out;
}

/**
 * Test/teardown helper. Reset all in-memory state. Does NOT touch the
 * inbox; persisted entries remain.
 */
export function _resetAll() {
  // Best-effort abort of anything in flight so tests don't leak handles.
  for (const state of _state.values()) {
    if (state.controller && !state.controller.signal.aborted) {
      try {
        state.controller.abort(new Error("scheduler reset"));
      } catch {}
    }
  }
  _state.clear();
  _rate.clear();
}

// ────────────────────────────────────────────────────────────────
// Run loop
// ────────────────────────────────────────────────────────────────

async function runLoop(beingId) {
  const state = _state.get(beingId);
  if (!state) return;

  try {
    // Process every space that has wake-queued pending work. The loop
    // drains the wakeQueue, then picks one per iteration. New wakes
    // arriving mid-loop just add to wakeQueue and the next iteration
    // sees them.
    while (state.wakeQueue.size > 0) {
      // Take a snapshot of spaceIds to check this iteration. Wakes
      // landing during the iteration get picked up on the next round.
      const spaceIds = Array.from(state.wakeQueue);
      state.wakeQueue.clear();

      let processedAny = false;
      // Per-run "already attempted in this pass" set. Round 5: with the
      // structural seal-gate, a failed cognition leaves its
      // InboxProjection row open (no answering Act exists to close
      // it). Without this guard, pickNextIntake would return the same
      // row immediately on the next iteration and we'd retry-storm
      // until rate-limited. The guard says: each correlation gets at
      // most one attempt per runLoop pass. Subsequent passes (driven
      // by a new external wake) reset the set and may re-attempt —
      // that's the backoff for "operator retried" / "new work
      // arrived alongside." No new policy knob; just "don't pick the
      // same row twice in one run."
      const seenCorrelations = new Set();
      for (const spaceId of spaceIds) {
        // Drain THIS space's intake before moving on. Priority is enforced
        // by pickNextIntake, which always returns the current top.
        let safetyCounter = 1000; // hard cap so a runaway producer can't loop forever
        while (safetyCounter-- > 0) {
          // Pick first, charge the token only for real work. Picking is
          // a cheap indexed DB read; charging the bucket for empty
          // pick-attempts (or for entries we'd dedupe via
          // seenCorrelations) used to drain tokens during quiet periods
          // and force the rate-limit branch on legitimate traffic.
          const picked = await pickNextIntake(spaceId, beingId);
          if (!picked) break;
          if (seenCorrelations.has(picked.entry.correlation)) {
            // Already attempted in this run. Stop draining — the row
            // stays open in the InboxProjection (the model's correct
            // shape for a moment that didn't seal). A future external
            // wake gets a fresh run and a fresh attempt.
            break;
          }
          // Pause / delete gate. Entries land on the picked branch;
          // if that branch is paused or deleted, running the moment
          // would just hit the wire-layer REALITY_PAUSED gate when
          // its downstream DOs fire, leaving the row open and
          // triggering a rate-limit storm. Mark the correlation seen
          // so we don't loop on it, and break to let the next pass
          // try once unpause / undelete lands.
          //
          // EXCEPTION: branch-lifecycle ops must run on a paused or
          // deleted branch . they're the only way to revive one.
          // Mirrors the wire-side exemption in protocols/ibp/verbs/
          // do.js. Without this, a click on unpause arrives as a
          // transport-act, the scheduler skips it because the branch
          // is paused, and the client times out at awaitResult after
          // 60s.
          //
          // Pause-exempts are broader (pause/unpause/create/delete/
          // undelete) than delete-exempts (delete/undelete) because
          // forking off a paused branch is allowed but forking off a
          // deleted one is not — undelete first if you want that.
          {
            // intake.pick now asserts row.branch; this fallback is dead.
            // Keep the bare read so a future intake refactor can't reintroduce
            // a silent default here.
            const entryBranch = picked.entry.branch;
            const innerAction = picked.entry?.act?.action || null;
            const isPauseLifecycleOp =
              picked.entry?.act?.verb === "do" &&
              (innerAction === "pause-branch" ||
               innerAction === "unpause-branch" ||
               innerAction === "create-branch" ||
               innerAction === "delete-branch" ||
               innerAction === "undelete-branch");
            const isDeleteLifecycleOp =
              picked.entry?.act?.verb === "do" &&
              (innerAction === "delete-branch" ||
               innerAction === "undelete-branch");
            if (!isPauseLifecycleOp) {
              const { isBranchPaused } = await import("../../materials/branch/branches.js");
              if (await isBranchPaused(entryBranch)) {
                seenCorrelations.add(picked.entry.correlation);
                break;
              }
            }
            if (!isDeleteLifecycleOp) {
              const { isBranchDeleted } = await import("../../materials/branch/branches.js");
              if (await isBranchDeleted(entryBranch)) {
                seenCorrelations.add(picked.entry.correlation);
                break;
              }
            }
          }
          if (!_checkRate(beingId)) {
            // Real work is queued but the per-being summons-per-second
            // bucket is empty. Yield the event loop and wait for a
            // refill window before retrying — `continue` re-picks the
            // same entry (still in the inbox, not yet added to
            // seenCorrelations). Without the await, the outer wakeQueue
            // re-add path would spin synchronously, hammering the log
            // and starving the bucket of wall-clock to refill against.
            log.warn(
              "Scheduler",
              `being ${beingId.slice(0, 8)} rate-limited; deferring`,
            );
            await new Promise((r) => setTimeout(r, RATE_LIMIT_BACKOFF_MS));
            continue;
          }
          seenCorrelations.add(picked.entry.correlation);
          await processEntry(beingId, spaceId, picked);
          processedAny = true;
        }
      }

      if (!processedAny && state.wakeQueue.size === 0) break;
    }
  } finally {
    state.running = false;
    state.controller = null;
    state.currentRoot = null;
  }
}

async function processEntry(beingId, spaceId, picked) {
  const { entry, index } = picked;
  const state = _state.get(beingId);
  const controller = new AbortController();
  state.controller = controller;
  state.currentRoot = entry.rootCorrelation || entry.correlation || null;

  // The conductor takes over. runMoment walks the four beats
  // (assign / fold / momentum / stamped) and routes the moment's
  // outcome through the handoff. The scheduler stays out of
  // voice, role, ctx-building, and seal concerns — it only manages
  // the line: per-being serial, abort lifecycle, handoff slot
  // cleanup.
  const handoff = state.handoffs?.get(entry.correlation);

  try {
    await runMoment({
      beingId,
      spaceId,
      entry,
      index,
      handoff,
      controller,
    });
  } catch (err) {
    // runMoment swallows its own errors into the seal; anything
    // that reaches here is a conductor bug.
    log.error("Scheduler", `runMoment threw: ${err.message}`);
  } finally {
    if (handoff) state.handoffs.delete(entry.correlation);
    state.controller = null;
    state.currentRoot = null;
  }
}

// ────────────────────────────────────────────────────────────────
// Handoff registration (called by verbs/summon.js for async sends)
// ────────────────────────────────────────────────────────────────

/**
 * Stash runtime context (sender identity, reply dispatcher) keyed to a
 * specific inbox entry. The scheduler pulls this up when it processes
 * the entry. Lets the verb handler do all the address/auth/being
 * resolution up front while the scheduler stays simple.
 *
 * @param {string} beingId
 * @param {string} correlation   the inbox entry's correlation id
 * @param {object} handoff       { identity, resolved, responseFromStance,
 *                                 onResponse(entry), onError(err, entry) }
 */
export function attachHandoff(beingId, correlation, handoff) {
  if (!beingId || !correlation) return;
  const state = _ensureState(beingId);
  if (!state.handoffs) state.handoffs = new Map();
  state.handoffs.set(correlation, handoff);
}

// ────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────

function _ensureState(beingId) {
  let state = _state.get(beingId);
  if (!state) {
    state = {
      running: false,
      controller: null,
      currentRoot: null,
      wakeQueue: new Set(),
      handoffs: new Map(),
    };
    _state.set(beingId, state);
  }
  return state;
}

function _checkRate(beingId) {
  const cap = CFG_SUMMONS_PER_SECOND();
  const now = Date.now();
  let bucket = _rate.get(beingId);
  if (!bucket) {
    bucket = { tokens: cap, lastRefillMs: now };
    _rate.set(beingId, bucket);
  }
  // Refill since last check, capped at the bucket size.
  const elapsedMs = now - bucket.lastRefillMs;
  if (elapsedMs > 0) {
    const refill = (elapsedMs / 1000) * cap;
    bucket.tokens = Math.min(cap, bucket.tokens + refill);
    bucket.lastRefillMs = now;
  }
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}
