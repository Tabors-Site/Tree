export default {
  name: "kb",
  version: "1.0.1",
  builtFor: "TreeOS",
  description:
    "Knowledge base. Tell it things. Ask it things. One person maintains, " +
    "everyone benefits. The tree organizes input into a topic hierarchy. " +
    "The AI answers from stored notes with citations. Staleness detection " +
    "flags notes that haven't been updated. Unplaced node catches what the " +
    "AI can't categorize yet. Two modes: kb-tell (create knowledge), " +
    "kb-ask (retrieve with citations). Type 'be' for a guided review " +
    "of stale notes. The tree that replaces wikis, training manuals, " +
    "and the coworker who always gets interrupted.",

  classifierHints: [
    /\b(kb|knowledge base|tell kb|save to kb|add to kb|store in kb|ask kb)\b/i,
    /\b(procedure|protocol|policy|process|steps for)\b/i,
    /\b(remember this|note that|fyi|heads up|update:|changed to)\b/i,
  ],

  needs: {
    models: ["Node", "Note"],
    services: ["hooks", "llm", "metadata"],
  },

  optional: {
    extensions: [
      "understanding",
      "tree-compress",
      "scout",
      "embed",
      "explore",
      "competence",
      "contradiction",
      "purpose",
      "prestige",
      "values",
      "channels",
      "breath",
      "html-rendering",
      "treeos-base",
    ],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    modes: true,
    guidedMode: "tree:kb-review",

    hooks: {
      fires: [],
      listens: ["enrichContext", "breath:exhale"],
    },

    cli: [
      {
        command: "kb [action] [message...]",
        scope: ["tree"],
        description: "Knowledge base. Tell or ask.",
        method: "POST",
        endpoint: "/root/:rootId/kb",
        body: ["message"],
        subcommands: {
          status: {
            method: "GET",
            endpoint: "/root/:rootId/kb/status",
            description: "Coverage, freshness, unplaced count.",
          },
          stale: {
            method: "GET",
            endpoint: "/root/:rootId/kb/stale",
            description: "Notes not updated in 90+ days.",
          },
          unplaced: {
            method: "GET",
            endpoint: "/root/:rootId/kb/unplaced",
            description: "Items that couldn't be categorized.",
          },
        },
      },
    ],
  },
};
