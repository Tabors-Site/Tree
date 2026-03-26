// Reddit channel type handler.
//
// Reddit API uses OAuth2 with password grant (script apps) or refresh tokens.
// Rate limit: 100 requests per minute per OAuth client. 10 requests per minute
// for search. Poll interval of 90 seconds keeps us well under.
//
// Three modes:
// OUTPUT: Submit self-posts to a subreddit via /api/submit.
// INPUT-OUTPUT: Poll comment replies on the bot's posts, respond in threads.
// INPUT: Monitor subreddit/new or /search for keywords. Rain from the clouds.
//
// Auth: Reddit "script" app type (personal use) with username/password grant.
// Per-channel override possible for multi-account setups.

import log from "../../seed/log.js";

// ─────────────────────────────────────────────────────────────────────────
// REDDIT OAUTH2
// ─────────────────────────────────────────────────────────────────────────

// Token cache: one token per client_id (shared across channels with same creds)
const tokenCache = new Map(); // credKey -> { token, expiresAt }

function credKey(clientId, username) {
  return `${clientId}:${username}`;
}

async function getAccessToken(creds) {
  const key = credKey(creds.clientId, creds.username);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 60000) {
    return cached.token;
  }

  const auth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const params = new URLSearchParams();
  params.append("grant_type", "password");
  params.append("username", creds.username);
  params.append("password", creds.password);

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": `TreeOS-Gateway/1.0 (by /u/${creds.username})`,
    },
    body: params.toString(),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Reddit OAuth failed: ${data.error || res.status}`);
  }

  const token = data.access_token;
  const expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  tokenCache.set(key, { token, expiresAt });
  return token;
}

// ─────────────────────────────────────────────────────────────────────────
// REDDIT API CLIENT
// ─────────────────────────────────────────────────────────────────────────

function getCreds(secrets) {
  return {
    clientId: secrets.clientId || process.env.REDDIT_CLIENT_ID,
    clientSecret: secrets.clientSecret || process.env.REDDIT_CLIENT_SECRET,
    username: secrets.username || process.env.REDDIT_USERNAME,
    password: secrets.password || process.env.REDDIT_PASSWORD,
  };
}

async function redditApi(creds, method, path, body) {
  const token = await getAccessToken(creds);
  const url = `https://oauth.reddit.com${path}`;

  const opts = {
    method,
    headers: {
      "Authorization": `Bearer ${token}`,
      "User-Agent": `TreeOS-Gateway/1.0 (by /u/${creds.username})`,
      "Content-Type": "application/json",
    },
  };

  if (body && method === "POST") {
    // Reddit API uses form-encoded for most endpoints
    if (body instanceof URLSearchParams) {
      opts.headers["Content-Type"] = "application/x-www-form-urlencoded";
      opts.body = body.toString();
    } else {
      opts.body = JSON.stringify(body);
    }
  }

  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`Reddit API ${method} ${path}: ${data.message || data.error || res.status}`);
  }
  return data;
}

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────

function validateConfig(config, direction) {
  const hasOutput = direction === "output" || direction === "input-output";
  const hasInput = direction === "input" || direction === "input-output";

  const cid = config.clientId || process.env.REDDIT_CLIENT_ID;
  const cs = config.clientSecret || process.env.REDDIT_CLIENT_SECRET;
  const user = config.username || process.env.REDDIT_USERNAME;
  const pass = config.password || process.env.REDDIT_PASSWORD;

  if (!cid || !cs || !user || !pass) {
    throw new Error(
      "Reddit requires REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_USERNAME, REDDIT_PASSWORD " +
      "in .env or per-channel config"
    );
  }

  if (hasOutput) {
    if (!config.subreddit || typeof config.subreddit !== "string") {
      throw new Error("Reddit output requires a subreddit name (without r/ prefix)");
    }
  }

  if (hasInput && config.monitorFilter) {
    if (typeof config.monitorFilter !== "string" || config.monitorFilter.length > 500) {
      throw new Error("monitorFilter must be a string under 500 characters");
    }
  }

  if (hasInput && !config.subreddit && !config.monitorFilter) {
    throw new Error("Reddit input requires either a subreddit to monitor or a monitorFilter query");
  }
}

function buildEncryptedConfig(config, direction) {
  const secrets = {};
  const metadata = {};

  // Per-channel credential overrides
  if (config.clientId) secrets.clientId = config.clientId;
  if (config.clientSecret) secrets.clientSecret = config.clientSecret;
  if (config.username) secrets.username = config.username;
  if (config.password) secrets.password = config.password;

  if (config.subreddit) metadata.subreddit = config.subreddit.replace(/^r\//, "");
  if (config.monitorFilter) metadata.monitorFilter = config.monitorFilter;

  return {
    secrets,
    metadata,
    displayIdentifier: config.subreddit ? `r/${config.subreddit.replace(/^r\//, "")}` : config.monitorFilter || "reddit",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// SENDER (submit post or reply to comment)
// ─────────────────────────────────────────────────────────────────────────

async function send(secrets, metadata, notification) {
  const creds = getCreds(secrets);
  const subreddit = metadata.subreddit;
  if (!subreddit) throw new Error("No subreddit configured for output");

  const title = notification.title || "Tree update";
  const text = notification.content || "";

  // If this is a reply to a comment (set by input processing)
  if (notification._replyToCommentFullname) {
    const params = new URLSearchParams();
    params.append("api_type", "json");
    params.append("thing_id", notification._replyToCommentFullname);
    params.append("text", text.length > 10000 ? text.slice(0, 9997) + "..." : text);
    await redditApi(creds, "POST", "/api/comment", params);
    return;
  }

  // Submit a new self-post
  const params = new URLSearchParams();
  params.append("api_type", "json");
  params.append("kind", "self");
  params.append("sr", subreddit);
  params.append("title", title.length > 300 ? title.slice(0, 297) + "..." : title);
  params.append("text", text.length > 40000 ? text.slice(0, 39997) + "..." : text);

  const result = await redditApi(creds, "POST", "/api/submit", params);

  // Track the post ID for comment monitoring
  const postUrl = result?.json?.data?.url;
  const postName = result?.json?.data?.name; // fullname like t3_xxxxx
  if (postName) {
    log.verbose("GatewayReddit", `Posted to r/${subreddit}: ${postUrl || postName}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// INPUT LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────

async function registerInput(channel, secrets) {
  const sub = channel.config?.metadata?.subreddit;
  const filter = channel.config?.metadata?.monitorFilter;
  log.info("GatewayReddit",
    `Reddit input registered for channel ${channel._id}` +
    (sub ? ` monitoring r/${sub}` : "") +
    (filter ? ` searching "${filter}"` : "") +
    `. Poll job will check for new posts and comments.`,
  );
}

async function unregisterInput(channel, secrets) {
  log.verbose("GatewayReddit", `Reddit input unregistered for channel ${channel._id}`);
}

// Exported for pollJob.js
export { redditApi, getCreds };

export default {
  allowedDirections: ["input", "output", "input-output"],
  validateConfig,
  buildEncryptedConfig,
  send,
  registerInput,
  unregisterInput,
};
