export default {
  name: "scripts",
  version: "1.1.0",
  description: "Sandboxed JavaScript execution on nodes with safe functions for values, goals, and status",

  needs: {
    models: ["Node"],
  },

  optional: {
    services: ["energy"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: false,
    orchestrator: false,
    energyActions: {
      script: { cost: 2 },
    },
    sessionTypes: {},
    schemaVersion: 1,
    migrations: "./migrations.js",
    cli: [
      { command: "scripts", description: "List scripts on current node", method: "GET", endpoint: "/node/:nodeId/scripts/help" },
      { command: "script <id>", description: "View a script", method: "GET", endpoint: "/node/:nodeId/script/:id" },
      { command: "run <id>", description: "Execute a script", method: "POST", endpoint: "/node/:nodeId/script/:id/execute" },
    ],
  },
};
