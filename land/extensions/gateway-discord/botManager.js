// Manages persistent Discord bot connections for gateway input channels.
// One bot client per unique bot token. Multiple channels can share a bot.

import log from "../../seed/log.js";

var Client, GatewayIntentBits;
var discordLoaded = false;

async function loadDiscord() {
  if (discordLoaded) return;
  try {
    var discordjs = await import("discord.js");
    Client = discordjs.Client;
    GatewayIntentBits = discordjs.GatewayIntentBits;
    discordLoaded = true;
  } catch {
    throw new Error(
      "discord.js package not installed. Run: npm install discord.js",
    );
  }
}

// tokenHash -> { client, channelMap: Map<channelId, { discordChannelId, rootId }> }
const activeBots = new Map();

function hashToken(token) {
  // Use last 10 chars as key (enough to distinguish, avoids storing full token in memory map key)
  return token.slice(-10);
}

export async function connectBot(
  botToken,
  channelId,
  discordChannelId,
  rootId,
) {
  await loadDiscord();

  var key = hashToken(botToken);
  var entry = activeBots.get(key);

  if (entry) {
    // Bot already connected, just add this channel to its map
    entry.channelMap.set(channelId, { discordChannelId, rootId });
    log.debug("GatewayDiscord",
      `Bot manager: added channel ${channelId} to existing bot (${entry.channelMap.size} channels)`,
    );
    return;
  }

  // Create new bot client
  var client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  var channelMap = new Map();
  channelMap.set(channelId, { discordChannelId, rootId });

  // Message handler
  client.on("messageCreate", async (message) => {
    // Ignore only our own replies (prevents self-reply loops)
    if (message.author.id === client.user?.id) return;

    // Find which gateway channel(s) are listening on this Discord channel
    for (var [gwChannelId, config] of channelMap) {
      if (message.channel.id !== config.discordChannelId) continue;

      var senderName =
        message.author.displayName || message.author.username || "Unknown";
      var senderPlatformId = message.author.id;
      var messageText = message.content;

      if (!messageText || !messageText.trim()) continue;

      log.debug("GatewayDiscord",
        `Bot: message on gw channel ${gwChannelId} from ${senderName}: "${messageText.slice(0, 80)}"`,
      );

      try {
        // Process via gateway core
        var { getExtension } = await import("../loader.js");
        var gateway = getExtension("gateway");
        if (!gateway?.exports?.processGatewayMessage) {
          log.error("GatewayDiscord", "Gateway core not loaded");
          continue;
        }

        var result = await gateway.exports.processGatewayMessage(gwChannelId, {
          senderName,
          senderPlatformId,
          messageText,
        });

        // Send reply back to the same Discord channel if input-output
        if (result.reply) {
          var replyText = result.reply;
          if (replyText.length > 2000) {
            replyText = replyText.slice(0, 1997) + "...";
          }
          await message.channel.send(replyText);
        }
      } catch (err) {
        log.error("GatewayDiscord",
          `Bot: error processing message for channel ${gwChannelId}:`,
          err.message,
        );
      }
    }
  });

  client.on("error", (err) => {
    log.error("GatewayDiscord", "Bot client error:", err.message);
  });

  client.on("warn", (msg) => {
    log.warn("GatewayDiscord", "Bot warning:", msg);
  });

  // Login
  try {
    await client.login(botToken);
    log.verbose("GatewayDiscord",
      `Bot manager: bot connected as ${client.user?.tag}, ${channelMap.size} channel(s)`,
    );
  } catch (err) {
    log.error("GatewayDiscord", "Bot manager: login failed:", err.message);
    throw new Error("Discord bot login failed: " + err.message);
  }

  activeBots.set(key, { client, channelMap, botToken });
}

export async function disconnectBot(channelId) {
  for (var [key, entry] of activeBots) {
    if (entry.channelMap.has(channelId)) {
      entry.channelMap.delete(channelId);
      log.debug("GatewayDiscord",
        `Bot manager: removed channel ${channelId} (${entry.channelMap.size} remaining)`,
      );

      // If no more channels, destroy the bot client
      if (entry.channelMap.size === 0) {
        try {
          entry.client.destroy();
        } catch {}
        activeBots.delete(key);
        log.verbose("GatewayDiscord",
          "Bot manager: bot client destroyed (no channels left)",
        );
      }
      return;
    }
  }
}

export async function disconnectAllBots() {
  for (var [key, entry] of activeBots) {
    try {
      entry.client.destroy();
    } catch {}
  }
  activeBots.clear();
  log.verbose("GatewayDiscord", "Bot manager: all bots disconnected");
}

export function getActiveBotCount() {
  return activeBots.size;
}

/**
 * Scan DB for enabled Discord input channels and connect their bots.
 * Called on server startup.
 */
export async function startupScan() {
  try {
    var GatewayChannel = (await import("../gateway/model.js")).default;
    var { getChannelWithSecrets } = await import("../gateway/core.js");

    var channels = await GatewayChannel.find({
      type: "discord",
      direction: { $in: ["input", "input-output"] },
      enabled: true,
    }).lean();

    if (channels.length === 0) {
      log.debug("GatewayDiscord", "Bot manager: no Discord input channels to connect");
      return;
    }

    log.verbose("GatewayDiscord",
      `Bot manager: found ${channels.length} Discord input channel(s) to connect`,
    );

    for (var channel of channels) {
      try {
        var full = await getChannelWithSecrets(channel._id);
        if (!full?.config?.decryptedSecrets?.botToken) {
          log.error("GatewayDiscord",
            `Bot manager: no bot token for channel ${channel._id}`,
          );
          continue;
        }

        await connectBot(
          full.config.decryptedSecrets.botToken,
          channel._id,
          channel.config.metadata.discordChannelId,
          channel.rootId,
        );
      } catch (err) {
        log.error("GatewayDiscord",
          `Bot manager: failed to connect channel ${channel._id}:`,
          err.message,
        );
      }
    }
  } catch (err) {
    log.error("GatewayDiscord", "Bot manager: startup scan failed:", err.message);
  }
}
