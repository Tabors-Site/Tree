// Resumption decision lives at the governing layer. The Ruler at a
// scope is the operational authority for that scope, including
// authority over what happens when work resumes after a pause. When
// the user types a continuation message ("continue", "keep going",
// "finish") at a project with paused / pending branches, the Ruler
// at that scope wakes up, examines its plan and contracts and the
// branch states, decides whether to redispatch existing pending
// branches, replan, amend contracts, or treat the message as a fresh
// request, and then invokes swarm to actually execute the dispatch.
//
// This replaces the legacy swarm.tryResumeSwarm front door. Swarm is
// the mechanism layer — parallel branch dispatch, retry, reconcile.
// It does not own the decision of WHAT to dispatch on resume; that
// decision belongs to the Ruler. Swarm continues to provide
// runBranchSwarm as the execution primitive; resumeAtRuler is the
// decision layer that drives it.
//
// For Pass 1 the decision is deterministic: continuation phrase + a
// Ruler scope above the position with pending branches → redispatch
// pending. Pass 2's courts will plug in here for ambiguous cases
// (work paused mid-dispute, contract conflicts, etc.); the decision
// surface is already in governing's territory.
//
// Returns a result object when the intercept fires (the Ruler's
// decision dispatched something), null when the orchestrator should
// continue with normal classification (the Ruler's decision: this is
// not a resume request).

import log from "../../../seed/log.js";
import { findRulerScope } from "./role.js";

const RESUME_CONTINUATION_RE = /^\s*(continue|keep\s+going|resume|finish(\s+it)?(\s+up)?|pick(\s+up)?|retry|again|go|go\s+ahead|proceed|keep\s+building|build|make\s+it|do\s+it|complete(\s+it)?|the\s+rest|what('|')?s\s+left|where\s+were\s+we)\b/i;

/**
 * Wake the Ruler at the user's scope, examine state, decide.
 *
 * Cheap-checks the message first (regex) so non-continuation turns
 * never pay for the tree walk. Walks to the nearest Ruler. Calls
 * swarm's reconcile + detectResumableSwarm (mechanism helpers, not
 * decision-makers) to inventory branch state. If continuation +
 * pending branches: hands off to swarm.runBranchSwarm in resume mode.
 *
 * The Ruler's decision is encoded as control flow here. Future
 * iterations may add LLM reasoning for ambiguous cases (governing-
 * planner with a "wake up at existing state" prompt), at which point
 * this function becomes the dispatcher between deterministic and
 * reasoned decision paths. For Pass 1 the deterministic case covers
 * the typical user flow ("continue" after a pause).
 */
export async function resumeAtRuler({
  message, forceMode, rootId, visitorId,
  userId, username, rootChatId, sessionId,
  signal, slot, socket, onToolLoopCheckpoint, rt,
  core, emitStatus, runBranch, currentNodeId,
  defaultBranchMode = null,
}) {
  if (forceMode || !message || !rootId) return null;

  // Regex first. Tree walks are expensive on mature projects; doing
  // them on every chat ("hi", "what's up", typos) before knowing the
  // intent is a waste. Only continuation-shaped messages get past
  // this gate.
  const shortImperative = message.length < 60 && RESUME_CONTINUATION_RE.test(message);
  if (!shortImperative) return null;

  try {
    const searchNodeId = currentNodeId || rootId;
    // Find the Ruler scope. governing owns the role taxonomy; this is
    // the scope whose authority covers the pending work.
    const scopeNode = await findRulerScope(searchNodeId);
    if (!scopeNode) return null;

    // Reconcile mechanism state against the tree. Users edit the tree
    // out-of-band (rename branches, delete chapters, add files); the
    // cached subPlan can drift. swarm's reconciler walks the children
    // and merges before the Ruler reads anything from it.
    const { getExtension } = await import("../../loader.js");
    const sw = getExtension("swarm")?.exports;
    if (!sw?.reconcileProject || !sw?.detectResumableSwarm || !sw?.runBranchSwarm) {
      log.debug("Governing", "resumeAtRuler: swarm helpers unavailable; skipping");
      return null;
    }
    await sw.reconcileProject({ projectNodeId: scopeNode._id, core });

    const resumable = await sw.detectResumableSwarm(scopeNode._id);
    if (!resumable || resumable.resumable.length === 0) return null;

    // Ruler's decision: continuation phrase + pending branches →
    // redispatch. Mechanical decision; no LLM round trip needed for
    // the unambiguous case. The dispatch is delegated to swarm
    // (mechanism); the decision is owned here (governing).
    log.info("Governing",
      `▶️  Ruler at "${resumable.projectName}" (${String(scopeNode._id).slice(0, 8)}) ` +
      `decides RESUME: ${resumable.resumable.length} of ${resumable.total} branches ` +
      `non-done (${JSON.stringify(resumable.statusCounts)}). Dispatching swarm in resume mode.`,
    );
    emitStatus?.(socket, "intent", `Ruler resuming ${resumable.resumable.length} branch(es)...`);

    const swarmResult = await sw.runBranchSwarm({
      branches: resumable.resumable,
      rootProjectNode: scopeNode,
      rootChatId, sessionId, visitorId, userId, username, rootId,
      signal, slot, socket, onToolLoopCheckpoint,
      userRequest: resumable.systemSpec || message,
      rt, resumeMode: true, core, emitStatus, runBranch,
      defaultBranchMode,
    });

    emitStatus?.(socket, "done", "");
    return {
      success: swarmResult.success,
      answer: swarmResult.summary,
      rootId,
      targetNodeId: String(scopeNode._id),
    };
  } catch (err) {
    log.debug("Governing", `resumeAtRuler skipped: ${err.message}`);
    return null;
  }
}
