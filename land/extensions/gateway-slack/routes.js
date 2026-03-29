// Slack Events API webhook receiver.
// Handles: url_verification challenge, event_callback for messages.
// Verifies request signature using SLACK_SIGNING_SECRET.
// Webhook URL: POST /api/v1/gateway/slack/:channelId

import log from "../../seed/log.js";
import { sendOk } from "../../seed/protocol.js";
import express from "express";
import crypto from "crypto";

const router = express.Router();

// Slack sends JSON with signature verification via headers
router.post("/gateway/slack/:channelId", express.json({ limit: "256kb" }), async (req, res) => {
  const body = req.body;

  // Slack URL verification challenge (sent once during setup)
  if (body.type === "url_verification") {
    return res.json({ challenge: body.challenge });
  }

  // Respond 200 immediately (Slack retries on 3s timeout)
  sendOk(res, { ok: true });

  // Only process event_callback
  if (body.type !== "event_callback" || !body.event) return;

  try {
    const channelId = req.params.channelId;
    const event = body.event;

    // Only handle message events (not subtypes like bot_message, message_changed)
    if (event.type !== "message" || event.subtype) return;
    if (event.bot_id) return; // Ignore bot messages (prevents loops)
    if (!event.text) return;

    // Verify signing secret if configured
    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (signingSecret) {
      const timestamp = req.headers["x-slack-request-timestamp"];
      const slackSig = req.headers["x-slack-signature"];

      // Prevent replay attacks (5 min window)
      if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
        log.warn("GatewaySlack", `Request too old for channel ${channelId}`);
        return;
      }

      const rawBody = JSON.stringify(body);
      const baseString = `v0:${timestamp}:${rawBody}`;
      const computed = "v0=" + crypto
        .createHmac("sha256", signingSecret)
        .update(baseString, "utf8")
        .digest("hex");

      if (!crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(slackSig || ""))) {
        log.warn("GatewaySlack", `Signature mismatch for channel ${channelId}`);
        return;
      }
    }

    // Load channel
    const { getExtension } = await import("../loader.js");
    const GatewayChannel = getExtension("gateway")?.exports?.GatewayChannel;
    const channel = await GatewayChannel.findById(channelId).lean();
    if (!channel || !channel.enabled) return;
    if (channel.type !== "slack") return;

    const hasInput = channel.direction === "input" || channel.direction === "input-output";
    if (!hasInput) return;

    // Verify the event is from the configured Slack channel
    const expectedChannel = channel.config?.metadata?.slackChannelId;
    if (expectedChannel && event.channel !== expectedChannel) return;

    const senderName = event.user || "unknown";
    const senderPlatformId = event.user || "";
    const messageText = event.text.trim();

    if (!messageText) return;

    log.verbose("GatewaySlack",
      `Slack message on channel ${channelId} from ${senderName}: "${messageText.slice(0, 80)}"`,
    );

    // Process via gateway core
    const { getExtension } = await import("../loader.js");
    const gateway = getExtension("gateway");
    if (!gateway?.exports?.processGatewayMessage) {
      log.error("GatewaySlack", "Gateway core not loaded");
      return;
    }

    const result = await gateway.exports.processGatewayMessage(channelId, {
      senderName,
      senderPlatformId,
      messageText,
    });

    // Reply in the Slack channel if input-output
    if (result.reply && channel.direction === "input-output") {
      try {
        const { slackApi, getToken } = await import("./handler.js");
        const fullChannel = await gateway.exports.getChannelWithSecrets(channel._id);
        const secrets = fullChannel?.config?.decryptedSecrets || {};
        const token = getToken(secrets);
        if (!token) throw new Error("No Slack bot token available for reply");

        await slackApi("chat.postMessage", token, {
          channel: event.channel,
          text: result.reply,
          thread_ts: event.ts,
          unfurl_links: false,
          unfurl_media: false,
        });
      } catch (replyErr) {
        log.warn("GatewaySlack", `Reply failed on channel ${channelId}: ${replyErr.message}`);
      }
    }
  } catch (err) {
    log.error("GatewaySlack",
      `Slack webhook error for channel ${req.params.channelId}:`,
      err.message,
    );
  }
});

export default router;
