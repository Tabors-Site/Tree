export default {
  name: "tree-cli",
  version: "1.0.0",
  description: "AI can execute TreeOS CLI commands. Ext install, config, peer management, and any registered command.",

  needs: {
    models: ["User"],
  },

  optional: {
    extensions: ["shell"],
  },

  provides: {
    routes: false,
    tools: "./tools.js",
    jobs: false,
  },
};
