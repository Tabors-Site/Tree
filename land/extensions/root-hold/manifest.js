export default {
  name: "root-hold",
  version: "1.0.0",
  description:
    "The tree stays aligned with its purpose. Every tree has a thesis. A root " +
    "purpose that everything under it should serve. Root-hold monitors coherence " +
    "between the thesis and the actual content. When branches drift too far from " +
    "purpose, when notes accumulate that don't serve the root intention, root-hold " +
    "surfaces the drift. Not to delete. To ask: is this branch still part of this " +
    "tree, or did it grow into a new tree that needs its own root?",

  needs: {
    services: ["hooks", "llm"],
    models: ["Node", "Note"],
  },

  optional: {
    extensions: ["embed", "contradiction"],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},

    cli: [
      {
        command: "roothold [action]",
        description: "Current thesis and coherence trend. Actions: thesis, drift, review.",
        method: "GET",
        endpoint: "/root/:rootId/roothold",
        subcommands: {
          "thesis": { method: "GET", endpoint: "/root/:rootId/roothold/thesis", description: "Show or regenerate the thesis" },
          "drift": { method: "GET", endpoint: "/root/:rootId/roothold/drift", description: "Nodes with lowest coherence scores" },
          "review": { method: "GET", endpoint: "/root/:rootId/roothold/review", description: "Notes flagged as off-purpose" },
        },
      },
    ],

    hooks: {
      fires: [],
      listens: ["afterNote", "enrichContext"],
    },
  },
};
