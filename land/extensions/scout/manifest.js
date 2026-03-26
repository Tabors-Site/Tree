export default {
  name: "scout",
  version: "1.0.0",
  description:
    "The tree sends scouts ahead. Before explore reads deeply, scout runs a fast " +
    "structural pass. It counts children, checks types, reads names, checks metadata " +
    "density. Returns a heat map of where the interesting content is without reading " +
    "any of it. Explore uses the scout map to decide where to drill. Scout is the " +
    "peripheral vision. Explore is the focused gaze.",

  needs: {
    services: ["hooks"],
    models: ["Node"],
  },

  optional: {
    extensions: ["evolution", "pulse"],
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
