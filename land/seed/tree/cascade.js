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
import { CASCADE } from "../protocol.js";
import { v4 as uuidv4 } from "uuid";

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

  // Check node's cascade config
  const meta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
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
 * Write a cascade result to the .flow system node.
 */
async function writeResult(signalId, result) {
  try {
    // Atomic push to avoid concurrent read-modify-write races.
    // Uses MongoDB $set on the specific signalId key to minimize conflict surface.
    await Node.findOneAndUpdate(
      { systemRole: "flow" },
      { $push: { [`metadata.results.${signalId}`]: result } },
      { upsert: false },
    );
  } catch (err) {
    log.error("Cascade", "Failed to write result to .flow:", err.message);
  }
}

/**
 * Get cascade results for a signal.
 */
export async function getCascadeResults(signalId) {
  const flowNode = await Node.findOne({ systemRole: "flow" }).select("metadata").lean();
  if (!flowNode) return [];
  const results = flowNode.metadata instanceof Map
    ? flowNode.metadata.get("results") || {}
    : flowNode.metadata?.results || {};
  return results[signalId] || [];
}

/**
 * Get all recent cascade results.
 */
export async function getAllCascadeResults(limit = 50) {
  const flowNode = await Node.findOne({ systemRole: "flow" }).select("metadata").lean();
  if (!flowNode) return {};
  const results = flowNode.metadata instanceof Map
    ? flowNode.metadata.get("results") || {}
    : flowNode.metadata?.results || {};

  const entries = Object.entries(results);
  const sorted = entries.sort((a, b) => {
    const aTime = a[1][a[1].length - 1]?.timestamp || 0;
    const bTime = b[1][b[1].length - 1]?.timestamp || 0;
    return new Date(bTime) - new Date(aTime);
  });
  return Object.fromEntries(sorted.slice(0, limit));
}

/**
 * Clean up expired results from .flow based on resultTTL config.
 */
export async function cleanupExpiredResults() {
  const ttl = parseInt(getLandConfigValue("resultTTL") || "604800", 10);
  const cutoff = new Date(Date.now() - ttl * 1000);

  const flowNode = await Node.findOne({ systemRole: "flow" });
  if (!flowNode) return 0;

  const results = flowNode.metadata instanceof Map
    ? flowNode.metadata.get("results") || {}
    : flowNode.metadata?.results || {};

  let cleaned = 0;
  for (const [signalId, entries] of Object.entries(results)) {
    const newest = entries[entries.length - 1];
    if (newest?.timestamp && new Date(newest.timestamp) < cutoff) {
      delete results[signalId];
      cleaned++;
    }
  }

  if (cleaned > 0) {
    if (flowNode.metadata instanceof Map) {
      flowNode.metadata.set("results", results);
    } else {
      flowNode.metadata.results = results;
    }
    if (flowNode.markModified) flowNode.markModified("metadata");
    await flowNode.save();
    log.verbose("Cascade", `Cleaned ${cleaned} expired signal(s) from .flow`);
  }

  return cleaned;
}
