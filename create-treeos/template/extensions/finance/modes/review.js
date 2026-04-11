import { findExtensionRoot } from "../../../seed/tree/extensionMetadata.js";
import { getMonthSummary, getRecentTransactions } from "../core.js";

export default {
  name: "tree:finance-review",
  emoji: "🔍",
  label: "Finance Review",
  bigMode: "tree",
  hidden: true,

  maxMessagesBeforeLoop: 6,
  preserveContextOnLoop: true,

  toolNames: [
    "navigate-tree",
    "get-tree-context",
    "get-tree",
    "get-node-notes",
    "get-searched-notes-by-user",
  ],

  async buildSystemPrompt({ username, rootId, currentNodeId }) {
    const finRoot = await findExtensionRoot(currentNodeId || rootId, "finance") || rootId;
    const summary = finRoot ? await getMonthSummary(finRoot) : null;
    const recent = finRoot ? await getRecentTransactions(finRoot, 20) : [];

    const accountList = summary?.accounts?.length > 0
      ? summary.accounts.map(a => `- ${a.name} (${a.accountType}): $${a.balance}`).join("\n")
      : "No accounts.";

    const categoryList = summary?.categories?.length > 0
      ? summary.categories
          .sort((a, b) => b.spentThisMonth - a.spentThisMonth)
          .map(c => {
            const pct = c.budget > 0 ? ` (${Math.round((c.spentThisMonth / c.budget) * 100)}%)` : "";
            const over = c.budget > 0 && c.spentThisMonth > c.budget ? " OVER BUDGET" : "";
            return `- ${c.name}: $${c.spentThisMonth}${c.budget > 0 ? `/$${c.budget}` : ""}${pct}${over}`;
          }).join("\n")
      : "";

    const recentList = recent.length > 0
      ? recent.slice(0, 15).map(n => `- ${n.content}`).join("\n")
      : "No recent transactions.";

    return `You are reviewing ${username}'s finances. Show the full picture. Be honest.

ACCOUNTS:
${accountList}

${categoryList ? `SPENDING BY CATEGORY (this month):\n${categoryList}\n` : ""}
TOTAL SPENT: $${summary?.totalSpent || 0}
${summary?.totalBudget > 0 ? `TOTAL BUDGET: $${summary.totalBudget}\nREMAINING: $${summary.budgetRemaining}` : ""}

RECENT TRANSACTIONS:
${recentList}

BEHAVIOR:
- Answer their question directly with numbers.
- "How much did I spend on food?" = look at Food category total.
- "What's my balance?" = show all accounts.
- "How am I doing this month?" = compare spending to budgets, highlight overages.
- Flag concerning patterns: overspending in one category, declining balances, no savings.
- Be factual. Don't moralize. Just show the numbers and let them decide.
- Never expose node IDs or metadata to the user.`.trim();
  },
};
