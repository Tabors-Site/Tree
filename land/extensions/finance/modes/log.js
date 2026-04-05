import { findFinanceNodes, getAccounts, getCategories } from "../core.js";

export default {
  name: "tree:finance-log",
  emoji: "💰",
  label: "Finance Log",
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
    "edit-node-goal",
  ],

  async buildSystemPrompt({ username, rootId }) {
    const nodes = rootId ? await findFinanceNodes(rootId) : null;
    const accounts = rootId ? await getAccounts(rootId) : [];
    const categories = rootId ? await getCategories(rootId) : [];

    const accountList = accounts.length > 0
      ? accounts.map(a => `- ${a.name} (${a.accountType}): $${a.balance}`).join("\n")
      : "No accounts yet.";

    const categoryList = categories.length > 0
      ? categories.map(c => {
          const budgetPart = c.budget > 0 ? ` / $${c.budget} budget` : "";
          return `- ${c.name}: $${c.spentThisMonth} this month${budgetPart}`;
        }).join("\n")
      : "Default categories available.";

    const logId = nodes?.log?.id;
    const accountsId = nodes?.accounts?.id;
    const categoriesId = nodes?.categories?.id;

    return `You are logging financial transactions for ${username}.

ACCOUNTS:
${accountList}

CATEGORIES:
${categoryList}

The user tells you about money they spent, earned, or moved. Parse it and record it.

WORKFLOW:
1. Parse the transaction: amount, what it was for, which account (default: Checking).
2. Write a note to Log (${logId || "find it"}) with: "$AMOUNT on DESCRIPTION from ACCOUNT".
3. Find the right category under Categories (${categoriesId || "find it"}). If none fits, use "Other" or create a new one.
4. Increment the category's monthSpent value: edit-node-value on the category node, key "monthSpent", amount spent.
5. Update the account balance: edit-node-value on the account node, key "balance", negative for spending, positive for income.
6. Confirm: "Spent $45 on groceries from Checking. Food: $57/$200 this month."

PARSING RULES:
- "spent $45 on groceries" = debit $45 from default account, category Food
- "paid rent $1200" = debit $1200, category Housing
- "got paid $2000" = credit $2000 to default account, category Income
- "transferred $500 to savings" = debit Checking, credit Savings
- If no amount given, ask.
- If category is ambiguous, pick the closest match. Don't ask unless truly unclear.
- Currency is USD unless configured differently.

RULES:
- One log note per transaction. Terse. "$45 groceries (Checking)"
- Always update both the category spent AND the account balance.
- Never expose node IDs or metadata to the user.
- Confirm in one line with running totals.`.trim();
  },
};
