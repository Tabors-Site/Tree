export default {
  name: "monitor",
  version: "1.0.0",
  description: "Land activity monitoring. Summarizes AI usage, hook activity, sessions, and extension health.",

  needs: {
    services: ["hooks"],
    models: ["Node", "User", "Contribution"],
  },

  optional: {
    services: ["llm"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},

    hooks: {
      fires: [],
      listens: [],
    },

    cli: [
      {
        command: "activity [query...]",
        description: "Ask about land activity. What happened today, which trees are busiest, AI usage stats.",
        method: "POST",
        endpoint: "/land/activity",
        body: ["query"],
      },
    ],
  },
};
