export default {
  name: "scripts",
  version: "1.0.0",
  description: "VM2 sandboxed scripts per node with scheduling and safe functions",

  needs: {
    models: ["Node"],
  },

  optional: {
    services: ["energy"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {
      script: { cost: 2 },
    },
    sessionTypes: {},
  },
};
