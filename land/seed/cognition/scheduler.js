// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Per-being summon scheduler.
//
// The scheduler is the consumer side of the inbox queue. Async beings
// don't fire-and-forget anymore; they hand their summoning to this
// scheduler which serializes per-being, orders by priority, and exposes
// an AbortController per in-flight Summon so cancellations can interrupt.
//
// Three rules:
//
//   1. **One Summon per being at a time.** A being is single-threaded.
//      Concurrent SUMMONs to the same being queue up and run sequentially.
//   2. **Priority ordering on each pull.** When the scheduler picks the
//      next entry from a being's inbox, it picks the highest-priority
//      pending (non-consumed, non-cancelled) entry. Same priority breaks
//      to oldest. Higher-priority SUMMONs that land while lower-priority
//      ones wait jump ahead automatically.
//   3. **Parallel across beings.** Each being runs its own loop. The
//      scheduler does NOT serialize across beings — Ruler and Planner
//      summon concurrently when each has work.
//
// Backpressure (per-being inbox depth, summons rate) is enforced here
// against limits read from each being's qualities, falling back to land
// defaults. When tripped, the scheduler logs and drops the lowest-
// priority pending entries; role templates can override that policy by
// inspecting their own inbox before allowing append.
//
// **State.** Per-being runtime state lives in memory; on crash it is
// lost but the inbox persists, so re-wakes catch up. A boot-time
// recovery pass that scans inboxes for unsummoned pending entries and
// resumes them is on the roadmap.

import { randomUUID } from "crypto";
import log from "../system/log.js";
import Being from "../models/being.js";
import {
  pickNextEntry,
  markSummoned,
  markInboxConsumed,
  readInbox,
} from "./inbox.js";
import { getRole } from "../cognition/roles/registry.js";
import { pushIbp } from "../ibp/pushChannel.js";
import { getLandConfigValue } from "../landConfig.js";

// Per-being scheduler state.
//
//   beingId -> {
//     running:        boolean,         // true while runLoop is processing
//     controller:     AbortController, // signal for the current Summon
//     currentRoot:    string | null,   // rootCorrelation of the running Summon
//     wakeQueue:      Set<spaceId>,     // positions known to have pending work
//   }
const _state = new Map();

// Backpressure defaults. Per-being overrides live on Being.qualities.scheduler
// (not yet wired); land-wide overrides come from .config. Each accessor
// reads at use time so live `treeos config set` propagates immediately.
//
// Currently only summonsPerSecond is enforced (token bucket in _checkRate).
// summonInboxDepth + summonMaxAgeSeconds are declared so the planned
// inbox-pressure + stale-entry sweeps land without another config pass.
function CFG_INBOX_DEPTH() {
  const v = Number(getLandConfigValue("summonInboxDepth"));
  return Number.isFinite(v) && v > 0 ? v : 100;
}
function CFG_SUMMONS_PER_SECOND() {
  const v = Number(getLandConfigValue("summonsPerSecond"));
  return Number.isFinite(v) && v > 0 ? v : 10;
}
function CFG_MAX_AGE_SECONDS() {
  const v = Number(getLandConfigValue("summonMaxAgeSeconds"));
  return Number.isFinite(v) && v > 0 ? v : 3600;
}

// Token bucket per being for the summons-rate limit. Created lazily.
//
//   beingId -> { tokens, lastRefillMs }
const _rate = new Map();

// Cached cognition mode per being. Humans don't have schedulers
// running their inboxes — they have browser observers joined to their
// being-room (see ibp/verbs/summon.js::emitSummon pattern). On
// wake() we branch to a notify path that emits to the being-room
// instead of entering the runLoop. The cache avoids re-reading the
// Being doc on every wake. operatingMode rarely changes; if a land
// does mutate it the test-helper _resetAll() also clears this map.
//
//   beingId -> "human" | "agent"
const _cognitionMode = new Map();

// ────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────

/**
 * Tell the scheduler a being has new pending work. If the being is
 * idle, runs its inbox loop until empty. If the being is already
 * processing, the new wake folds into the running loop's next iteration
 * (the loop re-reads the inbox after each Summon).
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
    // The cognition branch (agent vs human) happens at the top of
    // runLoop so wake() stays synchronous and the test ordering
    // contract holds: wake() returns → state.running === true →
    // abortCurrent / getStats see the in-flight Summon.
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
 * Abort the currently-running Summon for this being. The AbortSignal
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
 * Inspect a being's currently-running Summon root correlation. Used by
 * role templates to decide whether an incoming cancel SUMMON applies
 * to the work in flight. Returns null when idle.
 */
export function getCurrentRootCorrelation(beingId) {
  const state = _state.get(beingId);
  return state?.currentRoot || null;
}

/**
 * Abort every in-flight Summon across all beings whose currentRoot
 * matches one of the supplied rootCorrelations. Returns the count of
 * aborts actually fired.
 *
 * Cancel-button surface: the caller computes the set of rootCorrelations
 * the user originated (via Summon.find({ beingIn: user, "endMessage.time": null })
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
  _cognitionMode.clear();
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
    //
    // Cognition branch (agent vs human) lives inside processEntry,
    // after the receiver Being is loaded. For humans, processEntry
    // emits being-room notifications and returns { humanBreakNode },
    // which signals this per-space loop to break — entries stay
    // pending in the inbox and the human responds by emitting a
    // new SUMMON, not by scheduler processing.
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
          const result = await processEntry(beingId, spaceId, picked);
          processedAny = true;
          // Humans: entries stay pending; we've notified observers
          // and shouldn't re-pick the same entry forever.
          if (result?.humanBreakNode) break;
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

  // Resolve the receiver Being + the active role for THIS summon.
  //
  // Active role resolution (mirrors verbs/summon.js):
  //   1. The inbox entry's `activeRole` field (set when the SUMMON
  //      envelope specified one).
  //   2. `toBeing.defaultRole` (the being's default capacity).
  //   3. Fallback to nothing — consume the entry and skip with a warn.
  //
  // Strict membership check on entry.activeRole: if specified, must be
  // in the being's `roles[]`. Skip otherwise (the verb handler should
  // have rejected; defensive double-check.)
  let activeRole = null;
  let role = null;
  let toBeing = null;
  try {
    toBeing = await Being.findById(beingId);
    if (!toBeing) {
      log.warn(
        "Scheduler",
        `being ${beingId.slice(0, 8)} not found; marking entry consumed and skipping`,
      );
      await markInboxConsumed(spaceId, beingId, [entry.correlation]);
      return;
    }
    // Cache cognition mode on first encounter so future wakes for this
    // being don't re-resolve it (rarely changes; cleared on _resetAll).
    if (!_cognitionMode.has(beingId)) {
      _cognitionMode.set(
        beingId,
        toBeing.operatingMode === "human" ? "human" : "agent",
      );
    }
    // Human cognition branch. Entries stay pending; we emit
    // being-room notifications for each unconsumed entry at this
    // space (dedup via state.humanNotified), release the controller,
    // and signal the runLoop to break this space's loop. The human
    // responds by emitting a new SUMMON, not by scheduler processing.
    if (toBeing.operatingMode === "human") {
      state.controller = null;
      state.currentRoot = null;
      await _notifyHumanObservers(beingId, spaceId, state);
      return { humanBreakNode: true };
    }
    if (entry.activeRole) {
      const carried = Array.isArray(toBeing.roles) ? toBeing.roles : [];
      if (!carried.includes(entry.activeRole)) {
        log.warn(
          "Scheduler",
          `entry's activeRole "${entry.activeRole}" not carried by being ${beingId.slice(0, 8)} ` +
            `(roles: ${carried.join(", ") || "none"}); consuming without summon`,
        );
        await markInboxConsumed(spaceId, beingId, [entry.correlation]);
        return;
      }
      activeRole = entry.activeRole;
    } else {
      activeRole = toBeing.defaultRole || null;
    }
    role = activeRole ? getRole(activeRole) : null;
  } catch (err) {
    log.error(
      "Scheduler",
      `resolution failed for being ${beingId.slice(0, 8)}: ${err.message}`,
    );
    await markInboxConsumed(spaceId, beingId, [entry.correlation]);
    return;
  }

  if (!role) {
    log.warn(
      "Scheduler",
      `no role registered for "${activeRole}" of being ${beingId.slice(0, 8)}; consuming without summon`,
    );
    await markInboxConsumed(spaceId, beingId, [entry.correlation]);
    return;
  }

  // Build the summonCtx the being expects. Mirrors what
  // verbs/summon.js builds at request time — the scheduler is the late
  // executor for that handoff. `identity` carries the sender, `resolved`
  // carries the receiver's resolved stance (best-effort: when the entry
  // was written from a request the verb handler had the full resolved
  // shape; the scheduler reconstructs the parts it needs from stored
  // data).
  const summonCtx = {
    spaceId,
    being: activeRole, // legacy field name; carries the active role
    activeRole, // canonical
    toBeing,
    message: {
      from: entry.from,
      content: entry.content,
      correlation: entry.correlation,
      rootCorrelation: entry.rootCorrelation || entry.correlation,
      activeRole,
      inReplyTo: entry.inReplyTo,
      attachments: entry.attachments,
      sentAt: entry.sentAt,
      priority: entry.priority,
    },
    resolved: {
      being: activeRole,
      activeRole,
      spaceId,
    },
    identity: null, // populated by the caller-side enqueue path (set below if attached)
    signal: controller.signal,
  };

  // Verb-handler-attached runtime context (sender identity, response
  // dispatcher). The async branch of summon.js stashes a small handoff
  // record on the entry's per-being state slot so the scheduler can
  // reach the sender's socket without re-parsing.
  const handoff = state.handoffs?.get(entry.correlation);
  if (handoff) {
    summonCtx.identity = handoff.identity || null;
    summonCtx.resolved = handoff.resolved || summonCtx.resolved;
  }

  let responseEntry = null;
  try {
    const result = await role.summon(summonCtx.message, summonCtx);
    if (result && typeof result === "object") {
      responseEntry = {
        from: handoff?.responseFromStance || null,
        content: result.text ?? result.content ?? "",
        correlation: result.correlation || randomUUID(),
        inReplyTo: entry.correlation,
        sentAt: new Date().toISOString(),
        summonId: result.summonId || null,
      };
    }
  } catch (err) {
    if (controller.signal.aborted) {
      log.info(
        "Scheduler",
        `Summon aborted for being ${beingId.slice(0, 8)} (${entry.correlation.slice(0, 8)}): ${err.message}`,
      );
      // Treat aborted as a finalization — mark consumed but emit no reply.
      // Role templates that need to inform the sender about cancellation
      // should emit their own SUMMON; the scheduler stays out of policy.
    } else {
      log.error(
        "Scheduler",
        `Summon errored for being ${beingId.slice(0, 8)}: ${err.message}`,
      );
      if (handoff?.onError) {
        try {
          handoff.onError(err, entry);
        } catch {}
      }
    }
  } finally {
    try {
      await markInboxConsumed(spaceId, beingId, [entry.correlation], {
        responseId: responseEntry?.correlation || null,
        summonId: responseEntry?.summonId || null,
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

/**
 * Notify a human being's connected browser observers that pending
 * inbox entries arrived at this position. Pushes an IBP envelope to
 * the being's socket room for each unconsumed entry that hasn't been
 * notified yet (tracked in `state.humanNotified`). Entries stay
 * pending — humans consume by replying (new SUMMON with `inReplyTo`),
 * not by scheduler processing.
 *
 * The push rides the unified `ibp` event with `{ verb: "summon",
 * payload: <inbox entry> }` per [[project_ibp_summon_unified_event]].
 * Direction (server → client) is implicit. The client routes on
 * envelope.verb and uses payload.correlation / payload.inReplyTo.
 */
async function _notifyHumanObservers(beingId, spaceId, state) {
  const entries = await readInbox(spaceId, beingId, { unconsumed: true });
  if (!entries.length) return;
  if (!state.humanNotified) state.humanNotified = new Set();
  for (const entry of entries) {
    if (!entry?.correlation) continue;
    if (state.humanNotified.has(entry.correlation)) continue;
    state.humanNotified.add(entry.correlation);
    try {
      pushIbp(beingId, { verb: "summon", payload: entry });
    } catch {}
  }
}

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
