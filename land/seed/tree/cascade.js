// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Cascade: The Nervous System
 *
 * When content is written at a node that has metadata.cascade configured
 * and cascadeEnabled is true in .config, the kernel fires onCascade.
 * The first cascade event is always local: somebody wrote something at
 * a position marked for cascade. Extensions then propagate outward.
 *
 * The kernel checks two booleans on every content write (note, status change):
 *   1. Does this node have metadata.cascade.enabled = true?
 *   2. Is cascadeEnabled = true in .config?
 * If both yes, fire onCascade with the write context.
 *
 * Extensions register onCascade handlers to react, propagate to children,
 * send across lands via Canopy, or write results to .flow.
 *
 * The kernel never blocks inbound. Results are always written.
 */

import log from "../log.js";
import Node from "../models/node.js";
import { hooks } from "../hooks.js";
import { getLandConfigValue } from "../landConfig.js";
import { CASCADE, SYSTEM_ROLE } from "../protocol.js";
import { v4 as uuidv4 } from "uuid";
import { checkWriteSize, estimateWriteSize } from "./documentGuard.js";

/**
 * Check if cascade should fire for a content write at a node.
 * Called by afterNote and afterStatusChange hooks in the kernel.
 *
 * @param {string} nodeId - the node where content was written
 * @param {object} writeContext - what was written (note data, status change, etc.)
 */
export async function checkCascade(nodeId, writeContext) {
  // Check global enable
  const enabled = getLandConfigValue("cascadeEnabled");
  if (enabled === false || enabled === "false") return;

  // Load node and check cascade config
  const node = await Node.findById(nodeId).select("name metadata children systemRole").lean();
  if (!node || node.systemRole) return;

  const meta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
  const cascadeConfig = meta.cascade;
  if (!cascadeConfig?.enabled) return;

  // Rate limit: count signals from this node in the current minute
  const rateLimit = parseInt(getLandConfigValue("cascadeRateLimit") || "60", 10);
  const recentCount = await countRecentSignals(nodeId);
  if (recentCount >= rateLimit) {
    const signalId = uuidv4();
    const result = { status: CASCADE.REJECTED, source: nodeId, payload: { reason: "rate_limited", count: recentCount, limit: rateLimit }, timestamp: new Date(), signalId };
    await writeResult(signalId, result);
    return { signalId, result };
  }

  // Both booleans true. Fire onCascade.
  const signalId = uuidv4();

  const hookData = {
    node,
    nodeId,
    signalId,
    writeContext,
    cascadeConfig,
    depth: 0,
  };

  try {
    await hooks.run("onCascade", hookData);
  } catch (err) {
    log.warn("Cascade", `onCascade failed at ${node.name}: ${err.message}`);
  }

  // Write result to .flow (the guarantee: something always gets recorded)
  const result = {
    status: hookData._resultStatus || CASCADE.SUCCEEDED,
    source: nodeId,
    payload: hookData._resultPayload || writeContext,
    timestamp: new Date(),
    signalId,
    extName: hookData._resultExtName || null,
  };
  await writeResult(signalId, result);

  return { signalId, result };
}

/**
 * Propagate a cascade signal to a target node.
 * Called by extensions that want to deliver a signal to another node
 * (children, siblings, remote nodes). This is the "arrival" path.
 *
 * The kernel never blocks inbound. Always accepts. Always writes a result.
 *
 * @param {object} opts
 * @param {string} opts.nodeId - target node
 * @param {string} opts.signalId - ties back to the original cascade chain
 * @param {object} opts.payload - signal data
 * @param {string} opts.source - originating nodeId
 * @param {number} opts.depth - current propagation depth
 */
export async function deliverCascade({ nodeId, signalId, payload = {}, source, depth = 0 }) {
  // Check payload size limit
  const maxPayloadBytes = parseInt(getLandConfigValue("cascadeMaxPayloadBytes") || "51200", 10);
  const payloadBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  if (payloadBytes > maxPayloadBytes) {
    const result = { status: CASCADE.REJECTED, source: nodeId, payload: { reason: "payload_too_large", size: payloadBytes, max: maxPayloadBytes }, timestamp: new Date(), signalId };
    await writeResult(signalId, result);
    return result;
  }

  // Check depth limit
  const maxDepth = parseInt(getLandConfigValue("cascadeMaxDepth") || "50", 10);
  if (depth > maxDepth) {
    const result = { status: CASCADE.REJECTED, source: nodeId, payload: { reason: "depth limit exceeded", depth, maxDepth }, timestamp: new Date(), signalId };
    await writeResult(signalId, result);
    return result;
  }

  // Load target node
  const node = await Node.findById(nodeId).select("name metadata children systemRole").lean();
  if (!node) {
    const result = { status: CASCADE.FAILED, source: nodeId, payload: { reason: "node not found" }, timestamp: new Date(), signalId };
    await writeResult(signalId, result);
    return result;
  }
  if (node.systemRole) {
    const result = { status: CASCADE.REJECTED, source: nodeId, payload: { reason: "system nodes do not cascade" }, timestamp: new Date(), signalId };
    await writeResult(signalId, result);
    return result;
  }

  // Circuit breaker: reject signals to tripped trees
  const nodeMeta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
  if (nodeMeta.circuit?.tripped) {
    const result = { status: CASCADE.REJECTED, source: nodeId, payload: { reason: "tree circuit breaker tripped" }, timestamp: new Date(), signalId };
    await writeResult(signalId, result);
    return result;
  }

  // Check node's cascade config
  const meta = nodeMeta;
  const cascadeConfig = meta.cascade;

  // Never block inbound. Fire onCascade regardless of local cascade config.
  // The config controls whether THIS node originates cascades, not whether it receives them.
  let result;
  try {
    const hookData = { node, nodeId, signalId, payload, source, depth, cascadeConfig };
    await hooks.run("onCascade", hookData);
    result = {
      status: hookData._resultStatus || CASCADE.SUCCEEDED,
      source: nodeId,
      payload: hookData._resultPayload || payload,
      timestamp: new Date(),
      signalId,
      extName: hookData._resultExtName || null,
    };
  } catch (err) {
    result = { status: CASCADE.FAILED, source: nodeId, payload: { reason: err.message }, timestamp: new Date(), signalId };
  }

  await writeResult(signalId, result);
  return result;
}

/**
 * Count cascade signals from a specific node in the last minute.
 * Reads today's .flow partition and counts results where source matches.
 */
async function countRecentSignals(nodeId) {
  const flowNode = await Node.findOne({ systemRole: SYSTEM_ROLE.FLOW }).select("_id").lean();
  if (!flowNode) return 0;
  const today = todayPartitionName();
  const partition = await Node.findOne({ parent: flowNode._id, name: today }).select("metadata").lean();
  if (!partition) return 0;
  const results = partition.metadata instanceof Map
    ? partition.metadata.get("results") || {}
    : partition.metadata?.results || {};
  const oneMinuteAgo = Date.now() - 60000;
  let count = 0;
  for (const entries of Object.values(results)) {
    const arr = Array.isArray(entries) ? entries : [entries];
    for (const r of arr) {
      if (r.source === nodeId && new Date(r.timestamp).getTime() > oneMinuteAgo) count++;
    }
  }
  return count;
}

// ── .flow Partitioning ──
// Results are stored in daily partition nodes under .flow.
// Each partition is a child of .flow named by date (YYYY-MM-DD).
// This prevents any single document from growing unbounded.
// Retention deletes entire partition nodes older than resultTTL.

function todayPartitionName() {
  return new Date().toISOString().slice(0, 10); // "2026-03-25"
}

/**
 * Get or create today's partition node under .flow.
 * Creates the partition on first cascade write of the day.
 */
async function getOrCreatePartition() {
  const today = todayPartitionName();
  const flowNode = await Node.findOne({ systemRole: SYSTEM_ROLE.FLOW }).select("_id children").lean();
  if (!flowNode) return null;

  // Check if today's partition exists
  const existing = await Node.findOne({
    parent: flowNode._id,
    name: today,
  }).select("_id metadata").lean();

  if (existing) return existing._id;

  // Create today's partition
  const partition = new Node({
    name: today,
    parent: flowNode._id,
    metadata: new Map([["results", {}]]),
  });
  await partition.save();

  // Add to .flow's children
  await Node.updateOne(
    { _id: flowNode._id },
    { $addToSet: { children: partition._id } },
  );

  return partition._id;
}

/**
 * Write a cascade result to today's .flow partition.
 * Guarded against document size limit. When today's partition hits
 * flowMaxResultsPerDay, oldest results are dropped (circular buffer).
 */
async function writeResult(signalId, result) {
  try {
    const partitionId = await getOrCreatePartition();
    if (!partitionId) {
      log.error("Cascade", "No .flow system node found. Cannot write result.");
      return;
    }

    // Load partition to check size
    const partition = await Node.findById(partitionId);
    if (!partition) return;

    const writeSize = estimateWriteSize(result);
    const sizeCheck = checkWriteSize(partition, writeSize, {
      documentType: "system",
      documentId: partitionId,
    });

    if (!sizeCheck.ok) {
      // Partition full. Drop oldest results to make room.
      const meta = partition.metadata instanceof Map
        ? partition.metadata.get("results") || {}
        : partition.metadata?.results || {};
      const keys = Object.keys(meta);
      if (keys.length > 0) {
        delete meta[keys[0]]; // drop oldest signal
        if (partition.metadata instanceof Map) {
          partition.metadata.set("results", meta);
        } else {
          partition.metadata.results = meta;
        }
        if (partition.markModified) partition.markModified("metadata");
        await partition.save();
      }
    }

    // Check per-day cap
    const maxPerDay = parseInt(getLandConfigValue("flowMaxResultsPerDay") || "10000", 10);
    const partitionDoc = await Node.findById(partitionId).select("metadata").lean();
    const currentResults = partitionDoc?.metadata instanceof Map
      ? partitionDoc.metadata.get("results") || {}
      : partitionDoc?.metadata?.results || {};
    const resultCount = Object.keys(currentResults).length;

    if (resultCount >= maxPerDay) {
      // Circular buffer: drop oldest signal key
      const oldest = Object.keys(currentResults)[0];
      await Node.updateOne(
        { _id: partitionId },
        { $unset: { [`metadata.results.${oldest}`]: 1 } },
      );
    }

    // Write the result
    await Node.findByIdAndUpdate(
      partitionId,
      { $push: { [`metadata.results.${signalId}`]: result } },
      { upsert: false },
    );
  } catch (err) {
    log.error("Cascade", "Failed to write result to .flow:", err.message);
  }
}

/**
 * Get cascade results for a signal.
 * Searches across all partitions (most recent first).
 */
export async function getCascadeResults(signalId) {
  const flowNode = await Node.findOne({ systemRole: SYSTEM_ROLE.FLOW }).select("_id children").lean();
  if (!flowNode) return [];

  // Search partitions newest first
  const partitions = await Node.find({ parent: flowNode._id })
    .select("metadata")
    .sort({ name: -1 })
    .lean();

  for (const p of partitions) {
    const results = p.metadata instanceof Map
      ? p.metadata.get("results") || {}
      : p.metadata?.results || {};
    if (results[signalId]) return results[signalId];
  }

  // Fallback: check .flow itself for pre-partition results
  const results = flowNode.metadata instanceof Map
    ? flowNode.metadata.get("results") || {}
    : flowNode.metadata?.results || {};
  return results[signalId] || [];
}

/**
 * Get all recent cascade results across partitions.
 */
export async function getAllCascadeResults(limit = 50) {
  const flowNode = await Node.findOne({ systemRole: SYSTEM_ROLE.FLOW }).select("_id").lean();
  if (!flowNode) return {};

  const partitions = await Node.find({ parent: flowNode._id })
    .select("metadata")
    .sort({ name: -1 })
    .lean();

  const all = {};
  let count = 0;

  for (const p of partitions) {
    if (count >= limit) break;
    const results = p.metadata instanceof Map
      ? p.metadata.get("results") || {}
      : p.metadata?.results || {};

    const entries = Object.entries(results).sort((a, b) => {
      const aTime = a[1][a[1].length - 1]?.timestamp || 0;
      const bTime = b[1][b[1].length - 1]?.timestamp || 0;
      return new Date(bTime) - new Date(aTime);
    });

    for (const [signalId, results] of entries) {
      if (count >= limit) break;
      all[signalId] = results;
      count++;
    }
  }

  return all;
}

/**
 * Clean up expired partition nodes from .flow based on resultTTL config.
 * Deletes entire partition nodes older than the cutoff. No scanning individual keys.
 */
export async function cleanupExpiredResults() {
  const ttl = parseInt(getLandConfigValue("resultTTL") || "604800", 10);
  const cutoff = new Date(Date.now() - ttl * 1000);
  const cutoffDate = cutoff.toISOString().slice(0, 10); // "2026-03-18"

  const flowNode = await Node.findOne({ systemRole: SYSTEM_ROLE.FLOW }).select("_id children").lean();
  if (!flowNode) return 0;

  // Find partitions older than cutoff (partition name is date string, lexicographic compare works)
  const expired = await Node.find({
    parent: flowNode._id,
    name: { $lt: cutoffDate },
  }).select("_id name");

  if (expired.length === 0) return 0;

  const expiredIds = expired.map(p => p._id);

  // Remove from .flow children
  await Node.updateOne(
    { _id: flowNode._id },
    { $pullAll: { children: expiredIds } },
  );

  // Delete partition nodes
  await Node.deleteMany({ _id: { $in: expiredIds } });

  log.verbose("Cascade", `Cleaned ${expired.length} expired partition(s) from .flow: ${expired.map(p => p.name).join(", ")}`);
  return expired.length;
}
