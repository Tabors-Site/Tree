// jobs/shortTermDrain.js
// Periodically drains pending ShortMemory items into their trees.
// Finds all trees with pending items and processes them sequentially.

import log from "../../core/log.js";
import ShortMemory from "./model.js";
import Node from "../../db/models/node.js";
import { drainTree } from "./shortTermDrain.js";
import { userHasLlm } from "../../ws/conversation.js";

// ─────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────

let jobTimer = null;

// ─────────────────────────────────────────────────────────────────────────
// JOB RUN
// ─────────────────────────────────────────────────────────────────────────

export async function runShortTermDrain() {
 log.verbose("Dreams", " Short-term drain job running...");

  try {
    // Find all distinct trees with pending items that haven't been escalated
    const rootIds = await ShortMemory.distinct("rootId", {
      status: "pending",
      drainAttempts: { $lt: 3 },
    });

    if (rootIds.length === 0) {
 log.verbose("Dreams", " No pending short-term items — skipping.");
      return;
    }

 log.verbose("Dreams", ` ${rootIds.length} tree(s) with pending short-term items.`);

    // Process each tree sequentially to avoid overloading LLM
    for (const rootId of rootIds) {
      // Skip if owner has no LLM and root has no LLM assigned
      const rootNode = await Node.findById(rootId).select("rootOwner llmDefault metadata").lean();
      if (rootNode) {
        const hasRootLlm = !!(rootNode.llmDefault && rootNode.llmDefault !== "none");
        const ownerId = rootNode.rootOwner?.toString();
        if (!hasRootLlm && (!ownerId || !await userHasLlm(ownerId))) {
 log.verbose("Dreams", ` Skipping drain for tree ${rootId} — owner has no LLM connection`);
          continue;
        }
      }
      await drainTree(rootId).catch((err) =>
 log.error("Dreams", ` Drain failed for tree ${rootId}:`, err.message),
      );
    }
  } catch (err) {
 log.error("Dreams", " Short-term drain job error:", err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// START / STOP
// ─────────────────────────────────────────────────────────────────────────

export function startShortTermDrainJob({ intervalMs = 30 * 60 * 1000 } = {}) {
  if (jobTimer) clearInterval(jobTimer);

 log.info("Dreams", ` Short-term drain job started (interval: ${intervalMs / 1000}s)`);
  jobTimer = setInterval(runShortTermDrain, intervalMs);
  return jobTimer;
}

export function stopShortTermDrainJob() {
  if (jobTimer) {
    clearInterval(jobTimer);
    jobTimer = null;
 log.info("Dreams", "⏹ Short-term drain job stopped");
  }
}
