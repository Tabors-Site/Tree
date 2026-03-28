export default {
  name: "breath",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "The tree breathes. A single adaptive rhythm replaces every extension's individual " +
    "timer. Activity speeds it up. Silence slows it down. Dormancy stops it. Each tree " +
    "has its own breathing cycle. Extensions listen to breath:exhale instead of running " +
    "setInterval. Active tree = frequent exhales. Quiet tree = slow exhales. Sleeping " +
    "tree = no exhales, zero cost. Resource usage is proportional to actual activity, " +
    "not installed extension count.",

  needs: {
    services: ["hooks"],
    models: ["Node"],
  },

  optional: {
    extensions: ["heartbeat"],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: true,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    hooks: {
      fires: ["breath:exhale"],
      listens: [
        "afterNote",
        "afterNodeCreate",
        "afterToolCall",
        "afterNavigate",
        "enrichContext",
      ],
    },
    cli: [],
  },
};
