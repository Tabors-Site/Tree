export default {
  name: "changelog",
  version: "1.0.0",
  description:
    "The tree remembers what changed and why. Every structural change, every " +
    "compression, every prune, every reroot move gets a human-readable entry. " +
    "Not the contribution log (that's the audit trail of who did what). The " +
    "changelog is the narrative of why the tree looks the way it does now. " +
    "When a new contributor joins a tree, they read the changelog to understand " +
    "the tree's history without reading every note.",

  needs: {
    services: ["hooks"],
    models: ["Node"],
  },

  optional: {
    extensions: ["prune", "reroot", "tree-compress"],
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
