// Email inbound webhook receiver.
// No auth middleware. Email services call this directly.
//
// Normalizes payloads from:
//   - SendGrid Inbound Parse (multipart form: from, to, subject, text)
//   - Mailgun (form: sender, subject, body-plain)
//   - Postmark (JSON: { From, Subject, TextBody })
//   - AWS SES via SNS (JSON: { Message.mail.source, Message.content })
//   - Raw JSON (JSON: { from, subject, text })
//
// Webhook URL: POST /api/v1/gateway/email/:channelId
// Optional verification: ?secret=<webhookSecret> or X-Webhook-Secret header

import log from "../../seed/log.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";
import express from "express";

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────
// PAYLOAD NORMALIZER
// ─────────────────────────────────────────────────────────────────────────

/**
 * Extract { from, subject, text } from any supported email service payload.
 * Returns null if the payload is unrecognizable.
 */
function normalizeEmailPayload(body, contentType) {
  if (!body) return null;

  // Postmark JSON: { From, Subject, TextBody }
  if (body.From && body.TextBody !== undefined) {
    return {
      from: body.From,
      subject: body.Subject || "(no subject)",
      text: body.TextBody || body.HtmlBody || "",
    };
  }

  // SendGrid Inbound Parse (form data parsed by express): { from, subject, text }
  if (body.from && body.subject !== undefined && (body.text !== undefined || body.html !== undefined)) {
    return {
      from: body.from,
      subject: body.subject || "(no subject)",
      text: body.text || body.html || "",
    };
  }

  // Mailgun (form data): { sender, subject, body-plain }
  if (body.sender && (body["body-plain"] !== undefined || body["body-html"] !== undefined)) {
    return {
      from: body.sender,
      subject: body.subject || "(no subject)",
      text: body["body-plain"] || body["body-html"] || "",
    };
  }

  // AWS SES via SNS: { Type: "Notification", Message: JSON string }
  if (body.Type === "Notification" && body.Message) {
    try {
      const msg = typeof body.Message === "string" ? JSON.parse(body.Message) : body.Message;
      const mail = msg.mail || {};
      const content = msg.content || "";
      return {
        from: mail.source || mail.commonHeaders?.from?.[0] || "unknown",
        subject: mail.commonHeaders?.subject || "(no subject)",
        text: typeof content === "string" ? content : JSON.stringify(content),
      };
    } catch {
      return null;
    }
  }

  // AWS SES SNS subscription confirmation
  if (body.Type === "SubscriptionConfirmation" && body.SubscribeURL) {
    // Auto-confirm SNS subscription
    fetch(body.SubscribeURL).catch(() => {});
    return null; // Not a message, just confirmation
  }

  // Raw JSON: { from, subject, text } or { from, body }
  if (body.from && (body.text !== undefined || body.body !== undefined)) {
    return {
      from: body.from,
      subject: body.subject || "(no subject)",
      text: body.text || body.body || "",
    };
  }

  return null;
}

/**
 * Extract a clean sender name from an email From header.
 * "John Doe <john@example.com>" -> "John Doe"
 * "john@example.com" -> "john"
 */
function extractSenderName(from) {
  if (!from) return "Unknown";
  // "Name <email>" format
  const match = from.match(/^([^<]+)\s*</);
  if (match) return match[1].trim();
  // Plain email
  const atIdx = from.indexOf("@");
  if (atIdx > 0) return from.slice(0, atIdx);
  return from;
}

/**
 * Extract email address from a From header.
 * "John Doe <john@example.com>" -> "john@example.com"
 */
function extractEmail(from) {
  if (!from) return "";
  const match = from.match(/<([^>]+)>/);
  if (match) return match[1].toLowerCase();
  return from.toLowerCase().trim();
}

// ─────────────────────────────────────────────────────────────────────────
// WEBHOOK ENDPOINT
// ─────────────────────────────────────────────────────────────────────────

// Accept both JSON and form-encoded payloads (different services use different formats)
router.use("/gateway/email/:channelId", express.urlencoded({ extended: true, limit: "1mb" }));

router.post("/gateway/email/:channelId", async (req, res) => {
  // Respond 200 immediately (prevents retries from email services)
  sendOk(res, { ok: true });

  try {
    const channelId = req.params.channelId;

    // Load channel
    const GatewayChannel = (await import("../gateway/model.js")).default;
    const channel = await GatewayChannel.findById(channelId).lean();
    if (!channel || !channel.enabled) return;
    if (channel.type !== "email") return;

    const hasInput = channel.direction === "input" || channel.direction === "input-output";
    if (!hasInput) return;

    // Verify webhook secret (query param or header)
    const expectedSecret = channel.config?.metadata?.webhookSecret;
    if (expectedSecret) {
      const providedSecret =
        req.query?.secret ||
        req.headers["x-webhook-secret"] ||
        req.headers["x-email-webhook-secret"];
      if (providedSecret !== expectedSecret) {
        log.warn("GatewayEmail", `Webhook secret mismatch for channel ${channelId}`);
        return;
      }
    }

    // Normalize the payload
    const normalized = normalizeEmailPayload(req.body, req.headers["content-type"]);
    if (!normalized) {
      log.warn("GatewayEmail", `Unrecognized email payload for channel ${channelId}`);
      return;
    }

    // From filter: if configured, only accept emails from matching address/domain
    const fromFilter = channel.config?.metadata?.fromFilter;
    if (fromFilter) {
      const senderEmail = extractEmail(normalized.from);
      const filterLower = fromFilter.toLowerCase();
      // Match full email or domain
      if (senderEmail !== filterLower && !senderEmail.endsWith("@" + filterLower)) {
        log.verbose("GatewayEmail", `Filtered out email from ${senderEmail} (filter: ${fromFilter})`);
        return;
      }
    }

    const senderName = extractSenderName(normalized.from);
    const senderPlatformId = extractEmail(normalized.from);

    // Build the message text. Include subject as context.
    let messageText = normalized.text.trim();
    if (normalized.subject && normalized.subject !== "(no subject)") {
      messageText = `[${normalized.subject}] ${messageText}`;
    }

    if (!messageText) return;

    log.verbose("GatewayEmail",
      `Email on channel ${channelId} from ${senderName}: "${messageText.slice(0, 80)}"`,
    );

    // Process the message via gateway core
    const { getExtension } = await import("../loader.js");
    const gateway = getExtension("gateway");
    if (!gateway?.exports?.processGatewayMessage) {
      log.error("GatewayEmail", "Gateway core not loaded");
      return;
    }

    const result = await gateway.exports.processGatewayMessage(channelId, {
      senderName,
      senderPlatformId,
      messageText,
    });

    // Send reply via email if input-output and there's a reply
    if (result.reply && channel.direction === "input-output") {
      await sendEmailReply(channel, senderPlatformId, normalized.subject, result.reply);
    }
  } catch (err) {
    log.error("GatewayEmail",
      `Email webhook error for channel ${req.params.channelId}:`,
      err.message,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────
// REPLY SENDER
// ─────────────────────────────────────────────────────────────────────────

async function sendEmailReply(channel, toEmail, originalSubject, replyText) {
  try {
    const nodemailer = await import("nodemailer");

    // Decrypt channel secrets for SMTP config
    const { getExtension } = await import("../loader.js");
    const gateway = getExtension("gateway");
    const fullChannel = await gateway.exports.getChannelWithSecrets(channel._id);
    const secrets = fullChannel?.config?.decryptedSecrets || {};

    const host = secrets.smtpHost || process.env.SMTP_HOST;
    const port = Number(secrets.smtpPort || process.env.SMTP_PORT || 587);
    const user = secrets.smtpUser || process.env.SMTP_USER;
    const pass = secrets.smtpPass || process.env.SMTP_PASS;
    const from = secrets.fromEmail || process.env.SMTP_FROM || user;

    if (!host || !user || !pass) {
      log.warn("GatewayEmail", "Cannot send reply: SMTP not configured");
      return;
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

    const subject = originalSubject
      ? `Re: ${originalSubject.replace(/^Re:\s*/i, "")}`
      : "Re: your message";

    await transporter.sendMail({
      from,
      to: toEmail,
      subject,
      text: replyText,
    });

    log.verbose("GatewayEmail", `Reply sent to ${toEmail}`);
  } catch (err) {
    log.error("GatewayEmail", `Failed to send reply to ${toEmail}: ${err.message}`);
  }
}

export default router;
