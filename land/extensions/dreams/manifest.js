export default {
  name: "dreams",
  version: "1.0.0",
  description: "Background tree maintenance. Runs cleanup, short term drain, and understanding on a daily schedule.",

  needs: {
    services: ["llm", "session", "chat", "orchestrator"],
    models: ["Node", "Contribution"],
    extensions: ["understanding"],
  },

  optional: {
    services: ["energy"],
    extensions: ["gateway", "notifications"],
  },

  provides: {
    models: {
      ShortMemory: "./model.js",
    },
    routes: "./routes.js",
    tools: false,
    jobs: "./treeDream.js",
    orchestrator: false,
    energyActions: {},
    sessionTypes: {
      DREAM_ORCHESTRATE: "dream-orchestrate",
      DREAM_NOTIFY: "dream-notify",
      SHORT_TERM_DRAIN: "short-term-drain",
      CLEANUP_REORGANIZE: "cleanup-reorganize",
      CLEANUP_EXPAND: "cleanup-expand",
    },
    cli: [
      { command: "dream-time <time>", description: "Set daily dream time (HH:MM) for current tree", method: "POST", endpoint: "/root/:rootId/dream-time" },
      { command: "holdings", description: "List deferred items for current tree", method: "GET", endpoint: "/root/:rootId/holdings" },
      { command: "holdings-dismiss <id>", description: "Dismiss a deferred item", method: "POST", endpoint: "/root/:rootId/holdings/:id/dismiss" },
      { command: "holdings-view <id>", description: "View details of a deferred item", method: "GET", endpoint: "/root/:rootId/holdings/:id" },
    ],
    hooks: {
      fires: [],
      listens: [],
    },
  },
};
