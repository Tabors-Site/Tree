// Channels Core
//
// Direct named signal paths between nodes. One-hop delivery via deliverCascade.
// No tree walk. Subscriptions stored in metadata.channels on each endpoint.
//
// ROOMS are built on this primitive. A room is a cascade-enabled node.
// Participants are one-sided subscriptions on the room with `participantType`
// set to "agent" (auto-orchestrate on signal), "user" (deliver to home),
// or "observer" (read-only, skip delivery). A pair is just a room with
// two participants; a chain is a room whose node has a subscription into
// another room's node.

import log from "../../seed/log.js";
import { deliverCascade } from "../../seed/tree/cascade.js";
import { v4 as uuidv4 } from "uuid";

let Node = null;
let Note = null;
let _metadata = null;
export function setServices({ models, metadata }) {
  Node = models.Node;
  Note = models.Note;
  if (metadata) _metadata = metadata;
}

const CHANNEL_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,49}$/;
const MAX_CHANNELS_PER_NODE = 50;

// ─────────────────────────────────────────────────────────────────────────
// Room metadata helpers — rooms live nested under channels namespace
// so setExtMeta's namespace guard is respected. (Extensions can only
// write to their own namespace; "room" would be a violation.)
// ─────────────────────────────────────────────────────────────────────────

function getRoomMeta(node) {
  if (!node) return null;
  const channels = _metadata.getExtMeta(node, "channels") || {};
  return channels.room || null;
}

async function setRoomMeta(nodeDoc, roomMeta) {
  if (!nodeDoc) return;
  const channels = _metadata.getExtMeta(nodeDoc, "channels") || {};
  channels.room = roomMeta;
  await _metadata.setExtMeta(nodeDoc, "channels", channels);
}

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
  const node = await Node.findById(nodeId).select("metadata name").lean();
  if (!node) return [];

  const meta = _metadata.getExtMeta(node, "channels");
  const subs = (meta.subscriptions || []).filter(
    s => s.active && (s.direction === "outbound" || s.direction === "bidirectional"),
  );

  if (subs.length === 0) return [];

  const results = [];
  const payloadTags = signalPayload.tags || [];
  const authorSubId = signalPayload._authorSubId || null;

  for (const sub of subs) {
    // Apply tag filter if configured
    if (sub.filter?.tags && sub.filter.tags.length > 0) {
      const overlap = sub.filter.tags.some(t => payloadTags.includes(t));
      if (!overlap) continue;
    }

    // Self-ignore: a subscription never receives its own post. The note
    // written by an agent carries _authorSubId equal to the authoring
    // subscription's _subId; matching subs skip delivery. Without this,
    // an agent's own response fans back to itself and loops.
    if (authorSubId && sub._subId && sub._subId === authorSubId) continue;

    // Observer: read-only, never receives delivery. Transcript visibility
    // is via the room's note history, not live signals.
    if (sub.participantType === "observer") continue;

    // Agent participant: invoke orchestration at the agent's tree
    // position. The room node IS the source; the agent's response will
    // be written back as a note on the room, which cascades again.
    //
    // Fire-and-forget on purpose: LLM orchestration can take 20-30s per
    // agent, and the hook system times out at 5s. Awaiting deliverToAgent
    // here would (a) block the remaining agents in this iteration from
    // ever running and (b) cause Hooks to flag the channels handler as
    // failed. Instead we spawn each agent's work as a background promise
    // and return immediately. The agent's eventual response triggers its
    // own cascade which fans back out to the other participants.
    if (sub.participantType === "agent" && sub.agent) {
      log.info("Channels", `🤖 Room delivery → agent "${sub.agent?.label || sub.partnerId}" @ ${String(sub.agent?.rootId).slice(0,8)}/${String(sub.agent?.nodeId).slice(0,8)} (mode=${sub.agent?.modeHint || "auto"})`);
      deliverToAgent({
        roomNode: node,
        subscription: sub,
        signalPayload,
        signalId,
        depth,
      })
        .then((deliveryResult) => {
          log.info("Channels", `🤖 Agent "${sub.agent?.label}" result: ${deliveryResult?.status}${deliveryResult?.reason ? ` (${deliveryResult.reason})` : ""}`);
        })
        .catch((err) => {
          log.warn("Channels", `🤖 Agent delivery THREW for "${sub.agent?.label || sub.partnerId}": ${err.message}\n${err.stack?.split("\n").slice(0, 6).join("\n")}`);
        });
      results.push({
        channelName: sub.channelName,
        partnerId: sub.partnerId,
        partnerName: sub.partnerName || sub.agent.label || "agent",
        status: "dispatched",
        kind: "agent",
      });
      continue;
    }

    // Default: cascade delivery to the partner node. Covers `node` (legacy
    // pair channels), `user` (delivers to the user's home node where
    // notification extensions pick it up), and any participant type that
    // just wants the signal to arrive as cascade.
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
        kind: sub.participantType || "node",
      });
    } catch (err) {
      log.debug("Channels", `Channel delivery failed for "${sub.channelName}" to ${sub.partnerName}: ${err.message}`);
      results.push({
        channelName: sub.channelName,
        partnerId: sub.partnerId,
        partnerName: sub.partnerName,
        status: "failed",
        kind: sub.participantType || "node",
        error: err.message,
      });
    }
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────────
// AGENT DELIVERY — invoke orchestration on behalf of a tree participant
// ─────────────────────────────────────────────────────────────────────────

/**
 * When a room cascade arrives and a subscription is an agent participant,
 * we run orchestrateTreeRequest at the agent's tree position with the
 * room post as the message. The orchestrator's answer is written back
 * to the room as a note, stamped with the agent's subscription id so
 * it doesn't fan back to the same agent.
 *
 * Cooldown + room budget + [[ROOM-DONE]] are enforced here. Dynamic
 * imports avoid a boot-time circular dependency with tree-orchestrator.
 */
async function deliverToAgent({ roomNode, subscription, signalPayload, signalId, depth }) {
  const roomNodeId = roomNode._id || roomNode.id;
  const agent = subscription.agent;
  const nowMs = Date.now();

  // In-flight lock: skip if this subscription already has an orchestration
  // running. Without this, a new cascade (e.g. from another agent's reply)
  // would kick off a second concurrent invocation of the same agent before
  // the first finishes — wasting tokens and producing cross-talk. Lock is
  // set at dispatch and cleared on completion (success or failure).
  // Treat the lock as stale after 45 minutes to cover the longest local-model
  // turns without leaving a zombie lock if the process crashed mid-run.
  const LOCK_TTL_MS = 45 * 60 * 1000;
  const runningAt = subscription._runningAt ? new Date(subscription._runningAt).getTime() : 0;
  if (runningAt && (nowMs - runningAt) < LOCK_TTL_MS) {
    return { status: "busy", reason: `running since ${Math.round((nowMs - runningAt) / 1000)}s ago` };
  }

  // Cooldown: an agent can't post faster than its configured interval.
  const cooldownMs = typeof subscription.cooldownMs === "number" ? subscription.cooldownMs : 500;
  const lastAt = subscription.lastPostAt ? new Date(subscription.lastPostAt).getTime() : 0;
  if (lastAt && nowMs - lastAt < cooldownMs) {
    return { status: "cooldown", reason: `${cooldownMs - (nowMs - lastAt)}ms remaining` };
  }

  // Set the in-flight lock on this subscription. Cleared in finally below.
  try { await touchSubscriptionRunning(roomNodeId, subscription._subId, nowMs); } catch {}

  // Everything past this point runs under the lock; use try/finally so
  // the lock always clears even on error.
  try {
  // Room budget: if the room has posted more than maxMessages, new agent
  // responses are suppressed. Creator can raise the limit or close the room.
  const roomMeta = getRoomMeta(roomNode) || {};
  const maxMessages = roomMeta.maxMessages || 60;
  const postCount = roomMeta.postCount || 0;
  if (postCount >= maxMessages) {
    return { status: "room-budget-exceeded" };
  }

  // Load runChat dynamically (no boot-time cycle). runChat is the kernel
  // programmatic entry point: it owns its Chat record lifecycle (starts +
  // finalizes, visible in the tree's /chats page), switches mode directly
  // to what we ask for (no intent classifier to override modeHint), and
  // honors ephemeral session isolation. This is the right layer for
  // background callers like room-agent delivery — orchestrateTreeRequest
  // would require pre-existing chat plumbing from the caller.
  let runChat;
  try {
    runChat = (await import("../../seed/llm/conversation.js")).runChat;
  } catch (err) {
    log.warn("Channels", `Agent delivery requires conversation.runChat: ${err.message}`);
    return { status: "runchat-unavailable" };
  }

  // Build the message the agent sees. Preamble explains room semantics
  // (who's here, what a room is, how to behave) + identifies the sender
  // of the current post. We put room rules in the MESSAGE rather than
  // via enrichContext because modes read enrichedContext inconsistently —
  // the message param is the one place every mode always reads.
  const payloadText = signalPayload?.text
    || signalPayload?.content
    || (typeof signalPayload === "string" ? signalPayload : "")
    || "";
  if (!payloadText.trim()) {
    return { status: "empty-payload" };
  }
  const sourceLabel = signalPayload?._authorLabel
    || signalPayload?._authorName
    || "a room participant";

  // Compose participant list so the agent knows who else is in the room.
  const chanMeta = _metadata.getExtMeta(roomNode, "channels") || {};
  const otherParticipants = (chanMeta.subscriptions || [])
    .filter((s) => s.active && s._subId !== subscription._subId)
    .map((s) => {
      const kind = s.participantType === "agent" ? "🤖"
        : s.participantType === "user" ? "👤"
        : s.participantType === "observer" ? "👁" : "•";
      return `  ${kind} ${s.partnerName || s.agent?.label || s.subId?.slice(0, 8) || "unknown"}`;
    })
    .join("\n") || "  (just you)";

  const preamble =
`[Room: "${roomNode.name || roomNodeId}"]
You are participating in a multi-party conversation. Rules:
- Keep replies SHORT. Rooms get crowded; don't lecture.
- Address specific participants with @name when relevant.
- If the message isn't for you, you MAY stay silent (reply with just "skip" or empty).
- Emit [[ROOM-DONE]] on its own line to CLOSE the room when the conversation has resolved.
- You are talking to other trees + the user, not one-on-one.

Other participants besides you:
${otherParticipants}

────────────────────────────────────────
Incoming post from ${sourceLabel}:
${payloadText}
────────────────────────────────────────

Respond briefly as yourself (${agent.label || "agent"}).`;
  const message = preamble;

  // Ephemeral visitorId isolates the agent's turn from any live user chat.
  // runChat with ephemeral=true also bypasses its own session cache, so
  // the visitorId below is just a trace-label — not shared with any other
  // session or reused across turns.
  const turnIndex = postCount + 1;
  const visitorId = `room:${String(roomNodeId).slice(0, 8)}:${subscription._subId || "anon"}:${turnIndex}`;
  const mode = agent.modeHint || "tree:converse";

  const runResult = await runChat({
    userId: subscription.createdBy || agent.userId || "system",
    username: agent.label || "agent",
    message,
    mode,
    rootId: agent.rootId,
    nodeId: agent.nodeId,
    visitorId,
    ephemeral: true,
    llmPriority: "INTERACTIVE",
    // Link the agent's chat record to both the tree node it's acting
    // from (so it appears on that node's /chats page) and the room
    // it's speaking into (so the transcript viewer can cross-link).
    treeContext: {
      targetNodeId: agent.nodeId || agent.rootId,
      roomNodeId: String(roomNodeId),
      roomSubId: subscription._subId || null,
    },
  });

  const answer = (runResult?.content || runResult?.answer || "").trim();
  if (!answer) {
    return { status: "agent-silent" };
  }

  // [[ROOM-DONE]] closes the room immediately. Strip the marker before
  // posting so the closing message still lands in the transcript.
  let cleanedAnswer = answer;
  let roomDone = false;
  if (/\[\[ROOM-DONE\]\]/.test(answer)) {
    cleanedAnswer = answer.replace(/\[\[ROOM-DONE\]\]/g, "").trim() || "(closing room)";
    roomDone = true;
  }

  // Write the agent's response as a note on the room and fire cascade
  // ourselves so other participants receive it. Mark authorSubId so
  // self-ignore engages on re-entry.
  const authorLabel = agent.label || subscription.partnerName || "agent";
  try {
    await postNoteToRoomAs({
      roomNodeId,
      content: cleanedAnswer,
      authorSubId: subscription._subId,
      authorLabel,
      userId: subscription.createdBy || agent.userId || "system",
      signalId,
      depth,
    });
  } catch (err) {
    log.warn("Channels", `Failed to post agent response to room ${roomNodeId}: ${err.message}`);
    return { status: "post-failed", error: err.message };
  }

  // Update subscription's lastPostAt on the room node.
  try {
    await touchSubscriptionLastPost(roomNodeId, subscription._subId, nowMs);
  } catch (err) {
    log.debug("Channels", `lastPostAt touch failed: ${err.message}`);
  }

  // If closing: mark the room closed so further delivery short-circuits.
  if (roomDone) {
    try { await closeRoom(roomNodeId); } catch (err) {
      log.debug("Channels", `closeRoom failed: ${err.message}`);
    }
  }

  return { status: "posted", roomDone };
  } finally {
    // Always clear the in-flight lock so this subscription is dispatchable
    // for the next cascade (even if orchestration threw or we returned
    // early with cooldown/budget/empty status).
    try { await touchSubscriptionRunning(roomNodeId, subscription._subId, null); } catch {}
  }
}

/**
 * Write a note on the room node with the authoring subscription id
 * embedded in cascade payload so self-ignore works when cascade fires.
 */
async function postNoteToRoomAs({ roomNodeId, content, authorSubId, authorLabel, userId, signalId, depth }) {
  const { createNote } = await import("../../seed/tree/notes.js");
  await createNote({
    contentType: "text",
    content,
    userId,
    nodeId: roomNodeId,
    wasAi: true,
    metadata: {
      room: {
        authorSubId: authorSubId || null,
        authorLabel: authorLabel || null,
      },
    },
  });
  // Increment the room's post counter + fire cascade manually so the
  // payload carries _authorSubId. We don't rely on checkCascade firing
  // from the note write because we need to attach author metadata to
  // the payload for self-ignore.
  await incrementRoomPostCount(roomNodeId);
  try {
    await deliverCascade({
      nodeId: roomNodeId,
      signalId: signalId || uuidv4(),
      payload: {
        text: content,
        _room: true,
        _authorSubId: authorSubId,
        _authorLabel: authorLabel,
      },
      source: roomNodeId,
      depth: (depth || 0) + 1,
    });
  } catch (err) {
    log.debug("Channels", `deliverCascade on room post failed: ${err.message}`);
  }
}

async function incrementRoomPostCount(roomNodeId) {
  const nodeDoc = await Node.findById(roomNodeId);
  if (!nodeDoc) return;
  const roomMeta = getRoomMeta(nodeDoc) || {};
  roomMeta.postCount = (roomMeta.postCount || 0) + 1;
  roomMeta.lastPostAt = new Date().toISOString();
  await setRoomMeta(nodeDoc, roomMeta);
}

async function touchSubscriptionLastPost(roomNodeId, subId, atMs) {
  if (!subId) return;
  const nodeDoc = await Node.findById(roomNodeId);
  if (!nodeDoc) return;
  const meta = _metadata.getExtMeta(nodeDoc, "channels");
  const subs = meta.subscriptions || [];
  const target = subs.find((s) => s._subId === subId);
  if (!target) return;
  target.lastPostAt = new Date(atMs).toISOString();
  await _metadata.setExtMeta(nodeDoc, "channels", meta);
}

/**
 * Set or clear the in-flight orchestration lock on an agent subscription.
 * atMs = number → set to that timestamp ("running").
 * atMs = null   → clear the lock ("idle").
 * Two concurrent calls at the same subscription are serialized through
 * the metadata upsert path; concurrent deliveries to DIFFERENT agents
 * don't interact.
 */
async function touchSubscriptionRunning(roomNodeId, subId, atMs) {
  if (!subId) return;
  const nodeDoc = await Node.findById(roomNodeId);
  if (!nodeDoc) return;
  const meta = _metadata.getExtMeta(nodeDoc, "channels");
  const subs = meta.subscriptions || [];
  const target = subs.find((s) => s._subId === subId);
  if (!target) return;
  target._runningAt = atMs ? new Date(atMs).toISOString() : null;
  await _metadata.setExtMeta(nodeDoc, "channels", meta);
}

export async function closeRoom(roomNodeId) {
  const nodeDoc = await Node.findById(roomNodeId);
  if (!nodeDoc) return;
  const roomMeta = getRoomMeta(nodeDoc) || {};
  roomMeta.status = "closed";
  roomMeta.closedAt = new Date().toISOString();
  await setRoomMeta(nodeDoc, roomMeta);
}

// ─────────────────────────────────────────────────────────────────────────
// ROOM LIFECYCLE
// ─────────────────────────────────────────────────────────────────────────

/**
 * Create a room — a cascade-enabled node that holds channel subscriptions.
 * If `parentNodeId` is supplied the room becomes its child; otherwise it
 * attaches under the caller's user-root.
 *
 * Returns the room node id.
 */
export async function createRoom({ name, parentNodeId, userId, maxMessages = 60 }) {
  if (!name || typeof name !== "string") throw new Error("Room name is required");
  if (!userId) throw new Error("userId is required");

  const parentId = parentNodeId || null;
  if (!parentId) throw new Error("parentNodeId is required (pick a node to host the room under)");

  const parentDoc = await Node.findById(parentId).select("_id rootOwner").lean();
  if (!parentDoc) throw new Error("parentNodeId not found");

  const roomNode = await Node.create({
    _id: uuidv4(),
    name,
    type: "room",
    parent: parentId,
    status: "active",
    rootOwner: parentDoc.rootOwner || userId,
  });
  await Node.updateOne({ _id: parentId }, { $addToSet: { children: roomNode._id } });

  // Stamp room metadata under the channels namespace (extensions can only
  // write to their own). Cascade enablement writes to the `cascade`
  // core namespace, which is exempt from the namespace guard — any
  // extension can flip a node into cascade.
  const roomDoc = await Node.findById(roomNode._id);
  await setRoomMeta(roomDoc, {
    status: "open",
    createdBy: userId,
    createdAt: new Date().toISOString(),
    maxMessages,
    postCount: 0,
    participantCount: 0,
    channelName: `room-${String(roomNode._id).slice(0, 8)}`,
  });
  await _metadata.setExtMeta(roomDoc, "cascade", {
    enabled: true,
    enabledAt: new Date().toISOString(),
    enabledBy: "channels:room",
  });

  log.info("Channels", `Room "${name}" created at ${roomNode._id}`);
  return { roomId: String(roomNode._id), name, channelName: `room-${String(roomNode._id).slice(0, 8)}` };
}

/**
 * Add an agent participant to a room. The room fans cascade signals to
 * this subscription; each delivery invokes orchestrateTreeRequest at the
 * agent's (rootId, nodeId) with the optional modeHint.
 */
export async function addAgentParticipant({ roomNodeId, rootId, nodeId, modeHint, label, userId }) {
  if (!roomNodeId || !rootId || !nodeId) throw new Error("roomNodeId, rootId, nodeId required");
  const roomDoc = await Node.findById(roomNodeId);
  if (!roomDoc) throw new Error("Room not found");
  const roomMeta = getRoomMeta(roomDoc) || {};
  if (roomMeta.status === "closed") throw new Error("Room is closed");

  const subId = uuidv4();
  const subscription = {
    _subId: subId,
    channelName: roomMeta.channelName || `room-${String(roomNodeId).slice(0, 8)}`,
    partnerId: nodeId,
    partnerName: label || null,
    direction: "outbound",
    filter: null,
    createdAt: new Date().toISOString(),
    createdBy: userId,
    active: true,
    participantType: "agent",
    agent: { rootId, nodeId, modeHint: modeHint || null, label: label || null, userId: userId || null },
    cooldownMs: 500,
    lastPostAt: null,
  };
  await writeSubscription(roomNodeId, subscription);
  await incrementParticipantCount(roomNodeId);
  log.info("Channels", `Agent "${label || nodeId}" joined room ${roomNodeId}`);
  return { subId, role: "agent" };
}

/**
 * Add a user participant to a room. Creates a subscription on the room
 * pointing at the user's home node (so cascade delivery reaches their
 * notifications) plus a mirror subscription on the user's home node so
 * they see the room in their channel list.
 */
export async function addUserParticipant({ roomNodeId, userHomeNodeId, label, userId }) {
  if (!roomNodeId || !userHomeNodeId) throw new Error("roomNodeId and userHomeNodeId required");
  const roomDoc = await Node.findById(roomNodeId);
  if (!roomDoc) throw new Error("Room not found");
  const homeDoc = await Node.findById(userHomeNodeId).select("_id name").lean();
  if (!homeDoc) throw new Error("User home node not found");
  const roomMeta = getRoomMeta(roomDoc) || {};
  if (roomMeta.status === "closed") throw new Error("Room is closed");

  const channelName = roomMeta.channelName || `room-${String(roomNodeId).slice(0, 8)}`;
  const subId = uuidv4();

  // Subscription on the room side, one-way (outbound, room → user).
  await writeSubscription(roomNodeId, {
    _subId: subId,
    channelName,
    partnerId: String(userHomeNodeId),
    partnerName: homeDoc.name || label || "user",
    direction: "outbound",
    filter: null,
    createdAt: new Date().toISOString(),
    createdBy: userId,
    active: true,
    participantType: "user",
  });

  // Mirror on the user's home side so the user can see + leave the room.
  await writeSubscription(userHomeNodeId, {
    _subId: uuidv4(),
    channelName,
    partnerId: String(roomNodeId),
    partnerName: roomDoc.name,
    direction: "inbound",
    filter: null,
    createdAt: new Date().toISOString(),
    createdBy: userId,
    active: true,
    participantType: "user-mirror",
    roomRef: String(roomNodeId),
  });

  await incrementParticipantCount(roomNodeId);
  log.info("Channels", `User ${userId} joined room ${roomNodeId}`);
  return { subId, role: "user" };
}

/**
 * Add a read-only observer. Appears on the room but does not receive
 * delivery (no notifications, no orchestration). Useful for trees that
 * want the room to show in their own channel view without any cost.
 */
export async function addObserverParticipant({ roomNodeId, label, partnerId, userId }) {
  if (!roomNodeId) throw new Error("roomNodeId required");
  const roomDoc = await Node.findById(roomNodeId);
  if (!roomDoc) throw new Error("Room not found");
  const roomMeta = getRoomMeta(roomDoc) || {};

  const subId = uuidv4();
  await writeSubscription(roomNodeId, {
    _subId: subId,
    channelName: roomMeta.channelName || `room-${String(roomNodeId).slice(0, 8)}`,
    partnerId: partnerId || null,
    partnerName: label || "observer",
    direction: "outbound",
    filter: null,
    createdAt: new Date().toISOString(),
    createdBy: userId,
    active: true,
    participantType: "observer",
  });
  await incrementParticipantCount(roomNodeId);
  return { subId, role: "observer" };
}

/**
 * Remove a participant (by _subId). If the participant was user-mirrored
 * on their own home node, also clears the mirror.
 */
export async function removeParticipant({ roomNodeId, subId }) {
  if (!roomNodeId || !subId) throw new Error("roomNodeId and subId required");
  const roomDoc = await Node.findById(roomNodeId);
  if (!roomDoc) return null;
  const meta = _metadata.getExtMeta(roomDoc, "channels");
  const subs = meta.subscriptions || [];
  const idx = subs.findIndex((s) => s._subId === subId);
  if (idx === -1) return null;
  const removed = subs.splice(idx, 1)[0];
  await _metadata.setExtMeta(roomDoc, "channels", meta);

  // If a user participant, strip the mirror on their home node.
  if (removed.participantType === "user" && removed.partnerId) {
    try {
      const homeDoc = await Node.findById(removed.partnerId);
      if (homeDoc) {
        const homeMeta = _metadata.getExtMeta(homeDoc, "channels");
        const homeSubs = homeMeta.subscriptions || [];
        const mirrorIdx = homeSubs.findIndex(
          (s) => s.roomRef === String(roomNodeId) && s.participantType === "user-mirror",
        );
        if (mirrorIdx >= 0) {
          homeSubs.splice(mirrorIdx, 1);
          await _metadata.setExtMeta(homeDoc, "channels", homeMeta);
        }
      }
    } catch (err) {
      log.debug("Channels", `Failed to strip user mirror: ${err.message}`);
    }
  }

  await decrementParticipantCount(roomNodeId);
  return { removed: true, removedType: removed.participantType };
}

async function incrementParticipantCount(roomNodeId) {
  const nodeDoc = await Node.findById(roomNodeId);
  if (!nodeDoc) return;
  const meta = getRoomMeta(nodeDoc) || {};
  meta.participantCount = (meta.participantCount || 0) + 1;
  await setRoomMeta(nodeDoc, meta);
}

async function decrementParticipantCount(roomNodeId) {
  const nodeDoc = await Node.findById(roomNodeId);
  if (!nodeDoc) return;
  const meta = getRoomMeta(nodeDoc) || {};
  meta.participantCount = Math.max(0, (meta.participantCount || 1) - 1);
  await setRoomMeta(nodeDoc, meta);
}

/**
 * User-posted message: entry point for a human writing into the room.
 * Writes the note + fires cascade with the user's identity so agent
 * self-ignore works correctly.
 */
export async function postToRoom({ roomNodeId, content, userId, authorLabel }) {
  if (!roomNodeId) throw new Error("roomNodeId required");
  if (!content || typeof content !== "string") throw new Error("content required");
  const roomDoc = await Node.findById(roomNodeId).select("_id name metadata").lean();
  if (!roomDoc) throw new Error("Room not found");
  const meta = getRoomMeta(roomDoc) || {};
  if (meta.status === "closed") throw new Error("Room is closed");
  if ((meta.postCount || 0) >= (meta.maxMessages || 60)) {
    throw new Error("Room at capacity. Raise maxMessages or archive.");
  }

  const label = authorLabel || `user:${userId}`;
  await postNoteToRoomAs({
    roomNodeId: String(roomNodeId),
    content,
    authorSubId: null, // user posts have no sub to self-ignore against
    authorLabel: label,
    userId,
    signalId: uuidv4(),
    depth: 0,
  });
  return { posted: true, roomId: String(roomNodeId), authorLabel: label };
}

/**
 * Read a room's recent transcript from its notes, chronological, including
 * author metadata so UIs can color-code by participant.
 */
export async function readRoomTranscript({ roomNodeId, limit = 100 }) {
  if (!roomNodeId) throw new Error("roomNodeId required");
  if (!Note) return [];
  const notes = await Note.find({ nodeId: roomNodeId, contentType: "text" })
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();
  return notes.map((n) => ({
    id: String(n._id),
    content: n.content,
    at: n.createdAt,
    wasAi: !!n.wasAi,
    authorSubId: n?.metadata?.room?.authorSubId || null,
    authorLabel: n?.metadata?.room?.authorLabel || null,
    authorUserId: n.userId || null,
  }));
}

/**
 * List all rooms. Optionally scoped to a user's visibility (rooms they
 * created, joined, or that are public under their trees). For now: list
 * every node whose metadata.channels.room is present.
 */
export async function listRooms({ userId } = {}) {
  const filter = { "metadata.channels.room": { $exists: true } };
  // Rough scoping: if userId supplied, limit to rooms whose rootOwner matches,
  // plus rooms the user is a participant in (detected via their home node
  // having a user-mirror subscription). For v1 we keep it permissive.
  const nodes = await Node.find(filter).select("_id name metadata rootOwner parent").lean();
  return nodes.map((n) => {
    const chanMeta = n.metadata instanceof Map ? n.metadata.get("channels") : n.metadata?.channels;
    const roomMeta = chanMeta?.room || null;
    const subs = chanMeta?.subscriptions || [];
    const byType = { agent: 0, user: 0, observer: 0, other: 0 };
    for (const s of subs) {
      const t = s.participantType || "other";
      if (byType[t] !== undefined) byType[t]++;
      else byType.other++;
    }
    return {
      id: String(n._id),
      name: n.name,
      status: roomMeta?.status || "open",
      createdAt: roomMeta?.createdAt,
      createdBy: roomMeta?.createdBy,
      postCount: roomMeta?.postCount || 0,
      maxMessages: roomMeta?.maxMessages || 60,
      lastPostAt: roomMeta?.lastPostAt || null,
      participants: {
        total: subs.length,
        agents: byType.agent,
        users: byType.user,
        observers: byType.observer,
      },
      subscriptions: subs.map((s) => ({
        subId: s._subId,
        type: s.participantType,
        label: s.partnerName || s.agent?.label,
        agentRootId: s.agent?.rootId,
        agentNodeId: s.agent?.nodeId,
        modeHint: s.agent?.modeHint,
      })),
    };
  });
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
