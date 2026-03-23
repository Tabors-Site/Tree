export default {
  name: "gateway",
  version: "1.1.0",
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
            description: "Add a channel. Usage: gateway add <name> <telegram|discord|webapp> <input|output|input-output> <read|write|read-write>",
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
