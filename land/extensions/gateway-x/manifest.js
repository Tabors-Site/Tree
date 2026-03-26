export default {
  name: "gateway-x",
  version: "1.0.0",
  description:
    "X (Twitter) channel type for the gateway. Three modes: output-only post generation " +
    "(the tree becomes a content engine), input-output conversation (threaded replies on X), " +
    "and input-only listening (mentions, keywords, hashtags become cascade signals). " +
    "Every X channel binds to a TreeOS user for energy, permissions, and rate limiting.",

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
      { key: "X_API_KEY", required: false, secret: true, description: "X API Key (OAuth 1.0a consumer key)" },
      { key: "X_API_SECRET", required: false, secret: true, description: "X API Secret (OAuth 1.0a consumer secret)" },
      { key: "X_WEBHOOK_SECRET", required: false, secret: true, autoGenerate: true, description: "Shared secret for verifying X Account Activity API webhooks" },
    ],
    cli: [],
  },
};
