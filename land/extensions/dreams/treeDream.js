// jobs/treeDream.js
// Unified "tree dream" — daily maintenance pipeline per tree.
// Replaces independent cleanup, shortTermDrain, and understanding jobs.
// Pipeline: cleanup (multi-pass) → short-term drain (multi-pass) → understanding run.
// Triggered by user-configured dreamTime on root nodes.

import log from "../../core/log.js";
import Node from "../../db/models/node.js";
import User from "../../db/models/user.js";
import ShortMemory from "./model.js";
import { orchestrateReorganize } from "./cleanupReorganize.js";
import { orchestrateExpand } from "./cleanupExpand.js";
import { drainTree } from "./shortTermDrain.js";
// Dynamic imports: understanding is a separate extension
let findOrCreateUnderstandingRun, orchestrateUnderstanding;
try {
  ({ findOrCreateUnderstandingRun } = await import("../understanding/core.js"));
  ({ orchestrateUnderstanding } = await import("../understanding/pipeline.js"));
} catch {
  findOrCreateUnderstandingRun = async () => null;
  orchestrateUnderstanding = async () => {};
}
import { orchestrateDreamNotify } from "./dreamNotify.js";
import { userHasLlm } from "../../ws/conversation.js";
import { acquireLock, releaseLock } from "../../orchestrators/locks.js";
import { setExtMeta } from "../../core/tree/extensionMetadata.js";

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

let jobTimer = null;

// ─────────────────────────────────────────────────────────────────────────
// SINGLE TREE DREAM
// ─────────────────────────────────────────────────────────────────────────

async function runTreeDream(rootNode) {
  const rootId = rootNode._id.toString();
  const userId = rootNode.rootOwner.toString();

  if (!acquireLock("dream", rootId)) {
 log.verbose("Dreams", ` Dream already running for "${rootNode.name}", skipping`);
    return;
  }

  // Skip empty trees (no children at all)
  if (!rootNode.children || rootNode.children.length === 0) {
 log.verbose("Dreams", ` Skipping "${rootNode.name}" — no children`);
    releaseLock("dream", rootId);
    return;
  }

  // Resolve username
  const user = await User.findById(userId).select("username").lean();
  if (!user) {
 log.warn("Dreams", ` Dream: no user for tree ${rootId}`);
    releaseLock("dream", rootId);
    return;
  }
  const username = user.username;

  // Skip if no LLM available (root assignment or user connection)
  const rootFull = await Node.findById(rootId).select("llmDefault metadata").lean();
  const treeLlmOff = !rootFull?.llmDefault || rootFull.llmDefault === "none";
  if (treeLlmOff && !(await userHasLlm(userId))) {
 log.verbose("Dreams", ` Skipping "${rootNode.name}" — owner has no LLM connection`);
    releaseLock("dream", rootId);
    return;
  }

 log.verbose("Dreams", 
    `💤 Dream starting for "${rootNode.name}" [${rootId.slice(0, 8)}]`,
  );

  const dreamSessionIds = [];

  try {
    // ════════════════════════════════════════════════════════════════
    // PHASE 1: CLEANUP (multi-pass)
    // ════════════════════════════════════════════════════════════════

    for (let pass = 1; pass <= MAX_CLEANUP_PASSES; pass++) {
 log.verbose("Dreams", 
        `💤 Cleanup pass ${pass}/${MAX_CLEANUP_PASSES} for "${rootNode.name}"`,
      );

      let totalChanges = 0;

      try {
        const reorgResult = await orchestrateReorganize({
          rootId,
          userId,
          username,
          source: "background",
        });
        if (reorgResult?.sessionId) dreamSessionIds.push(reorgResult.sessionId);
        totalChanges += (reorgResult?.moves || 0) + (reorgResult?.deletes || 0);
      } catch (err) {
 log.error("Dreams", 
          `❌ Dream cleanup reorganize pass ${pass} failed:`,
          err.message,
        );
      }

      try {
        const expandResult = await orchestrateExpand({
          rootId,
          userId,
          username,
          source: "background",
        });
        if (expandResult?.sessionId)
          dreamSessionIds.push(expandResult.sessionId);
        totalChanges += expandResult?.expanded || 0;
      } catch (err) {
 log.error("Dreams", 
          `❌ Dream cleanup expand pass ${pass} failed:`,
          err.message,
        );
      }

      if (totalChanges === 0) {
 log.verbose("Dreams", ` Cleanup stable after pass ${pass} — no more changes`);
        break;
      }

 log.verbose("Dreams", 
        `💤 Cleanup pass ${pass}: ${totalChanges} change(s) — continuing`,
      );
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
 log.verbose("Dreams", ` No pending short-term items — drain complete`);
        break;
      }

 log.verbose("Dreams", 
        `💤 Drain pass ${pass}/${MAX_DRAIN_PASSES}: ${pendingCount} pending item(s)`,
      );

      try {
        const drainResult = await drainTree(rootId);
        if (drainResult?.sessionId) dreamSessionIds.push(drainResult.sessionId);
      } catch (err) {
 log.error("Dreams", ` Dream drain pass ${pass} failed:`, err.message);
        break;
      }
    }

    // ════════════════════════════════════════════════════════════════
    // PHASE 3: UNDERSTANDING RUN
    // ════════════════════════════════════════════════════════════════

    try {
 log.verbose("Dreams", ` Starting understanding run for "${rootNode.name}"`);

      const run = await findOrCreateUnderstandingRun(
        rootId,
        userId,
        NAV_PERSPECTIVE,
        true,
      );

      await orchestrateUnderstanding({
        rootId,
        userId,
        username,
        runId: run.understandingRunId,
        source: "background",
      });

 log.verbose("Dreams", ` Understanding run complete`);
    } catch (err) {
 log.error("Dreams", ` Dream understanding failed:`, err.message);
    }

    // ════════════════════════════════════════════════════════════════
    // PHASE 4: DREAM NOTIFICATIONS
    // ════════════════════════════════════════════════════════════════

    if (dreamSessionIds.length > 0) {
      try {
 log.verbose("Dreams", ` Generating dream notifications for "${rootNode.name}"`);
        await orchestrateDreamNotify({
          rootId,
          userId,
          username,
          treeName: rootNode.name,
          dreamSessionIds,
          source: "background",
        });
      } catch (err) {
 log.error("Dreams", ` Dream notifications failed:`, err.message);
      }
    }

    // ════════════════════════════════════════════════════════════════
    // MARK COMPLETE
    // ════════════════════════════════════════════════════════════════

    const rootDoc = await Node.findById(rootId);
    if (rootDoc) {
      const dreamMeta = rootDoc.metadata?.get?.("dreams") || rootDoc.metadata?.dreams || {};
      dreamMeta.lastDreamAt = new Date();
      setExtMeta(rootDoc, "dreams", dreamMeta);
      await rootDoc.save();
    }
 log.verbose("Dreams", ` Dream complete for "${rootNode.name}"`);
  } catch (err) {
 log.error("Dreams", ` Dream failed for "${rootNode.name}":`, err.message);
  } finally {
    releaseLock("dream", rootId);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// SCHEDULER — checks which trees need to dream
// ─────────────────────────────────────────────────────────────────────────

export async function runTreeDreamJob() {
  try {
    // Find all root nodes with a dreamTime configured
    const rootNodes = await Node.find({
      rootOwner: { $nin: [null, "SYSTEM"] },
      dreamTime: { $ne: null },
    })
      .select("_id name rootOwner children metadata")
      .lean();

    if (rootNodes.length === 0) return;

    const now = new Date();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    for (const rootNode of rootNodes) {
      // Parse dreamTime "HH:MM" → minutes since midnight
      const [hours, minutes] = (rootNode.metadata?.dreams?.dreamTime || "")
        .split(":")
        .map(Number);
      if (isNaN(hours) || isNaN(minutes)) {
 log.warn("Dreams", 
          `⚠️ Invalid dreamTime "${rootNode.metadata?.dreams?.dreamTime}" for "${rootNode.name}"`,
        );
        continue;
      }
      const dreamMinutes = hours * 60 + minutes;

      // Check if it's time to dream: current time >= dreamTime AND haven't dreamed today
      const alreadyDreamedToday =
        rootNode.metadata?.dreams?.lastDreamAt && rootNode.metadata?.dreams?.lastDreamAt >= startOfDay;
      if (currentMinutes >= dreamMinutes && !alreadyDreamedToday) {
 log.verbose("Dreams", 
          `💤 Dream time reached for "${rootNode.name}" (${rootNode.metadata?.dreams?.dreamTime})`,
        );
        await runTreeDream(rootNode);
      }
    }
  } catch (err) {
 log.error("Dreams", " Tree dream job error:", err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// START / STOP
// ─────────────────────────────────────────────────────────────────────────

export function startTreeDreamJob({ intervalMs = 30 * 60 * 1000 } = {}) {
  if (jobTimer) clearInterval(jobTimer);
  jobTimer = setInterval(runTreeDreamJob, intervalMs);
 log.info("Dreams", `💤 Tree dream job started (checking every ${intervalMs / 1000}s)`,
  );
}

export function stopTreeDreamJob() {
  if (jobTimer) {
    clearInterval(jobTimer);
    jobTimer = null;
 log.info("Dreams", "⏹ Tree dream job stopped");
  }
}
