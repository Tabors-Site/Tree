export default {
  name: "gateway-webhook",
  version: "1.0.1",
  builtFor: "treeos-connect",
  description:
    "Web push channel type for the gateway extension. Registers the webapp channel type at boot, " +
    "enabling trees to push notifications to web browsers using the Web Push protocol (RFC 8030). " +
    "This is output-only: browsers receive notifications from the tree, but cannot send messages " +
    "back through this channel. For bidirectional browser communication, use the WebSocket " +
    "connection or a different channel type.\n\n" +
    "Configuration requires a Push API subscription object from the browser (containing endpoint, " +
    "keys.p256dh, and keys.auth), which is stored encrypted in the channel's secrets. VAPID keys " +
    "(public, private, and contact email) are set in environment variables and used for all web " +
    "push channels on the land. The extension dynamically imports the web-push npm package at send " +
    "time, so the package must be installed but the extension boots without it.\n\n" +
    "When a notification fires, the handler serializes the title, body, and type into a JSON " +
    "payload and delivers it through the web-push library, which handles VAPID signing, payload " +
    "encryption, and the HTTP/2 push to the browser's push service endpoint. Expired subscriptions " +
    "(HTTP 410 Gone) are handled gracefully: the channel is automatically disabled and the error " +
    "is recorded, preventing repeated delivery attempts to a dead subscription. This means " +
    "channels self-heal when a user clears their browser data or revokes notification permissions.",

  needs: {
    models: ["Node", "User"],
    extensions: ["gateway"],
  },

  optional: {},

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [
      { key: "VAPID_PUBLIC_KEY", required: false, description: "VAPID public key for web push" },
      { key: "VAPID_PRIVATE_KEY", required: false, secret: true, description: "VAPID private key for web push" },
      { key: "VAPID_EMAIL", required: false, description: "VAPID contact email for web push" },
    ],
    cli: [],

    hooks: {
      fires: [],
      listens: [],
    },
  },
};
