// Matrix sync poller.
// Long-polls the /sync endpoint to receive new messages.
// One poller per unique homeserver+token pair (like Discord's one bot per token).
// When a message arrives in a room that matches a gateway channel, processes it.

import log from "../../seed/log.js";
import { matrixApi, getMatrixCreds } from "./handler.js";

// Map<channelId, { roomId, creds, channelDoc }>
const activeChannels = new Map();

// Map<credKey, { nextBatch, abortController, running }>
const syncLoops = new Map();

function credKey(creds) {
  // One sync loop per homeserver+token combo
  return `${creds.homeserver}::${creds.accessToken.slice(-8)}`;
}

/**
 * Start tracking a channel for incoming messages.
 */
export function connectChannel(channelId, channel, secrets) {
  const creds = getMatrixCreds(secrets);
  const roomId = channel.config?.metadata?.roomId;
  if (!roomId) return;

  activeChannels.set(channelId, { roomId, creds, channelDoc: channel });

  const key = credKey(creds);
  if (!syncLoops.has(key)) {
    startSyncLoop(key, creds);
  }
}

/**
 * Stop tracking a channel.
 */
export function disconnectChannel(channelId) {
  activeChannels.delete(channelId);

  // If no more channels use this sync loop, stop it
  // (check if any remaining channel shares the same credKey)
  // For simplicity, leave the loop running. It's cheap when idle.
}

/**
 * Scan all enabled Matrix input channels and connect them.
 */
export async function startupScan() {
  try {
    const { getExtension } = await import("../loader.js");
    const GatewayChannel = getExtension("gateway")?.exports?.GatewayChannel;
    const channels = await GatewayChannel.find({
      type: "matrix",
      enabled: true,
      direction: { $in: ["input", "input-output"] },
    }).lean();

    if (channels.length === 0) return;

    const gateway = getExtension("gateway");
    if (!gateway?.exports?.getChannelWithSecrets) return;

    for (const ch of channels) {
      try {
        const full = await gateway.exports.getChannelWithSecrets(ch._id);
        if (!full) continue;
        connectChannel(ch._id.toString(), ch, full.config?.decryptedSecrets || {});
      } catch (err) {
        log.warn("GatewayMatrix", `Failed to connect channel ${ch._id}: ${err.message}`);
      }
    }

    log.verbose("GatewayMatrix", `Sync poller: ${activeChannels.size} channel(s) connected`);
  } catch (err) {
    log.error("GatewayMatrix", `Startup scan failed: ${err.message}`);
  }
}

export function stopAllSyncLoops() {
  for (const [key, loop] of syncLoops) {
    loop.running = false;
    if (loop.abortController) loop.abortController.abort();
  }
  syncLoops.clear();
  activeChannels.clear();
}

// ─────────────────────────────────────────────────────────────────────────
// SYNC LOOP
// ─────────────────────────────────────────────────────────────────────────

function startSyncLoop(key, creds) {
  const state = { nextBatch: null, abortController: null, running: true };
  syncLoops.set(key, state);

  (async () => {
    // Initial sync (get the since token without processing old messages)
    try {
      const initial = await matrixApi(creds, "GET",
        "/_matrix/client/v3/sync?timeout=0&filter=" + encodeURIComponent(JSON.stringify({
          room: { timeline: { limit: 0 } },
        })),
      );
      state.nextBatch = initial.next_batch;
    } catch (err) {
      log.error("GatewayMatrix", `Initial sync failed: ${err.message}`);
      syncLoops.delete(key);
      return;
    }

    log.verbose("GatewayMatrix", `Sync loop started for ${creds.homeserver}`);

    while (state.running) {
      try {
        state.abortController = new AbortController();
        const timeout = 30000; // 30s long poll

        const filter = JSON.stringify({
          room: {
            timeline: { limit: 10 },
            // Only care about message events
            types: ["m.room.message"],
          },
        });

        const url = `/_matrix/client/v3/sync?timeout=${timeout}&since=${state.nextBatch}&filter=${encodeURIComponent(filter)}`;

        const res = await fetch(`${creds.homeserver}${url}`, {
          headers: { "Authorization": `Bearer ${creds.accessToken}` },
          signal: state.abortController.signal,
        });

        if (!res.ok) {
          log.warn("GatewayMatrix", `Sync error ${res.status}, retrying in 10s`);
          await sleep(10000);
          continue;
        }

        const data = await res.json();
        state.nextBatch = data.next_batch;

        // Process room events
        const rooms = data.rooms?.join || {};
        for (const [roomId, roomData] of Object.entries(rooms)) {
          const events = roomData.timeline?.events || [];
          for (const event of events) {
            await handleMatrixEvent(roomId, event, creds);
          }
        }
      } catch (err) {
        if (err.name === "AbortError") break;
        log.warn("GatewayMatrix", `Sync error: ${err.message}. Retrying in 10s.`);
        await sleep(10000);
      }
    }

    syncLoops.delete(key);
    log.verbose("GatewayMatrix", `Sync loop stopped for ${creds.homeserver}`);
  })();
}

async function handleMatrixEvent(roomId, event, creds) {
  // Only process m.room.message with m.text msgtype
  if (event.type !== "m.room.message") return;
  if (event.content?.msgtype !== "m.text") return;

  // Ignore bot's own messages
  const botUserId = creds.botUserId || process.env.MATRIX_BOT_USER_ID;
  if (botUserId && event.sender === botUserId) return;

  const text = event.content.body?.trim();
  if (!text) return;

  // Find the channel(s) watching this room
  for (const [channelId, info] of activeChannels) {
    if (info.roomId !== roomId) continue;

    const senderName = event.sender?.split(":")[0]?.replace("@", "") || "unknown";
    const senderPlatformId = event.sender || "";

    log.verbose("GatewayMatrix",
      `Matrix message in ${roomId} from ${senderName}: "${text.slice(0, 80)}"`,
    );

    try {
      const { getExtension } = await import("../loader.js");
      const gateway = getExtension("gateway");
      if (!gateway?.exports?.processGatewayMessage) return;

      const result = await gateway.exports.processGatewayMessage(channelId, {
        senderName,
        senderPlatformId,
        messageText: text,
      });

      // Reply in the room if input-output
      const channel = info.channelDoc;
      if (result.reply && channel.direction === "input-output") {
        const txnId = `tree_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await matrixApi(creds, "PUT",
          `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
          { msgtype: "m.text", body: result.reply },
        );
      }
    } catch (err) {
      log.error("GatewayMatrix", `Error processing Matrix message in ${roomId}: ${err.message}`);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
