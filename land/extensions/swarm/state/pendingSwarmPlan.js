/**
 * Pending swarm plan stash.
 *
 * Mirrors the shape of [[PLAN]] item stashing in
 * tree-orchestrator/pendingPlan.js, but for [[BRANCHES]] blocks
 * that the code-plan architect emits.
 *
 * Lifecycle:
 *   1. Architect emits [[BRANCHES]]. dispatch.js parses + validates,
 *      then calls setPendingSwarmPlan() and RETURNS instead of
 *      dispatching. The user sees the plan card and a prompt.
 *   2. Next turn, orchestrator.js calls getPendingSwarmPlan() at
 *      entry. If present:
 *        - affirmative  → clear stash, dispatch the stored branches
 *        - revision     → keep stash, re-call architect with
 *                          "revise based on: <user msg>"
 *        - pivot        → confirm, archive, clear stash, re-classify
 *
 * State stored is PURE DATA (no sockets, no signals, no closures).
 * The next turn's fresh runtime context — socket, signal, rt,
 * onToolLoopCheckpoint — is reassembled when dispatching, so the
 * stash survives reconnects within the TTL window.
 *
 * TTL: 30 minutes. Longer than pendingPlan's 10-min because a plan
 * review often interleaves with reading docs / thinking; short
 * enough that a next-day "yes" doesn't resurrect a stale plan.
 */

import log from "../../../seed/log.js";

// visitorId -> entry
const _pendingSwarmPlans = new Map();

const SWARM_PLAN_TTL_MS = 30 * 60 * 1000;

/**
 * Stash a parsed swarm plan for a visitor. Overwrites any previous
 * plan — the newest one wins. Expects data-only fields.
 *
 * Required:
 *   branches          [{ name, spec, path, files, slot?, mode?, parentBranch? }, ...]
 *   projectNodeId     id of the swarm project root
 *
 * Optional but recommended:
 *   contracts         parsed [[CONTRACTS]] entries
 *   userRequest       the original user message that produced the plan
 *   architectChatId   chat id of the architect turn that emitted this
 *   rootChatId        chat id of the root user turn
 *   rootId            tree root
 *   cleanedAnswer     architect's visible answer (branches block stripped)
 *   modeKey           mode the architect used (tree:code-plan typically)
 *   targetNodeId      node the architect ran at
 *   version           plan version counter (1 for a fresh proposal)
 */
export function setPendingSwarmPlan(visitorId, entry) {
  if (!visitorId || !entry || !Array.isArray(entry.branches) || entry.branches.length === 0) return;
  _pendingSwarmPlans.set(visitorId, {
    ...entry,
    createdAt: Date.now(),
  });
  log.debug("PendingSwarmPlan",
    `Stashed ${entry.branches.length} branches for ${visitorId} (project=${String(entry.projectNodeId || "").slice(0, 8)}, v${entry.version || 1})`,
  );
}

/**
 * Read the pending swarm plan for a visitor if one exists and hasn't
 * expired. Does NOT clear the plan — caller clears after consuming.
 */
export function getPendingSwarmPlan(visitorId) {
  if (!visitorId) return null;
  const entry = _pendingSwarmPlans.get(visitorId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > SWARM_PLAN_TTL_MS) {
    _pendingSwarmPlans.delete(visitorId);
    return null;
  }
  return entry;
}

export function clearPendingSwarmPlan(visitorId) {
  if (!visitorId) return;
  _pendingSwarmPlans.delete(visitorId);
}

export function hasPendingSwarmPlan(visitorId) {
  return !!getPendingSwarmPlan(visitorId);
}

// Periodic cleanup. Unref so it doesn't keep the process alive in
// tests or short-lived commands.
setInterval(() => {
  const now = Date.now();
  for (const [vid, entry] of _pendingSwarmPlans) {
    if (now - entry.createdAt > SWARM_PLAN_TTL_MS) _pendingSwarmPlans.delete(vid);
  }
}, 5 * 60 * 1000).unref();
