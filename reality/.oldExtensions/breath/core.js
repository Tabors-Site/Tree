/**
 * Breath Core
 *
 * Per-tree adaptive breathing. Each tree has its own rhythm.
 * Activity speeds it up. Silence slows it down. Dormancy stops it.
 *
 * The exhale is the only moment work happens. Extensions listen to
 * breath:exhale and decide whether to act based on activityLevel
 * and their own thresholds.
 */

import log from "../../seed/log.js";

// ── Tuning constants ──

const MIN_BREATH = 15000;     // fastest: 15 seconds
const MAX_BREATH = 600000;    // slowest: 10 minutes
const DEFAULT_BREATH = 60000; // startup / wake from dormancy
const DORMANT_AFTER = 3;      // consecutive zero-activity cycles before dormancy

// ── Per-tree state ──

const states = new Map(); // rootId -> BreathState

// ── nodeId -> rootId cache ──

const rootCache = new Map();
const ROOT_CACHE_MAX = 5000;

// ── Dependency references (set by configure) ──

let _fireHook = null;
let _Node = null;

/**
 * Set references to core services. Called once from init().
 */
export function configure({ hooks, Node }) {
  _fireHook = (name, data) => hooks.run(name, data);
  _Node = Node;
}

// ── Root resolution ──

/**
 * Resolve rootId from a nodeId. Walks parent chain, caches result.
 * Returns null if the node doesn't exist or has no root.
 */
export async function resolveRootId(nodeId) {
  if (!nodeId || !_Node) return null;
  const key = String(nodeId);
  if (rootCache.has(key)) return rootCache.get(key);

  let current = key;
  const visited = [current];

  for (let depth = 0; depth < 50; depth++) {
    const node = await _Node.findById(current).select("parent").lean();
    if (!node) return null;
    if (!node.parent) {
      // Found root. Cache every node in the path.
      if (rootCache.size >= ROOT_CACHE_MAX) {
        const oldest = rootCache.keys().next().value;
        rootCache.delete(oldest);
      }
      for (const id of visited) rootCache.set(id, current);
      return current;
    }
    current = String(node.parent);
    visited.push(current);
  }

  return null;
}

// ── Activity tracking ──

/**
 * Record an activity event on a tree. Wakes from dormancy if needed.
 */
export function recordActivity(rootId) {
  if (!rootId) return;

  let state = states.get(rootId);
  if (!state) {
    state = {
      interval: DEFAULT_BREATH,
      timer: null,
      activity: 0,
      zeros: 0,
      lastExhale: null,
      running: false,
    };
    states.set(rootId, state);
  }

  state.activity++;

  // Wake from dormancy on first event
  if (!state.running) {
    state.interval = DEFAULT_BREATH;
    state.zeros = 0;
    startBreathing(rootId);
  }
}

// ── Breathing loop ──

function startBreathing(rootId) {
  const state = states.get(rootId);
  if (!state || state.running) return;

  state.running = true;
  log.verbose("Breath", `${rootId.slice(0, 8)}... waking. Cycle: ${state.interval}ms`);
  scheduleNext(rootId);
}

function stopBreathing(rootId) {
  const state = states.get(rootId);
  if (!state) return;

  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.running = false;
  log.verbose("Breath", `${rootId.slice(0, 8)}... dormant after ${DORMANT_AFTER} empty cycles`);
}

function scheduleNext(rootId) {
  const state = states.get(rootId);
  if (!state || !state.running) return;

  state.timer = setTimeout(async () => {
    await exhale(rootId);
    if (state.running) scheduleNext(rootId);
  }, state.interval);

  // Don't hold the process open for breath timers
  if (state.timer.unref) state.timer.unref();
}

/**
 * One exhale. Read activity, adjust rate, fire hook.
 */
async function exhale(rootId) {
  const state = states.get(rootId);
  if (!state) return;

  const activityLevel = state.activity;
  state.activity = 0;

  // Adjust breathing rate based on activity since last exhale
  if (activityLevel === 0) {
    state.zeros++;
    if (state.zeros >= DORMANT_AFTER) {
      stopBreathing(rootId);
      return;
    }
    // Slow down
    state.interval = Math.min(Math.round(state.interval * 1.3), MAX_BREATH);
  } else if (activityLevel >= 20) {
    // High activity: breathe faster
    state.zeros = 0;
    state.interval = Math.max(Math.round(state.interval * 0.7), MIN_BREATH);
  } else if (activityLevel >= 6) {
    // Moderate activity: speed up gently
    state.zeros = 0;
    state.interval = Math.max(Math.round(state.interval * 0.85), MIN_BREATH);
  } else {
    // Low activity (1-5): slow down gently
    state.zeros = 0;
    state.interval = Math.min(Math.round(state.interval * 1.3), MAX_BREATH);
  }

  state.lastExhale = Date.now();

  // Fire the exhale hook for all listening extensions
  if (_fireHook) {
    try {
      await _fireHook("breath:exhale", {
        rootId,
        breathRate: getRate(state),
        activityLevel,
        cycleMs: state.interval,
      });
    } catch (err) {
      log.warn("Breath", `Exhale hook error for ${rootId.slice(0, 8)}...: ${err.message}`);
    }
  }
}

// ── Rate labels ──

function getRate(state) {
  if (!state || !state.running) return "dormant";
  if (state.interval <= 30000) return "active";
  if (state.interval <= 120000) return "steady";
  return "resting";
}

// ── Public getters ──

/**
 * Get the enrichContext-ready data for a tree.
 */
export function getBreathContext(rootId) {
  const state = states.get(rootId);
  if (!state) return null;

  return {
    rate: getRate(state),
    cycleMs: state.interval,
    lastExhale: state.lastExhale,
    activitySinceLastBreath: state.activity,
  };
}

/**
 * Get raw state for a tree (for diagnostics).
 */
export function getState(rootId) {
  return states.get(rootId) || null;
}

/**
 * Get all tree breathing states (for diagnostics).
 */
export function getAllStates() {
  const result = {};
  for (const [rootId, state] of states) {
    result[rootId] = {
      rate: getRate(state),
      interval: state.interval,
      activity: state.activity,
      zeros: state.zeros,
      running: state.running,
      lastExhale: state.lastExhale,
    };
  }
  return result;
}

// ── Shutdown ──

/**
 * Stop all breathing cycles. Called on extension shutdown.
 */
export function stopAll() {
  for (const [, state] of states) {
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    state.running = false;
  }
  states.clear();
  rootCache.clear();
  log.info("Breath", "All breathing stopped");
}
