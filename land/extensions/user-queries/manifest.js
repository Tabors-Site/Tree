export default {
  name: "user-queries",
  version: "1.0.0",
  description: "User level data access for notes, tags, contributions, and chats",

  needs: {
    models: ["User", "Node"],
  },

  optional: {},

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
  },
};
