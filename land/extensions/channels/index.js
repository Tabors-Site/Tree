import log from "../../seed/log.js";
import tools from "./tools.js";
import { setServices, deliverToChannels, getChannels, createChannel, removeChannel, acceptInvite } from "./core.js";
import { getExtMeta } from "../../seed/tree/extensionMetadata.js";

export async function init(core) {
  setServices({ models: core.models });

  // ── onCascade: deliver signals through channel subscriptions ────────
  //
  // Runs AFTER propagation (propagation is a required dependency, so its
  // handler registered first). Nearby nodes get the signal through the
  // tree walk before distant partners get it through the channel shortcut.
  //
  // Two skip conditions prevent loops and misrouting:
  // 1. _channel tag present: this signal already arrived via a channel.
  //    One hop only. Never re-enter the channel system.
  // 2. _channelInvite present: this is an invitation signal, not content.
  //    Handled separately below.

  core.hooks.register("onCascade", async (hookData) => {
    const { nodeId, payload, signalId, depth } = hookData;
    if (!payload) return;

    // Skip channel-delivered signals (loop prevention)
    if (payload._channel) return;

    // Skip invitation signals (handled by the invitation listener below)
    if (payload._channelInvite) return;

    // Deliver to all matching channel subscriptions
    const results = await deliverToChannels(nodeId, payload, signalId, depth);

    if (results.length > 0) {
      log.verbose("Channels", `Delivered signal from ${nodeId} through ${results.length} channel(s)`);
    }

    return { channelDeliveries: results };
  }, "channels");

  // ── onCascade: handle channel invitations ───────────────────────────
  //
  // When a _channelInvite arrives, auto-accept if same owner.
  // Otherwise the invitation is already in pending[] from createChannel.

  core.hooks.register("onCascade", async (hookData) => {
    const { nodeId, payload } = hookData;
    if (!payload?._channelInvite) return;

    const invite = payload._channelInvite;
    const Node = core.models.Node;

    // Check if same owner for auto-accept
    const targetNode = await Node.findById(nodeId).select("rootOwner").lean();
    const sourceNode = await Node.findById(invite.sourceNodeId).select("rootOwner").lean();

    if (targetNode?.rootOwner && sourceNode?.rootOwner &&
        targetNode.rootOwner.toString() === sourceNode.rootOwner.toString()) {
      try {
        await acceptInvite(nodeId, invite.channelName, "system");
        log.verbose("Channels", `Auto-accepted channel "${invite.channelName}" from ${invite.sourceNodeName}`);
      } catch (err) {
        log.debug("Channels", `Auto-accept failed for "${invite.channelName}": ${err.message}`);
      }
    }
  }, "channels");

  // ── enrichContext: surface channel info to the AI ───────────────────

  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const channelMeta = meta.channels;
    if (!channelMeta?.subscriptions?.length) return;

    const active = channelMeta.subscriptions.filter(s => s.active);
    if (active.length === 0) return;

    context.channels = active.map(s => ({
      name: s.channelName,
      partner: s.partnerName,
      direction: s.direction,
      filter: s.filter?.tags || null,
    }));

    if (channelMeta.pending?.length > 0) {
      context.pendingChannelInvites = channelMeta.pending.length;
    }
  }, "channels");

  const { default: router } = await import("./routes.js");

  log.info("Channels", "Direct signal channels loaded");

  return {
    router,
    tools,
    exports: {
      getChannels,
      createChannel,
      removeChannel,
      acceptInvite,
      deliverToChannels,
    },
  };
}
