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

import log from "../../system/log.js";
import {
  pickNextEntry,
  markSummoned,
  markInboxConsumed,
} from "./inbox.js";
import { assign } from "../stamper/assign.js";
import { moment } from "../stamper/moment.js";
import { stamp } from "../stamper/stamped.js";
import { buildResponseEntry } from "./replies.js";
import { getPlaceConfigValue } from "../../placeConfig.js";

// Per-being scheduler state.
//
//   beingId -> {
//     running:        boolean,         // true while runLoop is processing
//     controller:     AbortController, // signal for the current Stamp
//     currentRoot:    string | null,   // rootCorrelation of the running Stamp
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
  const v = Number(getPlaceConfigValue("summonInboxDepth"));
  return Number.isFinite(v) && v > 0 ? v : 100;
}
function CFG_SUMMONS_PER_SECOND() {
  const v = Number(getPlaceConfigValue("summonsPerSecond"));
  return Number.isFinite(v) && v > 0 ? v : 10;
}
function CFG_MAX_AGE_SECONDS() {
  const v = Number(getPlaceConfigValue("summonMaxAgeSeconds"));
  return Number.isFinite(v) && v > 0 ? v : 3600;
}

// Token bucket per being for the summons-rate limit. Created lazily.
//
//   beingId -> { tokens, lastRefillMs }
const _rate = new Map();

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

/**
 * Tell the scheduler a being has new pending work. If the being is
 * idle, runs its inbox loop until empty. If the being is already
 * processing, the new wake folds into the running loop's next iteration
 * (the loop re-reads the inbox after each Stamp).
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
 * Abort the currently-running Stamp for this being. The AbortSignal
 * propagates into the being's summon() call. Returns true when an
 * abort was actually fired (something was running and not already
 * aborted), false otherwise.
 *
 * Role templates use this when they decide to cascade a cancellation
 * downstream — typically alongside cancelByRootCorrelation on the
 * being's inbox to also drop queued entries.
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
 * Inspect a being's currently-running Stamp root correlation. Used by
 * role templates to decide whether an incoming cancel SUMMON applies
 * to the work in flight. Returns null when idle.
 */
export function getCurrentRootCorrelation(beingId) {
  const state = _state.get(beingId);
  return state?.currentRoot || null;
}

/**
 * Abort every in-flight Stamp across all beings whose currentRoot
 * matches one of the supplied rootCorrelations. Returns the count of
 * aborts actually fired.
 *
 * Cancel-button surface: the caller computes the set of rootCorrelations
 * the user originated (via Stamp.find({ beingIn: user, "endMessage.time": null })
 * and walking rootCorrelation), then calls this to halt the chain
 * cascade in one sweep. Pending inbox entries get cleaned separately
 * via cancelByRootCorrelation per (spaceId, beingId).
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
      for (const spaceId of spaceIds) {
        // Drain THIS space's queue before moving on. Priority is enforced
        // by pickNextEntry, which always returns the current top.
        let safetyCounter = 1000; // hard cap so a runaway producer can't loop forever
        while (safetyCounter-- > 0) {
          if (!_checkRate(beingId)) {
            // Rate-limited — put spaceId back so we revisit on the next wake.
            state.wakeQueue.add(spaceId);
            log.warn(
              "Scheduler",
              `being ${beingId.slice(0, 8)} rate-limited; deferring`,
            );
            break;
          }
          const picked = await pickNextEntry(spaceId, beingId);
          if (!picked) break;
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

  await markSummoned(spaceId, beingId, index);

  // The factory takes over: assign does the setup (load being,
  // resolve role, build ctx); moment dispatches role.summon. The
  // scheduler stays out of voice, role, and ctx-building concerns —
  // it only manages the line: abort lifecycle, inbox state, and the
  // handoff callbacks the SUMMON verb stashed.
  const handoff = state.handoffs?.get(entry.correlation);
  let responseEntry = null;
  let stampId = null;
  let sealContent = null;
  let sealError = null;

  try {
    const setup = await assign({
      beingId,
      spaceId,
      entry,
      handoff,
      signal: controller.signal,
    });
    if (setup.skipped) {
      // The factory couldn't run this entry (being missing, role not
      // carried, role not registered). Already logged inside assign.
      // assign returned no stampId so there's nothing to seal.
    } else {
      stampId = setup.stampId || null;
      const outcome = await moment(setup);
      if (outcome?.result) {
        responseEntry = buildResponseEntry({
          result: outcome.result,
          handoff,
          originalEntry: entry,
        });
        // Seal content is the voice's response text (post-beforeResponse
        // shaping when the voice runs one). Roles that return null —
        // human roles waiting for an out-of-band reply — seal with null
        // content; the human's eventual response opens its own Stamp
        // via a fresh SUMMON. defaultSummon returns `text`; scripted
        // roles may return `content` or `answer`.
        sealContent = outcome.result.text
          ?? outcome.result.content
          ?? outcome.result.answer
          ?? null;
      }
    }
  } catch (err) {
    sealError = err;
    if (controller.signal.aborted) {
      log.info(
        "Scheduler",
        `Stamp aborted for being ${beingId.slice(0, 8)} (${entry.correlation.slice(0, 8)}): ${err.message}`,
      );
      // Treat aborted as a finalization — mark consumed but emit no reply.
      // Role templates that need to inform the sender about cancellation
      // should emit their own SUMMON; the scheduler stays out of policy.
    } else {
      log.error(
        "Scheduler",
        `Stamp errored for being ${beingId.slice(0, 8)}: ${err.message}`,
      );
      if (handoff?.onError) {
        try {
          handoff.onError(err, entry);
        } catch {}
      }
    }
  } finally {
    // Beat 4: press the closing face. assign opened the row; this
    // is the symmetric close. stamp()'s atomic guard ensures a
    // second seal is a no-op if the voice already sealed itself.
    if (stampId) {
      const stopped = controller.signal.aborted;
      const content = stopped
        ? null
        : (sealError ? `Error: ${sealError.message}` : sealContent);
      try {
        await stamp({ stampId, content, stopped });
      } catch (err) {
        log.warn("Scheduler", `stamp seal failed: ${err.message}`);
      }
    }
    try {
      await markInboxConsumed(spaceId, beingId, [entry.correlation], {
        responseId: responseEntry?.correlation || null,
        stampId:    responseEntry?.stampId || null,
      });
    } catch (err) {
      log.warn("Scheduler", `markInboxConsumed failed: ${err.message}`);
    }
    if (responseEntry && handoff?.onResponse) {
      try {
        handoff.onResponse(responseEntry);
      } catch {}
    }
    // Clear handoff slot so a long-lived being doesn't accumulate them.
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
