export default {
  name: "gateway-sms",
  version: "1.0.1",
  builtFor: "treeos-connect",
  description:
    "SMS channel type for the gateway extension. Registers the sms channel type at boot, enabling " +
    "trees to send and receive text messages through Twilio. No Twilio SDK required. The handler " +
    "calls the Twilio REST API directly using basic auth, sending form-encoded POST requests to " +
    "the Messages endpoint. Outbound messages are composed from notification title and content, " +
    "trimmed to 1500 characters to stay within Twilio's segmentation limits.\n\n" +
    "Three directions are supported: input (receive SMS into a tree), output (send SMS from a " +
    "tree), and input-output (bidirectional conversation). For output channels, a toNumber in " +
    "E.164 format is required. Twilio credentials (account SID, auth token, from number) can " +
    "be set globally via environment variables or overridden per channel through encrypted config. " +
    "Per-channel secrets are stored using the gateway core's AES encryption, so one land can run " +
    "multiple Twilio accounts across different trees.\n\n" +
    "Inbound SMS arrives via a Twilio webhook at POST /api/v1/gateway/sms/:channelId. The endpoint " +
    "responds immediately with empty TwiML to prevent Twilio retries, then processes the message " +
    "asynchronously. Twilio sends form-encoded data including From, Body, and MessageSid. The " +
    "handler validates the channel exists and is enabled, extracts the sender phone number and " +
    "message text, then delegates to the gateway core's processGatewayMessage function which runs " +
    "the message through the tree's AI in the configured mode. For input-output channels, the AI " +
    "reply is sent back as an SMS to the sender's phone number. Trees in your pocket without an app.",

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
