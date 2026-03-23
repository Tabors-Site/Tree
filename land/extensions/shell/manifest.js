export default {
  name: "shell",
  version: "1.0.0",
  description: "Execute shell commands from AI. God-tier only. Full system access.",

  needs: {
    models: ["User"],
  },

  provides: {
    routes: false,
    tools: "./tools.js",
    jobs: false,

    cli: [],
  },
};
