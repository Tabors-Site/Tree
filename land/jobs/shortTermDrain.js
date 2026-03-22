// jobs/shortTermDrain.js
// Periodically drains pending ShortMemory items into their trees.
// Finds all trees with pending items and processes them sequentially.

import ShortMemory from "../extensions/dreams/model.js";
import Node from "../db/models/node.js";
import { drainTree } from "../orchestrators/pipelines/shortTermDrain.js";
import { userHasLlm } from "../ws/conversation.js";

// ─────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────

let jobTimer = null;

// ─────────────────────────────────────────────────────────────────────────
// JOB RUN
// ─────────────────────────────────────────────────────────────────────────

export async function runShortTermDrain() {
  console.log("🧠 Short-term drain job running...");

  try {
    // Find all distinct trees with pending items that haven't been escalated
    const rootIds = await ShortMemory.distinct("rootId", {
      status: "pending",
      drainAttempts: { $lt: 3 },
    });

    if (rootIds.length === 0) {
      console.log("🧠 No pending short-term items — skipping.");
      return;
    }

    console.log(`🧠 ${rootIds.length} tree(s) with pending short-term items.`);

    // Process each tree sequentially to avoid overloading LLM
    for (const rootId of rootIds) {
      // Skip if owner has no LLM and root has no LLM assigned
      const rootNode = await Node.findById(rootId).select("rootOwner llmAssignments").lean();
      if (rootNode) {
        const hasRootLlm = !!(rootNode.llmAssignments?.default && rootNode.llmAssignments.default !== "none");
        const ownerId = rootNode.rootOwner?.toString();
        if (!hasRootLlm && (!ownerId || !await userHasLlm(ownerId))) {
          console.log(`🧠 Skipping drain for tree ${rootId} — owner has no LLM connection`);
          continue;
        }
      }
      await drainTree(rootId).catch((err) =>
        console.error(`❌ Drain failed for tree ${rootId}:`, err.message),
      );
    }
  } catch (err) {
    console.error("❌ Short-term drain job error:", err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// START / STOP
// ─────────────────────────────────────────────────────────────────────────

export function startShortTermDrainJob({ intervalMs = 30 * 60 * 1000 } = {}) {
  if (jobTimer) clearInterval(jobTimer);

  console.log(`🧠 Short-term drain job started (interval: ${intervalMs / 1000}s)`);
  jobTimer = setInterval(runShortTermDrain, intervalMs);
  return jobTimer;
}

export function stopShortTermDrainJob() {
  if (jobTimer) {
    clearInterval(jobTimer);
    jobTimer = null;
    console.log("⏹ Short-term drain job stopped");
  }
}
