export default {
  name: "gateway-matrix",
  version: "1.0.0",
  builtFor: "treeos-connect",
  description:
    "Registers the Matrix channel type with the gateway core, enabling trees to communicate " +
    "through the Matrix open federation protocol. Output channels send notifications to a " +
    "Matrix room using the Client-Server API (PUT to /_matrix/client/v3/rooms/:roomId/send). " +
    "Messages are sent as m.room.message events with both plain text and org.matrix.custom.html " +
    "formatting. No SDK dependency: the handler uses the Matrix REST API directly via fetch." +
    "\n\n" +
    "Input channels poll for new messages using the Matrix /sync endpoint with long-polling, " +
    "the same mechanism the Matrix spec recommends for bots. One sync loop runs per unique " +
    "homeserver and access token combination. Multiple channels sharing the same credentials " +
    "share a single sync loop. On startup, the extension scans the database for enabled " +
    "Matrix input channels, decrypts their access tokens, and starts sync loops automatically. " +
    "The initial sync fetches the since token without processing old messages, so only new " +
    "messages after boot are handled. Events are filtered to m.room.message with m.text " +
    "msgtype. The bot's own messages are ignored using the configured MATRIX_BOT_USER_ID to " +
    "prevent loops." +
    "\n\n" +
    "Input-output channels close the loop: when an inbound message produces a reply from " +
    "the tree orchestrator, the bot posts the response back to the same Matrix room. " +
    "Credentials can be set globally via environment variables (MATRIX_HOMESERVER, " +
    "MATRIX_ACCESS_TOKEN, MATRIX_BOT_USER_ID) or per channel for multi-server deployments. " +
    "Because Matrix is an open, self-hostable protocol, this channel type is the most " +
    "aligned with TreeOS's federation philosophy: your land, your Matrix homeserver, your " +
    "tree, your data. No third-party platform controls the connection. The sync loop retries " +
    "gracefully on errors with a 10-second backoff and aborts cleanly on shutdown.",

  needs: {
    extensions: ["gateway"],
  },

  optional: {},

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: true,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [
      { key: "MATRIX_HOMESERVER", required: false, description: "Matrix homeserver URL (e.g., https://matrix.yourdomain.com)" },
      { key: "MATRIX_ACCESS_TOKEN", required: false, secret: true, description: "Matrix bot access token" },
      { key: "MATRIX_BOT_USER_ID", required: false, description: "Matrix bot user ID (e.g., @treebot:yourdomain.com)" },
    ],
    cli: [],
  },
};
