export default {
  name: "competence",
  version: "1.0.0",
  builtFor: "treeos-intelligence",
  description:
    "The tree knows where its knowledge ends. Tracks which queries found answers " +
    "and which found silence. Over time builds a map of the tree's competence boundary. " +
    "The AI injects: I can help with X, Y, Z at this branch. I don't have information " +
    "about A or B. Honest about limits instead of hallucinating.",

  needs: {
    services: ["hooks", "metadata"],
    models: ["Node"],
  },

  optional: {
    extensions: ["embed", "explore", "gap-detection"],
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
      listens: ["afterLLMCall", "enrichContext"],
    },

    cli: [
      {
        command: "competence",
        description: "Knowledge boundaries at this position",
        method: "GET",
        endpoint: "/node/:nodeId/competence",
      },
    ],
  },
};
