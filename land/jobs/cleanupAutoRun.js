// jobs/cleanupAutoRun.js
// Daily background job that runs both cleanup orchestrators on the biggest tree.

import Node from "../db/models/node.js";
import User from "../db/models/user.js";
import { orchestrateReorganize } from "../orchestrators/pipelines/cleanupReorganize.js";
import { orchestrateExpand } from "../orchestrators/pipelines/cleanupExpand.js";
import { userHasLlm } from "../ws/conversation.js";

// ─────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────

const MIN_TREE_CHILDREN = 3;

let jobTimer = null;
let lastRunDate = null; // Simple daily dedup

// ─────────────────────────────────────────────────────────────────────────
// MAIN JOB
// ─────────────────────────────────────────────────────────────────────────

export async function runCleanupAutoJob() {
  // Simple daily dedup — only run once per calendar day
  const today = new Date().toISOString().slice(0, 10);
  if (lastRunDate === today) {
    console.log("🧹 Cleanup already ran today — skipping");
    return;
  }

  try {
    console.log("🧹 Cleanup auto-run starting...");

    // Find all root nodes
    const rootNodes = await Node.find({ rootOwner: { $nin: [null, "SYSTEM"] } })
      .select("_id name rootOwner children")
      .lean();

    if (rootNodes.length === 0) {
      console.log("🧹 No trees found — skipping.");
      return;
    }

    // Pick the biggest tree (most children)
    const biggest = rootNodes.reduce((best, node) =>
      (node.children?.length || 0) > (best.children?.length || 0) ? node : best,
    );

    const rootId = biggest._id.toString();
    const userId = biggest.rootOwner.toString();

    // Skip tiny trees
    if (!biggest.children || biggest.children.length < MIN_TREE_CHILDREN) {
      console.log(`🧹 Skipping "${biggest.name}" — too few children (${biggest.children?.length || 0})`);
      return;
    }

    // Resolve username
    const user = await User.findById(userId).select("username").lean();
    if (!user) {
      console.warn(`⚠️ Cleanup auto-run: no user for tree ${rootId}`);
      return;
    }

    console.log(`🧹 Targeting biggest tree: "${biggest.name}" (${biggest.children?.length || 0} children)`);

    // Skip if owner has no LLM and root has no LLM assigned
    const rootFull = await Node.findById(rootId).select("llmAssignments").lean();
    const treeLlmOff = !rootFull?.llmAssignments?.default || rootFull.llmAssignments.default === "none";
    if (treeLlmOff && !await userHasLlm(userId)) {
      console.log(`🧹 Skipping "${biggest.name}" — owner has no LLM connection`);
      return;
    }

    // Run reorganize first, then expand
    try {
      await orchestrateReorganize({ rootId, userId, username: user.username, source: "background" });
    } catch (err) {
      console.error(`❌ Cleanup reorganize failed for "${biggest.name}":`, err.message);
    }

    try {
      await orchestrateExpand({ rootId, userId, username: user.username, source: "background" });
    } catch (err) {
      console.error(`❌ Cleanup expand failed for "${biggest.name}":`, err.message);
    }

    lastRunDate = today;
    console.log(`✅ Cleanup auto-run complete for "${biggest.name}"`);
  } catch (err) {
    console.error("❌ Cleanup auto-run job error:", err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// START / STOP
// ─────────────────────────────────────────────────────────────────────────

export function startCleanupAutoJob({ intervalMs = 24 * 60 * 60 * 1000 } = {}) {
  if (jobTimer) clearInterval(jobTimer);
  jobTimer = setInterval(runCleanupAutoJob, intervalMs);
  console.log(`🧹 Cleanup auto-run job started (interval: ${intervalMs / 1000}s)`);
}

export function stopCleanupAutoJob() {
  if (jobTimer) {
    clearInterval(jobTimer);
    jobTimer = null;
    console.log("⏹ Cleanup auto-run job stopped");
  }
}
