export default {
  name: "competence",
  version: "1.0.0",
  builtFor: "treeos-intelligence",
  description:
    "The tree knows where its knowledge ends. Competence detects the edges of what " +
    "the tree contains. A question arrives and the tree can answer it from its notes. " +
    "Another question arrives and the tree has nothing. Competence tracks which queries " +
    "found answers and which found silence. Over time it builds a map of the tree's " +
    "competence boundary. The AI injects this: I can help with X, Y, Z at this branch. " +
    "I don't have information about A or B. Honest about limits instead of hallucinating.",

  needs: {
    services: ["hooks"],
    models: ["Node"],
  },

  optional: {
    extensions: ["embed", "explore", "gap-detection"],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    cli: [],
    hooks: { fires: [], listens: [] },
  },
};
