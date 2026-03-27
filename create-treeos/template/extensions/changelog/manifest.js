export default {
  name: "changelog",
  version: "1.0.0",
  builtFor: "treeos-maintenance",
  description:
    "What changed since you last looked. Reads contributions (the kernel's audit trail) " +
    "and constructs a narrative. Scoped to subtree by default. Shows new work, completed " +
    "work, decisions, stalled areas, and autonomous activity from intent and dreams.",

  needs: {
    services: ["hooks", "llm", "metadata"],
    models: ["Node", "Contribution"],
  },

  optional: {
    extensions: ["intent", "dreams"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
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
        command: "changelog [args...]", scope: ["tree"],
        description: "What changed at this branch. --since 7d, --user <name>, --land",
        method: "GET",
        endpoint: "/node/:nodeId/changelog",
      },
    ],
  },
};
