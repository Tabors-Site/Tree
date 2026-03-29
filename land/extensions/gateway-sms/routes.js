// Twilio inbound SMS webhook receiver.
// No auth middleware. Twilio calls this directly.
// Twilio sends form-encoded POST: From, To, Body, MessageSid, etc.
// Webhook URL: POST /api/v1/gateway/sms/:channelId
// Configure in Twilio console: Messaging > Phone Number > Webhook URL

import log from "../../seed/log.js";
import { sendOk } from "../../seed/protocol.js";
import express from "express";

const router = express.Router();

router.use("/gateway/sms/:channelId", express.urlencoded({ extended: true, limit: "64kb" }));

router.post("/gateway/sms/:channelId", async (req, res) => {
  // Respond with empty TwiML (Twilio expects XML, but empty 200 works too)
  res.type("text/xml").send("<Response></Response>");

  try {
    const channelId = req.params.channelId;
    const body = req.body;

    // Twilio sends: From, To, Body, MessageSid, AccountSid, NumMedia, etc.
    if (!body || !body.Body || !body.From) return;

    const { getExtension } = await import("../loader.js");
    const GatewayChannel = getExtension("gateway")?.exports?.GatewayChannel;
    const channel = await GatewayChannel.findById(channelId).lean();
    if (!channel || !channel.enabled) return;
    if (channel.type !== "sms") return;

    const hasInput = channel.direction === "input" || channel.direction === "input-output";
    if (!hasInput) return;

    // Twilio request validation (optional but recommended)
    // If TWILIO_AUTH_TOKEN is set, verify the X-Twilio-Signature header
    // For now, channel-level verification via the unique webhook URL is sufficient.

    const senderName = body.From; // phone number
    const senderPlatformId = body.From;
    const messageText = body.Body.trim();

    if (!messageText) return;

    log.verbose("GatewaySMS",
      `SMS on channel ${channelId} from ${senderName}: "${messageText.slice(0, 80)}"`,
    );

    // Process via gateway core
    const { getExtension } = await import("../loader.js");
    const gateway = getExtension("gateway");
    if (!gateway?.exports?.processGatewayMessage) {
      log.error("GatewaySMS", "Gateway core not loaded");
      return;
    }

    const result = await gateway.exports.processGatewayMessage(channelId, {
      senderName,
      senderPlatformId,
      messageText,
    });

    // Reply via SMS if input-output and there's a reply
    if (result.reply && channel.direction === "input-output") {
      const { sendSms, getTwilioCreds } = await import("./handler.js");
      const fullChannel = await gateway.exports.getChannelWithSecrets(channel._id);
      const secrets = fullChannel?.config?.decryptedSecrets || {};
      const creds = getTwilioCreds(secrets);

      const reply = result.reply.length > 1500
        ? result.reply.slice(0, 1497) + "..."
        : result.reply;

      await sendSms(creds, body.From, reply);
    }
  } catch (err) {
    log.error("GatewaySMS",
      `SMS webhook error for channel ${req.params.channelId}:`,
      err.message,
    );
  }
});

export default router;
