export default {
  name: "shell",
  version: "1.0.0",
  description: "Execute shell commands from AI conversation. God tier only. Full system access.",

  needs: {
    models: ["User"],
  },

  optional: {},

  provides: {
    models: {},
    routes: false,
    tools: true,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    cli: [],
  },
};
