export default {
  name: "gateway",
  version: "1.0.0",
  builtFor: "treeos-connect",
  description:
    "A tree is not limited to the TreeOS interface. The gateway extension is the core " +
    "abstraction that connects trees to external platforms: Discord, Slack, Telegram, email, " +
    "Matrix, Reddit, X, and any future channel type. It provides the channel model, the " +
    "CRUD API, the type registry, the dispatch system, and the input processor. Platform-" +
    "specific extensions (gateway-discord, gateway-slack, gateway-email, etc.) register " +
    "their handlers with this core and inherit all shared infrastructure." +
    "\n\n" +
    "Each channel binds a tree root to an external destination with three configuration " +
    "dimensions. Direction controls data flow: output (tree pushes notifications outward), " +
    "input (external messages flow into the tree), or input-output (bidirectional). Mode " +
    "controls AI behavior on inbound messages: write maps to place (content goes onto the " +
    "tree silently), read maps to query (AI answers without modifying the tree), and " +
    "read-write maps to chat (full conversation with tree modifications). Notification " +
    "types filter which outbound events a channel receives (dream summaries, dream thoughts, " +
    "or custom types). Up to ten channels per tree root." +
    "\n\n" +
    "The dispatch system finds all enabled output channels for a root, filters by " +
    "notification type, decrypts each channel's secrets, delegates to the registered " +
    "platform handler's send function, and logs success or failure with timestamps and " +
    "error messages. The input processor is a complete message pipeline: it validates the " +
    "channel, enforces queue depth limits (max 2 concurrent per channel), resolves the " +
    "channel owner's LLM access, creates an OrchestratorRuntime session, routes through " +
    "the tree orchestrator with mode-appropriate flags, handles abort/cancel commands, and " +
    "returns the AI's reply for the platform handler to deliver. Secrets (API keys, bot " +
    "tokens, webhook URLs) are encrypted at rest using AES-256-CBC. The type registry " +
    "enforces a strict handler contract: validateConfig, buildEncryptedConfig, send, and " +
    "optional registerInput/unregisterInput for managing persistent connections like bots.",

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
