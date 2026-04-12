export default {
  name: "finance",
  version: "1.0.1",
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

  // Territory vocabulary split by part of speech.
  //
  // Philosophy: finance is the most likely domain to hijack other extensions
  // because money words sneak into all sorts of contexts ("cost me reps",
  // "bill as exercise", "invest in my training"). We keep nouns tight and
  // unambiguously financial, and we avoid overly generic verbs that trip
  // food and fitness sentences ("had" in food, "ran" in fitness etc).
  //
  // "groceries" intentionally left OUT of finance nouns. It's more of a food
  // concept and routing would confuse users saying "bought groceries" at a
  // food node. Food's locality bonus handles this case correctly.
  //
  // "bill" as a noun is only matched with a utility prefix (electric bill,
  // phone bill, etc.) to avoid hijacking on exercise names like "Bill".
  vocabulary: {
    verbs: [
      // Transaction verbs (unambiguously financial)
      /\b(spent|spend|spending|paid|paying|pay\s+for|bought|buying|purchased|purchasing|sold|selling|earned|earning|received|deposit(?:ed)?|withdraw(?:n|ing)?|withdrew|transferred|transferring|owe|owes|owing)\b/i,
      // Investment / account verbs
      /\b(invested|investing|saved\s+up|borrowed|borrowing|lent|lending|refinanced|refinancing|cashed\s+out|traded|trading)\b/i,
      // Monetary action phrases
      /\b(check(?:ed)?\s+(?:my\s+)?(?:balance|account|budget))\b/i,
    ],
    nouns: [
      // Money amounts (strong signals)
      /\$\d+(?:\.\d{2})?/,
      /\b\d+\s*(dollars?|bucks?|usd|eur|gbp|cents?|cad|aud)\b/i,
      // Utility bills (requires prefix to avoid "Bill" as a name)
      /\b(electric|phone|water|internet|gas|utility|utilities|medical|cable|insurance|heating|power)\s+bills?/i,
      // Explicit bill noun paired with pay context only
      /\b(pay|paid|paying|due)\s+(?:the\s+|my\s+|a\s+)?bill/i,
      // Income and obligations
      /\b(rent|mortgage|subscription|subscriptions|paycheck|salary|wages|income|savings?|budget|allowance|tip|tips|tax|taxes|refund)\b/i,
      // Investment instruments
      /\b(invest(?:ment)?s?|crypto|bitcoin|ethereum|stock|stocks|bonds?|shares?|portfolio|dividend|dividends|401k|ira|roth|etf|mutual\s+fund)\b/i,
      // Banking terms
      /\b(bank|banking|checking|credit\s+card|debit\s+card|credit|debit|account|balance|net\s+worth|overdraft|interest\s+rate|loan|loans|debt|debts|fees?|transaction|transactions|receipt|receipts|statement|statements)\b/i,
      // Expense / category nouns
      /\b(expense|expenses|spending|purchase|purchases|bill|bills)\s+(?:category|report|breakdown|summary)?\b/i,
    ],
    adjectives: [
      // Money states
      /\b(expensive|pricey|cheap|affordable|unaffordable|broke|rich|wealthy|in\s+debt|debt[- ]free|over\s+budget|under\s+budget|over\s+priced|profitable|cost[- ]effective)\b/i,
      // Amount qualifiers (when paired with money words)
      /\b(tight\s+budget|big\s+purchase|major\s+expense|unexpected\s+cost)\b/i,
    ],
  },

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
