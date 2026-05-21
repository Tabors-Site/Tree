// X (Twitter) channel type handler.
//
// Three modes, one handler:
//
// OUTPUT: Post generation. The tree writes, the extension publishes.
//   Cascade signals compress into post-length insights. The tree's
//   transpiration: structured output evaporating into the cloud layer.
//
// INPUT-OUTPUT: Conversation. Someone replies on X. The webhook catches it.
//   processGatewayMessage fires. The AI responds. Posted as a threaded reply.
//   The tree is having a public conversation. History lives as notes.
//
// INPUT: Listening. Mentions, keywords, hashtags. Every matching post
//   becomes rain falling on the land. Cascade signals from the clouds.
//
// Identity binding: every X channel maps an X account to a TreeOS user.
// The user's energy budget covers API calls. The user's permissions
// determine which trees the X account can interact with. Without this
// binding, unauthenticated replies trigger AI with no rate limiting.
// The gateway core handles this. We just map X account ID in config.
//
// X API v2 with OAuth 1.0a User Context (per-user tokens).
// Rate limits: 1500 posts/month (free), 3000 (basic), 300K (pro).

import log from "../../seed/log.js";
import crypto from "crypto";

// ─────────────────────────────────────────────────────────────────────────
// OAUTH 1.0a SIGNING
// ─────────────────────────────────────────────────────────────────────────

function percentEncode(str) {
  return encodeURIComponent(str)
    .replace(/!/g, "%21")
    .replace(/\*/g, "%2A")
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
}

function generateOAuthHeader(method, url, params, consumerKey, consumerSecret, accessToken, tokenSecret) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  // Combine oauth params and request params, sort, encode
  const allParams = { ...oauthParams, ...params };
  const paramString = Object.keys(allParams)
    .sort()
    .map(k => `${percentEncode(k)}=${percentEncode(allParams[k])}`)
    .join("&");

  const baseString = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  const signature = crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");

  oauthParams.oauth_signature = signature;

  const header = "OAuth " + Object.keys(oauthParams)
    .sort()
    .map(k => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
    .join(", ");

  return header;
}

// ─────────────────────────────────────────────────────────────────────────
// X API CLIENT
// ─────────────────────────────────────────────────────────────────────────

function getCreds(secrets) {
  return {
    apiKey: secrets.apiKey || process.env.X_API_KEY,
    apiSecret: secrets.apiSecret || process.env.X_API_SECRET,
    accessToken: secrets.accessToken,
    tokenSecret: secrets.tokenSecret,
  };
}

async function xApi(creds, method, path, body) {
  const url = `https://api.x.com${path}`;

  const authHeader = generateOAuthHeader(
    method, url, {},
    creds.apiKey, creds.apiSecret,
    creds.accessToken, creds.tokenSecret,
  );

  const opts = {
    method,
    headers: {
      "Authorization": authHeader,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const detail = data.detail || data.errors?.[0]?.message || data.title || `${res.status}`;
    throw new Error(`X API ${method} ${path}: ${detail}`);
  }
  return data;
}

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────

function validateConfig(config, direction) {
  // Per-user OAuth tokens are always required (X API v2 user context)
  if (!config.accessToken || typeof config.accessToken !== "string") {
    throw new Error("X channel requires an accessToken (OAuth 1.0a user access token)");
  }
  if (!config.tokenSecret || typeof config.tokenSecret !== "string") {
    throw new Error("X channel requires a tokenSecret (OAuth 1.0a user token secret)");
  }

  const apiKey = config.apiKey || process.env.X_API_KEY;
  const apiSecret = config.apiSecret || process.env.X_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error("X channel requires X_API_KEY and X_API_SECRET in .env or channel config");
  }

  // Input-only listening can optionally filter by keywords/hashtags
  if (direction === "input" && config.listenFilter) {
    if (typeof config.listenFilter !== "string" || config.listenFilter.length > 500) {
      throw new Error("listenFilter must be a string under 500 characters");
    }
  }
}

function buildEncryptedConfig(config, direction) {
  const secrets = {
    accessToken: config.accessToken,
    tokenSecret: config.tokenSecret,
  };
  if (config.apiKey) secrets.apiKey = config.apiKey;
  if (config.apiSecret) secrets.apiSecret = config.apiSecret;

  const metadata = {
    xUserId: config.xUserId || null,
    xUsername: config.xUsername || null,
  };

  // Input listening filter (keywords, hashtags, mentions)
  if (config.listenFilter) {
    metadata.listenFilter = config.listenFilter;
  }

  return {
    secrets,
    metadata,
    displayIdentifier: config.xUsername ? `@${config.xUsername}` : config.xUserId || "x",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// SENDER (post / reply)
// ─────────────────────────────────────────────────────────────────────────

async function send(secrets, metadata, notification) {
  const creds = getCreds(secrets);
  if (!creds.accessToken || !creds.tokenSecret) throw new Error("X OAuth credentials not configured");
  if (!creds.apiKey || !creds.apiSecret) throw new Error("X API key not configured");

  // Format as a post. 280 char limit for the main body.
  let text = notification.content || "";
  if (notification.title && text.length + notification.title.length + 3 < 280) {
    text = `${notification.title}\n\n${text}`;
  }
  if (text.length > 280) text = text.slice(0, 277) + "...";

  const body = { text };

  // If this notification has a reply context (set by input processing), thread it
  if (notification._replyToTweetId) {
    body.reply = { in_reply_to_tweet_id: notification._replyToTweetId };
  }

  const result = await xApi(creds, "POST", "/2/tweets", body);
  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// INPUT LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────

async function registerInput(channel, secrets) {
  // Input uses polling (see pollJob.js). The Account Activity API
  // requires an enterprise tier. Polling /2/users/:id/mentions is
  // available on basic tier. The poll job handles this.
  const username = channel.config?.metadata?.xUsername || channel.config?.metadata?.xUserId;
  log.info("GatewayX",
    `X input registered for channel ${channel._id} (@${username}). ` +
    `Poll job will check for new mentions and replies.`,
  );
}

async function unregisterInput(channel, secrets) {
  log.verbose("GatewayX", `X input unregistered for channel ${channel._id}`);
}

// Exported for pollJob.js
export { xApi, getCreds };

export default {
  allowedDirections: ["input", "output", "input-output"],
  validateConfig,
  buildEncryptedConfig,
  send,
  registerInput,
  unregisterInput,
};
