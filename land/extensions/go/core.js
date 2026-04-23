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
            // Only pull the serializable fields — hints/vocab on the entry
            // are arrays of RegExp which render as "{}" through JSON and
            // leak into the CLI output ("[{},{},{},{}]" noise).
            matches.push({
              nodeId: entry.nodeId,
              name: entry.name,
              path: entry.path,
              mode: entry.mode,
              extension: extName,
              score,
            });
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

  // Dedupe: a single destination can score via both the routing index
  // entry and the root-name pass. Keep the highest-scoring copy per nodeId.
  const byNode = new Map();
  for (const m of matches) {
    const key = String(m.nodeId || m.path || m.name);
    const prev = byNode.get(key);
    if (!prev || m.score > prev.score) byNode.set(key, m);
  }
  const unique = [...byNode.values()];
  unique.sort((a, b) => b.score - a.score);
  matches.length = 0;
  for (const m of unique) matches.push(m);

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

// Stop words we don't want to match on. "go to food" should match nothing
// for "go" or "to" — only the content word "food" matters.
const STOP_WORDS = new Set(["go", "to", "the", "a", "an", "at", "in", "into", "on", "my", "our", "for", "from"]);

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

  // Word-level match. Drop stop words and single-letter tokens from the
  // query so "go to food" can't score on a tree literally named "t" (which
  // the old bidirectional containment let through via `"to".includes("t")`).
  const targetWords = target
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  if (targetWords.length === 0) return 0;

  const nameWords = lowerName.split(/[\s\-_\/]+/).filter(Boolean);
  const pathWords = lowerPath.split(/[\s\-_\/]+/).filter(Boolean);
  const allWords = [...nameWords, ...pathWords, lowerExt].filter(Boolean);

  // Containment is ONE-WAY: the entity word must contain the target word.
  // The old reverse direction (tw.includes(w)) matched any entity whose
  // name was a substring of any target word, which meant single-letter
  // tree names got credit for multi-letter query words.
  let wordHits = 0;
  for (const tw of targetWords) {
    if (allWords.some((w) => w.includes(tw))) wordHits++;
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
