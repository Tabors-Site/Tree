// Ruler decision register. Per-Ruler-turn transient store of "what the
// Ruler chose this turn." The Ruler's tools write here; the orchestrator's
// runRulerTurn reads after the Ruler exits and dispatches accordingly.
//
// Keying: chatId. Each Ruler turn runs inside one chat record (one
// chainstep of the conversation). The decision belongs to that turn,
// not to the broader conversation — multiple turns within a thread
// each get their own decision entry, all live simultaneously until
// each is read+cleared by its corresponding orchestrator handler.
//
// Why not metadata: the decision is ephemeral. It binds one user
// turn to the next role's invocation. After the cycle completes, the
// decision is consumed. Metadata is for durable substrate (plan
// emissions, contracts, executions, ledgers). The decision is
// pre-substrate — it's the impulse that produces substrate writes.

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
export function setRulerDecision(chatId, decision) {
  if (!chatId || !decision?.kind) return;
  decisions.set(String(chatId), {
    ...decision,
    decidedAt: new Date().toISOString(),
  });
}

export function getRulerDecision(chatId) {
  if (!chatId) return null;
  return decisions.get(String(chatId)) || null;
}

export function clearRulerDecision(chatId) {
  if (!chatId) return;
  decisions.delete(String(chatId));
}
