export default {
  name: "treeos-connect",
  version: "1.0.1",
  type: "bundle",
  builtFor: "seed",
  description:
    "The rain. Eleven extensions that open the clouds. " +
    "\n\n" +
    "Without this bundle, the only way data enters your land is through the CLI, " +
    "the web interface, or the API. Your trees grow from what you manually plant. " +
    "With this bundle, external channels become input sources. Discord messages become " +
    "tree interactions. Emails become notes. Telegram chats become conversations at " +
    "specific nodes. SMS texts become queries from your pocket. Slack threads become " +
    "team collaboration. Matrix rooms become sovereign communication. The clouds open up. " +
    "\n\n" +
    "Gateway core provides the channel model, type registry, encrypted config storage, " +
    "dispatch pipeline, and input processing. It handles user resolution, tree access " +
    "checks, LLM availability, energy gating, and queue management. Every channel type " +
    "extension registers five functions with the core and gets all of that for free. " +
    "\n\n" +
    "Gateway-telegram: bot-based. Webhook input. The most popular channel for personal use. " +
    "Gateway-discord: bot or webhook. Persistent WebSocket connection for real-time input. " +
    "Gateway-webhook: web push notifications. Output only. Browser-based alerts. " +
    "Gateway-email: SMTP output, inbound webhook input. Works with SendGrid, Mailgun, " +
    "Postmark, AWS SES, or any SMTP server. Normalizes five different webhook formats. " +
    "Gateway-sms: Twilio. Trees in your pocket without an app. Text your tree. " +
    "Gateway-slack: bot token plus channel ID. The tree lives where teams already work. " +
    "Gateway-matrix: open protocol. Self-hosted. Your land, your server, your data. " +
    "Gateway-reddit: post notifications as Reddit threads. " +
    "Gateway-x: post to X (Twitter). Output generation, thread management, webhook input. " +
    "Gateway-tree: tree-to-tree channels across lands. Native cascade bridging. " +
    "\n\n" +
    "Operators install the bundle for the full registry, then enable individual " +
    "channels as needed. Each channel type extension also works standalone. " +
    "treeos ext install gateway-telegram works on its own if you only want one channel. " +
    "The bundle installs all of them for operators who want everything available. " +
    "\n\n" +
    "Install: treeos ext install treeos-connect",

  includes: [
    "gateway", "gateway-telegram", "gateway-discord", "gateway-webhook",
    "gateway-email", "gateway-sms", "gateway-slack", "gateway-matrix",
    "gateway-reddit", "gateway-x", "gateway-tree", "browser-bridge",
  ],

  needs: {
    extensions: [
      "gateway", "gateway-telegram", "gateway-discord", "gateway-webhook",
      "gateway-email", "gateway-sms", "gateway-slack", "gateway-matrix",
      "gateway-reddit", "gateway-x", "gateway-tree",
    ],
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
  },
};
