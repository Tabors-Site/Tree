// Resume intercept for an in-progress branch swarm.
//
// When the user's current position sits under a swarm project whose
// masterPlan has ANY non-done branches, AND the incoming message looks
// like a continuation ("continue", "finish", "keep going", or any short
// imperative), skip the classifier and dispatch runBranchSwarm directly
// on the pending / paused / failed branches.
//
// "TreeOS knows what it already built": the tree is authoritative state,
// AI chats are ephemeral. A new message at a project sees its state and
// picks up where it left off. No re-architecting, no duplicate branches.
//
// Returns a result object when the intercept fires, null when the
// orchestrator should continue with normal classification.

import log from "../../seed/log.js";
import { findProjectForNode, detectResumableSwarm } from "./project.js";
import { reconcileProject } from "./reconcile.js";
import { runBranchSwarm } from "./swarm.js";

const RESUME_CONTINUATION_RE = /^\s*(continue|keep\s+going|resume|finish(\s+it)?(\s+up)?|pick(\s+up)?|retry|again|go|go\s+ahead|proceed|keep\s+building|build|make\s+it|do\s+it|complete(\s+it)?|the\s+rest|what('|')?s\s+left|where\s+were\s+we)\b/i;

export async function tryResumeSwarm({
  message, forceMode, rootId, visitorId,
  userId, username, rootChatId, sessionId,
  signal, slot, socket, onToolLoopCheckpoint, rt,
  core, emitStatus, runBranch, currentNodeId,
  defaultBranchMode = null,
}) {
  if (forceMode || !message || !rootId) return null;

  try {
    const searchNodeId = currentNodeId || rootId;
    const projectNode = await findProjectForNode(searchNodeId);
    if (!projectNode) return null;

    // Reconcile against the tree before reading subPlan — user may have
    // edited the project (added chapters, rewritten code, deleted a branch)
    // in the time since the last swarm pass.
    await reconcileProject({ projectNodeId: projectNode._id, core });

    const resumable = await detectResumableSwarm(projectNode._id);
    if (!resumable || resumable.resumable.length === 0) return null;

    const shortImperative = message.length < 60 && RESUME_CONTINUATION_RE.test(message);
    if (!shortImperative) return null;

    log.info("Swarm",
      `▶️  Resume intercept: ${resumable.resumable.length} of ${resumable.total} branches non-done under "${resumable.projectName}" (${JSON.stringify(resumable.statusCounts)}). Skipping classifier, dispatching runBranchSwarm in resume mode.`,
    );
    emitStatus?.(socket, "intent", `Resuming ${resumable.resumable.length} branch(es) from prior run...`);

    const swarmResult = await runBranchSwarm({
      branches: resumable.resumable,
      rootProjectNode: projectNode,
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
      targetNodeId: String(projectNode._id),
    };
  } catch (err) {
    log.debug("Swarm", `Resume intercept skipped: ${err.message}`);
    return null;
  }
}
