// Foreman decision register. Per-Foreman-turn transient store of "what
// the Foreman chose this turn." The Foreman's tools write here; the
// orchestrator's runForemanTurn reads after the Foreman exits and
// applies the chosen action.
//
// Keying: rootChatId. A Foreman turn is one user-message-level turn —
// the chainsteps within it share the same rootChatId. The decision
// belongs to the turn; the orchestrator reads using the same rootChatId
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

export function setForemanDecision(rootChatId, decision) {
  if (!rootChatId || !decision?.kind) return;
  decisions.set(String(rootChatId), {
    ...decision,
    decidedAt: new Date().toISOString(),
  });
}

export function getForemanDecision(rootChatId) {
  if (!rootChatId) return null;
  return decisions.get(String(rootChatId)) || null;
}

export function clearForemanDecision(rootChatId) {
  if (!rootChatId) return;
  decisions.delete(String(rootChatId));
}
