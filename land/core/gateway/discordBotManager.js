// core/discordBotManager.js
// Manages persistent Discord bot connections for gateway input channels.
// One bot client per unique bot token. Multiple channels can share a bot.

import { processGatewayMessage } from "./gatewayInput.js";
import { getChannelWithSecrets } from "./gateway.js";

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
    console.log(
      `Discord bot manager: added channel ${channelId} to existing bot (${entry.channelMap.size} channels)`,
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

      console.log(
        `Discord bot: message on gw channel ${gwChannelId} from ${senderName}: "${messageText.slice(0, 80)}"`,
      );

      try {
        var result = await processGatewayMessage(gwChannelId, {
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
        console.error(
          `Discord bot: error processing message for channel ${gwChannelId}:`,
          err.message,
        );
      }
    }
  });

  client.on("error", (err) => {
    console.error("Discord bot: client error:", err.message);
  });

  client.on("warn", (msg) => {
    console.warn("Discord bot: warning:", msg);
  });

  // Login
  try {
    await client.login(botToken);
    console.log(
      `Discord bot manager: bot connected as ${client.user?.tag}, ${channelMap.size} channel(s)`,
    );
  } catch (err) {
    console.error("Discord bot manager: login failed:", err.message);
    throw new Error("Discord bot login failed: " + err.message);
  }

  activeBots.set(key, { client, channelMap, botToken });
}

export async function disconnectBot(channelId) {
  for (var [key, entry] of activeBots) {
    if (entry.channelMap.has(channelId)) {
      entry.channelMap.delete(channelId);
      console.log(
        `Discord bot manager: removed channel ${channelId} (${entry.channelMap.size} remaining)`,
      );

      // If no more channels, destroy the bot client
      if (entry.channelMap.size === 0) {
        try {
          entry.client.destroy();
        } catch {}
        activeBots.delete(key);
        console.log(
          "Discord bot manager: bot client destroyed (no channels left)",
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
  console.log("Discord bot manager: all bots disconnected");
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
    var GatewayChannel = (await import("../../db/models/gatewayChannel.js"))
      .default;
    var channels = await GatewayChannel.find({
      type: "discord",
      direction: { $in: ["input", "input-output"] },
      enabled: true,
    }).lean();

    if (channels.length === 0) {
      console.log("Discord bot manager: no Discord input channels to connect");
      return;
    }

    console.log(
      `Discord bot manager: found ${channels.length} Discord input channel(s) to connect`,
    );

    for (var channel of channels) {
      try {
        var full = await getChannelWithSecrets(channel._id);
        if (!full?.config?.decryptedSecrets?.botToken) {
          console.error(
            `Discord bot manager: no bot token for channel ${channel._id}`,
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
        console.error(
          `Discord bot manager: failed to connect channel ${channel._id}:`,
          err.message,
        );
      }
    }
  } catch (err) {
    console.error("Discord bot manager: startup scan failed:", err.message);
  }
}
