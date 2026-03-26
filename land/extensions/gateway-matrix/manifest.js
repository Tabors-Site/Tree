export default {
  name: "gateway-matrix",
  version: "1.0.0",
  description: "Matrix channel type for the gateway. Open protocol, self-hosted. Your land, your Matrix server, your tree, your data.",

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
