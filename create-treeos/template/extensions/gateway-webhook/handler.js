// Web push (webhook) channel type handler.
// Registered with gateway core during init. Output only.

import log from "../../seed/log.js";

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────

function validateConfig(config, direction) {
  if (!config.subscription || typeof config.subscription !== "object") {
    throw new Error("Web push channel requires a subscription object");
  }
  if (
    !config.subscription.endpoint ||
    typeof config.subscription.endpoint !== "string"
  ) {
    throw new Error("Web push subscription must have an endpoint");
  }
}

function buildEncryptedConfig(config, direction) {
  return {
    secrets: { subscription: config.subscription },
    metadata: {},
    displayIdentifier: config.displayIdentifier || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// SENDER
// ─────────────────────────────────────────────────────────────────────────

async function send(secrets, metadata, notification) {
  const { subscription } = secrets;

  let webpush;
  try {
    webpush = await import("web-push");
    webpush = webpush.default || webpush;
  } catch {
    throw new Error("web-push package not installed");
  }

  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidEmail = process.env.VAPID_EMAIL;

  if (!vapidPublic || !vapidPrivate || !vapidEmail) {
    throw new Error("VAPID keys not configured");
  }

  const email = vapidEmail.startsWith("mailto:") ? vapidEmail : "mailto:" + vapidEmail;
  webpush.setVapidDetails(email, vapidPublic, vapidPrivate);

  const payload = JSON.stringify({
    title: notification.title,
    body: notification.content,
    type: notification.type,
  });

  try {
    await webpush.sendNotification(subscription, payload);
  } catch (err) {
    if (err.statusCode === 410) {
      // Subscription expired, disable the channel
      try {
        const GatewayChannel = (await import("../gateway/model.js")).default;
        await GatewayChannel.findByIdAndUpdate(notification._channelId, {
          $set: { enabled: false, lastError: "Push subscription expired (410 Gone)" },
        });
      } catch (err2) { log.warn("GatewayWebhook", "failed to disable expired channel:", err2.message); }
      throw new Error("Push subscription expired");
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// EXPORT HANDLER
// ─────────────────────────────────────────────────────────────────────────

export default {
  allowedDirections: ["output"],
  validateConfig,
  buildEncryptedConfig,
  send,
};
