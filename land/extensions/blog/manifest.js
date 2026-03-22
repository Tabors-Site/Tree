export default {
  name: "blog",
  version: "1.0.0",
  description: "Land-level blog for posts and updates",

  needs: {
    models: ["User"],
  },

  optional: {},

  provides: {
    models: { BlogPost: "./model.js" },
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
  },
};
