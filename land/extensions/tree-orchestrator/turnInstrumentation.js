// Turn-latency instrumentation.
//
// Cheap, in-memory bookkeeping of how long Ruler / Foreman / Planner /
// Contractor / Worker turns take, scoped by Ruler-node. The point is
// to see actual latency numbers at depth before optimizing — pull
// median/p95 from real runs, decide whether snapshot caching or two-
// step Ruler-splits are worth the complexity.
//
// Storage: per-scope rolling window of the last N turns. No
// persistence; the data lives only as long as the process. That's
// fine — the goal is recent latency for the live snapshot, not a
// long-term reputation record. (Long-term reputation is Pass 3, fed
// from the approval ledgers, not from in-memory turn timings.)
//
// Depth: how many Ruler scopes deep the turn ran. 0 = root Ruler. 1 =
// first-level sub-Ruler. etc. Threaded explicitly through runRulerTurn
// rather than computed from lineage on every record (computing depth
// per turn would itself add latency we're trying to measure).

const KEEP_LAST = 20;

// scopeNodeId → array of { role, durationMs, depth, at }
const turnsByScope = new Map();

/**
 * Record one turn's duration. Called inside runRulerTurn /
 * runForemanTurn after the LLM call resolves.
 */
export function recordTurn({ scopeNodeId, role, durationMs, depth = 0 }) {
  if (!scopeNodeId || typeof durationMs !== "number") return;
  const key = String(scopeNodeId);
  const list = turnsByScope.get(key) || [];
  list.push({
    role: String(role || "(unknown)"),
    durationMs,
    depth: typeof depth === "number" ? depth : 0,
    at: new Date().toISOString(),
  });
  if (list.length > KEEP_LAST) list.splice(0, list.length - KEEP_LAST);
  turnsByScope.set(key, list);
}

/**
 * Read the recent-latency summary for a scope. Powers the snapshot's
 * reputation.recentDecisionLatency slot.
 *
 * Returns null when no turns have been recorded yet.
 */
export function getRecentLatency(scopeNodeId) {
  if (!scopeNodeId) return null;
  const list = turnsByScope.get(String(scopeNodeId));
  if (!list || list.length === 0) return null;
  const durations = list.map((t) => t.durationMs).sort((a, b) => a - b);
  const median = durations[Math.floor(durations.length / 2)];
  const p95Idx = Math.min(durations.length - 1, Math.floor(durations.length * 0.95));
  const p95 = durations[p95Idx];
  const last = list[list.length - 1];
  return {
    count: list.length,
    medianMs: median,
    p95Ms: p95,
    lastRole: last.role,
    lastDurationMs: last.durationMs,
    lastAt: last.at,
  };
}

/**
 * Read all recorded turns for a scope (for debugging or future
 * reputation-aware tooling). Returns an array of {role, durationMs,
 * depth, at} entries, oldest-first.
 */
export function getRecentTurns(scopeNodeId) {
  if (!scopeNodeId) return [];
  return [...(turnsByScope.get(String(scopeNodeId)) || [])];
}

/**
 * Drop all recorded turns for a scope. Used at archive-plan time so
 * the latency window resets when the Ruler discards its work.
 */
export function clearTurnsForScope(scopeNodeId) {
  if (!scopeNodeId) return;
  turnsByScope.delete(String(scopeNodeId));
}
