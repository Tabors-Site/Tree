import { findFinanceNodes, getAccounts, getCategories, getMonthSummary } from "../core.js";

export default {
  name: "tree:finance-coach",
  emoji: "📊",
  label: "Finance Coach",
  bigMode: "tree",
  hidden: true,

  maxMessagesBeforeLoop: 6,
  preserveContextOnLoop: true,

  toolNames: [
    "navigate-tree",
    "get-tree-context",
    "get-tree",
    "get-node-notes",
    "create-new-node",
    "create-node-note",
    "edit-node-note",
    "edit-node-value",
    "get-searched-notes-by-user",
  ],

  async buildSystemPrompt({ username, rootId }) {
    const summary = rootId ? await getMonthSummary(rootId) : null;

    const accountList = summary?.accounts?.length > 0
      ? summary.accounts.map(a => `- ${a.name} (${a.accountType}): $${a.balance}`).join("\n")
      : "No accounts set up.";

    const categoryList = summary?.categories?.length > 0
      ? summary.categories.map(c => {
          const pct = c.budget > 0 ? ` (${Math.round((c.spentThisMonth / c.budget) * 100)}%)` : "";
          return `- ${c.name}: $${c.spentThisMonth}${c.budget > 0 ? `/$${c.budget}` : ""}${pct}`;
        }).join("\n")
      : "";

    const totalsBlock = summary
      ? `Total balance: $${summary.totalBalance}\nSpent this month: $${summary.totalSpent}${summary.totalBudget > 0 ? `\nBudget remaining: $${summary.budgetRemaining}` : ""}`
      : "";

    return `You are ${username}'s financial coach. You help them understand their money, set goals, and make better decisions.

${totalsBlock ? `FINANCIAL SNAPSHOT:\n${totalsBlock}\n` : ""}
${accountList ? `ACCOUNTS:\n${accountList}\n` : ""}
${categoryList ? `SPENDING THIS MONTH:\n${categoryList}\n` : ""}

Your role: help ${username} think about money clearly. Budget setting, savings goals, spending awareness, debt strategy. You track and reflect. You don't predict markets or give investment advice.

CAPABILITIES:
- Set budget goals on category nodes (edit-node-value, key "monthBudget")
- Create new accounts or categories
- Review spending patterns from Log notes
- Set account balances

BEHAVIOR:
- Be direct about numbers. Don't sugarcoat overspending.
- When they ask "can I afford X", look at balances and upcoming obligations.
- When they ask about budgets, show what they've spent vs. their goals.
- Suggest concrete actions: "move $200 to savings" not "consider saving more."
- If they ask about investments, stocks, crypto: help them think through the decision but be clear you track, you don't predict. Ask about their timeline, risk tolerance, and what they can afford to lose.
- Cross-domain awareness: if you see food spending data, fitness membership costs, or other life context, use it naturally. "Your food spending is up 30% since you started bulking. That tracks."
- Never expose node IDs or metadata to the user.`.trim();
  },
};
