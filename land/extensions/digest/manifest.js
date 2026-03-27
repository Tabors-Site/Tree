export default {
  name: "digest",
  version: "1.0.0",
  builtFor: "treeos-maintenance",
  description:
    "The tree's daily newspaper. Written by the tree about itself. Runs once daily, reads " +
    "changelog, intent history, dream logs, prune history, purpose coherence trends, evolution " +
    "dormancy alerts, pulse health, and delegate suggestions. Sends one combined summary to the " +
    "AI: write a morning briefing for this land. What happened overnight. What needs attention. " +
    "What the tree did on its own. What's healthy. What's drifting. Result writes to metadata on " +
    "the land root. If gateway is installed, pushes the briefing to a configured channel.",

  needs: {
    services: ["hooks", "llm", "metadata"],
    models: ["Node"],
  },

  optional: {
    extensions: [
      "changelog",
      "intent",
      "dreams",
      "prune",
      "purpose",
      "evolution",
      "pulse",
      "delegate",
      "gateway",
    ],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: true,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},

    hooks: {
      fires: [],
      listens: [],
    },

    cli: [
      {
        command: "digest [action]",
        description: "The tree's daily briefing. Actions: history, config",
        method: "GET",
        endpoint: "/land/digest",
        subcommands: {
          history: {
            method: "GET",
            endpoint: "/land/digest/history",
            description: "Past briefings",
          },
          config: {
            method: "GET",
            endpoint: "/land/digest/config",
            description: "Delivery time, channel, scope",
          },
        },
      },
    ],
  },
};
