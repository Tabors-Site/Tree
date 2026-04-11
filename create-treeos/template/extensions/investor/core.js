/**
 * Investor Core
 *
 * Track holdings, log trades, monitor portfolio.
 * The tree is the portfolio.
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
  PORTFOLIO: "portfolio",
  WATCHLIST: "watchlist",
  HISTORY: "history",
};

export { ROLES };

// -- Scaffold --

export async function scaffold(rootId, userId) {
  if (!_Node) throw new Error("Investor core not configured");
  const { createNode } = await import("../../seed/tree/treeManagement.js");

  const logNode = await createNode({ name: "Log", parentId: rootId, userId });
  const portfolioNode = await createNode({ name: "Portfolio", parentId: rootId, userId });
  const watchlistNode = await createNode({ name: "Watchlist", parentId: rootId, userId });
  const historyNode = await createNode({ name: "History", parentId: rootId, userId });

  const tags = [
    [logNode, ROLES.LOG],
    [portfolioNode, ROLES.PORTFOLIO],
    [watchlistNode, ROLES.WATCHLIST],
    [historyNode, ROLES.HISTORY],
  ];

  for (const [node, role] of tags) {
    await _metadata.setExtMeta(node, "investor", { role });
  }

  await setNodeMode(rootId, "respond", "tree:investor-coach");
  await setNodeMode(logNode._id, "respond", "tree:investor-log");

  const root = await _Node.findById(rootId);
  if (root) {
    await _metadata.setExtMeta(root, "investor", {
      initialized: true,
      setupPhase: "complete",
    });
  }

  const ids = {};
  for (const [node, role] of tags) ids[role] = String(node._id);

  log.info("Investor", `Scaffolded under ${rootId}`);
  return ids;
}

// -- Find nodes --

export async function findInvestorNodes(rootId) {
  if (!_Node) return null;
  const children = await _Node.find({ parent: rootId }).select("_id name metadata").lean();
  const result = {};
  for (const child of children) {
    const meta = child.metadata instanceof Map
      ? child.metadata.get("investor")
      : child.metadata?.investor;
    if (meta?.role) result[meta.role] = { id: String(child._id), name: child.name };
  }
  return result;
}

export async function isInitialized(rootId) {
  if (!_Node) return false;
  const root = await _Node.findById(rootId).select("metadata").lean();
  if (!root) return false;
  const meta = root.metadata instanceof Map
    ? root.metadata.get("investor")
    : root.metadata?.investor;
  return !!meta?.initialized;
}

export async function getSetupPhase(rootId) {
  if (!_Node) return null;
  const root = await _Node.findById(rootId).select("metadata").lean();
  if (!root) return null;
  const meta = root.metadata instanceof Map
    ? root.metadata.get("investor")
    : root.metadata?.investor;
  return meta?.setupPhase || (meta?.initialized ? "complete" : null);
}

export async function completeSetup(rootId) {
  const root = await _Node.findById(rootId);
  if (!root) return;
  const existing = _metadata.getExtMeta(root, "investor") || {};
  await _metadata.setExtMeta(root, "investor", { ...existing, setupPhase: "complete" });
}

// -- Holdings --

export async function getHoldings(rootId) {
  const nodes = await findInvestorNodes(rootId);
  if (!nodes?.portfolio) return [];

  const children = await _Node.find({ parent: nodes.portfolio.id })
    .select("_id name metadata").lean();

  return children.map(c => {
    const meta = c.metadata instanceof Map
      ? c.metadata.get("investor")
      : c.metadata?.investor;
    const values = c.metadata instanceof Map
      ? c.metadata.get("values")
      : c.metadata?.values;
    const shares = meta?.shares || 0;
    const entryPrice = meta?.entryPrice || 0;
    const currentPrice = meta?.currentPrice || entryPrice;
    const value = shares * currentPrice;
    const cost = shares * entryPrice;
    const gain = value - cost;
    const gainPercent = cost > 0 ? ((gain / cost) * 100) : 0;
    return {
      id: String(c._id),
      name: c.name,
      ticker: meta?.ticker || c.name,
      assetType: meta?.assetType || "stock",
      shares,
      entryPrice,
      currentPrice,
      value,
      gain,
      gainPercent,
    };
  });
}

// -- Watchlist --

export async function getWatchlist(rootId) {
  const nodes = await findInvestorNodes(rootId);
  if (!nodes?.watchlist) return [];

  const children = await _Node.find({ parent: nodes.watchlist.id })
    .select("_id name metadata").lean();

  return children.map(c => {
    const meta = c.metadata instanceof Map
      ? c.metadata.get("investor")
      : c.metadata?.investor;
    return {
      id: String(c._id),
      name: c.name,
      ticker: meta?.ticker || c.name,
      targetPrice: meta?.targetPrice || null,
      stopLoss: meta?.stopLoss || null,
      notes: meta?.notes || null,
    };
  });
}

// -- Portfolio Summary --

export async function getPortfolioSummary(rootId) {
  const holdings = await getHoldings(rootId);

  const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);
  const totalCost = holdings.reduce((sum, h) => sum + (h.shares * h.entryPrice), 0);
  const totalGain = totalValue - totalCost;
  const totalGainPercent = totalCost > 0 ? ((totalGain / totalCost) * 100) : 0;

  const allocation = holdings.map(h => ({
    ticker: h.ticker,
    name: h.name,
    value: h.value,
    percent: totalValue > 0 ? ((h.value / totalValue) * 100) : 0,
    gain: h.gain,
    gainPercent: h.gainPercent,
  }));

  return {
    holdings,
    totalValue,
    totalCost,
    totalGain,
    totalGainPercent,
    allocation,
  };
}
