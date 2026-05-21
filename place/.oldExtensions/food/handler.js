/**
 * Food handleMessage: lock to coach mode during setup.
 *
 * Same pattern as fitness. The orchestrator calls this BEFORE suffix routing.
 * Returning { mode } forces the orchestrator to use that mode.
 *
 * Why: until goals are configured (setupPhase = "complete"), every message
 * should go to food-coach which has the food-save-profile tool and knows
 * how to gather goals. Without this, suffix routing sends food-related
 * messages to food-log which doesn't handle setup and the goals never save.
 *
 * Once setup is complete, return null and let suffix routing pick the right
 * mode: "ate eggs" -> food-log, "how am i doing" -> food-review, etc.
 */
import Node from "../../seed/models/node.js";

export async function handleMessage(message, { rootId, targetNodeId }) {
  const startId = targetNodeId || rootId;
  if (!startId) return null;

  try {
    // Walk up to find the food root (might be at the target node or an ancestor)
    let current = await Node.findById(startId).select("_id parent metadata").lean();
    let depth = 0;
    let foodRoot = null;
    while (current && depth < 20) {
      const meta = current.metadata instanceof Map
        ? current.metadata.get("food")
        : current.metadata?.food;
      if (meta?.initialized) {
        foodRoot = { node: current, meta };
        break;
      }
      if (!current.parent) break;
      current = await Node.findById(current.parent).select("_id parent metadata").lean();
      depth++;
    }

    if (!foodRoot) return null;

    // Setup complete = let the orchestrator do its normal suffix routing
    if (foodRoot.meta.setupPhase === "complete") return null;

    // Setup in progress = force coach mode regardless of what the user said
    return { mode: "tree:food-coach" };
  } catch {
    return null;
  }
}
