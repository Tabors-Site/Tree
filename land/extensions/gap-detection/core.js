/**
 * Gap Detection Core
 *
 * Compares signal metadata namespaces against loaded extensions.
 * Writes gap records to the receiving node when unrecognized namespaces arrive.
 */

import Node from "../../seed/models/node.js";
import { getLoadedExtensionNames } from "../loader.js";

// Namespaces that are kernel or core, not extensions. Never flagged as gaps.
const KERNEL_NAMESPACES = new Set([
  "cascade", "circuit", "extensions", "nav", "tools", "modes",
  "memory", "codebook", "perspective", "gaps", "pulse",
  "_sealed", "_passthrough", "tags",
]);

/**
 * Extract extension namespace keys from a cascade payload.
 *
 * Only inspects explicit extension data carriers, not arbitrary top-level
 * payload keys. Local cascade payloads are writeContext (action, contentType,
 * etc.) which are not extension namespaces. Cross-land signals carry node
 * metadata in payload.metadata or payload.extensionData.
 */
export function extractNamespaces(payload) {
  if (!payload || typeof payload !== "object") return [];

  const namespaces = new Set();

  // Cross-land signals carry the source node's metadata map.
  // Each key in this map is an extension namespace.
  if (payload.metadata && typeof payload.metadata === "object") {
    for (const key of Object.keys(payload.metadata)) {
      if (key.startsWith("_")) continue;
      if (KERNEL_NAMESPACES.has(key)) continue;
      namespaces.add(key);
    }
  }

  // Some relay patterns pack extension data under a dedicated key
  if (payload.extensionData && typeof payload.extensionData === "object") {
    for (const key of Object.keys(payload.extensionData)) {
      if (key.startsWith("_")) continue;
      if (KERNEL_NAMESPACES.has(key)) continue;
      namespaces.add(key);
    }
  }

  // Signals may declare their extension origin via tags
  if (Array.isArray(payload.tags)) {
    for (const tag of payload.tags) {
      if (typeof tag === "string" && !KERNEL_NAMESPACES.has(tag)) {
        namespaces.add(tag);
      }
    }
  }

  return [...namespaces];
}

/**
 * Find namespaces in a signal that don't match any loaded extension.
 */
export function findGaps(namespaces) {
  const loaded = new Set(getLoadedExtensionNames());
  return namespaces.filter((ns) => !loaded.has(ns));
}

/**
 * Write gap records to a node's metadata.gaps.
 * Each gap: { namespace, firstSeen, lastSeen, count }.
 * Increments count if the gap already exists. Adds new entry if not.
 */
export async function writeGaps(nodeId, gapNamespaces) {
  if (!gapNamespaces || gapNamespaces.length === 0) return;

  const node = await Node.findById(nodeId).select("metadata").lean();
  if (!node) return;

  const meta = node.metadata instanceof Map
    ? Object.fromEntries(node.metadata)
    : (node.metadata || {});

  const existing = Array.isArray(meta.gaps) ? meta.gaps : [];
  const gapMap = new Map(existing.map((g) => [g.namespace, g]));
  const now = new Date().toISOString();

  for (const ns of gapNamespaces) {
    const entry = gapMap.get(ns);
    if (entry) {
      entry.lastSeen = now;
      entry.count = (entry.count || 1) + 1;
    } else {
      gapMap.set(ns, { namespace: ns, firstSeen: now, lastSeen: now, count: 1 });
    }
  }

  await Node.findByIdAndUpdate(nodeId, {
    $set: { "metadata.gaps": [...gapMap.values()] },
  });
}

/**
 * Get gap records for a node.
 */
export async function getGaps(nodeId) {
  const node = await Node.findById(nodeId).select("metadata").lean();
  if (!node) return [];

  const meta = node.metadata instanceof Map
    ? Object.fromEntries(node.metadata)
    : (node.metadata || {});

  return Array.isArray(meta.gaps) ? meta.gaps : [];
}

/**
 * Clear gap records for a node (e.g. after installing the missing extension).
 */
export async function clearGaps(nodeId) {
  await Node.findByIdAndUpdate(nodeId, { $unset: { "metadata.gaps": 1 } });
}
