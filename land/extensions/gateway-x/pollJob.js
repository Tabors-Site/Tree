// X mention and reply poller.
//
// The Account Activity API (webhooks) requires enterprise tier.
// Polling is available on all tiers. We poll:
//   - /2/users/:id/mentions (input and input-output channels)
//   - /2/tweets/search/recent with query (input-only listening channels)
//
// One poll loop per unique X user. Checks every 60 seconds.
// Stores the latest seen tweet ID per channel to avoid reprocessing.
//
// Rate limits: 10 requests/15min for mentions, 60/15min for search.
// Poll interval of 60s stays well within limits.

import log from "../../seed/log.js";
import { xApi, getCreds } from "./handler.js";

// Map<channelId, { xUserId, creds, channelDoc, sinceId }>
const activeChannels = new Map();

let pollTimer = null;
const POLL_INTERVAL_MS = 60000; // 60 seconds

/**
 * Connect a channel for polling.
 */
export function connectChannel(channelId, channel, secrets) {
  const creds = getCreds(secrets);
  const xUserId = channel.config?.metadata?.xUserId;
  const listenFilter = channel.config?.metadata?.listenFilter;

  if (!xUserId && !listenFilter) {
    log.warn("GatewayX", `Channel ${channelId} has no xUserId or listenFilter, skipping`);
    return;
  }

  activeChannels.set(channelId, {
    xUserId,
    listenFilter,
    creds,
    channelDoc: channel,
    sinceId: null,
  });
}

export function disconnectChannel(channelId) {
  activeChannels.delete(channelId);
}

/**
 * Scan all enabled X input channels and connect them.
 */
export async function startupScan() {
  try {
    const { getExtension } = await import("../loader.js");
    const GatewayChannel = getExtension("gateway")?.exports?.GatewayChannel;
    const channels = await GatewayChannel.find({
      type: "x",
      enabled: true,
      direction: { $in: ["input", "input-output"] },
    }).lean();

    if (channels.length === 0) return;

    const { getExtension } = await import("../loader.js");
    const gateway = getExtension("gateway");
    if (!gateway?.exports?.getChannelWithSecrets) return;

    for (const ch of channels) {
      try {
        const full = await gateway.exports.getChannelWithSecrets(ch._id);
        if (!full) continue;
        connectChannel(ch._id.toString(), ch, full.config?.decryptedSecrets || {});
      } catch (err) {
        log.warn("GatewayX", `Failed to connect channel ${ch._id}: ${err.message}`);
      }
    }

    if (activeChannels.size > 0) {
      startPolling();
      log.verbose("GatewayX", `Poll job: ${activeChannels.size} channel(s) connected`);
    }
  } catch (err) {
    log.error("GatewayX", `Startup scan failed: ${err.message}`);
  }
}

export function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  activeChannels.clear();
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollAll, POLL_INTERVAL_MS);
  if (pollTimer.unref) pollTimer.unref();
  // First poll immediately
  pollAll();
}

// ─────────────────────────────────────────────────────────────────────────
// POLL LOOP
// ─────────────────────────────────────────────────────────────────────────

async function pollAll() {
  for (const [channelId, info] of activeChannels) {
    try {
      if (info.listenFilter && !info.xUserId) {
        // Input-only listening: search recent tweets
        await pollSearch(channelId, info);
      } else if (info.xUserId) {
        // Mentions (input or input-output)
        await pollMentions(channelId, info);
      }
    } catch (err) {
      log.debug("GatewayX", `Poll error for channel ${channelId}: ${err.message}`);
    }
  }
}

/**
 * Poll /2/users/:id/mentions for new mentions and replies.
 */
async function pollMentions(channelId, info) {
  let path = `/2/users/${info.xUserId}/mentions?max_results=10&tweet.fields=author_id,conversation_id,in_reply_to_user_id,text,created_at`;
  if (info.sinceId) path += `&since_id=${info.sinceId}`;

  const data = await xApi(info.creds, "GET", path);
  const tweets = data.data;
  if (!tweets || tweets.length === 0) return;

  // Update since_id to newest
  info.sinceId = tweets[0].id;

  // On first poll, just set the watermark. Don't process old mentions.
  if (!info.sinceId && tweets.length > 0) {
    info.sinceId = tweets[0].id;
    return;
  }

  for (const tweet of tweets.reverse()) { // oldest first
    await processTweet(channelId, info, tweet);
  }
}

/**
 * Poll /2/tweets/search/recent for keyword/hashtag listening.
 */
async function pollSearch(channelId, info) {
  const query = info.listenFilter;
  if (!query) return;

  let path = `/2/tweets/search/recent?query=${encodeURIComponent(query)}&max_results=10&tweet.fields=author_id,text,created_at`;
  if (info.sinceId) path += `&since_id=${info.sinceId}`;

  const data = await xApi(info.creds, "GET", path);
  const tweets = data.data;
  if (!tweets || tweets.length === 0) return;

  // Update watermark
  info.sinceId = tweets[0].id;

  for (const tweet of tweets.reverse()) {
    await processTweet(channelId, info, tweet);
  }
}

/**
 * Process a single tweet: send it through processGatewayMessage.
 */
async function processTweet(channelId, info, tweet) {
  const senderName = tweet.author_id || "unknown";
  const senderPlatformId = tweet.author_id || "";
  const messageText = tweet.text?.trim();
  if (!messageText) return;

  log.verbose("GatewayX",
    `Tweet on channel ${channelId} from ${senderName}: "${messageText.slice(0, 80)}"`,
  );

  try {
    const { getExtension } = await import("../loader.js");
    const gateway = getExtension("gateway");
    if (!gateway?.exports?.processGatewayMessage) return;

    const result = await gateway.exports.processGatewayMessage(channelId, {
      senderName,
      senderPlatformId,
      messageText,
    });

    // Reply as a threaded tweet if input-output
    const channel = info.channelDoc;
    if (result.reply && channel.direction === "input-output") {
      let replyText = result.reply;
      if (replyText.length > 280) replyText = replyText.slice(0, 277) + "...";

      await xApi(info.creds, "POST", "/2/tweets", {
        text: replyText,
        reply: { in_reply_to_tweet_id: tweet.id },
      });
    }
  } catch (err) {
    log.error("GatewayX", `Error processing tweet on channel ${channelId}: ${err.message}`);
  }
}
