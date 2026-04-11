/**
 * Finance Core
 *
 * Track accounts, log transactions, monitor spending.
 * The tree is the ledger.
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
  ACCOUNTS: "accounts",
  CATEGORIES: "categories",
  BUDGET: "budget",
  PROFILE: "profile",
  HISTORY: "history",
};

export { ROLES };

// ── Scaffold ──

export async function scaffold(rootId, userId) {
  if (!_Node) throw new Error("Finance core not configured");
  const { createNode } = await import("../../seed/tree/treeManagement.js");

  const logNode = await createNode({ name: "Log", parentId: rootId, userId });
  const accountsNode = await createNode({ name: "Accounts", parentId: rootId, userId });
  const categoriesNode = await createNode({ name: "Categories", parentId: rootId, userId });
  const budgetNode = await createNode({ name: "Budget", parentId: rootId, userId });
  const profileNode = await createNode({ name: "Profile", parentId: rootId, userId });
  const historyNode = await createNode({ name: "History", parentId: rootId, userId });

  // Default accounts
  const checking = await createNode({ name: "Checking", parentId: String(accountsNode._id), userId });
  const savings = await createNode({ name: "Savings", parentId: String(accountsNode._id), userId });
  const cash = await createNode({ name: "Cash", parentId: String(accountsNode._id), userId });
  const creditCard = await createNode({ name: "Credit Card", parentId: String(accountsNode._id), userId });

  // Default spending categories
  for (const cat of ["Food", "Housing", "Transport", "Health", "Entertainment", "Shopping", "Bills", "Other"]) {
    const catNode = await createNode({ name: cat, parentId: String(categoriesNode._id), userId });
    await _metadata.setExtMeta(catNode, "finance", { role: "category" });
  }

  const tags = [
    [logNode, ROLES.LOG],
    [accountsNode, ROLES.ACCOUNTS],
    [categoriesNode, ROLES.CATEGORIES],
    [budgetNode, ROLES.BUDGET],
    [profileNode, ROLES.PROFILE],
    [historyNode, ROLES.HISTORY],
  ];

  for (const [node, role] of tags) {
    await _metadata.setExtMeta(node, "finance", { role });
  }

  // Tag accounts with their type
  for (const [node, type] of [[checking, "checking"], [savings, "savings"], [cash, "cash"], [creditCard, "credit"]]) {
    await _metadata.setExtMeta(node, "finance", { role: "account", accountType: type });
  }

  await setNodeMode(rootId, "respond", "tree:finance-coach");
  await setNodeMode(logNode._id, "respond", "tree:finance-log");

  const root = await _Node.findById(rootId);
  if (root) {
    await _metadata.setExtMeta(root, "finance", {
      initialized: true,
      setupPhase: "complete",
      currency: "USD",
    });
  }

  const ids = {};
  for (const [node, role] of tags) ids[role] = String(node._id);

  log.info("Finance", `Scaffolded under ${rootId}`);
  return ids;
}

// ── Find nodes ──

export async function findFinanceNodes(rootId) {
  if (!_Node) return null;
  const children = await _Node.find({ parent: rootId }).select("_id name metadata").lean();
  const result = {};
  for (const child of children) {
    const meta = child.metadata instanceof Map
      ? child.metadata.get("finance")
      : child.metadata?.finance;
    if (meta?.role) result[meta.role] = { id: String(child._id), name: child.name };
  }
  return result;
}

export async function isInitialized(rootId) {
  if (!_Node) return false;
  const root = await _Node.findById(rootId).select("metadata").lean();
  if (!root) return false;
  const meta = root.metadata instanceof Map
    ? root.metadata.get("finance")
    : root.metadata?.finance;
  return !!meta?.initialized;
}

export async function getSetupPhase(rootId) {
  if (!_Node) return null;
  const root = await _Node.findById(rootId).select("metadata").lean();
  if (!root) return null;
  const meta = root.metadata instanceof Map
    ? root.metadata.get("finance")
    : root.metadata?.finance;
  return meta?.setupPhase || (meta?.initialized ? "complete" : null);
}

export async function completeSetup(rootId) {
  const root = await _Node.findById(rootId);
  if (!root) return;
  const existing = _metadata.getExtMeta(root, "finance") || {};
  await _metadata.setExtMeta(root, "finance", { ...existing, setupPhase: "complete" });
}

// ── Accounts ──

export async function getAccounts(rootId) {
  const nodes = await findFinanceNodes(rootId);
  if (!nodes?.accounts) return [];

  const children = await _Node.find({ parent: nodes.accounts.id })
    .select("_id name metadata").lean();

  return children.map(c => {
    const meta = c.metadata instanceof Map
      ? c.metadata.get("finance")
      : c.metadata?.finance;
    const values = c.metadata instanceof Map
      ? c.metadata.get("values")
      : c.metadata?.values;
    return {
      id: String(c._id),
      name: c.name,
      accountType: meta?.accountType || "other",
      balance: values?.balance || 0,
    };
  });
}

// ── Categories ──

export async function getCategories(rootId) {
  const nodes = await findFinanceNodes(rootId);
  if (!nodes?.categories) return [];

  const children = await _Node.find({ parent: nodes.categories.id })
    .select("_id name metadata").lean();

  return children.map(c => {
    const values = c.metadata instanceof Map
      ? c.metadata.get("values")
      : c.metadata?.values;
    const goals = c.metadata instanceof Map
      ? c.metadata.get("goals")
      : c.metadata?.goals;
    return {
      id: String(c._id),
      name: c.name,
      spentThisMonth: values?.monthSpent || 0,
      budget: goals?.monthBudget || 0,
    };
  });
}

// ── Spending summary ──

export async function getMonthSummary(rootId) {
  const accounts = await getAccounts(rootId);
  const categories = await getCategories(rootId);

  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);
  const totalSpent = categories.reduce((sum, c) => sum + c.spentThisMonth, 0);
  const totalBudget = categories.reduce((sum, c) => sum + c.budget, 0);

  return {
    accounts,
    categories: categories.filter(c => c.spentThisMonth > 0 || c.budget > 0),
    totalBalance,
    totalSpent,
    totalBudget,
    budgetRemaining: totalBudget > 0 ? totalBudget - totalSpent : null,
  };
}

// ── Recent transactions from log ──

export async function getRecentTransactions(rootId, limit = 15) {
  const nodes = await findFinanceNodes(rootId);
  if (!nodes?.log) return [];

  const { getNotes } = await import("../../seed/tree/notes.js");
  const result = await getNotes({ nodeId: nodes.log.id, limit });
  return result?.notes || [];
}
