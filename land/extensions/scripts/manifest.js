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
    cli: [
      { command: "scripts", description: "List scripts on current node", method: "GET", endpoint: "/node/:nodeId/scripts/help" },
      { command: "script <id>", description: "View a script", method: "GET", endpoint: "/node/:nodeId/script/:id" },
      { command: "run <id>", description: "Execute a script", method: "POST", endpoint: "/node/:nodeId/script/:id/execute" },
    ],
  },
};
