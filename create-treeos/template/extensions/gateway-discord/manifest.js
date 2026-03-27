export default {
  name: "gateway-discord",
  version: "1.0.0",
  builtFor: "treeos-connect",
  description:
    "Registers the Discord channel type with the gateway core, enabling trees to send and " +
    "receive messages through Discord servers. Output channels post notifications to a " +
    "Discord channel via webhook URL. Input channels connect a persistent Discord bot that " +
    "listens for messages in a specific channel and routes them through the gateway's AI " +
    "pipeline. Input-output channels do both: the bot listens for messages, processes them " +
    "through the tree orchestrator, and replies directly in the Discord channel." +
    "\n\n" +
    "The bot manager maintains persistent Discord.js client connections, one per unique bot " +
    "token. Multiple gateway channels can share a single bot if they use the same token, " +
    "with each channel mapped to a different Discord channel ID. On server startup, the " +
    "manager scans the database for all enabled Discord input channels, decrypts their bot " +
    "tokens, and connects their bots automatically. When a channel is disabled or deleted, " +
    "the bot is removed from the channel map. When no channels remain on a bot, the client " +
    "is destroyed to free resources. Bot messages from the bot's own user ID are ignored to " +
    "prevent self-reply loops." +
    "\n\n" +
    "Output uses the Discord webhook API, which requires no bot and no persistent connection. " +
    "Messages are formatted with bold titles and truncated to Discord's 2000 character limit. " +
    "For input-output channels that also need to send outbound notifications, the handler " +
    "can use either a webhook URL or the bot API directly, falling through based on what is " +
    "configured. Input channels require Standard or Premium tier subscriptions, enforced by " +
    "the gateway core's tier check system. Config validation ensures webhook URLs point to " +
    "discord.com or discordapp.com domains, and input channels provide both a bot token and " +
    "a Discord channel ID.",

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
    env: [],
    cli: [],

    hooks: {
      fires: [],
      listens: [],
    },
  },
};
