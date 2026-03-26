// Matrix channel type handler.
// Uses the Matrix Client-Server API directly (no SDK, just fetch).
// Output: sends messages to a Matrix room via PUT /_matrix/client/v3/rooms/:roomId/send.
// Input: polls /sync for new messages (long-polling, same pattern as the Matrix spec recommends for bots).
// Config: homeserver, accessToken, botUserId, roomId. From env or per-channel.

import log from "../../seed/log.js";

function validateConfig(config, direction) {
  const homeserver = config.homeserver || process.env.MATRIX_HOMESERVER;
  const accessToken = config.accessToken || process.env.MATRIX_ACCESS_TOKEN;

  if (!homeserver) {
    throw new Error("Matrix requires a homeserver URL in config or MATRIX_HOMESERVER env var");
  }

  if (!accessToken) {
    throw new Error("Matrix requires an accessToken in config or MATRIX_ACCESS_TOKEN env var");
  }

  if (!config.roomId || typeof config.roomId !== "string") {
    throw new Error("Matrix requires a roomId (e.g., !roomid:yourdomain.com)");
  }
}

function buildEncryptedConfig(config, direction) {
  const secrets = {};
  const metadata = {};

  if (config.homeserver) secrets.homeserver = config.homeserver;
  if (config.accessToken) secrets.accessToken = config.accessToken;

  metadata.roomId = config.roomId;
  metadata.botUserId = config.botUserId || process.env.MATRIX_BOT_USER_ID || null;

  return {
    secrets,
    metadata,
    displayIdentifier: config.roomId,
  };
}

function getMatrixCreds(secrets) {
  return {
    homeserver: (secrets.homeserver || process.env.MATRIX_HOMESERVER || "").replace(/\/$/, ""),
    accessToken: secrets.accessToken || process.env.MATRIX_ACCESS_TOKEN,
    botUserId: process.env.MATRIX_BOT_USER_ID || null,
  };
}

async function matrixApi(creds, method, path, body) {
  const url = `${creds.homeserver}${path}`;
  const opts = {
    method,
    headers: {
      "Authorization": `Bearer ${creds.accessToken}`,
      "Content-Type": "application/json",
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`Matrix API ${method} ${path}: ${data.error || res.status}`);
  }
  return data;
}

async function send(secrets, metadata, notification) {
  const creds = getMatrixCreds(secrets);
  if (!creds.homeserver || !creds.accessToken) throw new Error("Matrix credentials not configured");
  if (!metadata.roomId) throw new Error("Matrix roomId not configured");

  const text = notification.title
    ? `**${notification.title}**\n\n${notification.content}`
    : notification.content;

  // Matrix event ID must be unique per request
  const txnId = `tree_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await matrixApi(creds, "PUT",
    `/_matrix/client/v3/rooms/${encodeURIComponent(metadata.roomId)}/send/m.room.message/${txnId}`,
    {
      msgtype: "m.text",
      body: text,
      // Markdown-formatted version
      format: "org.matrix.custom.html",
      formatted_body: text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>"),
    },
  );
}

async function registerInput(channel, secrets) {
  log.info("GatewayMatrix",
    `Matrix input registered for channel ${channel._id} in room ${channel.config?.metadata?.roomId}. ` +
    `Sync polling will start with the background job.`,
  );
}

async function unregisterInput(channel, secrets) {
  log.verbose("GatewayMatrix", `Matrix input unregistered for channel ${channel._id}`);
}

// Exported for syncJob.js
export { matrixApi, getMatrixCreds };

export default {
  allowedDirections: ["input", "output", "input-output"],
  validateConfig,
  buildEncryptedConfig,
  send,
  registerInput,
  unregisterInput,
};
