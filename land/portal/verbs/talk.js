// TreeOS IBP — TALK verb handler.
//
// Envelope:
//   { id, stance: "<stance>", identity, message: { from, content,
//     intent, correlation, inReplyTo?, attachments?, sentAt? } }
//
// TALK delivers a message to the inbox of the being at the addressed
// stance and triggers a summoning. The protocol layer:
//
//   1. validates the envelope (stance qualified, message shape sane)
//   2. resolves the stance to a (nodeId, embodiment)
//   3. looks up the embodiment in the registry; rejects INVALID_INTENT
//      if the embodiment does not honor the message's intent
//   4. atomically appends to the inbox
//   5. fires the embodiment's summoning per its triggerOn declaration
//   6. for respondMode=sync, holds the ack open until the summoning
//      returns; ACKs immediately for respondMode=async or none
//
// Phase 4 implements sync respond-mode end-to-end with the `echo`
// embodiment. Async respond-mode lands in Phase 6.

import { randomUUID } from "crypto";
import log from "../../seed/log.js";
import { parseFromSocket, expand, getLandDomain } from "../address.js";
import { resolveStance } from "../resolver.js";
import { PortalError, PORTAL_ERR, isPortalError } from "../errors.js";
import { extractStance, ackOk, ackError } from "../envelope.js";
import { appendToInbox, markInboxConsumed } from "../inbox.js";
import { getEmbodiment } from "../embodiments/registry.js";
import { authorize } from "../authorize.js";

const VALID_INTENTS = new Set(["chat", "place", "query", "be"]);

export async function handleTalk(socket, msg, ack) {
  const id = msg?.id || null;
  try {
    const stanceString = extractStance(msg, "portal:talk");
    const message = validateMessage(msg.message);

    const parsed = parseFromSocket(socket, stanceString);
    const expanded = expand(parsed, {
      currentLand: getLandDomain(),
      currentUser: socket.username,
    });
    const resolved = await resolveStance(expanded.right);

    const embodimentName = resolved.embodiment;
    if (!embodimentName) {
      throw new PortalError(
        PORTAL_ERR.EMBODIMENT_UNAVAILABLE,
        "TALK requires a stance with an @embodiment qualifier",
      );
    }
    if (!resolved.nodeId && resolved.zone === "tree") {
      throw new PortalError(PORTAL_ERR.NODE_NOT_FOUND, "Stance does not resolve to a known node");
    }

    const embodiment = getEmbodiment(embodimentName);
    if (!embodiment) {
      throw new PortalError(
        PORTAL_ERR.EMBODIMENT_UNAVAILABLE,
        `Embodiment "${embodimentName}" is not registered on this land`,
      );
    }

    // Stance Authorization gate.
    const identity = socket.userId ? { userId: socket.userId, username: socket.username } : null;
    const decision = await authorize({
      identity,
      verb: "talk",
      target: { kind: "stance", nodeId: resolved.nodeId, embodiment: embodimentName },
      intent: message.intent,
    });
    if (!decision.ok) {
      throw new PortalError(
        identity ? PORTAL_ERR.FORBIDDEN : PORTAL_ERR.UNAUTHORIZED,
        `TALK denied for stance "${decision.stance}": ${decision.reason}`,
        { stance: decision.stance },
      );
    }

    if (!embodiment.honoredIntents.includes(message.intent)) {
      throw new PortalError(
        PORTAL_ERR.INVALID_INTENT,
        `Embodiment "${embodimentName}" does not honor intent "${message.intent}"`,
        { honoredIntents: embodiment.honoredIntents },
      );
    }

    // Inbox writes only make sense on a real node. The home- and land-zone
    // cases are out of scope for Phase 4 (no nodeId to attach to).
    const inboxNodeId = resolved.nodeId || resolved.userId;
    if (!inboxNodeId) {
      throw new PortalError(
        PORTAL_ERR.VERB_NOT_SUPPORTED,
        "TALK at this stance is not yet wired (no inbox target)",
      );
    }

    // Append to inbox atomically; the embodiment will read it on summoning.
    const { messageId, sentAt } = await appendToInbox(inboxNodeId, embodimentName, message);

    // Summon the embodiment. Phase 4: only triggerOn "message" is honored.
    let responseEntry = null;
    if (embodiment.triggerOn.includes("message")) {
      responseEntry = await runSummoning(embodiment, {
        nodeId:    inboxNodeId,
        embodiment: embodimentName,
        message:    { ...message, correlation: messageId, sentAt },
        resolved,
        identity:   { userId: socket.userId, username: socket.username },
      });
    }

    // Mark the message consumed (whether or not the summoning produced
    // a response). The response correlation, if any, is linked.
    await markInboxConsumed(
      inboxNodeId,
      embodimentName,
      [messageId],
      responseEntry?.correlation || null,
    );

    // Per respondMode:
    if (embodiment.respondMode === "sync") {
      if (!responseEntry) {
        return ackOk(ack, id, { status: "accepted", messageId });
      }
      return ackOk(ack, id, responseEntry);
    }
    // async / none: ACK accepted; the response, if any, lands later (Phase 6).
    return ackOk(ack, id, { status: "accepted", messageId });
  } catch (err) {
    if (isPortalError(err)) {
      return ackError(ack, id, err.code, err.message, err.detail);
    }
    log.error("Portal", `portal:talk failed: ${err.message}`);
    return ackError(ack, id, PORTAL_ERR.INTERNAL, err.message || "Internal portal error");
  }
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function validateMessage(message) {
  if (!message || typeof message !== "object") {
    throw new PortalError(PORTAL_ERR.INVALID_INPUT, "TALK requires a `message` object");
  }
  if (!message.intent || !VALID_INTENTS.has(message.intent)) {
    throw new PortalError(
      PORTAL_ERR.INVALID_INPUT,
      "`message.intent` must be one of: chat, place, query, be",
    );
  }
  if (typeof message.from !== "string" || !message.from.length) {
    throw new PortalError(PORTAL_ERR.INVALID_INPUT, "`message.from` is required");
  }
  if (!/@[a-z][a-z0-9-]*$/i.test(message.from)) {
    throw new PortalError(
      PORTAL_ERR.INVALID_INPUT,
      "`message.from` must be a qualified stance (position@embodiment)",
    );
  }
  if (message.content === undefined || message.content === null) {
    throw new PortalError(PORTAL_ERR.INVALID_INPUT, "`message.content` is required");
  }
  return message;
}

async function runSummoning(embodiment, ctx) {
  let result;
  try {
    result = await embodiment.summon(ctx.message, ctx);
  } catch (err) {
    log.error("Portal", `embodiment "${ctx.embodiment}" summoning errored: ${err.message}`);
    throw new PortalError(PORTAL_ERR.LLM_FAILED, `Summoning failed: ${err.message}`);
  }
  if (!result || typeof result !== "object") {
    return null; // no-response or place-intent
  }
  // The embodiment returned a response. Build a response envelope, write
  // it to the sender's inbox-equivalent, and return it for sync delivery.
  const responseCorrelation = randomUUID();
  return {
    from:        `${ctx.resolved.embodiment ? `${pathOfResolved(ctx.resolved)}@${ctx.embodiment}` : ctx.embodiment}`,
    content:     result.content,
    intent:      result.intent || ctx.message.intent,
    correlation: responseCorrelation,
    inReplyTo:   ctx.message.correlation,
    sentAt:      new Date().toISOString(),
  };
}

function pathOfResolved(resolved) {
  if (resolved.pathByNames) return `${getLandDomain()}${resolved.pathByNames}`;
  if (resolved.zone === "land") return `${getLandDomain()}/`;
  return `${getLandDomain()}/`;
}
