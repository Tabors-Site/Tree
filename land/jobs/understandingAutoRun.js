// jobs/understandingAutoRun.js
// Daily job: creates and runs a navigation-focused understanding pass per tree.
// Produces per-node encodings that enhance tree summaries for librarian/scout navigation.

import Node from "../db/models/node.js";
import User from "../db/models/user.js";
import { findOrCreateUnderstandingRun } from "../core/understanding.js";
import { orchestrateUnderstanding } from "../orchestrators/pipelines/understand.js";
import { userHasLlm } from "../ws/conversation.js";

// ─────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────

const NAV_PERSPECTIVE =
  "Summarize this section as if it is a node inside a larger knowledge tree. " +
  "Write from a perspective that understands this content will sit between a parent above and possible branches below. " +
  "Compress the meaning upward (what this contributes to the bigger picture) while preserving clarity downward " +
  "(what direction this section points toward). Emphasize the core idea, remove detail noise.";

const MIN_TREE_CHILDREN = 2; // skip trees with fewer than this many children

// ─────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────

let jobTimer = null;

// ─────────────────────────────────────────────────────────────────────────
// SINGLE TREE HANDLER
// ─────────────────────────────────────────────────────────────────────────

async function processTree(rootNode) {
  const rootId = rootNode._id.toString();
  const userId = rootNode.rootOwner.toString();

  // Skip tiny trees
  if (!rootNode.children || rootNode.children.length < MIN_TREE_CHILDREN) {
    console.log(`🧠 Skipping "${rootNode.name}" — too few children (${rootNode.children?.length || 0})`);
    return;
  }

  // Resolve username
  const user = await User.findById(userId).select("username").lean();
  if (!user) {
    console.warn(`⚠️ Understanding auto-run: no user for tree ${rootId}`);
    return;
  }

  // Skip if owner has no LLM and root has no LLM assigned
  const hasRootLlm = !!rootNode.llmAssignments?.placement;
  if (!hasRootLlm && !await userHasLlm(userId)) {
    console.log(`🧠 Skipping understanding for "${rootNode.name}" — owner has no LLM connection`);
    return;
  }

  console.log(`🧠 Understanding auto-run: starting for tree "${rootNode.name}" [${rootId.slice(0, 8)}]`);

  try {
    // Find existing run or create a new one
    const run = await findOrCreateUnderstandingRun(
      rootId,
      userId,
      NAV_PERSPECTIVE,
      true, // wasAi
    );

    // Run the orchestrator
    await orchestrateUnderstanding({
      rootId,
      userId,
      username: user.username,
      runId: run.understandingRunId,
      source: "background",
    });

    console.log(`✅ Understanding auto-run complete for tree "${rootNode.name}"`);
  } catch (err) {
    console.error(`❌ Understanding auto-run failed for tree "${rootNode.name}":`, err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// JOB RUN
// ─────────────────────────────────────────────────────────────────────────

export async function runUnderstandingAutoJob() {
  console.log("🧠 Understanding auto-run job starting...");

  try {
    // Find all root nodes (trees)
    const rootNodes = await Node.find({ rootOwner: { $nin: [null, "SYSTEM"] } })
      .select("_id name rootOwner children llmAssignments")
      .lean();

    if (rootNodes.length === 0) {
      console.log("🧠 No trees found — skipping.");
      return;
    }

    // Pick the biggest tree (most children) for now
    const biggest = rootNodes.reduce((best, node) =>
      (node.children?.length || 0) > (best.children?.length || 0) ? node : best,
    );

    console.log(`🧠 Targeting biggest tree: "${biggest.name}" (${biggest.children?.length || 0} children)`);
    await processTree(biggest);
  } catch (err) {
    console.error("❌ Understanding auto-run job error:", err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// START / STOP
// ─────────────────────────────────────────────────────────────────────────

export function startUnderstandingAutoJob({ intervalMs = 24 * 60 * 60 * 1000 } = {}) {
  if (jobTimer) clearInterval(jobTimer);

  console.log(`🧠 Understanding auto-run job started (interval: ${intervalMs / 1000}s)`);
  jobTimer = setInterval(runUnderstandingAutoJob, intervalMs);
  return jobTimer;
}

export function stopUnderstandingAutoJob() {
  if (jobTimer) {
    clearInterval(jobTimer);
    jobTimer = null;
    console.log("⏹ Understanding auto-run job stopped");
  }
}
