// Tree-to-tree gateway channel handler.
//
// Connects trees across lands without Canopy federation. Canopy is
// infrastructure-level peering between land operators. Gateway-tree is
// user-level connection between tree owners. You don't need your land
// operator to peer with their land operator. You just need your tree
// to talk to their tree.
//
// Fully async. Same pattern as every other channel type.
//
// Output: POST the message to the remote land's input endpoint. The
//   remote land responds 200 immediately. Connection closed. Done.
//   The remote land processes the message in the background through
//   processGatewayMessage. If the remote channel is input-output,
//   the remote AI's reply fires as a separate output POST back to
//   this land's input endpoint.
//
// Input: receive POSTed JSON from a remote tree. Respond 200 immediately.
//   Process through processGatewayMessage in the background. If this
//   channel is input-output, the reply fires through this channel's
//   output (a separate POST to the remote land's input endpoint).
//
// Two async one-way messages. Not one synchronous round trip. Each
// direction is independent. Each responds 200 before processing.
// If the remote land is slow, this land isn't hanging. If the remote
// AI fails, a cascade result with status:failed appears in .flow.
//
// Setup: both lands need gateway-tree installed. Both configure a channel
// pointing at the other. Land A's output URL is Land B's input endpoint.
// Land B's output URL is Land A's input endpoint. Two channels. Two
// directions. Fully async.
//
// The message arrives as rain on the receiving land. The reply arrives
// as rain on the sending land. Both flow through .flow. Both get
// filtered by perspective. Both get processed by the conversation loop.
// The gateway doesn't know it's talking to another tree. It just sends
// and receives messages through the same interface every other channel uses.

import log from "../../seed/log.js";
import crypto from "crypto";

// ─────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────

function validateConfig(config, direction) {
  const hasOutput = direction === "output" || direction === "input-output";
  const hasInput = direction === "input" || direction === "input-output";

  if (hasOutput) {
    if (!config.remoteUrl || typeof config.remoteUrl !== "string") {
      throw new Error(
        "Tree output requires a remoteUrl: the remote land's gateway-tree input endpoint " +
        "(e.g., https://otherland.example.com/api/v1/gateway/tree/<theirChannelId>)"
      );
    }
    try {
      const parsed = new URL(config.remoteUrl);
      if (!parsed.protocol.startsWith("http")) {
        throw new Error("remoteUrl must use http or https");
      }
    } catch (err) {
      if (err.message.includes("http")) throw err;
      throw new Error("remoteUrl is not a valid URL");
    }

    if (!config.remoteSecret || typeof config.remoteSecret !== "string") {
      throw new Error(
        "Tree output requires a remoteSecret: the webhook secret of the remote land's receiving channel"
      );
    }
  }

  if (hasInput) {
    // Input channels generate their own webhook secret on creation.
    // Share it with the remote tree owner. They configure it as their remoteSecret.
    if (config.senderFilter && typeof config.senderFilter !== "string") {
      throw new Error("senderFilter must be a string (land domain or username)");
    }
  }
}

function buildEncryptedConfig(config, direction) {
  const hasInput = direction === "input" || direction === "input-output";
  const hasOutput = direction === "output" || direction === "input-output";

  const secrets = {};
  const metadata = {};

  if (hasOutput) {
    secrets.remoteUrl = config.remoteUrl;
    secrets.remoteSecret = config.remoteSecret;
  }

  if (hasInput) {
    metadata.webhookSecret = crypto.randomBytes(32).toString("hex");
    if (config.senderFilter) metadata.senderFilter = config.senderFilter;
  }

  let display = "tree";
  if (config.remoteUrl) {
    try { display = new URL(config.remoteUrl).hostname; } catch {}
  }
  if (config.remoteName) display = config.remoteName;

  return {
    secrets,
    metadata,
    displayIdentifier: display,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// SENDER (output: fire-and-forget POST to remote land)
// ─────────────────────────────────────────────────────────────────────────

async function send(secrets, metadata, notification) {
  const url = secrets.remoteUrl;
  const secret = secrets.remoteSecret;

  if (!url || !secret) {
    throw new Error("Tree channel not configured for output (missing remoteUrl or remoteSecret)");
  }

  const payload = {
    secret,
    senderLand: process.env.LAND_DOMAIN || null,
    message: notification.content || "",
    title: notification.title || null,
    type: notification.type || "notification",
  };

  // Fire and forget. We only care that the remote land accepted the message (200).
  // The remote land processes in the background. If the remote AI produces a reply,
  // it comes back as a separate POST to our input endpoint. Not in this response.
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000), // 10s. Just waiting for 200 acceptance, not AI processing.
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Remote land responded ${res.status}: ${body.slice(0, 200)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// INPUT LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────

async function registerInput(channel, secrets) {
  const webhookSecret = channel.config?.metadata?.webhookSecret;
  log.info("GatewayTree",
    `Tree input registered for channel ${channel._id}. ` +
    `Endpoint: POST /api/v1/gateway/tree/${channel._id}. ` +
    `Share the webhook secret with the remote tree owner: ${webhookSecret ? webhookSecret.slice(0, 12) + "..." : "none"}`,
  );
}

async function unregisterInput(channel, secrets) {
  log.verbose("GatewayTree", `Tree input unregistered for channel ${channel._id}`);
}

export default {
  allowedDirections: ["input", "output", "input-output"],
  validateConfig,
  buildEncryptedConfig,
  send,
  registerInput,
  unregisterInput,
};
