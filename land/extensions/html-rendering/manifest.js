export default {
  name: "html-rendering",
  version: "1.0.0",
  description: "Server-rendered HTML pages, share token auth for ?html endpoints",

  needs: {
    models: ["User", "Node"],
  },

  optional: {},

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    energyActions: {},
    sessionTypes: {},
    env: [
      { key: "ENABLE_FRONTEND_HTML", required: false, default: "true", description: "Enable ?html server-rendered pages" },
    ],
  },
};
