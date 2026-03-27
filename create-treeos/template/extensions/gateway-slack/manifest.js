export default {
  name: "gateway-slack",
  version: "1.0.0",
  builtFor: "treeos-connect",
  description:
    "Registers the Slack channel type with the gateway core, enabling trees to send and " +
    "receive messages in Slack workspaces. Output channels post notifications to a Slack " +
    "channel using the chat.postMessage API with a Bot User OAuth Token (xoxb-). Messages " +
    "are formatted with Slack's bold markdown (*title*) and link/media unfurling is " +
    "disabled for clean notification display." +
    "\n\n" +
    "Input channels receive messages via Slack's Events API. The extension exposes a " +
    "webhook endpoint at POST /api/v1/gateway/slack/:channelId that handles both the " +
    "one-time url_verification challenge (sent during Slack app setup) and ongoing " +
    "event_callback payloads. Request authenticity is verified using HMAC-SHA256 signature " +
    "validation against the SLACK_SIGNING_SECRET, with a 5-minute replay attack window. " +
    "Only plain message events are processed: bot messages, subtypes (edits, deletions), " +
    "and messages from other bots are ignored to prevent loops." +
    "\n\n" +
    "Input-output channels close the loop. When a Slack message is processed through the " +
    "tree orchestrator and produces a reply, the bot posts the response back as a threaded " +
    "reply (using thread_ts) in the same Slack channel. This means the tree's responses " +
    "appear as thread replies to the original message, keeping the main channel clean. " +
    "Team members interact with the tree by posting in the configured Slack channel. They " +
    "do not need to install TreeOS or create accounts. The bot token and Slack channel ID " +
    "can be configured globally via environment variables or per channel. The Slack app " +
    "needs the channels:history (or groups:history for private channels) and chat:write " +
    "OAuth scopes, plus the message.channels (or message.groups) event subscription.",

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
