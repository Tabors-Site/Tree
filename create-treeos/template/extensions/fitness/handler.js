/**
 * Fitness handleMessage: lock to plan mode during setup.
 *
 * The orchestrator calls this BEFORE suffix routing. Returning { mode } forces
 * the orchestrator to use that mode and skip suffix routing for this message.
 *
 * Why: setup is a multi-step conversation. The user might say "i want to track
 * push-ups" which would normally route to fitness-log via suffix routing — but
 * if setup isn't complete, log mode has nothing useful to do. fitness-plan
 * owns the entire setup conversation. We force the user into plan mode for
 * every message until plan mode itself sets setupPhase = "complete" via
 * fitness-complete-setup.
 *
 * Once setup is complete, return null and let the orchestrator's suffix
 * routing pick the right mode based on what the user said.
 */
import Node from "../../seed/models/node.js";

export async function handleMessage(message, { rootId, targetNodeId }) {
  // Find the fitness root for the current position. The orchestrator gives us
  // either a targetNodeId (the position-hold node) or rootId. The fitness root
  // is whichever ancestor has metadata.fitness.initialized = true.
  const startId = targetNodeId || rootId;
  if (!startId) return null;

  try {
    // Walk up from the current position to find the fitness root.
    let current = await Node.findById(startId).select("_id parent metadata").lean();
    let depth = 0;
    let fitnessRoot = null;
    while (current && depth < 20) {
      const meta = current.metadata instanceof Map
        ? current.metadata.get("fitness")
        : current.metadata?.fitness;
      if (meta?.initialized) {
        fitnessRoot = { node: current, meta };
        break;
      }
      if (!current.parent) break;
      current = await Node.findById(current.parent).select("_id parent metadata").lean();
      depth++;
    }

    if (!fitnessRoot) return null;

    // Setup complete = let the orchestrator do its normal suffix routing
    if (fitnessRoot.meta.setupPhase === "complete") return null;

    // Setup in progress = force plan mode regardless of what the user said
    return { mode: "tree:fitness-plan" };
  } catch {
    return null;
  }
}
