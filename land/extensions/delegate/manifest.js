export default {
  name: "delegate",
  version: "1.0.0",
  builtFor: "treeos-maintenance",
  description:
    "The tree's social intelligence. Intent generates actions for the tree to do itself. " +
    "Delegate matches stuck work to available humans. Reads team contributor lists, activity " +
    "patterns from evolution, competence maps, and inverse-tree profiles. Suggests, never assigns. " +
    "enrichContext injects suggestions at stalled nodes. A contributor navigates nearby and the AI " +
    "says: 'The auth refactor branch has been stalled for two weeks. You've been working on related " +
    "API changes. Want to take a look?' Intent is the tree's desire. Delegate is the tree's social " +
    "intelligence.",

  needs: {
    services: ["hooks", "metadata"],
    models: ["Node", "User"],
  },

  optional: {
    extensions: [
      "evolution",
      "competence",
      "inverse-tree",
      "team",
      "intent",
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
      listens: ["enrichContext"],
    },

    cli: [
      {
        command: "delegate [action] [args...]", scope: ["tree"],
        description: "Delegate suggestions. Actions: dismiss <id>, accept <id>",
        method: "GET",
        endpoint: "/root/:rootId/delegate",
        subcommands: {
          dismiss: {
            method: "POST",
            endpoint: "/root/:rootId/delegate/dismiss",
            args: ["id"],
            description: "Not my problem",
          },
          accept: {
            method: "POST",
            endpoint: "/root/:rootId/delegate/accept",
            args: ["id"],
            description: "I'll look at it",
          },
        },
      },
    ],
  },
};
