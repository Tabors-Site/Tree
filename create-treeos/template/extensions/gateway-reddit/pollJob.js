// Reddit poll job.
//
// Polls two endpoints depending on channel config:
//
// 1. /r/{subreddit}/comments (input-output): monitors comments on posts
//    in the subreddit. When the bot is the post author, incoming comments
//    are gateway messages. The AI responds as a threaded comment.
//
// 2. /search?q={query} (input-only listening): monitors keyword/topic
//    matches across Reddit. Each matching post becomes a gateway message.
//    Rain from the cloud layer.
//
// 3. /r/{subreddit}/new (input): monitors new posts in a subreddit.
//    Each new post text becomes a gateway message.
//
// Rate limit: 100 req/min for authenticated, 10/min for search.
// Poll interval: 90 seconds. Well within limits.

import log from "../../seed/log.js";
import { redditApi, getCreds } from "./handler.js";

// Map<channelId, { creds, channelDoc, sinceTimestamp, trackedPosts }>
const activeChannels = new Map();

let pollTimer = null;
const POLL_INTERVAL_MS = 90000; // 90 seconds (Reddit is stricter than X)

export function connectChannel(channelId, channel, secrets) {
  const creds = getCreds(secrets);
  const subreddit = channel.config?.metadata?.subreddit;
  const monitorFilter = channel.config?.metadata?.monitorFilter;

  if (!subreddit && !monitorFilter) {
    log.warn("GatewayReddit", `Channel ${channelId} has no subreddit or monitorFilter, skipping`);
    return;
  }

  activeChannels.set(channelId, {
    creds,
    channelDoc: channel,
    subreddit,
    monitorFilter,
    sinceTimestamp: Math.floor(Date.now() / 1000),
    trackedPosts: new Set(), // fullnames of posts we authored (for comment tracking)
  });
}

export function disconnectChannel(channelId) {
  activeChannels.delete(channelId);
}

export async function startupScan() {
  try {
    const { getExtension } = await import("../loader.js");
    const GatewayChannel = getExtension("gateway")?.exports?.GatewayChannel;
    const channels = await GatewayChannel.find({
      type: "reddit",
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
        log.warn("GatewayReddit", `Failed to connect channel ${ch._id}: ${err.message}`);
      }
    }

    if (activeChannels.size > 0) {
      startPolling();
      log.verbose("GatewayReddit", `Poll job: ${activeChannels.size} channel(s) connected`);
    }
  } catch (err) {
    log.error("GatewayReddit", `Startup scan failed: ${err.message}`);
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
  pollAll();
}

// ─────────────────────────────────────────────────────────────────────────
// POLL LOOP
// ─────────────────────────────────────────────────────────────────────────

async function pollAll() {
  for (const [channelId, info] of activeChannels) {
    try {
      const direction = info.channelDoc.direction;

      if (direction === "input-output" && info.subreddit) {
        // Monitor comments on our posts in the subreddit
        await pollComments(channelId, info);
      } else if (info.monitorFilter) {
        // Search-based listening
        await pollSearch(channelId, info);
      } else if (info.subreddit) {
        // Monitor new posts in subreddit
        await pollNewPosts(channelId, info);
      }
    } catch (err) {
      log.debug("GatewayReddit", `Poll error for channel ${channelId}: ${err.message}`);
    }
  }
}

/**
 * Poll comments on the bot's recent posts in the subreddit.
 * Checks /r/{sub}/comments for new comments, filters to ones
 * on posts authored by the bot account.
 */
async function pollComments(channelId, info) {
  const path = `/r/${info.subreddit}/comments?limit=25&raw_json=1`;
  const data = await redditApi(info.creds, "GET", path);

  const comments = data?.data?.children || [];
  if (comments.length === 0) return;

  const botUsername = info.creds.username.toLowerCase();

  for (const item of comments) {
    const comment = item.data;
    if (!comment || item.kind !== "t1") continue;

    // Skip our own comments
    if (comment.author?.toLowerCase() === botUsername) continue;

    // Only process comments newer than our watermark
    if (comment.created_utc <= info.sinceTimestamp) continue;

    // Process all comments in the subreddit (not just on our posts).
    // The gateway core handles the rest.
    await processRedditItem(channelId, info, {
      author: comment.author,
      text: comment.body,
      fullname: comment.name, // t1_xxxxx
      created: comment.created_utc,
      isComment: true,
    });
  }

  // Update watermark to newest
  if (comments.length > 0 && comments[0].data?.created_utc) {
    info.sinceTimestamp = comments[0].data.created_utc;
  }
}

/**
 * Poll /search for keyword/topic monitoring.
 */
async function pollSearch(channelId, info) {
  const query = encodeURIComponent(info.monitorFilter);
  const path = `/search?q=${query}&sort=new&limit=10&type=link&raw_json=1&restrict_sr=false`;
  const data = await redditApi(info.creds, "GET", path);

  const posts = data?.data?.children || [];
  for (const item of posts) {
    const post = item.data;
    if (!post || item.kind !== "t3") continue;
    if (post.created_utc <= info.sinceTimestamp) continue;

    await processRedditItem(channelId, info, {
      author: post.author,
      text: post.selftext ? `[${post.title}] ${post.selftext}` : post.title,
      fullname: post.name,
      created: post.created_utc,
      isComment: false,
      subreddit: post.subreddit,
    });
  }

  if (posts.length > 0 && posts[0].data?.created_utc) {
    info.sinceTimestamp = posts[0].data.created_utc;
  }
}

/**
 * Poll /r/{sub}/new for new posts.
 */
async function pollNewPosts(channelId, info) {
  const path = `/r/${info.subreddit}/new?limit=10&raw_json=1`;
  const data = await redditApi(info.creds, "GET", path);

  const posts = data?.data?.children || [];
  const botUsername = info.creds.username.toLowerCase();

  for (const item of posts) {
    const post = item.data;
    if (!post || item.kind !== "t3") continue;
    if (post.created_utc <= info.sinceTimestamp) continue;
    if (post.author?.toLowerCase() === botUsername) continue; // skip our own

    await processRedditItem(channelId, info, {
      author: post.author,
      text: post.selftext ? `[${post.title}] ${post.selftext}` : post.title,
      fullname: post.name,
      created: post.created_utc,
      isComment: false,
    });
  }

  if (posts.length > 0 && posts[0].data?.created_utc) {
    info.sinceTimestamp = posts[0].data.created_utc;
  }
}

/**
 * Process a single Reddit post or comment through the gateway.
 */
async function processRedditItem(channelId, info, item) {
  const messageText = item.text?.trim();
  if (!messageText) return;

  log.verbose("GatewayReddit",
    `Reddit ${item.isComment ? "comment" : "post"} on channel ${channelId} from u/${item.author}: "${messageText.slice(0, 80)}"`,
  );

  try {
    const { getExtension } = await import("../loader.js");
    const gateway = getExtension("gateway");
    if (!gateway?.exports?.processGatewayMessage) return;

    const result = await gateway.exports.processGatewayMessage(channelId, {
      senderName: item.author,
      senderPlatformId: item.author,
      messageText,
    });

    // Reply as a comment if input-output and there's a reply
    const channel = info.channelDoc;
    if (result.reply && channel.direction === "input-output" && item.fullname) {
      let replyText = result.reply;
      if (replyText.length > 10000) replyText = replyText.slice(0, 9997) + "...";

      const params = new URLSearchParams();
      params.append("api_type", "json");
      params.append("thing_id", item.fullname);
      params.append("text", replyText);

      await redditApi(info.creds, "POST", "/api/comment", params);
      log.verbose("GatewayReddit", `Replied to ${item.fullname} on channel ${channelId}`);
    }
  } catch (err) {
    log.error("GatewayReddit", `Error processing Reddit item on channel ${channelId}: ${err.message}`);
  }
}
