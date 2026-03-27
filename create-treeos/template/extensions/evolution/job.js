/**
 * Evolution Analysis Job
 *
 * Periodically checks all trees. Only analyzes trees that have
 * meaningfully changed since last analysis. A dormant tree doesn't
 * need pattern discovery every 6 hours. It needs it once after a
 * burst of activity.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import User from "../../seed/models/user.js";
import { analyzeTree, getEvolutionConfig } from "./core.js";
import { getDescendantIds } from "../../seed/tree/treeFetch.js";

let jobTimer = null;

/**
 * Count activity events across a tree since a given timestamp.
 * Sums the atomic counters that hooks increment on every event.
 * Only loads metadata, no full documents.
 */
async function countActivitySince(rootId, sinceMs) {
  const nodeIds = await getDescendantIds(rootId);
  let activity = 0;

  // Sample up to 200 nodes to avoid loading the entire tree on huge lands
  const sample = nodeIds.length > 200
    ? nodeIds.sort(() => Math.random() - 0.5).slice(0, 200)
    : nodeIds;

  for (const nid of sample) {
    const node = await Node.findById(nid).select("metadata").lean();
    if (!node) continue;

    const evo = node.metadata instanceof Map
      ? node.metadata.get("evolution") || {}
      : node.metadata?.evolution || {};

    // If this node had activity after the analysis cutoff, count it
    if (evo.lastActivity && new Date(evo.lastActivity).getTime() > sinceMs) {
      activity += (evo.notesWritten || 0) + (evo.visits || 0) +
        (evo.cascadesOriginated || 0) + (evo.cascadesReceived || 0) +
        (evo.childrenCreated || 0);
    }
  }

  // Scale up if we sampled
  if (nodeIds.length > 200) {
    activity = Math.round(activity * (nodeIds.length / 200));
  }

  return activity;
}

async function run() {
  try {
    const roots = await Node.find({
      rootOwner: { $ne: null },
      systemRole: null,
    }).select("_id rootOwner name metadata").lean();

    if (roots.length === 0) return;

    const config = await getEvolutionConfig();
    let analyzed = 0;
    let skipped = 0;

    for (const root of roots) {
      const meta = root.metadata instanceof Map
        ? root.metadata.get("evolution") || {}
        : root.metadata?.evolution || {};

      const lastAnalysis = meta.lastAnalysis
        ? new Date(meta.lastAnalysis).getTime()
        : 0;

      // Skip if analyzed recently
      if (lastAnalysis > 0 && Date.now() - lastAnalysis < config.analysisIntervalMs) {
        skipped++;
        continue;
      }

      // Skip if not enough activity since last analysis
      const activitySince = await countActivitySince(root._id, lastAnalysis);
      if (activitySince < config.minActivityForAnalysis) {
        skipped++;
        continue;
      }

      const user = await User.findById(root.rootOwner).select("username").lean();
      if (!user) continue;

      try {
        await analyzeTree(root._id, root.rootOwner, user.username);
        analyzed++;
      } catch (err) {
        log.debug("Evolution", `Analysis failed for tree "${root.name}": ${err.message}`);
      }
    }

    if (analyzed > 0 || skipped > 0) {
      log.verbose("Evolution", `Analysis sweep: ${analyzed} analyzed, ${skipped} skipped (${roots.length} total trees)`);
    }
  } catch (err) {
    log.error("Evolution", `Analysis job error: ${err.message}`);
  }
}

export async function startAnalysisJob() {
  if (jobTimer) clearInterval(jobTimer);
  const config = await getEvolutionConfig();
  jobTimer = setInterval(run, config.analysisIntervalMs);
  log.info("Evolution", `Analysis job started (interval: ${config.analysisIntervalMs / 3600000}h, min activity: ${config.minActivityForAnalysis})`);
}

export function stopAnalysisJob() {
  if (jobTimer) {
    clearInterval(jobTimer);
    jobTimer = null;
    log.info("Evolution", "Analysis job stopped");
  }
}
