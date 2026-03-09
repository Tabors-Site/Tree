// jobs/treeDream.js
// Unified "tree dream" — daily maintenance pipeline per tree.
// Replaces independent cleanup, shortTermDrain, and understanding jobs.
// Pipeline: cleanup (multi-pass) → short-term drain (multi-pass) → understanding run.
// Triggered by user-configured dreamTime on root nodes.

import Node from "../db/models/node.js";
import User from "../db/models/user.js";
import ShortMemory from "../db/models/shortMemory.js";
import { orchestrateReorganize } from "../ws/orchestrator/cleanupReorganizeOrchestrator.js";
import { orchestrateExpand } from "../ws/orchestrator/cleanupExpandOrchestrator.js";
import { drainTree } from "../ws/orchestrator/shortTermDrainOrchestrator.js";
import { findOrCreateUnderstandingRun } from "../core/understanding.js";
import { orchestrateUnderstanding } from "../ws/orchestrator/understandOrchestrator.js";

// ─────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────

const MAX_CLEANUP_PASSES = 5;
const MAX_DRAIN_PASSES = 5;
const MIN_TREE_CHILDREN = 2;

const NAV_PERSPECTIVE =
  "Summarize this section as if it is a node inside a larger knowledge tree. " +
  "Write from a perspective that understands this content will sit between a parent above and possible branches below. " +
  "Compress the meaning upward (what this contributes to the bigger picture) while preserving clarity downward " +
  "(what direction this section points toward). Emphasize the core idea, remove detail noise.";

// In-memory lock — prevents concurrent dreams for the same tree
const activeDreams = new Set();

let jobTimer = null;

// ─────────────────────────────────────────────────────────────────────────
// SINGLE TREE DREAM
// ─────────────────────────────────────────────────────────────────────────

async function runTreeDream(rootNode) {
  const rootId = rootNode._id.toString();
  const userId = rootNode.rootOwner.toString();

  if (activeDreams.has(rootId)) {
    console.log(`💤 Dream already running for "${rootNode.name}", skipping`);
    return;
  }

  // Skip tiny trees
  if (!rootNode.children || rootNode.children.length < MIN_TREE_CHILDREN) {
    console.log(`💤 Skipping "${rootNode.name}" — too few children (${rootNode.children?.length || 0})`);
    return;
  }

  // Resolve username
  const user = await User.findById(userId).select("username").lean();
  if (!user) {
    console.warn(`⚠️ Dream: no user for tree ${rootId}`);
    return;
  }
  const username = user.username;

  activeDreams.add(rootId);
  console.log(`💤 Dream starting for "${rootNode.name}" [${rootId.slice(0, 8)}]`);

  try {
    // ════════════════════════════════════════════════════════════════
    // PHASE 1: CLEANUP (multi-pass)
    // ════════════════════════════════════════════════════════════════

    for (let pass = 1; pass <= MAX_CLEANUP_PASSES; pass++) {
      console.log(`💤 Cleanup pass ${pass}/${MAX_CLEANUP_PASSES} for "${rootNode.name}"`);

      let totalChanges = 0;

      try {
        const reorgResult = await orchestrateReorganize({ rootId, userId, username, source: "background" });
        totalChanges += (reorgResult?.moves || 0) + (reorgResult?.deletes || 0);
      } catch (err) {
        console.error(`❌ Dream cleanup reorganize pass ${pass} failed:`, err.message);
      }

      try {
        const expandResult = await orchestrateExpand({ rootId, userId, username, source: "background" });
        totalChanges += expandResult?.expanded || 0;
      } catch (err) {
        console.error(`❌ Dream cleanup expand pass ${pass} failed:`, err.message);
      }

      if (totalChanges === 0) {
        console.log(`💤 Cleanup stable after pass ${pass} — no more changes`);
        break;
      }

      console.log(`💤 Cleanup pass ${pass}: ${totalChanges} change(s) — continuing`);
    }

    // ════════════════════════════════════════════════════════════════
    // PHASE 2: SHORT-TERM DRAIN (multi-pass)
    // ════════════════════════════════════════════════════════════════

    for (let pass = 1; pass <= MAX_DRAIN_PASSES; pass++) {
      // Check for remaining pending items
      const pendingCount = await ShortMemory.countDocuments({
        rootId,
        status: "pending",
        drainAttempts: { $lt: 3 },
      });

      if (pendingCount === 0) {
        console.log(`💤 No pending short-term items — drain complete`);
        break;
      }

      console.log(`💤 Drain pass ${pass}/${MAX_DRAIN_PASSES}: ${pendingCount} pending item(s)`);

      try {
        await drainTree(rootId);
      } catch (err) {
        console.error(`❌ Dream drain pass ${pass} failed:`, err.message);
        break;
      }
    }

    // ════════════════════════════════════════════════════════════════
    // PHASE 3: UNDERSTANDING RUN
    // ════════════════════════════════════════════════════════════════

    try {
      console.log(`💤 Starting understanding run for "${rootNode.name}"`);

      const run = await findOrCreateUnderstandingRun(rootId, userId, NAV_PERSPECTIVE, true);

      await orchestrateUnderstanding({
        rootId,
        userId,
        username,
        runId: run.understandingRunId,
        source: "background",
      });

      console.log(`💤 Understanding run complete`);
    } catch (err) {
      console.error(`❌ Dream understanding failed:`, err.message);
    }

    // ════════════════════════════════════════════════════════════════
    // MARK COMPLETE
    // ════════════════════════════════════════════════════════════════

    await Node.findByIdAndUpdate(rootId, { lastDreamAt: new Date() });
    console.log(`✅ Dream complete for "${rootNode.name}"`);
  } catch (err) {
    console.error(`❌ Dream failed for "${rootNode.name}":`, err.message);
  } finally {
    activeDreams.delete(rootId);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// SCHEDULER — checks which trees need to dream
// ─────────────────────────────────────────────────────────────────────────

export async function runTreeDreamJob() {
  try {
    // Find all root nodes with a dreamTime configured
    const rootNodes = await Node.find({
      rootOwner: { $ne: null },
      dreamTime: { $ne: null },
    })
      .select("_id name rootOwner children dreamTime lastDreamAt")
      .lean();

    if (rootNodes.length === 0) return;

    const now = new Date();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    for (const rootNode of rootNodes) {
      // Parse dreamTime "HH:MM" → minutes since midnight
      const [hours, minutes] = (rootNode.dreamTime || "").split(":").map(Number);
      if (isNaN(hours) || isNaN(minutes)) {
        console.warn(`⚠️ Invalid dreamTime "${rootNode.dreamTime}" for "${rootNode.name}"`);
        continue;
      }
      const dreamMinutes = hours * 60 + minutes;

      // Check if it's time to dream: current time >= dreamTime AND haven't dreamed today
      const alreadyDreamedToday = rootNode.lastDreamAt && rootNode.lastDreamAt >= startOfDay;
      if (currentMinutes >= dreamMinutes && !alreadyDreamedToday) {
        console.log(`💤 Dream time reached for "${rootNode.name}" (${rootNode.dreamTime})`);
        await runTreeDream(rootNode);
      }
    }
  } catch (err) {
    console.error("❌ Tree dream job error:", err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// START / STOP
// ─────────────────────────────────────────────────────────────────────────

export function startTreeDreamJob({ intervalMs = 30 * 60 * 1000 } = {}) {
  if (jobTimer) clearInterval(jobTimer);
  jobTimer = setInterval(runTreeDreamJob, intervalMs);
  console.log(`💤 Tree dream job started (checking every ${intervalMs / 1000}s)`);
}

export function stopTreeDreamJob() {
  if (jobTimer) {
    clearInterval(jobTimer);
    jobTimer = null;
    console.log("⏹ Tree dream job stopped");
  }
}
