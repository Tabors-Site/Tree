/**
 * Long Memory Core
 *
 * Writes lightweight traces to node metadata on every cascade event.
 * Each trace is small: sourceId, timestamp, status. The rolling array
 * is capped so it never grows unbounded. MongoDB atomic update, one
 * operation per cascade hop. Fast enough for the onCascade sequential chain.
 */

import Node from "../../seed/models/node.js";
import { SYSTEM_ROLE } from "../../seed/protocol.js";

// ─────────────────────────────────────────────────────────────────────────
// CONFIG (stored on .config metadata["long-memory"])
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_MAX_CONNECTIONS = 50;

export async function getLongMemoryConfig() {
  const configNode = await Node.findOne({ systemRole: SYSTEM_ROLE.CONFIG }).select("metadata").lean();
  if (!configNode) return { maxConnections: DEFAULT_MAX_CONNECTIONS };

  const meta = configNode.metadata instanceof Map
    ? configNode.metadata.get("long-memory") || {}
    : configNode.metadata?.["long-memory"] || {};

  return {
    maxConnections: meta.maxConnections ?? DEFAULT_MAX_CONNECTIONS,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// TRACE WRITER
// ─────────────────────────────────────────────────────────────────────────

/**
 * Write a cascade trace to a node's metadata.memory.
 * Single atomic MongoDB update. Creates the structure if it doesn't exist.
 *
 * @param {string} nodeId - the node that received the signal
 * @param {string} sourceId - the node that sent/originated the signal
 * @param {string} status - cascade result status (succeeded, failed, etc.)
 * @param {number} maxConnections - cap for the rolling connections array
 */
export async function writeTrace(nodeId, sourceId, status, maxConnections) {
  const timestamp = new Date().toISOString();

  await Node.findByIdAndUpdate(nodeId, {
    $set: {
      "metadata.memory.lastSeen": timestamp,
      "metadata.memory.lastStatus": status,
      "metadata.memory.lastSourceId": sourceId,
    },
    $inc: {
      "metadata.memory.totalInteractions": 1,
    },
    $push: {
      "metadata.memory.connections": {
        $each: [{ sourceId, timestamp, status }],
        $slice: -(maxConnections || DEFAULT_MAX_CONNECTIONS),
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// READER
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get the memory trace for a node.
 *
 * @param {string} nodeId
 * @returns {object|null} memory trace or null
 */
export async function getMemory(nodeId) {
  const node = await Node.findById(nodeId).select("metadata").lean();
  if (!node) return null;

  const meta = node.metadata instanceof Map
    ? node.metadata.get("memory") || null
    : node.metadata?.memory || null;

  return meta;
}

/**
 * Clear the memory trace for a node.
 */
export async function clearMemory(nodeId) {
  await Node.findByIdAndUpdate(nodeId, {
    $unset: { "metadata.memory": 1 },
  });
}
