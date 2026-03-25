// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Tree Circuit Breaker
 *
 * When a tree exceeds health thresholds, the kernel trips its circuit.
 * No AI interactions. No cascade. No tool calls. No writes.
 * The data stays intact. The tree is sleeping, not dead.
 *
 * Health equation:
 *   treeHealth = (nodeCount / maxTreeNodes) * nodeWeight
 *              + (metadataDensity / maxTreeMetadataBytes) * densityWeight
 *              + (errorRate / maxTreeErrorRate) * errorWeight
 *
 * When treeHealth > 1.0, the tree trips. The kernel writes
 * metadata.circuit = { tripped: true, reason, timestamp, scores }
 * on the root node. That's it. One metadata write.
 *
 * The kernel trips. Extensions heal. The kernel does NOT auto-revive.
 * Extensions call core.tree.reviveTree(rootId) when they're satisfied.
 *
 * Defaults to OFF (treeCircuitEnabled: false).
 */

import log from "../log.js";
import Node from "../models/node.js";
import Contribution from "../models/contribution.js";
import { hooks } from "../hooks.js";
import { getLandConfigValue } from "../landConfig.js";
import { invalidateNode } from "./ancestorCache.js";

/**
 * Check if the tree circuit breaker feature is enabled.
 */
function isEnabled() {
  const val = getLandConfigValue("treeCircuitEnabled");
  return val === true || val === "true";
}

/**
 * Check if a tree is alive (not tripped).
 * Fast check: reads the root node's metadata.circuit.tripped field.
 *
 * @param {string} rootId
 * @returns {Promise<boolean>} true if alive, false if tripped
 */
export async function isTreeAlive(rootId) {
  if (!rootId) return true;
  if (!isEnabled()) return true;

  const root = await Node.findById(rootId).select("metadata").lean();
  if (!root) return true;

  const meta = root.metadata instanceof Map
    ? root.metadata.get("circuit")
    : root.metadata?.circuit;

  return !meta?.tripped;
}

/**
 * Calculate tree health score.
 * Returns a score where > 1.0 means the tree should trip.
 *
 * Error rate reads from BOTH sources:
 *   - Contribution log: tool call failures, write errors
 *   - .flow partitions: cascade failures and rejections
 *
 * @param {string} rootId
 * @returns {Promise<{ total: number, nodeCount: number, metadataDensity: number, errorRate: number, raw: object }>}
 */
export async function checkTreeHealth(rootId) {
  const maxNodes = parseInt(getLandConfigValue("maxTreeNodes") || "10000", 10);
  const maxMetaBytes = parseInt(getLandConfigValue("maxTreeMetadataBytes") || "1073741824", 10);
  const maxErrors = parseInt(getLandConfigValue("maxTreeErrorRate") || "100", 10);
  const nodeWeight = parseFloat(getLandConfigValue("circuitNodeWeight") || "0.4");
  const densityWeight = parseFloat(getLandConfigValue("circuitDensityWeight") || "0.3");
  const errorWeight = parseFloat(getLandConfigValue("circuitErrorWeight") || "0.3");

  // 1. Node count
  const nodeCount = await Node.countDocuments({ rootOwner: rootId });

  // 2. Metadata density (estimate total metadata size for this tree's nodes)
  // Sample up to 100 nodes to estimate average, then multiply by count
  const sampleSize = Math.min(nodeCount, 100);
  let metadataDensity = 0;
  if (sampleSize > 0) {
    const sample = await Node.find({ rootOwner: rootId })
      .select("metadata")
      .limit(sampleSize)
      .lean();

    let totalSampleSize = 0;
    for (const n of sample) {
      try {
        const meta = n.metadata instanceof Map ? Object.fromEntries(n.metadata) : (n.metadata || {});
        totalSampleSize += Buffer.byteLength(JSON.stringify(meta), "utf8");
      } catch {
        totalSampleSize += 1024; // estimate 1KB on serialization failure
      }
    }
    const avgSize = totalSampleSize / sampleSize;
    metadataDensity = avgSize * nodeCount;
  }

  // 3. Error rate from contributions (tool/write failures in last hour)
  const checkInterval = parseInt(getLandConfigValue("circuitCheckInterval") || "3600000", 10);
  const since = new Date(Date.now() - checkInterval);

  // Source A: Contribution log failures
  const contributionErrors = await Contribution.countDocuments({
    nodeId: { $exists: true },
    date: { $gte: since },
    $or: [
      { "extensionData.error": { $exists: true } },
      { action: { $in: ["error", "toolError", "writeError"] } },
    ],
  });

  // Source B: .flow cascade failures and rejections for nodes in this tree
  let flowErrors = 0;
  try {
    const flowNode = await Node.findOne({ systemRole: "flow" }).select("_id").lean();
    if (flowNode) {
      const today = new Date().toISOString().slice(0, 10);
      const partitions = await Node.find({ parent: flowNode._id, name: { $gte: since.toISOString().slice(0, 10), $lte: today } })
        .select("metadata")
        .lean();

      for (const p of partitions) {
        const results = p.metadata instanceof Map
          ? p.metadata.get("results") || {}
          : p.metadata?.results || {};

        for (const entries of Object.values(results)) {
          if (!Array.isArray(entries)) continue;
          for (const entry of entries) {
            if (entry.status === "failed" || entry.status === "rejected") {
              flowErrors++;
            }
          }
        }
      }
    }
  } catch {
    // .flow read failure is not itself an error to count
  }

  const totalErrors = contributionErrors + flowErrors;

  // Calculate weighted score
  const nodeScore = maxNodes > 0 ? (nodeCount / maxNodes) * nodeWeight : 0;
  const densityScore = maxMetaBytes > 0 ? (metadataDensity / maxMetaBytes) * densityWeight : 0;
  const errorScore = maxErrors > 0 ? (totalErrors / maxErrors) * errorWeight : 0;
  const total = nodeScore + densityScore + errorScore;

  return {
    total,
    nodeCount: nodeScore,
    metadataDensity: densityScore,
    errorRate: errorScore,
    raw: {
      nodeCount,
      metadataDensityBytes: Math.round(metadataDensity),
      contributionErrors,
      flowErrors,
      totalErrors,
    },
  };
}

/**
 * Trip a tree's circuit breaker.
 *
 * @param {string} rootId
 * @param {string} reason
 * @param {object} [scores] - health scores at time of trip
 */
export async function tripTree(rootId, reason, scores = {}) {
  const circuit = {
    tripped: true,
    reason,
    timestamp: new Date().toISOString(),
    scores,
  };

  await Node.updateOne(
    { _id: rootId },
    { $set: { "metadata.circuit": circuit } },
  );

  invalidateNode(rootId);

  log.warn("Circuit", `Tree ${rootId} tripped: ${reason}`);

  hooks.run("onTreeTripped", { rootId, reason, scores, timestamp: circuit.timestamp }).catch(() => {});
}

/**
 * Revive a tripped tree.
 *
 * @param {string} rootId
 */
export async function reviveTree(rootId) {
  await Node.updateOne(
    { _id: rootId },
    { $set: { "metadata.circuit": { tripped: false } } },
  );

  invalidateNode(rootId);

  log.info("Circuit", `Tree ${rootId} revived`);

  hooks.run("onTreeRevived", { rootId, timestamp: new Date().toISOString() }).catch(() => {});
}

/**
 * Start the background health check job.
 * Only runs if treeCircuitEnabled is true.
 */
export function startCircuitJob() {
  if (!isEnabled()) return null;

  const interval = parseInt(getLandConfigValue("circuitCheckInterval") || "3600000", 10);

  const timer = setInterval(async () => {
    try {
      // Find all tree roots (nodes with rootOwner set, not SYSTEM)
      const roots = await Node.find({
        rootOwner: { $nin: [null, "SYSTEM"] },
      }).select("_id name metadata").lean();

      for (const root of roots) {
        const meta = root.metadata instanceof Map
          ? root.metadata.get("circuit")
          : root.metadata?.circuit;

        // Skip already tripped trees
        if (meta?.tripped) continue;

        const health = await checkTreeHealth(String(root._id));

        if (health.total > 1.0) {
          const reason = `Health score ${health.total.toFixed(2)}: nodes ${health.nodeCount.toFixed(2)}, density ${health.metadataDensity.toFixed(2)}, errors ${health.errorRate.toFixed(2)}`;
          await tripTree(String(root._id), reason, {
            nodeCount: health.nodeCount,
            metadataDensity: health.metadataDensity,
            errorRate: health.errorRate,
            total: health.total,
          });
        }
      }
    } catch (err) {
      log.error("Circuit", "Health check job failed:", err.message);
    }
  }, interval);

  if (timer.unref) timer.unref();
  log.verbose("Circuit", `Tree health checks every ${Math.round(interval / 60000)}m`);
  return timer;
}
