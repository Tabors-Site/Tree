export default {
  name: "gateway-sms",
  version: "1.0.0",
  description: "SMS channel type for the gateway. Twilio-based sending and receiving. Trees in your pocket without an app.",

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
      { key: "TWILIO_ACCOUNT_SID", required: false, description: "Twilio Account SID" },
      { key: "TWILIO_AUTH_TOKEN", required: false, secret: true, description: "Twilio Auth Token" },
      { key: "TWILIO_FROM_NUMBER", required: false, description: "Twilio phone number to send from (e.g., +15551234567)" },
    ],
    cli: [],
  },
};
