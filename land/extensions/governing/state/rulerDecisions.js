// Ruler decision register. Per-visitor transient store of "what the
// Ruler chose this turn." The Ruler's tools write here; the
// orchestrator's runRulerTurn reads after the Ruler exits and
// dispatches accordingly.
//
// Why not metadata: the decision is ephemeral. It binds one user
// turn to the next role's invocation. After the cycle completes, the
// decision is consumed. Metadata is for durable substrate (plan
// emissions, contracts, executions, ledgers). The decision is
// pre-substrate — it's the impulse that produces substrate writes.
//
// Why not session state: keeping it separate makes the dispatch flow
// explicit. runRulerTurn reads from this register; no implicit
// session-coupled magic.

const decisions = new Map();

/**
 * Record the Ruler's decision for this turn.
 *
 * Shape (kind values):
 *   "hire-planner"      { briefing }
 *   "route-to-foreman"  { wakeupReason, payload }
 *   "respond-directly"  { response }
 *   "revise-plan"       { revisionReason }
 *   "archive-plan"      { reason }
 *   "pause-execution"   { reason }
 *   "resume-execution"  { reason }
 *   "convene-court"     { reason, payload }
 *
 * Idempotent within a turn: if the Ruler somehow calls two decision
 * tools, the second OVERWRITES the first. The Ruler prompt gates
 * this ("Pick exactly one tool. After the tool call, exit."), and
 * the register's overwrite semantics fail safely if the model misbehaves.
 */
export function setRulerDecision(visitorId, decision) {
  if (!visitorId || !decision?.kind) return;
  decisions.set(String(visitorId), {
    ...decision,
    decidedAt: new Date().toISOString(),
  });
}

export function getRulerDecision(visitorId) {
  if (!visitorId) return null;
  return decisions.get(String(visitorId)) || null;
}

export function clearRulerDecision(visitorId) {
  if (!visitorId) return;
  decisions.delete(String(visitorId));
}
