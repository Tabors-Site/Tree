// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Cascade. How a write at one position ripples outward.
//
// A write here is a write here — until someone marks the position as
// cascading. When a Matter write lands at a space whose
// qualities.cascade.enabled is true, and the land has cascadeEnabled
// in its config, I fire onCascade with the write context. Extensions
// hang their propagation logic off that hook: walk to children, send
// across lands through Canopy, queue downstream work, write results
// to .flow.
//
// Two gates only, both substrate:
//   1. qualities.cascade.enabled on this space.
//   2. cascadeEnabled in land config.
// I check both on every Matter write and let the hook chain do the
// rest. I never block inbound cascade; the result is always recorded.
//
// Results live under .flow as daily partition spaces, each carrying a
// qualities.results map keyed by signalId. The six statuses below
// classify what happened so the tree-health circuit (spaceCircuit.js)
// can count failures and rejections without scanning everything.

import log from "../../system/log.js";
import Space from "../../models/space.js";
import { hooks } from "../../system/hooks.js";
import { getLandConfigValue } from "../../landConfig.js";
import { SEED_SPACE } from "./seedSpaces.js";
import { v4 as uuidv4 } from "uuid";
import { checkWriteSize, estimateWriteSize } from "../documentGuard.js";

// Cascade result statuses written into the .flow partitions and used by
// the tree health equation (spaceCircuit.js) to count rejections + failures.
// SUCCEEDED  handler ran and returned a result
// FAILED     handler threw
// REJECTED   pre-handler gate rejected (rate limit, depth cap, payload size, etc.)
// QUEUED     handler deferred (extension queued the work for later)
// PARTIAL    handler completed some subset of the work
// AWAITING   handler is waiting on an external signal before completing
export const CASCADE = Object.freeze({
  SUCCEEDED: "succeeded",
  FAILED:    "failed",
  REJECTED:  "rejected",
  QUEUED:    "queued",
  PARTIAL:   "partial",
  AWAITING:  "awaiting",
});

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
 * Check if cascade should fire for a content write at a space.
 * Called from the afterMatter hook in the kernel.
 *
 * @param {string} spaceId - the space where content was written
 * @param {object} writeContext - what was written (matter data, qualities, etc.)
 */
export async function checkCascade(spaceId, writeContext) {
  // Check global enable
  const enabled = getLandConfigValue("cascadeEnabled");
  if (enabled === false || enabled === "false") return;

  // Load space and check cascade config
  const space = await Space.findById(spaceId).select("name qualities children seedSpace").lean();
  if (!space || space.seedSpace) return;

  const quals = space.qualities instanceof Map ? Object.fromEntries(space.qualities) : (space.qualities || {});
  const cascadeConfig = quals.cascade;
  if (!cascadeConfig?.enabled) return;

  // Rate limit: count signals from this space in the current minute
  const rateLimit = parseInt(getLandConfigValue("cascadeRateLimit") || "60", 10);
  const recentCount = await countRecentSignals(spaceId);
  if (recentCount >= rateLimit) {
    const signalId = uuidv4();
    const result = { status: CASCADE.REJECTED, source: spaceId, payload: { reason: "rate_limited", count: recentCount, limit: rateLimit }, timestamp: new Date(), signalId };
    await writeResult(signalId, result);
    return { signalId, result };
  }

  // Both booleans true. Fire onCascade.
  const signalId = uuidv4();

  const hookData = {
    space,
    spaceId,
    signalId,
    writeContext,
    cascadeConfig,
    source: spaceId,
    depth: 0,
  };

  try {
    await hooks.run("onCascade", hookData);
  } catch (err) {
    log.warn("Cascade", `onCascade failed at ${space.name}: ${err.message}`);
  }

  // Write result to .flow (the guarantee: something always gets recorded)
  const result = {
    status: hookData._resultStatus || CASCADE.SUCCEEDED,
    source: spaceId,
    payload: hookData._resultPayload || writeContext,
    timestamp: new Date(),
    signalId,
    extName: hookData._resultExtName || null,
  };
  await writeResult(signalId, result);

  return { signalId, result };
}

/**
 * Propagate a cascade signal to a target space.
 * Called by extensions that want to deliver a signal to another space
 * (children, siblings, remote spaces). This is the "arrival" path.
 *
 * The kernel never blocks inbound. Always accepts. Always writes a result.
 *
 * @param {object} opts
 * @param {string} opts.spaceId - target space
 * @param {string} opts.signalId - ties back to the original cascade chain
 * @param {object} opts.payload - signal data
 * @param {string} opts.source - originating spaceId
 * @param {number} opts.depth - current propagation depth
 */
export async function deliverCascade({ spaceId, signalId, payload = {}, source, depth = 0 }) {
  // Per-signal delivery rate limit: cap total deliveries per signalId.
  // Prevents a single cascade from flooding thousands of spaces.
  const maxDeliveriesPerSignal = parseInt(getLandConfigValue("cascadeMaxDeliveriesPerSignal") || "500", 10);
  if (signalId) {
    const entry = _signalDepths.get(signalId);
    const deliveries = (entry?.deliveries || 0) + 1;
    if (deliveries > maxDeliveriesPerSignal) {
      const result = { status: CASCADE.REJECTED, source: spaceId, payload: { reason: "delivery limit exceeded", deliveries, max: maxDeliveriesPerSignal }, timestamp: new Date(), signalId };
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
    const result = { status: CASCADE.REJECTED, source: spaceId, payload: { reason: "payload_not_serializable" }, timestamp: new Date(), signalId };
    await writeResult(signalId, result);
    return result;
  }
  if (payloadBytes > maxPayloadBytes) {
    const result = { status: CASCADE.REJECTED, source: spaceId, payload: { reason: "payload_too_large", size: payloadBytes, max: maxPayloadBytes }, timestamp: new Date(), signalId };
    await writeResult(signalId, result);
    return result;
  }

  // Check depth limit
  const maxDepth = parseInt(getLandConfigValue("cascadeMaxDepth") || "50", 10);
  if (depth > maxDepth) {
    const result = { status: CASCADE.REJECTED, source: spaceId, payload: { reason: "depth limit exceeded", depth, maxDepth }, timestamp: new Date(), signalId };
    await writeResult(signalId, result);
    return result;
  }

  // Depth regression guard: prevent extensions from resetting depth to bypass maxDepth
  if (signalId && !trackSignalDepth(signalId, depth)) {
    const result = { status: CASCADE.REJECTED, source: spaceId, payload: { reason: "depth regression detected", depth }, timestamp: new Date(), signalId };
    await writeResult(signalId, result);
    return result;
  }

  // Load target space
  const space = await Space.findById(spaceId).select("name qualities children seedSpace").lean();
  if (!space) {
    const result = { status: CASCADE.FAILED, source: spaceId, payload: { reason: "space not found" }, timestamp: new Date(), signalId };
    await writeResult(signalId, result);
    return result;
  }
  if (space.seedSpace) {
    const result = { status: CASCADE.REJECTED, source: spaceId, payload: { reason: "land seed spaces do not cascade" }, timestamp: new Date(), signalId };
    await writeResult(signalId, result);
    return result;
  }

  // Circuit breaker: reject signals to tripped trees
  const spaceQuals = space.qualities instanceof Map ? Object.fromEntries(space.qualities) : (space.qualities || {});
  if (spaceQuals.circuit?.tripped) {
    const result = { status: CASCADE.REJECTED, source: spaceId, payload: { reason: "tree circuit breaker tripped" }, timestamp: new Date(), signalId };
    await writeResult(signalId, result);
    return result;
  }

  // Check space's cascade config
  const cascadeConfig = spaceQuals.cascade;

  // Never block inbound. Fire onCascade regardless of local cascade config.
  // The config controls whether THIS space originates cascades, not whether it receives them.
  let result;
  try {
    const hookData = { space, spaceId, signalId, payload, source, depth, cascadeConfig };
    await hooks.run("onCascade", hookData);
    result = {
      status: hookData._resultStatus || CASCADE.SUCCEEDED,
      source: spaceId,
      payload: hookData._resultPayload || payload,
      timestamp: new Date(),
      signalId,
      extName: hookData._resultExtName || null,
    };
  } catch (err) {
    result = { status: CASCADE.FAILED, source: spaceId, payload: { reason: err.message }, timestamp: new Date(), signalId };
  }

  await writeResult(signalId, result);
  return result;
}

/**
 * Count cascade signals from a specific space in the last minute.
 * Reads today's .flow partition and counts results where source matches.
 */
async function countRecentSignals(spaceId) {
  const flowSpace = await Space.findOne({ seedSpace: SEED_SPACE.FLOW }).select("_id").lean();
  if (!flowSpace) return 0;
  const today = todayPartitionName();
  const partition = await Space.findOne({ parent: flowSpace._id, name: today }).select("qualities").lean();
  if (!partition) return 0;
  const results = partition.qualities instanceof Map
    ? partition.qualities.get("results") || {}
    : partition.qualities?.results || {};
  const oneMinuteAgo = Date.now() - 60000;
  let count = 0;
  for (const entries of Object.values(results)) {
    const arr = Array.isArray(entries) ? entries : [entries];
    for (const r of arr) {
      if (r.source === spaceId && new Date(r.timestamp).getTime() > oneMinuteAgo) count++;
    }
  }
  return count;
}

// ── .flow Partitioning ──
// Results are stored in daily partition spaces under .flow.
// Each partition is a child of .flow named by date (YYYY-MM-DD).
// This prevents any single document from growing unbounded.
// Retention deletes entire partition spaces older than resultTTL.

function todayPartitionName() {
  return new Date().toISOString().slice(0, 10); // "2026-03-25"
}

/**
 * Get or create today's partition space under .flow.
 * Creates the partition on first cascade write of the day.
 */
async function getOrCreatePartition() {
  const today = todayPartitionName();
  const flowSpace = await Space.findOne({ seedSpace: SEED_SPACE.FLOW }).select("_id").lean();
  if (!flowSpace) return null;

  // Atomic upsert: prevents duplicate partitions when concurrent cascade
  // writes hit the midnight boundary simultaneously.
  const partition = await Space.findOneAndUpdate(
    { parent: flowSpace._id, name: today },
    {
      $setOnInsert: {
        _id: uuidv4(),
        name: today,
        parent: flowSpace._id,
        children: [],
        contributors: [],
        qualities: { results: {} },
      },
    },
    { upsert: true, new: true, lean: true },
  );

  // Ensure .flow's children includes this partition (idempotent)
  await Space.updateOne(
    { _id: flowSpace._id },
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
  const doc = await Space.findById(partitionId).select("qualities").lean();
  if (!doc) return;
  const results = doc.qualities instanceof Map
    ? doc.qualities.get("results") || {}
    : doc.qualities?.results || {};
  const count = Object.keys(results).length;
  if (count <= maxPerDay) return;

  // Drop oldest until at cap
  const excess = count - maxPerDay;
  for (let i = 0; i < excess; i++) {
    const oldestKey = findOldestResultKey(results);
    if (!oldestKey) break;
    delete results[oldestKey];
    await Space.updateOne(
      { _id: partitionId },
      { $unset: { [`qualities.results.${oldestKey}`]: 1 } },
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
      log.error("Cascade", "No .flow land seed space found. Cannot write result.");
      return;
    }

    const partition = await Space.findById(partitionId).select("qualities").lean();
    if (!partition) return;

    // Hard cap: reject writes when signal key count exceeds per-day cap.
    // This is O(1) and prevents unbounded growth regardless of concurrency.
    const maxPerDay = parseInt(getLandConfigValue("flowMaxResultsPerDay") || "10000", 10);
    const results = partition.qualities instanceof Map
      ? partition.qualities.get("results") || {}
      : partition.qualities?.results || {};
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
        await Space.updateOne(
          { _id: partitionId },
          { $unset: { [`qualities.results.${oldestKey}`]: 1 } },
        );
      } else {
        // No key to drop. Partition qualities is full with non-result data. Reject.
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
    await Space.findByIdAndUpdate(
      partitionId,
      { $push: { [`qualities.results.${signalId}`]: result } },
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
  const flowSpace = await Space.findOne({ seedSpace: SEED_SPACE.FLOW }).select("_id children").lean();
  if (!flowSpace) return [];

  // Search partitions newest first
  const partitions = await Space.find({ parent: flowSpace._id })
    .select("qualities")
    .sort({ name: -1 })
    .lean();

  for (const p of partitions) {
    const results = p.qualities instanceof Map
      ? p.qualities.get("results") || {}
      : p.qualities?.results || {};
    if (results[signalId]) return results[signalId];
  }

  return [];
}

/**
 * Get all recent cascade results across partitions.
 */
export async function getAllCascadeResults(limit = 50) {
  const flowSpace = await Space.findOne({ seedSpace: SEED_SPACE.FLOW }).select("_id").lean();
  if (!flowSpace) return {};

  const partitions = await Space.find({ parent: flowSpace._id })
    .select("qualities")
    .sort({ name: -1 })
    .lean();

  const all = {};
  let count = 0;

  for (const p of partitions) {
    if (count >= limit) break;
    const results = p.qualities instanceof Map
      ? p.qualities.get("results") || {}
      : p.qualities?.results || {};

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
 * Clean up expired partition spaces from .flow based on resultTTL config.
 * Deletes entire partition spaces older than the cutoff. No scanning individual keys.
 */
export async function cleanupExpiredResults() {
  const ttl = parseInt(getLandConfigValue("resultTTL") || "604800", 10);
  const cutoff = new Date(Date.now() - ttl * 1000);
  const cutoffDate = cutoff.toISOString().slice(0, 10); // "2026-03-18"

  const flowSpace = await Space.findOne({ seedSpace: SEED_SPACE.FLOW }).select("_id children").lean();
  if (!flowSpace) return 0;

  // Find partitions older than cutoff (partition name is date string, lexicographic compare works)
  const expired = await Space.find({
    parent: flowSpace._id,
    name: { $lt: cutoffDate },
  }).select("_id name");

  if (expired.length === 0) return 0;

  const expiredIds = expired.map(p => p._id);

  // Remove from .flow children
  await Space.updateOne(
    { _id: flowSpace._id },
    { $pullAll: { children: expiredIds } },
  );

  // Delete partition spaces
  await Space.deleteMany({ _id: { $in: expiredIds } });

  log.verbose("Cascade", `Cleaned ${expired.length} expired partition(s) from .flow: ${expired.map(p => p.name).join(", ")}`);
  return expired.length;
}
