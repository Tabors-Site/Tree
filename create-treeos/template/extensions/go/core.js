/**
 * Go Core
 *
 * Cross-tree navigation by intent. Searches all user's trees
 * via the routing index and node names.
 */

import Node from "../../seed/models/node.js";
import log from "../../seed/log.js";

let _getExtension = null;
let _getUserRoots = null;

export function configure({ getExtension }) {
  _getExtension = getExtension;
}

function getRoutingExports() {
  if (!_getExtension) return null;
  return _getExtension("tree-orchestrator")?.exports || null;
}

function getNavExports() {
  if (!_getExtension) return null;
  return _getExtension("navigation")?.exports || null;
}

// ─────────────────────────────────────────────────────────────────────────
// LIST ALL POSITIONS
// ─────────────────────────────────────────────────────────────────────────

export async function listPositions(userId) {
  // Tree roots = direct children of land root, excluding system nodes
  const landRoot = await Node.findOne({ systemRole: "land-root" }).select("_id").lean();
  if (!landRoot) return { trees: [], extensions: [] };

  const allRoots = await Node.find({
    parent: landRoot._id,
    systemRole: null,
  }).select("_id name dateCreated rootOwner contributors").lean();

  // Filter to roots this user owns or contributes to
  const userRoots = allRoots.filter(r =>
    String(r.rootOwner) === String(userId) ||
    (r.contributors || []).some(c => String(c) === String(userId))
  );

  // Deduplicate by name (keep newest)
  const seen = new Map();
  for (const root of userRoots) {
    const existing = seen.get(root.name);
    if (!existing || root.dateCreated > existing.dateCreated) {
      seen.set(root.name, root);
    }
  }
  const trees = [...seen.values()].map(r => ({
    nodeId: String(r._id),
    name: r.name,
  }));

  // Extension positions from routing index
  const extensions = [];
  const routing = getRoutingExports();
  if (routing?.getIndexForRoot) {
    for (const root of trees) {
      const index = routing.getIndexForRoot(root.nodeId);
      if (!index) continue;
      for (const [extName, entry] of index) {
        extensions.push({
          nodeId: entry.nodeId,
          name: extName,
          path: entry.path,
        });
      }
    }
  }

  return { trees, extensions };
}

// ─────────────────────────────────────────────────────────────────────────
// FIND DESTINATION
// ─────────────────────────────────────────────────────────────────────────

export async function findDestination(query, userId) {
  const target = query.toLowerCase().trim();
  if (!target) return listPositions(userId);

  const matches = [];

  // Get user's roots
  const nav = getNavExports();
  const roots = nav?.getUserRootsWithNames
    ? await nav.getUserRootsWithNames(userId)
    : await Node.find({ rootOwner: userId }).select("_id name").lean();

  const routing = getRoutingExports();

  // Search routing index across all trees
  for (const root of roots) {
    const rootId = String(root._id);

    if (routing?.getIndexForRoot) {
      const index = routing.getIndexForRoot(rootId);
      if (index) {
        for (const [extName, entry] of index) {
          const score = matchScore(target, extName, entry.name, entry.path);
          if (score > 0) {
            matches.push({ ...entry, extension: extName, score });
          }
        }
      }
    }

    // Check root name
    const rootScore = matchScore(target, null, root.name, "/" + root.name);
    if (rootScore > 0) {
      matches.push({
        nodeId: rootId,
        name: root.name,
        path: "/" + root.name,
        mode: null,
        score: rootScore,
      });
    }
  }

  // If no matches from index, search node names directly
  if (matches.length === 0) {
    const nodeMatch = await searchNodesByName(target, roots.map(r => r._id));
    if (nodeMatch) {
      matches.push(nodeMatch);
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  if (matches.length === 0) {
    return { found: false, query: target };
  }

  if (matches.length === 1 || matches[0].score > matches[1].score * 1.5) {
    // Clear winner
    return { found: true, destination: matches[0] };
  }

  // Ambiguous
  return { found: true, ambiguous: true, options: matches.slice(0, 5) };
}

function matchScore(target, extName, nodeName, path) {
  const lowerName = (nodeName || "").toLowerCase();
  const lowerPath = (path || "").toLowerCase();
  const lowerExt = (extName || "").toLowerCase();

  // Exact extension name match
  if (lowerExt === target) return 10;

  // Exact node name match
  if (lowerName === target) return 9;

  // Extension name contains target
  if (lowerExt && lowerExt.includes(target)) return 7;

  // Node name contains target
  if (lowerName.includes(target)) return 6;

  // Path contains target
  if (lowerPath.includes(target)) return 4;

  // Word match in name
  const targetWords = target.split(/\s+/);
  const nameWords = lowerName.split(/[\s\-_\/]+/);
  const pathWords = lowerPath.split(/[\s\-_\/]+/);
  const allWords = [...nameWords, ...pathWords, lowerExt].filter(Boolean);

  let wordHits = 0;
  for (const tw of targetWords) {
    if (allWords.some(w => w.includes(tw) || tw.includes(w))) wordHits++;
  }
  if (wordHits > 0) return 2 + wordHits;

  return 0;
}

async function searchNodesByName(target, rootIds) {
  try {
    // Search for nodes whose name matches the target across user's trees
    const regex = new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const node = await Node.findOne({
      name: regex,
      $or: rootIds.map(id => ({ $or: [{ _id: id }, { parent: { $exists: true } }] })),
    }).select("_id name parent").lean();

    if (!node) return null;

    // Build path
    const parts = [node.name];
    let current = node;
    let depth = 0;
    while (current.parent && depth < 10) {
      current = await Node.findById(current.parent).select("name parent rootOwner").lean();
      if (!current) break;
      parts.unshift(current.name);
      if (current.rootOwner) break;
      depth++;
    }

    return {
      nodeId: String(node._id),
      name: node.name,
      path: "/" + parts.join("/"),
      mode: null,
      score: 3,
    };
  } catch {
    return null;
  }
}
