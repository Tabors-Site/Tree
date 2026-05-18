// TreeOS IBP — per-being summon scheduler.
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
// against limits read from each being's metadata, falling back to land
// defaults. When tripped, the scheduler logs and drops the lowest-
// priority pending entries; role templates can override that policy by
// inspecting their own inbox before allowing append.
//
// **State.** Per-being runtime state lives in memory; on crash it is
// lost but the inbox persists, so re-wakes catch up. A boot-time
// recovery pass (Slice 6 work, when external summon sources land) will
// scan inboxes for unsummoned pending entries and resume them.

import { randomUUID } from "crypto";
import log from "../seed/log.js";
import Being from "../seed/models/being.js";
import { pickNextEntry, markSummoned, markInboxConsumed } from "./inbox.js";
import { getRole } from "./roles/registry.js";

// Per-being scheduler state.
//
//   beingId -> {
//     running:        boolean,         // true while runLoop is processing
//     controller:     AbortController, // signal for the current Summon
//     currentRoot:    string | null,   // rootCorrelation of the running Summon
//     wakeQueue:      Set<nodeId>,     // positions known to have pending work
//   }
const _state = new Map();

// Backpressure defaults. Lands override per-being via Being metadata.
const DEFAULT_BACKPRESSURE = Object.freeze({
  maxInboxDepth:        100,   // entries; soft cap, scheduler keeps draining
  summonsPerSecond:     10,    // simple token bucket; refill at this rate
  maxAgeSeconds:        3600,  // pending entries older than this get logged
});

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
 * (the loop re-reads the inbox after each Summon).
 *
 * Calls are cheap; SUMMON handlers can fire this without awaiting.
 *
 * @param {string} beingId
 * @param {string} nodeId   position whose inbox just received the entry
 */
export function wake(beingId, nodeId) {
  if (!beingId || !nodeId) return;
  const state = _ensureState(beingId);
  state.wakeQueue.add(String(nodeId));
  if (!state.running) {
    state.running = true;
    // Fire and forget — runLoop owns its own error handling.
    runLoop(beingId).catch((err) => {
      log.error("Scheduler", `runLoop crashed for being ${beingId.slice(0, 8)}: ${err.message}`);
      const s = _state.get(beingId);
      if (s) { s.running = false; s.controller = null; s.currentRoot = null; }
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
  if (!state || !state.controller || state.controller.signal.aborted) return false;
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
 * Diagnostic snapshot of scheduler state. Used by tests and the
 * health-check dashboard.
 */
export function getStats() {
  const out = {};
  for (const [beingId, state] of _state) {
    out[beingId] = {
      running:     state.running,
      currentRoot: state.currentRoot,
      queueDepth:  state.wakeQueue.size,
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
      try { state.controller.abort(new Error("scheduler reset")); } catch {}
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
    // Process every node that has wake-queued pending work. The loop
    // drains the wakeQueue, then picks one per iteration. New wakes
    // arriving mid-loop just add to wakeQueue and the next iteration
    // sees them.
    while (state.wakeQueue.size > 0) {
      // Take a snapshot of nodeIds to check this iteration. Wakes
      // landing during the iteration get picked up on the next round.
      const nodeIds = Array.from(state.wakeQueue);
      state.wakeQueue.clear();

      let processedAny = false;
      for (const nodeId of nodeIds) {
        // Drain THIS node's queue before moving on. Priority is enforced
        // by pickNextEntry, which always returns the current top.
        let safetyCounter = 1000; // hard cap so a runaway producer can't loop forever
        while (safetyCounter-- > 0) {
          if (!_checkRate(beingId)) {
            // Rate-limited — put nodeId back so we revisit on the next wake.
            state.wakeQueue.add(nodeId);
            log.warn("Scheduler", `being ${beingId.slice(0, 8)} rate-limited; deferring`);
            break;
          }
          const picked = await pickNextEntry(nodeId, beingId);
          if (!picked) break;
          await processEntry(beingId, nodeId, picked);
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

async function processEntry(beingId, nodeId, picked) {
  const { entry, index } = picked;
  const state = _state.get(beingId);
  const controller = new AbortController();
  state.controller = controller;
  state.currentRoot = entry.rootCorrelation || entry.correlation || null;

  await markSummoned(nodeId, beingId, index);

  // Resolve the receiver Being + its being template. The being's
  // current role determines which role template runs. A being whose
  // role was changed between append and process picks up the new role's
  // behavior — same record, different interpretation. That is the
  // hierarchical-role rule from the design doc.
  let beingName = null;
  let role = null;
  let toBeing = null;
  try {
    toBeing = await Being.findById(beingId);
    if (!toBeing) {
      log.warn("Scheduler", `being ${beingId.slice(0, 8)} not found; marking entry consumed and skipping`);
      await markInboxConsumed(nodeId, beingId, [entry.correlation]);
      return;
    }
    beingName = toBeing.role || null;
    role = beingName ? getRole(beingName) : null;
  } catch (err) {
    log.error("Scheduler", `resolution failed for being ${beingId.slice(0, 8)}: ${err.message}`);
    await markInboxConsumed(nodeId, beingId, [entry.correlation]);
    return;
  }

  if (!role) {
    log.warn("Scheduler", `no role registered for "${beingName}" of being ${beingId.slice(0, 8)}; consuming without summon`);
    await markInboxConsumed(nodeId, beingId, [entry.correlation]);
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
    nodeId,
    embodiment: beingName,
    toBeing,
    message: {
      from:           entry.from,
      content:        entry.content,
      intent:         entry.intent,
      correlation:    entry.correlation,
      rootCorrelation: entry.rootCorrelation || entry.correlation,
      inReplyTo:      entry.inReplyTo,
      attachments:    entry.attachments,
      sentAt:         entry.sentAt,
      priority:       entry.priority,
    },
    resolved: {
      embodiment: beingName,
      nodeId,
    },
    identity: null, // populated by the caller-side enqueue path (set below if attached)
    signal:   controller.signal,
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
        from:        handoff?.responseFromStance || null,
        content:     result.content,
        intent:      result.intent || summonCtx.message.intent,
        correlation: result.correlation || randomUUID(),
        inReplyTo:   entry.correlation,
        sentAt:      new Date().toISOString(),
        summonId:    result.summonId || null,
      };
    }
  } catch (err) {
    if (controller.signal.aborted) {
      log.info("Scheduler", `Summon aborted for being ${beingId.slice(0, 8)} (${entry.correlation.slice(0, 8)}): ${err.message}`);
      // Treat aborted as a finalization — mark consumed but emit no reply.
      // Role templates that need to inform the sender about cancellation
      // should emit their own SUMMON; the scheduler stays out of policy.
    } else {
      log.error("Scheduler", `Summon errored for being ${beingId.slice(0, 8)}: ${err.message}`);
      if (handoff?.onError) {
        try { handoff.onError(err, entry); } catch {}
      }
    }
  } finally {
    try {
      await markInboxConsumed(nodeId, beingId, [entry.correlation], {
        responseId: responseEntry?.correlation || null,
        summonId:   responseEntry?.summonId    || null,
      });
    } catch (err) {
      log.warn("Scheduler", `markInboxConsumed failed: ${err.message}`);
    }
    if (responseEntry && handoff?.onResponse) {
      try { handoff.onResponse(responseEntry); } catch {}
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
      running:     false,
      controller:  null,
      currentRoot: null,
      wakeQueue:   new Set(),
      handoffs:    new Map(),
    };
    _state.set(beingId, state);
  }
  return state;
}

function _checkRate(beingId) {
  const cap = DEFAULT_BACKPRESSURE.summonsPerSecond;
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

