export default {
  name: "gateway-webhook",
  version: "1.0.0",
  description: "Web push (webhook) channel for gateway. Output only.",

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
