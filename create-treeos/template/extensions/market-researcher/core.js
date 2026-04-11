/**
 * Market Researcher Core
 *
 * Track sectors, record findings, maintain a watchlist.
 * The tree is the research desk.
 */

import log from "../../seed/log.js";
import { setNodeMode } from "../../seed/modes/registry.js";

let _Node = null;
let _Note = null;
let _metadata = null;

export function configure({ Node, Note, metadata }) {
  _Node = Node;
  _Note = Note;
  _metadata = metadata;
}

const ROLES = {
  LOG: "log",
  SECTORS: "sectors",
  FINDINGS: "findings",
  WATCHLIST: "watchlist",
  PROFILE: "profile",
};

export { ROLES };

// -- Scaffold --

export async function scaffold(rootId, userId) {
  if (!_Node) throw new Error("Market researcher core not configured");
  const { createNode } = await import("../../seed/tree/treeManagement.js");

  const logNode = await createNode({ name: "Log", parentId: rootId, userId });
  const sectorsNode = await createNode({ name: "Sectors", parentId: rootId, userId });
  const findingsNode = await createNode({ name: "Findings", parentId: rootId, userId });
  const watchlistNode = await createNode({ name: "Watchlist", parentId: rootId, userId });
  const profileNode = await createNode({ name: "Profile", parentId: rootId, userId });

  const tags = [
    [logNode, ROLES.LOG],
    [sectorsNode, ROLES.SECTORS],
    [findingsNode, ROLES.FINDINGS],
    [watchlistNode, ROLES.WATCHLIST],
    [profileNode, ROLES.PROFILE],
  ];

  for (const [node, role] of tags) {
    await _metadata.setExtMeta(node, "market-researcher", { role });
  }

  // Set default mode on root to coach, log node to tell
  await setNodeMode(rootId, "respond", "tree:market-coach");
  await setNodeMode(logNode._id, "respond", "tree:market-tell");

  // Configure browser-bridge auto-approve for financial sites
  const root = await _Node.findById(rootId);
  if (root) {
    await _metadata.setExtMeta(root, "market-researcher", {
      initialized: true,
      setupPhase: "complete",
      // Recommended browser-bridge sites (operator sets these on the browser-bridge namespace):
      // coingecko.com, coinmarketcap.com, *.tradingview.com, *.yahoo.com,
      // finance.yahoo.com, seeking-alpha.com, bloomberg.com
    });
  }

  const ids = {};
  for (const [node, role] of tags) ids[role] = String(node._id);

  log.info("MarketResearcher", `Scaffolded under ${rootId}`);
  return ids;
}

// -- Find nodes --

export async function findResearchNodes(rootId) {
  if (!_Node) return null;
  const children = await _Node.find({ parent: rootId }).select("_id name metadata").lean();
  const result = {};
  for (const child of children) {
    const meta = child.metadata instanceof Map
      ? child.metadata.get("market-researcher")
      : child.metadata?.["market-researcher"];
    if (meta?.role) result[meta.role] = { id: String(child._id), name: child.name };
  }
  return result;
}

export async function isInitialized(rootId) {
  if (!_Node) return false;
  const root = await _Node.findById(rootId).select("metadata").lean();
  if (!root) return false;
  const meta = root.metadata instanceof Map
    ? root.metadata.get("market-researcher")
    : root.metadata?.["market-researcher"];
  return !!meta?.initialized;
}

export async function getSetupPhase(rootId) {
  if (!_Node) return null;
  const root = await _Node.findById(rootId).select("metadata").lean();
  if (!root) return null;
  const meta = root.metadata instanceof Map
    ? root.metadata.get("market-researcher")
    : root.metadata?.["market-researcher"];
  return meta?.setupPhase || (meta?.initialized ? "complete" : null);
}

export async function completeSetup(rootId) {
  const root = await _Node.findById(rootId);
  if (!root) return;
  const existing = _metadata.getExtMeta(root, "market-researcher") || {};
  await _metadata.setExtMeta(root, "market-researcher", { ...existing, setupPhase: "complete" });
}

// -- Sectors --

export async function getSectors(rootId) {
  const nodes = await findResearchNodes(rootId);
  if (!nodes?.sectors) return [];

  const children = await _Node.find({ parent: nodes.sectors.id })
    .select("_id name metadata").lean();

  return children.map(c => ({
    id: String(c._id),
    name: c.name,
  }));
}

// -- Recent findings --

export async function getRecentFindings(rootId, limit = 15) {
  const nodes = await findResearchNodes(rootId);
  if (!nodes?.findings) return [];

  const { getNotes } = await import("../../seed/tree/notes.js");
  const result = await getNotes({ nodeId: nodes.findings.id, limit });
  return result?.notes || [];
}

// -- Watchlist --

export async function getWatchlist(rootId) {
  const nodes = await findResearchNodes(rootId);
  if (!nodes?.watchlist) return [];

  const children = await _Node.find({ parent: nodes.watchlist.id })
    .select("_id name metadata").lean();

  return children.map(c => ({
    id: String(c._id),
    name: c.name,
  }));
}
