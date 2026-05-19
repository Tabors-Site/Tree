// TreeOS IBP — SUMMON verb handler.
//
// Consumes the unified envelope per [[project_ibp_wire_shape]]:
//
//   { id, verb: "summon", address (stance), payload: { message, ...threading }, identity? }
//
// `payload.message` is the inbox payload: `{ from, content, intent?,
// correlation?, inReplyTo?, attachments?, sentAt? }`. Threading fields
// (`from`, `inReplyTo`, `rootCorrelation`, `priority`, `activeRole`) may
// live at the top level of payload OR inside payload.message.
//
// The handler:
//   1. validates the envelope (stance shape, message shape)
//   2. resolves the stance to (nodeId, being)
//   3. looks up the receiving being + active role
//   4. atomically appends to the inbox
//   5. fires the being's summoning per its triggerOn declaration
//   6. for respondMode=sync, holds the ack open until summoning returns;
//      for async, ACKs immediately and emits the reply later via
//      `ibp:update` on the sender's being-room.

import { randomUUID } from "crypto";
import log from "../../seed/log.js";
import { parseFromSocket, expand, getLandDomain } from "../address.js";
import { resolveStance } from "../resolver.js";
import { PortalError, PORTAL_ERR, isPortalError } from "../errors.js";
import { ackOk, ackError } from "../envelope.js";
import { appendToInbox, markInboxConsumed } from "../inbox.js";
import { getRole } from "../roles/registry.js";
import { authorize } from "../authorize.js";
import { getLandRootId } from "../../seed/landRoot.js";
import { getIO } from "../../seed/ws/websocket.js";
import { attachHandoff, wake } from "../scheduler.js";

/**
 * Broadcast an out-of-band IBP update (e.g. a SUMMON reply) to every
 * socket the asker being has connected. Falls back to the originating
 * socket when beingId or io aren't available.
 *
 * The wire shape is `{ correlation, content }` per
 * [[project_protocol_transport_separation]]. `content` carries the
 * inbox entry that was just delivered (full reply); `correlation`
 * matches whatever the client routes against (the rootCorrelation or
 * the inReplyTo, whichever the client tracked).
 */
function emitUpdate(socket, entry) {
  const update = {
    correlation: entry?.inReplyTo || entry?.correlation || null,
    content:     entry,
  };
  const beingId = socket?.beingId;
  const io = getIO();
  if (beingId && io) {
    try {
      io.to(`being:${String(beingId)}`).emit("ibp:update", update);
      return;
    } catch {}
  }
  try {
    if (socket?.connected) socket.emit("ibp:update", update);
  } catch {}
}

export async function handleSummon(socket, env, ack) {
  const id = env?.id || null;
  try {
    const { address, payload } = env;
    const message = validateMessage(payload?.message);

    const parsed = parseFromSocket(socket, address);
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
    //   1. Direct username lookup (canonical: @ruler435, @auth)
    //   2. Role shorthand at the resolved position via metadata.beings.<role>.beingId
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

    // Resolve activeRole. Three sources, in order:
    //   1. message.activeRole or payload.activeRole (envelope-specified)
    //   2. toBeing.defaultRole
    //   3. qualifier (last-resort fallback)
    //
    // Strict membership check: envelope-specified activeRole MUST be in
    // the being's roles[]. Silent fallback hides bugs.
    let activeRole;
    const envelopeRole = message.activeRole || payload.activeRole || null;
    if (envelopeRole) {
      const carriedRoles = Array.isArray(toBeing.roles) ? toBeing.roles : [];
      if (!carriedRoles.includes(envelopeRole)) {
        throw new PortalError(
          PORTAL_ERR.ROLE_UNAVAILABLE,
          `Being @${toBeing.username} does not carry role "${envelopeRole}" ` +
          `(roles: ${carriedRoles.length ? carriedRoles.join(", ") : "none"})`,
        );
      }
      activeRole = envelopeRole;
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

    // Stance Authorization gate.
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

    // Resolve inbox-attach node.
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
          summonId:   responseEntry?.summonId || null,
        },
      );
      if (!responseEntry) {
        return ackOk(ack, id, { status: "accepted", messageId });
      }
      return ackOk(ack, id, responseEntry);
    }

    // Async respond-mode: ACK accepted immediately; per-being scheduler
    // serializes summonings. Reply arrives later via `ibp:update` on the
    // sender's being-room.
    if (role.respondMode === "async") {
      ackOk(ack, id, { status: "accepted", messageId });
      const responseFromStance = `${pathOfResolved(resolved)}@${toBeing.username}`;
      attachHandoff(recipientBeingId, messageId, {
        identity:           summonCtx.identity,
        resolved,
        responseFromStance,
        onResponse: (responseEntry) => emitUpdate(socket, responseEntry),
        onError: (err) => emitUpdate(socket, {
          from:        responseFromStance,
          content:     `[${err.code || "error"}] ${err.message || "summoning failed"}`,
          intent:      "chat",
          correlation: randomUUID(),
          inReplyTo:   messageId,
          sentAt:      new Date().toISOString(),
          error:       true,
        }),
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
    log.error("IBP", `ibp SUMMON failed: ${err.message}`);
    return ackError(ack, id, PORTAL_ERR.INTERNAL, err.message || "Internal portal error");
  }
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function validateMessage(message) {
  if (!message || typeof message !== "object") {
    throw new PortalError(PORTAL_ERR.INVALID_INPUT, "SUMMON payload must include a `message` object");
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
  const responseCorrelation = randomUUID();
  return {
    from:        `${ctx.resolved.being ? `${pathOfResolved(ctx.resolved)}@${ctx.toBeing.username}` : ctx.being}`,
    content:     result.content,
    intent:      result.intent || ctx.message.intent,
    correlation: responseCorrelation,
    inReplyTo:   ctx.message.correlation,
    sentAt:      new Date().toISOString(),
    summonId:    result.summonId || null,
  };
}

function pathOfResolved(resolved) {
  if (resolved.pathByNames) return `${getLandDomain()}${resolved.pathByNames}`;
  if (resolved.zone === "land") return `${getLandDomain()}/`;
  return `${getLandDomain()}/`;
}
