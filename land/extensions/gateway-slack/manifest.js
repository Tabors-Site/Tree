export default {
  name: "gateway-slack",
  version: "1.0.0",
  description: "Slack channel type for the gateway. Bot token plus channel ID. The tree lives in a Slack channel. Team members interact without installing anything.",

  needs: {
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
      { key: "SLACK_BOT_TOKEN", required: false, secret: true, description: "Slack Bot User OAuth Token (xoxb-...)" },
      { key: "SLACK_SIGNING_SECRET", required: false, secret: true, description: "Slack app signing secret for webhook verification" },
    ],
    cli: [],
  },
};
