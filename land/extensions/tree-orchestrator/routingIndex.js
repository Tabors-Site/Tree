/**
 * Routing Index
 *
 * In-memory cache of all nodes with metadata.modes.respond set.
 * Replaces per-message DB queries in localClassify with one Map scan.
 * Rebuilt on boot and after structural/mode changes.
 */

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import { getModeOwner } from "../../seed/tree/extensionScope.js";
import { getClassifierHintsForMode } from "../loader.js";

// Map<rootId, Map<extName, { nodeId, name, path, mode, hints }>>
const _indices = new Map();

// ─────────────────────────────────────────────────────────────────────────
// PATH RESOLUTION
// ─────────────────────────────────────────────────────────────────────────

async function buildPathString(nodeId) {
  const parts = [];
  let current = await Node.findById(nodeId).select("name parent rootOwner").lean();
  let depth = 0;
  while (current && depth < 20) {
    parts.unshift(current.name || String(current._id));
    if (current.rootOwner || !current.parent) break;
    current = await Node.findById(current.parent).select("name parent rootOwner").lean();
    depth++;
  }
  return "/" + parts.join("/");
}

// ─────────────────────────────────────────────────────────────────────────
// REBUILD
// ─────────────────────────────────────────────────────────────────────────

export async function rebuildIndexForRoot(rootId) {
  const rid = String(rootId);
  try {
    // Find all nodes in this tree with modes set (including root itself)
    const nodes = await Node.find({
      $or: [
        { _id: rootId },
        { rootOwner: rootId },          // root's direct info
        { parent: { $exists: true } },  // children (filtered below)
      ],
      "metadata.modes": { $exists: true },
    }).select("_id name parent rootOwner metadata.modes").lean();

    // Filter to only nodes that belong to this tree
    // Root node: _id === rootId
    // Other nodes: walk parent chain to verify (expensive, so use a cheaper approach)
    // Actually, rootOwner is only on root nodes. For children, we need a different query.
    // Let's use a simpler approach: get all descendants of rootId.

    const index = new Map();

    // Check root itself
    const root = await Node.findById(rootId).select("_id name metadata.modes").lean();
    if (root) {
      const modes = root.metadata instanceof Map ? root.metadata.get("modes") : root.metadata?.modes;
      if (modes?.respond) {
        const owner = getModeOwner(modes.respond);
        if (owner) {
          const hints = getClassifierHintsForMode(modes.respond) || [];
          index.set(owner, {
            nodeId: rid,
            name: root.name,
            path: "/" + (root.name || rid),
            mode: modes.respond,
            hints,
          });
        }
      }
    }

    // Find all descendants with modes set (BFS from root children)
    const descendants = await findDescendantsWithModes(rootId);
    for (const node of descendants) {
      const modes = node.metadata instanceof Map ? node.metadata.get("modes") : node.metadata?.modes;
      const modeKey = modes?.respond;
      if (!modeKey) continue;

      const owner = getModeOwner(modeKey);
      if (!owner) continue;
      if (index.has(owner)) continue; // first (shallowest) wins

      const hints = getClassifierHintsForMode(modeKey) || [];
      const path = await buildPathString(node._id);

      index.set(owner, {
        nodeId: String(node._id),
        name: node.name,
        path,
        mode: modeKey,
        hints,
      });
    }

    // Also include confined extensions that are ext-allowed at the tree root.
    // These don't scaffold nodes or set modes.respond, but they're active here.
    try {
      const { getConfinedExtensions, isExtensionBlockedAtNode, getModesOwnedBy } = await import("../../seed/tree/extensionScope.js");
      const { getExtensionManifest, flattenVocabulary } = await import("../loader.js");
      for (const extName of getConfinedExtensions()) {
        if (index.has(extName)) continue;
        if (await isExtensionBlockedAtNode(extName, rid)) continue;
        const manifest = getExtensionManifest(extName);
        const hints = flattenVocabulary(manifest);
        if (hints.length === 0) continue;
        const modes = getModesOwnedBy(extName);
        const defaultMode = modes.find(m => m.endsWith("-agent") || m.endsWith("-tell") || m.endsWith("-log") || m.endsWith("-browse")) || modes[0];
        if (!defaultMode) continue;
        index.set(extName, {
          nodeId: rid,
          name: extName,
          path: "/" + (root?.name || rid),
          mode: defaultMode,
          hints,
        });
      }
    } catch {}

    _indices.set(rid, index);
    if (index.size > 0) {
      log.debug("RoutingIndex", `Built index for ${root?.name || rid}: ${index.size} extensions`);
    }
  } catch (err) {
    log.debug("RoutingIndex", `Failed to build index for ${rid}: ${err.message}`);
  }
}

async function findDescendantsWithModes(rootId) {
  // BFS: walk children level by level, collect nodes with modes set
  const results = [];
  let currentLevel = [String(rootId)];
  let depth = 0;

  while (currentLevel.length > 0 && depth < 10) {
    const children = await Node.find({
      parent: { $in: currentLevel },
    }).select("_id name parent metadata.modes children").lean();

    const nextLevel = [];
    for (const child of children) {
      const modes = child.metadata instanceof Map ? child.metadata.get("modes") : child.metadata?.modes;
      if (modes?.respond) results.push(child);
      if (child.children?.length > 0) nextLevel.push(String(child._id));
    }
    currentLevel = nextLevel;
    depth++;
  }

  return results;
}

export async function rebuildAll() {
  // Tree roots = direct children of land root, excluding system nodes
  const landRoot = await Node.findOne({ systemRole: "land-root" }).select("_id").lean();
  if (!landRoot) return;
  const roots = await Node.find({
    parent: landRoot._id,
    systemRole: null,
  }).select("_id").lean();

  for (const root of roots) {
    await rebuildIndexForRoot(root._id);
  }
  log.debug("RoutingIndex", `Indexed ${_indices.size} trees`);
}

// ─────────────────────────────────────────────────────────────────────────
// QUERY
// ─────────────────────────────────────────────────────────────────────────

/**
 * Query the routing index for a message at a position.
 * Returns { mode, targetNodeId, confidence } or null.
 */
export function queryIndex(rootId, message, currentPath) {
  const index = _indices.get(String(rootId));
  if (!index || index.size === 0) return null;

  for (const [, entry] of index) {
    // Only match descendants of current position (or the current position itself)
    if (currentPath && entry.path !== currentPath && !entry.path.startsWith(currentPath + "/")) {
      continue;
    }

    // Test hints
    if (entry.hints.length > 0 && entry.hints.some(re => re.test(message))) {
      return {
        mode: entry.mode,
        targetNodeId: entry.nodeId,
        confidence: 0.9,
      };
    }
  }

  return null;
}

/**
 * Query the routing index for ALL extensions that match a message.
 * Used by the orchestrator to detect multi-extension chains.
 * Returns [{ mode, targetNodeId, extName }] (all matches, not just first).
 */
export function queryAllMatches(rootId, message, currentPath) {
  const index = _indices.get(String(rootId));
  if (!index || index.size === 0) return [];

  const matches = [];
  for (const [extName, entry] of index) {
    if (currentPath && entry.path !== currentPath && !entry.path.startsWith(currentPath + "/")) {
      continue;
    }
    if (entry.hints.length > 0 && entry.hints.some(re => re.test(message))) {
      matches.push({ mode: entry.mode, targetNodeId: entry.nodeId, extName });
    }
  }
  return matches;
}

/**
 * Get the raw index for a root. Used by the go extension for cross-tree search.
 */
export function getIndexForRoot(rootId) {
  return _indices.get(String(rootId)) || null;
}

/**
 * Get all indexed roots.
 */
export function getAllIndexedRoots() {
  return [..._indices.keys()];
}

/**
 * Invalidate a root's index. Called on structural changes.
 */
export function invalidateRoot(rootId) {
  _indices.delete(String(rootId));
}
