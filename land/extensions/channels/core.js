// Channels Core
//
// Direct named signal paths between nodes. One-hop delivery via deliverCascade.
// No tree walk. Subscriptions stored in metadata.channels on each endpoint.

import log from "../../seed/log.js";
import { deliverCascade } from "../../seed/tree/cascade.js";
import { v4 as uuidv4 } from "uuid";

let Node = null;
let _metadata = null;
export function setServices({ models, metadata }) {
  Node = models.Node;
  if (metadata) _metadata = metadata;
}

const CHANNEL_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,49}$/;
const MAX_CHANNELS_PER_NODE = 50;

// ─────────────────────────────────────────────────────────────────────────
// READ
// ─────────────────────────────────────────────────────────────────────────

export async function getChannels(nodeId) {
  const node = await Node.findById(nodeId).select("metadata").lean();
  if (!node) throw new Error("Node not found");
  const meta = _metadata.getExtMeta(node, "channels");
  return {
    subscriptions: meta.subscriptions || [],
    pending: meta.pending || [],
  };
}

// ─────────────────────────────────────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────────────────────────────────────

export async function createChannel({
  sourceNodeId,
  targetNodeId,
  channelName,
  direction = "bidirectional",
  filter = null,
  userId,
}) {
  if (!CHANNEL_NAME_RE.test(channelName)) {
    throw new Error("Channel name must be 1-50 alphanumeric characters, hyphens, or underscores");
  }
  if (!["inbound", "outbound", "bidirectional"].includes(direction)) {
    throw new Error("Direction must be inbound, outbound, or bidirectional");
  }
  if (sourceNodeId === targetNodeId) {
    throw new Error("Cannot create a channel from a node to itself");
  }

  const sourceNode = await Node.findById(sourceNodeId).select("_id name rootOwner metadata").lean();
  if (!sourceNode) throw new Error("Source node not found");

  const targetNode = await Node.findById(targetNodeId).select("_id name rootOwner metadata").lean();
  if (!targetNode) throw new Error("Target node not found");

  // Check for duplicate channel name between this pair
  const sourceMeta = _metadata.getExtMeta(sourceNode, "channels");
  const subs = sourceMeta.subscriptions || [];
  if (subs.length >= MAX_CHANNELS_PER_NODE) {
    throw new Error(`Maximum ${MAX_CHANNELS_PER_NODE} channels per node`);
  }
  const duplicate = subs.find(
    s => s.channelName === channelName && s.partnerId === targetNodeId,
  );
  if (duplicate) {
    throw new Error(`Channel "${channelName}" already exists between these nodes`);
  }

  // Determine if auto-accept applies (same owner)
  const sameOwner = sourceNode.rootOwner && targetNode.rootOwner &&
    sourceNode.rootOwner.toString() === targetNode.rootOwner.toString();

  const now = new Date().toISOString();

  if (sameOwner) {
    // Auto-accept: write subscription to both sides
    await writeSubscription(sourceNodeId, {
      channelName,
      partnerId: targetNodeId,
      partnerName: targetNode.name,
      direction,
      filter,
      createdAt: now,
      createdBy: userId,
      active: true,
    });

    const reverseDirection = direction === "outbound" ? "inbound"
      : direction === "inbound" ? "outbound"
      : "bidirectional";

    await writeSubscription(targetNodeId, {
      channelName,
      partnerId: sourceNodeId,
      partnerName: sourceNode.name,
      direction: reverseDirection,
      filter,
      createdAt: now,
      createdBy: userId,
      active: true,
    });

    log.verbose("Channels", `Channel "${channelName}" created between ${sourceNode.name} and ${targetNode.name} (auto-accepted)`);

    return { channelName, status: "active", autoAccepted: true };
  }

  // Different owner: send invitation via cascade
  await writeInvitation(targetNodeId, {
    channelName,
    fromNodeId: sourceNodeId,
    fromNodeName: sourceNode.name,
    direction,
    filter,
    invitedAt: now,
    invitedBy: userId,
  });

  // Also send a cascade signal so the target's operator is notified
  try {
    await deliverCascade({
      nodeId: targetNodeId,
      signalId: uuidv4(),
      payload: {
        _channelInvite: {
          channelName,
          sourceNodeId,
          sourceNodeName: sourceNode.name,
          direction,
          filter,
        },
      },
      source: sourceNodeId,
      depth: 0,
    });
  } catch (err) {
    log.debug("Channels", `Invitation cascade delivery failed: ${err.message}`);
  }

  log.verbose("Channels", `Channel invitation "${channelName}" sent from ${sourceNode.name} to ${targetNode.name}`);

  return { channelName, status: "pending", autoAccepted: false };
}

// ─────────────────────────────────────────────────────────────────────────
// ACCEPT INVITATION
// ─────────────────────────────────────────────────────────────────────────

export async function acceptInvite(nodeId, channelName, userId) {
  const node = await Node.findById(nodeId).select("_id name metadata").lean();
  if (!node) throw new Error("Node not found");

  const meta = _metadata.getExtMeta(node, "channels");
  const pending = meta.pending || [];
  const inviteIdx = pending.findIndex(p => p.channelName === channelName);
  if (inviteIdx === -1) throw new Error(`No pending invitation for channel "${channelName}"`);

  const invite = pending[inviteIdx];
  const now = new Date().toISOString();

  // Write subscription on this side
  await writeSubscription(nodeId, {
    channelName,
    partnerId: invite.fromNodeId,
    partnerName: invite.fromNodeName,
    direction: invite.direction === "outbound" ? "inbound"
      : invite.direction === "inbound" ? "outbound"
      : "bidirectional",
    filter: invite.filter || null,
    createdAt: now,
    createdBy: userId,
    active: true,
  });

  // Write subscription on the source side
  await writeSubscription(invite.fromNodeId, {
    channelName,
    partnerId: nodeId,
    partnerName: node.name,
    direction: invite.direction,
    filter: invite.filter || null,
    createdAt: now,
    createdBy: invite.invitedBy,
    active: true,
  });

  // Remove from pending
  pending.splice(inviteIdx, 1);
  const nodeDoc = await Node.findById(nodeId);
  if (nodeDoc) {
    const updated = _metadata.getExtMeta(nodeDoc, "channels");
    updated.pending = pending;
    await _metadata.setExtMeta(nodeDoc, "channels", updated);
  }

  log.verbose("Channels", `Channel invitation "${channelName}" accepted at ${node.name}`);

  return { channelName, status: "active" };
}

// ─────────────────────────────────────────────────────────────────────────
// REMOVE
// ─────────────────────────────────────────────────────────────────────────

export async function removeChannel(nodeId, channelName, userId) {
  // Remove from this side
  const removed = await removeSubscription(nodeId, channelName);
  if (!removed) throw new Error(`Channel "${channelName}" not found on this node`);

  // Remove from partner side
  if (removed.partnerId) {
    try {
      await removeSubscription(removed.partnerId, channelName);
    } catch (err) {
      log.debug("Channels", `Partner-side removal failed for "${channelName}": ${err.message}`);
    }
  }

  log.verbose("Channels", `Channel "${channelName}" removed from node ${nodeId}`);

  return { channelName, removed: true };
}

// ─────────────────────────────────────────────────────────────────────────
// DELIVER (called from onCascade handler)
// ─────────────────────────────────────────────────────────────────────────

export async function deliverToChannels(nodeId, signalPayload, signalId, depth) {
  const node = await Node.findById(nodeId).select("metadata").lean();
  if (!node) return [];

  const meta = _metadata.getExtMeta(node, "channels");
  const subs = (meta.subscriptions || []).filter(
    s => s.active && (s.direction === "outbound" || s.direction === "bidirectional"),
  );

  if (subs.length === 0) return [];

  const results = [];
  const payloadTags = signalPayload.tags || [];

  for (const sub of subs) {
    // Apply tag filter if configured
    if (sub.filter?.tags && sub.filter.tags.length > 0) {
      const overlap = sub.filter.tags.some(t => payloadTags.includes(t));
      if (!overlap) continue;
    }

    // Deliver with _channel tag to prevent re-entry
    try {
      const result = await deliverCascade({
        nodeId: sub.partnerId,
        signalId: signalId || uuidv4(),
        payload: {
          ...signalPayload,
          _channel: sub.channelName,
          _channelSource: nodeId,
        },
        source: nodeId,
        depth: (depth || 0) + 1,
      });

      results.push({
        channelName: sub.channelName,
        partnerId: sub.partnerId,
        partnerName: sub.partnerName,
        status: result?.status || "delivered",
      });
    } catch (err) {
      log.debug("Channels", `Channel delivery failed for "${sub.channelName}" to ${sub.partnerName}: ${err.message}`);
      results.push({
        channelName: sub.channelName,
        partnerId: sub.partnerId,
        partnerName: sub.partnerName,
        status: "failed",
        error: err.message,
      });
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────
// METADATA HELPERS
// ─────────────────────────────────────────────────────────────────────────

async function writeSubscription(nodeId, subscription) {
  const nodeDoc = await Node.findById(nodeId);
  if (!nodeDoc) throw new Error(`Node ${nodeId} not found for subscription write`);

  const meta = _metadata.getExtMeta(nodeDoc, "channels");
  if (!meta.subscriptions) meta.subscriptions = [];
  meta.subscriptions.push(subscription);
  await _metadata.setExtMeta(nodeDoc, "channels", meta);
}

async function writeInvitation(nodeId, invitation) {
  const nodeDoc = await Node.findById(nodeId);
  if (!nodeDoc) throw new Error(`Node ${nodeId} not found for invitation write`);

  const meta = _metadata.getExtMeta(nodeDoc, "channels");
  if (!meta.pending) meta.pending = [];

  // Replace existing invitation for same channel name from same source
  const existingIdx = meta.pending.findIndex(
    p => p.channelName === invitation.channelName && p.fromNodeId === invitation.fromNodeId,
  );
  if (existingIdx >= 0) {
    meta.pending[existingIdx] = invitation;
  } else {
    meta.pending.push(invitation);
  }
  await _metadata.setExtMeta(nodeDoc, "channels", meta);
}

async function removeSubscription(nodeId, channelName) {
  const nodeDoc = await Node.findById(nodeId);
  if (!nodeDoc) return null;

  const meta = _metadata.getExtMeta(nodeDoc, "channels");
  if (!meta.subscriptions) return null;

  const idx = meta.subscriptions.findIndex(s => s.channelName === channelName);
  if (idx === -1) return null;

  const removed = meta.subscriptions.splice(idx, 1)[0];
  await _metadata.setExtMeta(nodeDoc, "channels", meta);
  return removed;
}
