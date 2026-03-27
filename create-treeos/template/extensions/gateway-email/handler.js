// Email channel type handler.
// Registered with gateway core during init.
//
// Output: sends via SMTP (nodemailer). Works with any SMTP server.
//   Gmail, Outlook, SendGrid, Mailgun, Postmark, AWS SES, self-hosted.
//   Config: toEmail (required). SMTP credentials from env vars or per-channel override.
//
// Input: receives inbound email via webhook POST from email services.
//   SendGrid Inbound Parse, Mailgun Routes, Postmark Inbound, or raw JSON.
//   The webhook URL is: POST /api/v1/gateway/email/:channelId
//   Each service sends a different format. The route normalizes all of them.

import log from "../../seed/log.js";
import crypto from "crypto";

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateConfig(config, direction) {
  const hasOutput = direction === "output" || direction === "input-output";
  const hasInput = direction === "input" || direction === "input-output";

  if (hasOutput) {
    if (!config.toEmail || !EMAIL_RE.test(config.toEmail)) {
      throw new Error("Email output requires a valid toEmail address");
    }

    // SMTP config: either from env or per-channel override
    const smtpHost = config.smtpHost || process.env.SMTP_HOST;
    if (!smtpHost) {
      throw new Error("Email output requires SMTP_HOST in .env or smtpHost in channel config");
    }
  }

  if (hasInput) {
    // Input just needs a fromFilter (optional) to filter who can send
    // The webhook URL is generated automatically
    if (config.fromFilter && typeof config.fromFilter !== "string") {
      throw new Error("fromFilter must be a string (email address or domain)");
    }
  }
}

function buildEncryptedConfig(config, direction) {
  const hasOutput = direction === "output" || direction === "input-output";
  const hasInput = direction === "input" || direction === "input-output";

  const secrets = {};
  const metadata = {};

  if (hasOutput) {
    // Per-channel SMTP overrides (optional, falls back to env)
    if (config.smtpHost) secrets.smtpHost = config.smtpHost;
    if (config.smtpPort) secrets.smtpPort = config.smtpPort;
    if (config.smtpUser) secrets.smtpUser = config.smtpUser;
    if (config.smtpPass) secrets.smtpPass = config.smtpPass;
    if (config.fromEmail) secrets.fromEmail = config.fromEmail;

    metadata.toEmail = config.toEmail;
  }

  if (hasInput) {
    // Generate a webhook secret for verifying inbound posts
    metadata.webhookSecret = crypto.randomBytes(24).toString("hex");
    if (config.fromFilter) metadata.fromFilter = config.fromFilter;
  }

  return {
    secrets,
    metadata,
    displayIdentifier: config.toEmail || config.fromFilter || "email",
  };
}

// ─────────────────────────────────────────────────────────────────────────
// SENDER (SMTP via nodemailer)
// ─────────────────────────────────────────────────────────────────────────

let _nodemailer = null;

async function getNodemailer() {
  if (!_nodemailer) _nodemailer = await import("nodemailer");
  return _nodemailer;
}

async function send(secrets, metadata, notification) {
  const nodemailer = await getNodemailer();

  const host = secrets.smtpHost || process.env.SMTP_HOST;
  const port = Number(secrets.smtpPort || process.env.SMTP_PORT || 587);
  const user = secrets.smtpUser || process.env.SMTP_USER;
  const pass = secrets.smtpPass || process.env.SMTP_PASS;
  const from = secrets.fromEmail || process.env.SMTP_FROM || user;

  if (!host || !user || !pass) {
    throw new Error("SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS in .env or channel config.");
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });

  const subject = notification.title || "Tree notification";
  const text = notification.content || "";

  await transporter.sendMail({
    from,
    to: metadata.toEmail,
    subject,
    text,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// INPUT LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────

async function registerInput(channel, secrets) {
  // Webhook-based input. No persistent connection needed.
  // The webhook URL is: POST /api/v1/gateway/email/:channelId
  // User configures their email service (SendGrid, Mailgun, etc.) to POST here.
  const webhookSecret = channel.config?.metadata?.webhookSecret;
  log.info("GatewayEmail",
    `Email input registered for channel ${channel._id}. ` +
    `Webhook: POST /api/v1/gateway/email/${channel._id}` +
    (webhookSecret ? ` (secret: ${webhookSecret.slice(0, 8)}...)` : ""),
  );
}

async function unregisterInput(channel, secrets) {
  log.verbose("GatewayEmail", `Email input unregistered for channel ${channel._id}`);
}

// ─────────────────────────────────────────────────────────────────────────
// EXPORT HANDLER
// ─────────────────────────────────────────────────────────────────────────

export default {
  allowedDirections: ["input", "output", "input-output"],
  validateConfig,
  buildEncryptedConfig,
  send,
  registerInput,
  unregisterInput,
};
