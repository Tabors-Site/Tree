export default {
  name: "gateway",
  version: "2.0.0",
  description: "Gateway core: channel model, CRUD, dispatch, and type registry. Install gateway-telegram, gateway-discord, or gateway-webhook for platform support.",

  needs: {
    services: ["session"],
    models: ["Node", "User"],
  },

  optional: {
    services: ["energy"],
  },

  provides: {
    models: { GatewayChannel: "./model.js" },
    routes: "./routes.js",
    tools: false,
    sessionTypes: {
      GATEWAY_INPUT: "gateway-input",
    },

    cli: [
      {
        command: "gateway [action] [args...]",
        description: "Gateway channels. Actions: add, update, delete, test. No action lists channels.",
        method: "GET",
        endpoint: "/root/:rootId/gateway",
        subcommands: {
          "add": {
            method: "POST",
            endpoint: "/root/:rootId/gateway",
            args: ["name", "type", "direction", "mode"],
            description: "Add a channel. Usage: gateway add <name> <type> <direction> <mode>",
          },
          "update": {
            method: "PUT",
            endpoint: "/gateway/channel/:channelId",
            args: ["channelId"],
            description: "Update a channel. Usage: gateway update <channelId> (pass fields in body)",
          },
          "delete": {
            method: "DELETE",
            endpoint: "/gateway/channel/:channelId",
            args: ["channelId"],
            description: "Delete a channel. Usage: gateway delete <channelId>",
          },
          "test": {
            method: "POST",
            endpoint: "/gateway/channel/:channelId/test",
            args: ["channelId"],
            description: "Send a test notification. Usage: gateway test <channelId>",
          },
        },
      },
    ],
  },
};
