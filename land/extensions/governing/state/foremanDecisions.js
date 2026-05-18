// Foreman decision register. Per-Foreman-turn transient store of "what
// the Foreman chose this turn." The Foreman's tools write here; the
// orchestrator's runForemanTurn reads after the Foreman exits and
// applies the chosen action.
//
// Keying: rootSummonId. A Foreman turn is one user-message-level turn —
// the chainsteps within it share the same rootSummonId. The decision
// belongs to the turn; the orchestrator reads using the same rootSummonId
// it passed into runSteppedMode. Mirrors rulerDecisions in shape and
// lifetime.
//
// Decision kinds:
//   "retry-branch"        { recordNodeId, stepIndex, branchName, reason }
//   "mark-failed"         { recordNodeId, stepIndex, branchName?, reason, error? }
//   "freeze-record"       { recordNodeId, terminalStatus, summary? }
//   "pause-record"        { recordNodeId, reason }
//   "resume-record"       { recordNodeId, reason }
//   "escalate-to-ruler"   { signal, payload }
//   "respond-directly"    { response }
//
// "escalate-to-ruler" is the Foreman's way to say "this exceeds my
// authority — the Ruler should decide." runForemanTurn returns control
// to the Ruler with the escalation payload as a wakeupReason on the
// Ruler's next turn (which, in the synchronous case, is the immediate
// continuation of the current user turn).

const decisions = new Map();

export function setForemanDecision(rootSummonId, decision) {
  if (!rootSummonId || !decision?.kind) return;
  decisions.set(String(rootSummonId), {
    ...decision,
    decidedAt: new Date().toISOString(),
  });
}

export function getForemanDecision(rootSummonId) {
  if (!rootSummonId) return null;
  return decisions.get(String(rootSummonId)) || null;
}

export function clearForemanDecision(rootSummonId) {
  if (!rootSummonId) return;
  decisions.delete(String(rootSummonId));
}
