export default {
  name: "gateway-telegram",
  version: "1.0.1",
  builtFor: "treeos-connect",
  description:
    "Telegram channel type for the gateway extension. Registers the telegram channel type at boot, " +
    "enabling trees to communicate through Telegram bots. A channel requires a bot token (from " +
    "BotFather) and a chat ID (the Telegram group or direct message to connect). The bot token is " +
    "stored encrypted in the channel's secrets. The chat ID stays in plaintext metadata since it " +
    "is not sensitive.\n\n" +
    "Three directions are supported: input (messages from Telegram flow into the tree), output " +
    "(the tree pushes notifications to Telegram), and input-output (full bidirectional conversation " +
    "with the tree's AI through Telegram). Output messages are sent as Markdown-formatted text via " +
    "the Telegram Bot API's sendMessage endpoint, with titles bolded. Messages exceeding Telegram's " +
    "4096 character limit are automatically truncated.\n\n" +
    "For input channels, the extension registers a Telegram webhook by calling the setWebhook API " +
    "with a unique per-channel URL and a cryptographic secret token for request verification. The " +
    "webhook endpoint at POST /api/v1/gateway/telegram/:channelId responds with 200 immediately to " +
    "prevent Telegram retries, then processes the message asynchronously. Inbound messages are " +
    "verified against both the secret token header (X-Telegram-Bot-Api-Secret-Token) and the " +
    "expected chat ID, rejecting messages from unregistered chats. The sender's username and " +
    "platform ID are extracted and passed to the gateway core's processGatewayMessage function. " +
    "When a channel is disabled or deleted, unregisterInput calls deleteWebhook to clean up the " +
    "Telegram-side registration.",

  needs: {
    models: ["Node", "User"],
    extensions: ["gateway"],
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
    env: [],
    cli: [],

    hooks: {
      fires: [],
      listens: [],
    },
  },
};
