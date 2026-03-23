export default {
  name: "gateway",
  version: "1.0.0",
  description: "External channel integration for Telegram, Discord, and web widgets",

  needs: {
    models: ["Node", "User"],
  },

  optional: {
    services: ["energy"],
  },

  provides: {
    models: { GatewayChannel: "./model.js" },
    routes: "./routes.js",
    tools: false,
    jobs: false,

    cli: [
      { command: "gateway", description: "List gateway channels for current tree", method: "GET", endpoint: "/root/:rootId/gateway" },
    ],
  },
};
