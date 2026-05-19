// TreeOS IBP — SUMMON verb handler.
//
// Envelope:
//   { id, stance: "<stance>", identity, message: { from, content,
//     intent, correlation, inReplyTo?, attachments?, sentAt? } }
//
// SUMMON delivers a message to the inbox of the being at the addressed
// stance and wakes them. The protocol layer:
//
//   1. validates the envelope (stance qualified, message shape sane)
//   2. resolves the stance to a (nodeId, being)
//   3. looks up the being in the registry; rejects INVALID_INTENT
//      if the being does not honor the message's intent
//   4. atomically appends to the inbox
//   5. fires the being's summoning per its triggerOn declaration
//   6. for respondMode=sync, holds the ack open until the summoning
//      returns; ACKs immediately for respondMode=async or none

import { randomUUID } from "crypto";
import log from "../../seed/log.js";
import { parseFromSocket, expand, getLandDomain } from "../address.js";
import { resolveStance } from "../resolver.js";
import { PortalError, PORTAL_ERR, isPortalError } from "../errors.js";
import { extractStance, ackOk, ackError } from "../envelope.js";
import { appendToInbox, markInboxConsumed } from "../inbox.js";
import { getRole } from "../roles/registry.js";
import { authorize } from "../authorize.js";
import { getLandRootId } from "../../seed/landRoot.js";
import { getIO } from "../../seed/ws/websocket.js";
import { attachHandoff, wake } from "../scheduler.js";

// intent field retired 2026-05-18. Permissions belong to role identity
// (see memory `role-permissions-not-envelope`); envelopes no longer
// declare chat/place/query/be. Legacy senders may still pass `intent`
// strings — the field is accepted but ignored.

/**
 * Broadcast a SUMMON reply to every socket the asker being has
 * connected. The originating socket may have disconnected during async
 * summoning — other sockets for the same being still see the reply.
 * Falls back to the originating socket when beingId or the io server
 * isn't reachable.
 */
function emitSummon(socket, entry) {
  const beingId = socket?.beingId;
  const io = getIO();
  if (beingId && io) {
    try {
      io.to(`being:${String(beingId)}`).emit("ibp:summon", entry);
      return;
    } catch {}
  }
  try {
    if (socket?.connected) socket.emit("ibp:summon", entry);
  } catch {}
}

export async function handleSummon(socket, msg, ack) {
  const id = msg?.id || null;
  try {
    const stanceString = extractStance(msg, "ibp:summon");
    const message = validateMessage(msg.message);

    const parsed = parseFromSocket(socket, stanceString);
    const expanded = expand(parsed, {
      currentLand: getLandDomain(),
      currentUser: socket.username,
    });
    const resolved = await resolveStance(expanded.right);

    const qualifier = resolved.being;
    if (!qualifier) {
      throw new PortalError(
        PORTAL_ERR.ROLE_UNAVAILABLE,
        "SUMMON requires a stance with an @qualifier",
      );
    }
    if (!resolved.nodeId && resolved.zone === "tree") {
      throw new PortalError(PORTAL_ERR.NODE_NOT_FOUND, "Stance does not resolve to a known node");
    }

    // Resolve the qualifier to a specific Being:
    //   1. Try a direct username lookup (the canonical addressing form,
    //      e.g. @ruler435 or @auth).
    //   2. If not found, treat the qualifier as a role shorthand and
    //      look in metadata.beings.<role>.beingId at the resolved
    //      position — accepts shorthand like @ruler when exactly one
    //      ruler-role being lives at that node.
    const Being = (await import("../../seed/models/being.js")).default;
    let toBeing = await Being.findOne({ username: qualifier });
    if (!toBeing && resolved.nodeId) {
      const Node = (await import("../../seed/models/node.js")).default;
      const targetNode = await Node.findById(resolved.nodeId).select("metadata").lean();
      const emb = targetNode?.metadata instanceof Map
        ? targetNode.metadata.get("beings")
        : targetNode?.metadata?.beings;
      const homeBeingId = emb?.[qualifier]?.beingId || null;
      if (homeBeingId) toBeing = await Being.findById(homeBeingId);
    }
    if (!toBeing) {
      throw new PortalError(
        PORTAL_ERR.ROLE_UNAVAILABLE,
        `No being addressable as "@${qualifier}" at this position`,
      );
    }

    // Resolve the active role for this summon. Three sources, in order:
    //   1. `message.activeRole` from the envelope (caller specifies the
    //      role they want this summon processed in).
    //   2. `toBeing.defaultRole` (the being's default capacity).
    //   3. `qualifier` as a last-resort fallback (useful for role-named
    //      addressing when the being instance hasn't yet had its
    //      defaultRole stamped — e.g. very-early-boot system beings).
    //
    // Strict membership check: if the envelope specifies an activeRole,
    // it MUST be in the being's `roles[]`. Otherwise reject — the
    // sender either knows what they're addressing or they don't; silent
    // fallback hides bugs.
    let activeRole;
    if (message.activeRole) {
      const carriedRoles = Array.isArray(toBeing.roles) ? toBeing.roles : [];
      if (!carriedRoles.includes(message.activeRole)) {
        throw new PortalError(
          PORTAL_ERR.ROLE_UNAVAILABLE,
          `Being @${toBeing.username} does not carry role "${message.activeRole}" ` +
          `(roles: ${carriedRoles.length ? carriedRoles.join(", ") : "none"})`,
        );
      }
      activeRole = message.activeRole;
    } else {
      activeRole = toBeing.defaultRole || qualifier;
    }

    const role = getRole(activeRole);
    if (!role) {
      throw new PortalError(
        PORTAL_ERR.ROLE_UNAVAILABLE,
        `Role template "${activeRole}" for being @${toBeing.username} is not registered`,
      );
    }

    // Stance Authorization gate. Passes `activeRole` so permission
    // rules can vary per role even on the same being.
    const identity = socket.beingId ? { beingId: socket.beingId, username: socket.username } : null;
    const decision = await authorize({
      identity,
      verb: "summon",
      target: { kind: "stance", nodeId: resolved.nodeId, being: activeRole, activeRole },
      intent: message.intent,
    });
    if (!decision.ok) {
      throw new PortalError(
        identity ? PORTAL_ERR.FORBIDDEN : PORTAL_ERR.UNAUTHORIZED,
        `SUMMON denied for stance "${decision.stance}": ${decision.reason}`,
        { stance: decision.stance },
      );
    }

    // Intent-honoring check retired with intent field. Role permissions
    // (declared on the role spec) handle tool-level capability scoping
    // inside the role's summon → runChat call.

    // Inbox writes attach to a real Node. Priority:
    //   1. The resolved position's nodeId (tree zone or specific node)
    //   2. The receiving being's home Node (every being has one)
    //   3. The land root as final fallback for land-zone targets
    const inboxNodeId =
      resolved.nodeId
      || toBeing.homePositionId
      || (resolved.zone === "land" ? getLandRootId() : null);
    if (!inboxNodeId) {
      throw new PortalError(
        PORTAL_ERR.VERB_NOT_SUPPORTED,
        "SUMMON at this stance is not yet wired (no inbox target)",
      );
    }

    // Append to inbox atomically; the receiving being's summoning will
    // read it. Inbox is keyed by the receiver's beingId, not by role
    // type, so multiple beings of the same role at one position get
    // their own delivery queues.
    const recipientBeingId = String(toBeing._id);
    const { messageId, sentAt } = await appendToInbox(inboxNodeId, recipientBeingId, message);

    const summonCtx = {
      nodeId:     inboxNodeId,
      being:      activeRole,                    // legacy field name; carries the active role
      activeRole,                                // canonical: which role is acting in this summon
      toBeing,                                   // the resolved being instance (receiver)
      message:    { ...message, correlation: messageId, sentAt, activeRole },
      resolved,
      identity:   { beingId: socket.beingId, username: socket.username },
    };

    // Sync respond-mode: run summoning inline, ACK with the response.
    if (role.respondMode === "sync") {
      let responseEntry = null;
      if (role.triggerOn.includes("message")) {
        responseEntry = await runSummoning(role, summonCtx);
      }
      await markInboxConsumed(
        inboxNodeId,
        recipientBeingId,
        [messageId],
        {
          responseId: responseEntry?.correlation || null,
          summonId:     responseEntry?.summonId || null,
        },
      );
      if (!responseEntry) {
        return ackOk(ack, id, { status: "accepted", messageId });
      }
      return ackOk(ack, id, responseEntry);
    }

    // Async respond-mode: ACK accepted immediately, hand the summoning
    // off to the per-being scheduler. The scheduler serializes Summons
    // for this being (no two run concurrently), enforces priority order
    // on each pull, and exposes an AbortController so role templates
    // can interrupt. The response is pushed to the sender's socket via
    // `ibp:summon` when summoning completes — and errors land on
    // the same channel so the client can render an inline error bubble.
    if (role.respondMode === "async") {
      ackOk(ack, id, { status: "accepted", messageId });
      const responseFromStance = `${pathOfResolved(resolved)}@${beingName}`;
      attachHandoff(recipientBeingId, messageId, {
        identity:           summonCtx.identity,
        resolved,
        responseFromStance,
        onResponse: (responseEntry) => {
          emitSummon(socket, responseEntry);
        },
        onError: (err) => {
          emitSummon(socket, {
            from:        responseFromStance,
            content:     `[${err.code || "error"}] ${err.message || "summoning failed"}`,
            intent:      "chat",
            correlation: randomUUID(),
            inReplyTo:   messageId,
            sentAt:      new Date().toISOString(),
            error:       true,
          });
        },
      });
      wake(recipientBeingId, inboxNodeId);
      return;
    }

    // none: ACK accepted; nothing else to do.
    await markInboxConsumed(inboxNodeId, recipientBeingId, [messageId]);
    return ackOk(ack, id, { status: "accepted", messageId });
  } catch (err) {
    if (isPortalError(err)) {
      return ackError(ack, id, err.code, err.message, err.detail);
    }
    log.error("IBP", `ibp:summon failed: ${err.message}`);
    return ackError(ack, id, PORTAL_ERR.INTERNAL, err.message || "Internal portal error");
  }
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function validateMessage(message) {
  if (!message || typeof message !== "object") {
    throw new PortalError(PORTAL_ERR.INVALID_INPUT, "SUMMON requires a `message` object");
  }
  if (typeof message.from !== "string" || !message.from.length) {
    throw new PortalError(PORTAL_ERR.INVALID_INPUT, "`message.from` is required");
  }
  if (!/@[a-z][a-z0-9-]*$/i.test(message.from)) {
    throw new PortalError(
      PORTAL_ERR.INVALID_INPUT,
      "`message.from` must be a qualified stance (position@being)",
    );
  }
  if (message.content === undefined || message.content === null) {
    throw new PortalError(PORTAL_ERR.INVALID_INPUT, "`message.content` is required");
  }
  return message;
}

async function runSummoning(role, ctx) {
  let result;
  try {
    result = await role.summon(ctx.message, ctx);
  } catch (err) {
    log.error("IBP", `being "${ctx.being}" summoning errored: ${err.message}`);
    throw new PortalError(PORTAL_ERR.LLM_FAILED, `Summoning failed: ${err.message}`);
  }
  if (!result || typeof result !== "object") {
    return null; // no-response or place-intent
  }
  // The being returned a response. Build a response envelope, write
  // it to the sender's inbox-equivalent, and return it for sync delivery.
  // `summonId` (when the being routed through runChat) propagates so
  // the caller's markInboxConsumed can stamp the consumed inbox entry
  // with a pointer to the Chat record this message became.
  const responseCorrelation = randomUUID();
  return {
    from:        `${ctx.resolved.being ? `${pathOfResolved(ctx.resolved)}@${ctx.being}` : ctx.being}`,
    content:     result.content,
    intent:      result.intent || ctx.message.intent,
    correlation: responseCorrelation,
    inReplyTo:   ctx.message.correlation,
    sentAt:      new Date().toISOString(),
    summonId:      result.summonId || null,
  };
}

function pathOfResolved(resolved) {
  if (resolved.pathByNames) return `${getLandDomain()}${resolved.pathByNames}`;
  if (resolved.zone === "land") return `${getLandDomain()}/`;
  return `${getLandDomain()}/`;
}
