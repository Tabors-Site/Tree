export default {
  name: "land-manager",
  version: "1.0.0",
  description: "Autonomous land management agent. Lives in system nodes. Manages extensions, config, peers, and land health.",

  needs: {
    models: ["Node", "User"],
  },

  optional: {
    extensions: ["shell", "tree-cli"],
  },

  provides: {
    routes: false,
    tools: "./tools.js",
    jobs: false,
  },
};
