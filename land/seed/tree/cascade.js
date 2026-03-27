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

// Track the maximum depth seen per signalId. Prevents extensions from
// resetting depth to 0 to bypass the maxDepth guard.
// Entries auto-expire after 5 minutes to prevent unbounded growth.
const _signalDepths = new Map();
const SIGNAL_DEPTH_TTL_MS = 5 * 60 * 1000;

function trackSignalDepth(signalId, depth) {
  const existing = _signalDepths.get(signalId);
  if (existing && depth < existing.maxDepth) {
    return false; // depth regression, reject
  }
  _signalDepths.set(signalId, { maxDepth: depth, at: Date.now() });
  // Lazy cleanup: evict expired entries when map grows large
  if (_signalDepths.size > 10000) {
    const now = Date.now();
    for (const [id, entry] of _signalDepths) {
      if (now - entry.at > SIGNAL_DEPTH_TTL_MS) _signalDepths.delete(id);
    }
  }
  return true;
}

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
  // Per-signal delivery rate limit: cap total deliveries per signalId.
  // Prevents a single cascade from flooding thousands of nodes.
  const maxDeliveriesPerSignal = parseInt(getLandConfigValue("cascadeMaxDeliveriesPerSignal") || "500", 10);
  if (signalId) {
    const entry = _signalDepths.get(signalId);
    const deliveries = (entry?.deliveries || 0) + 1;
    if (deliveries > maxDeliveriesPerSignal) {
      const result = { status: CASCADE.REJECTED, source: nodeId, payload: { reason: "delivery limit exceeded", deliveries, max: maxDeliveriesPerSignal }, timestamp: new Date(), signalId };
      await writeResult(signalId, result);
      return result;
    }
    _signalDepths.set(signalId, { ...(_signalDepths.get(signalId) || {}), deliveries, at: Date.now() });
  }

  // Check payload size limit
  const maxPayloadBytes = parseInt(getLandConfigValue("cascadeMaxPayloadBytes") || "51200", 10);
  let payloadBytes;
  try {
    payloadBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
  } catch {
    const result = { status: CASCADE.REJECTED, source: nodeId, payload: { reason: "payload_not_serializable" }, timestamp: new Date(), signalId };
    await writeResult(signalId, result);
    return result;
  }
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

  // Depth regression guard: prevent extensions from resetting depth to bypass maxDepth
  if (signalId && !trackSignalDepth(signalId, depth)) {
    const result = { status: CASCADE.REJECTED, source: nodeId, payload: { reason: "depth regression detected", depth }, timestamp: new Date(), signalId };
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
  const flowNode = await Node.findOne({ systemRole: SYSTEM_ROLE.FLOW }).select("_id").lean();
  if (!flowNode) return null;

  // Atomic upsert: prevents duplicate partitions when concurrent cascade
  // writes hit the midnight boundary simultaneously.
  const partition = await Node.findOneAndUpdate(
    { parent: flowNode._id, name: today },
    {
      $setOnInsert: {
        _id: uuidv4(),
        name: today,
        parent: flowNode._id,
        children: [],
        contributors: [],
        metadata: { results: {} },
      },
    },
    { upsert: true, new: true, lean: true },
  );

  // Ensure .flow's children includes this partition (idempotent)
  await Node.updateOne(
    { _id: flowNode._id },
    { $addToSet: { children: partition._id } },
  );

  return partition._id;
}

/**
 * Find the result key with the earliest timestamp in a results map.
 * Used by the circular buffer to drop the truly oldest result,
 * not just the first Object.keys entry (which is unstable across
 * MongoDB deserialization boundaries).
 */
function findOldestResultKey(results) {
  let oldestKey = null;
  let oldestTime = Infinity;
  for (const [key, entries] of Object.entries(results)) {
    const arr = Array.isArray(entries) ? entries : [entries];
    for (const r of arr) {
      const ts = r?.timestamp ? new Date(r.timestamp).getTime() : Infinity;
      if (ts < oldestTime) {
        oldestTime = ts;
        oldestKey = key;
      }
    }
  }
  return oldestKey;
}

/**
 * Trim a partition's results to the per-day cap.
 * Runs asynchronously after writes to avoid racing on the count check.
 */
async function trimPartitionIfNeeded(partitionId, maxPerDay) {
  const doc = await Node.findById(partitionId).select("metadata").lean();
  if (!doc) return;
  const results = doc.metadata instanceof Map
    ? doc.metadata.get("results") || {}
    : doc.metadata?.results || {};
  const count = Object.keys(results).length;
  if (count <= maxPerDay) return;

  // Drop oldest until at cap
  const excess = count - maxPerDay;
  for (let i = 0; i < excess; i++) {
    const oldestKey = findOldestResultKey(results);
    if (!oldestKey) break;
    delete results[oldestKey];
    await Node.updateOne(
      { _id: partitionId },
      { $unset: { [`metadata.results.${oldestKey}`]: 1 } },
    );
  }
}

/**
 * Write a cascade result to today's .flow partition.
 * Guarded against document size limit. When today's partition hits
 * flowMaxResultsPerDay, oldest results are dropped (circular buffer).
 *
 * Concurrency safety: the size check and write are not atomic (read-then-write).
 * Under high concurrency, multiple writers can all pass the size check before
 * any write lands. To prevent exceeding the 16MB BSON limit:
 *   1. Trim synchronously (not deferred) when at or above 60% capacity.
 *   2. Hard-cap signal keys per partition. Reject writes that exceed the cap.
 *   3. Keep a 4MB headroom (14MB ceiling, 16MB MongoDB limit) to absorb
 *      concurrent writes that slip through between the read and the write.
 */
async function writeResult(signalId, result) {
  try {
    const partitionId = await getOrCreatePartition();
    if (!partitionId) {
      log.error("Cascade", "No .flow system node found. Cannot write result.");
      return;
    }

    const partition = await Node.findById(partitionId).select("metadata").lean();
    if (!partition) return;

    // Hard cap: reject writes when signal key count exceeds per-day cap.
    // This is O(1) and prevents unbounded growth regardless of concurrency.
    const maxPerDay = parseInt(getLandConfigValue("flowMaxResultsPerDay") || "10000", 10);
    const results = partition.metadata instanceof Map
      ? partition.metadata.get("results") || {}
      : partition.metadata?.results || {};
    const keyCount = Object.keys(results).length;

    if (keyCount >= maxPerDay) {
      // At capacity. Trim synchronously before writing.
      await trimPartitionIfNeeded(partitionId, maxPerDay);
    }

    // Size check. If over 60% capacity, trim synchronously first.
    const writeSize = estimateWriteSize(result);
    const sizeCheck = checkWriteSize(partition, writeSize, {
      documentType: "system",
      documentId: partitionId,
    });

    if (!sizeCheck.ok) {
      // Partition over size limit. Drop oldest result synchronously, then recheck.
      const oldestKey = findOldestResultKey(results);
      if (oldestKey) {
        await Node.updateOne(
          { _id: partitionId },
          { $unset: { [`metadata.results.${oldestKey}`]: 1 } },
        );
      } else {
        // No key to drop. Partition metadata is full with non-result data. Reject.
        log.error("Cascade", `Partition ${partitionId} over size limit with no droppable results. Write rejected.`);
        return;
      }
    } else if (sizeCheck.projectedSize >= sizeCheck.maxSize * 0.6) {
      // Proactive trim at 60% to keep headroom for concurrent writers.
      // Synchronous, not deferred. Under high concurrency, deferred trims
      // arrive too late and the partition blows past the BSON limit.
      await trimPartitionIfNeeded(partitionId, Math.floor(maxPerDay * 0.8));
    }

    // Write the result.
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

  return [];
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

    for (const [signalId, signalResults] of entries) {
      if (count >= limit) break;
      all[signalId] = signalResults;
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
