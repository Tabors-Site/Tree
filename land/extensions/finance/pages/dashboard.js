/**
 * Finance Dashboard
 *
 * Builds from getMonthSummary() data. Renders via the generic app dashboard.
 * Accounts show balances. Categories show spending vs budget.
 * Recent transactions from the log.
 */

import { renderAppDashboard } from "../../html-rendering/html/appDashboard.js";

const CATEGORY_COLORS = {
  Food: "#48bb78",
  Housing: "#667eea",
  Transport: "#f6ad55",
  Health: "#fc8181",
  Entertainment: "#a78bfa",
  Shopping: "#ed64a6",
  Bills: "#4fd1c5",
  Other: "#718096",
};

export function renderFinanceDashboard({ rootId, rootName, summary, recentTransactions, token, userId, inApp }) {
  const s = summary || {};
  const accounts = s.accounts || [];
  const categories = s.categories || [];
  const totalBalance = s.totalBalance || 0;
  const totalSpent = s.totalSpent || 0;
  const totalBudget = s.totalBudget || 0;
  const budgetRemaining = s.budgetRemaining;

  // Hero: total balance
  const hero = {
    value: `$${totalBalance.toLocaleString()}`,
    label: totalBudget > 0
      ? `$${totalSpent.toLocaleString()} spent of $${totalBudget.toLocaleString()} budget`
      : `$${totalSpent.toLocaleString()} spent this month`,
    color: budgetRemaining != null && budgetRemaining < 0 ? "#fc8181" : "#48bb78",
    sub: budgetRemaining != null && budgetRemaining >= 0
      ? `$${budgetRemaining.toLocaleString()} remaining`
      : budgetRemaining != null
        ? `$${Math.abs(budgetRemaining).toLocaleString()} over budget`
        : null,
  };

  // Stats: account balances
  const stats = accounts.map(a => ({
    value: `$${a.balance.toLocaleString()}`,
    label: a.name,
  }));

  // Bars: category spending vs budget
  const bars = categories
    .filter(c => c.spentThisMonth > 0 || c.budget > 0)
    .sort((a, b) => b.spentThisMonth - a.spentThisMonth)
    .map(c => ({
      label: c.name,
      current: c.spentThisMonth,
      goal: c.budget || 0,
      color: CATEGORY_COLORS[c.name] || "#a78bfa",
      unit: "$",
    }));

  // Cards: recent transactions
  const txItems = (recentTransactions || []).slice(0, 20).map(n => ({
    text: n.content || "Transaction",
    sub: n.createdAt ? new Date(n.createdAt).toLocaleDateString() : null,
  }));

  const cards = [];
  if (txItems.length > 0) {
    cards.push({ title: "Recent Transactions", items: txItems });
  }

  // Account details card
  if (accounts.length > 0) {
    cards.push({
      title: "Accounts",
      items: accounts.map(a => ({
        text: `${a.name} (${a.accountType})`,
        detail: [`$${a.balance.toLocaleString()}`],
      })),
    });
  }

  return renderAppDashboard({
    rootId,
    rootName: rootName || "Finance",
    token,
    userId,
    inApp: !!inApp,
    subtitle: new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
    hero,
    stats,
    bars,
    cards,
    chatBar: {
      placeholder: "Log a transaction or ask about spending...",
      endpoint: `/api/v1/root/${rootId}/chat`,
    },
    emptyState: totalSpent === 0 && accounts.every(a => a.balance === 0)
      ? { title: "No transactions yet", message: "Tell me what you spent or earned. The tree tracks it." }
      : null,
  });
}
