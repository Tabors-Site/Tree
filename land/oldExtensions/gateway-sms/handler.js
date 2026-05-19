// SMS channel type handler (Twilio).
// Output: sends SMS via Twilio API.
// Input: receives inbound SMS via Twilio webhook.
// Config: toNumber (required for output). accountSid, authToken, fromNumber from env or per-channel.

import log from "../../seed/log.js";
import crypto from "crypto";

const PHONE_RE = /^\+[1-9]\d{6,14}$/;

function validateConfig(config, direction) {
  const hasOutput = direction === "output" || direction === "input-output";

  if (hasOutput) {
    if (!config.toNumber || !PHONE_RE.test(config.toNumber)) {
      throw new Error("SMS output requires a valid toNumber in E.164 format (e.g., +15551234567)");
    }
  }

  const sid = config.accountSid || process.env.TWILIO_ACCOUNT_SID;
  const token = config.authToken || process.env.TWILIO_AUTH_TOKEN;
  const from = config.fromNumber || process.env.TWILIO_FROM_NUMBER;

  if (!sid || !token || !from) {
    throw new Error("SMS requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER in .env or channel config");
  }
}

function buildEncryptedConfig(config, direction) {
  const secrets = {};
  const metadata = {};

  // Per-channel Twilio overrides (optional, falls back to env)
  if (config.accountSid) secrets.accountSid = config.accountSid;
  if (config.authToken) secrets.authToken = config.authToken;
  if (config.fromNumber) secrets.fromNumber = config.fromNumber;

  if (config.toNumber) metadata.toNumber = config.toNumber;

  // Webhook verification token for inbound
  const hasInput = direction === "input" || direction === "input-output";
  if (hasInput) {
    metadata.webhookSecret = crypto.randomBytes(24).toString("hex");
  }

  return {
    secrets,
    metadata,
    displayIdentifier: config.toNumber || config.fromNumber || "sms",
  };
}

function getTwilioCreds(secrets) {
  return {
    accountSid: secrets.accountSid || process.env.TWILIO_ACCOUNT_SID,
    authToken: secrets.authToken || process.env.TWILIO_AUTH_TOKEN,
    fromNumber: secrets.fromNumber || process.env.TWILIO_FROM_NUMBER,
  };
}

async function sendSms(creds, to, body) {
  // Twilio REST API. No SDK needed.
  const url = `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`;
  const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64");

  const params = new URLSearchParams();
  params.append("To", to);
  params.append("From", creds.fromNumber);
  params.append("Body", body);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio error ${res.status}: ${text}`);
  }
}

async function send(secrets, metadata, notification) {
  const creds = getTwilioCreds(secrets);
  const body = notification.title
    ? `${notification.title}\n\n${notification.content}`
    : notification.content;

  // SMS max 1600 chars (Twilio auto-segments, but keep it reasonable)
  const trimmed = body.length > 1500 ? body.slice(0, 1497) + "..." : body;
  await sendSms(creds, metadata.toNumber, trimmed);
}

async function registerInput(channel, secrets) {
  log.info("GatewaySMS",
    `SMS input registered for channel ${channel._id}. ` +
    `Webhook: POST /api/v1/gateway/sms/${channel._id}`,
  );
}

async function unregisterInput(channel, secrets) {
  log.verbose("GatewaySMS", `SMS input unregistered for channel ${channel._id}`);
}

// Exported for routes.js reply sending
export { sendSms, getTwilioCreds };

export default {
  allowedDirections: ["input", "output", "input-output"],
  validateConfig,
  buildEncryptedConfig,
  send,
  registerInput,
  unregisterInput,
};
