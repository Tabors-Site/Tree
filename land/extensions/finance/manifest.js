export default {
  name: "finance",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Personal finance. Track accounts, log transactions in natural language, " +
    "monitor spending by category. Each account is a node with a balance. " +
    "Say what you spent or earned and the tree updates. Budget goals per category. " +
    "The AI reflects on patterns, flags overspending, helps you think through " +
    "decisions. Cross-domain: knows your food spending, gym membership status, " +
    "how finances relate to your whole life. Type 'be' for a guided check-in " +
    "on your financial health.",

  territory: "money, spending, budget, income, savings, bills, rent, paycheck, debt, invest, account, bank, credit, debit, purchase, cost, price, afford",
  classifierHints: [
    /\$\d+/,                                                      // "$45", "$1200"
    /\b\d+\s*(dollars?|bucks?|usd|eur|gbp)\b/i,                  // "45 dollars"
    /\b(spent|paid|bought|cost|earned|received|deposited|withdrew|transferred|owe|owes)\b/i,
    /\b(rent|mortgage|groceries|subscription|bill|paycheck|salary|income|savings?|budget|invest|crypto|stock)\b/i,
    /\b(bank|checking|credit card|debit|account|balance|net worth)\b/i,
  ],

  needs: {
    models: ["Node", "Note"],
    services: ["hooks", "llm", "metadata"],
  },

  optional: {
    extensions: [
      "transactions",
      "channels",
      "html-rendering",
      "treeos-base",
    ],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    modes: true,

    hooks: {
      fires: [],
      listens: ["enrichContext"],
    },

    cli: [
      {
        command: "fin [message...]",
        scope: ["tree"],
        description: "Finance. Log spending, check budgets, review.",
        method: "POST",
        endpoint: "/root/:rootId/chat",
        body: ["message"],
      },
    ],
  },
};
