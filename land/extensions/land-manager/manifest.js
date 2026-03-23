export default {
  name: "land-manager",
  version: "1.0.0",
  description: "Autonomous land management agent for extensions, config, peers, and health monitoring",

  needs: {
    models: ["Node", "User"],
  },

  optional: {
    extensions: ["shell"],
  },

  provides: {
    routes: "./routes.js",
    tools: "./tools.js",
    jobs: false,

    cli: [
      { command: "land-status", description: "Show land overview (extensions, users, trees, peers)", method: "GET", endpoint: "/land/status" },
      { command: "land-users", description: "List all users on this land", method: "GET", endpoint: "/land/users" },
    ],
  },
};
