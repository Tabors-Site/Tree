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
import { getLandRootId } from "../../seed/landRoot.js";

const VALID_INTENTS = new Set(["chat", "place", "query", "be"]);

export async function handleTalk(socket, msg, ack) {
  const id = msg?.id || null;
  try {
    const stanceString = extractStance(msg, "ibp:talk");
    const message = validateMessage(msg.message);

    const parsed = parseFromSocket(socket, stanceString);
    const expanded = expand(parsed, {
      currentLand: getLandDomain(),
      currentUser: socket.username,
    });
    const resolved = await resolveStance(expanded.right);

    const qualifier = resolved.embodiment;
    if (!qualifier) {
      throw new PortalError(
        PORTAL_ERR.EMBODIMENT_UNAVAILABLE,
        "TALK requires a stance with an @qualifier",
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
        : targetNode?.metadata?.embodiments;
      const homeBeingId = emb?.[qualifier]?.beingId || null;
      if (homeBeingId) toBeing = await Being.findById(homeBeingId);
    }
    if (!toBeing) {
      throw new PortalError(
        PORTAL_ERR.EMBODIMENT_UNAVAILABLE,
        `No being addressable as "@${qualifier}" at this position`,
      );
    }

    // Behavior comes from the role template registered in
    // embodiments/registry.js. Identity (homePositionId, llmSlot,
    // history) lives on the Being instance.
    const embodimentName = toBeing.role || qualifier;
    const embodiment = getEmbodiment(embodimentName);
    if (!embodiment) {
      throw new PortalError(
        PORTAL_ERR.EMBODIMENT_UNAVAILABLE,
        `Role template "${embodimentName}" for being @${toBeing.username} is not registered`,
      );
    }

    // Stance Authorization gate.
    const identity = socket.beingId ? { beingId: socket.beingId, username: socket.username } : null;
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
        "TALK at this stance is not yet wired (no inbox target)",
      );
    }

    // Append to inbox atomically; the embodiment will read it on summoning.
    const { messageId, sentAt } = await appendToInbox(inboxNodeId, embodimentName, message);

    const summonCtx = {
      nodeId:     inboxNodeId,
      embodiment: embodimentName,
      toBeing,                                  // the resolved being instance (receiver)
      message:    { ...message, correlation: messageId, sentAt },
      resolved,
      identity:   { beingId: socket.beingId, username: socket.username },
    };

    // Sync respond-mode: run summoning inline, ACK with the response.
    if (embodiment.respondMode === "sync") {
      let responseEntry = null;
      if (embodiment.triggerOn.includes("message")) {
        responseEntry = await runSummoning(embodiment, summonCtx);
      }
      await markInboxConsumed(
        inboxNodeId,
        embodimentName,
        [messageId],
        responseEntry?.correlation || null,
      );
      if (!responseEntry) {
        return ackOk(ack, id, { status: "accepted", messageId });
      }
      return ackOk(ack, id, responseEntry);
    }

    // Async respond-mode: ACK accepted immediately, run summoning in
    // the background, and push the response to the sender's socket via
    // `ibp:talk-reply` when it lands. Errors are surfaced through the
    // same channel so the client can render an inline error bubble.
    if (embodiment.respondMode === "async") {
      ackOk(ack, id, { status: "accepted", messageId });
      runSummoning(embodiment, summonCtx)
        .then(async (responseEntry) => {
          try {
            await markInboxConsumed(
              inboxNodeId,
              embodimentName,
              [messageId],
              responseEntry?.correlation || null,
            );
          } catch (err) {
            log.warn("Portal", `markInboxConsumed failed: ${err.message}`);
          }
          if (responseEntry && socket.connected) {
            socket.emit("ibp:talk-reply", responseEntry);
          }
        })
        .catch((err) => {
          log.error("Portal", `async summoning failed: ${err.message}`);
          if (socket.connected) {
            socket.emit("ibp:talk-reply", {
              from:        `${pathOfResolved(resolved)}@${embodimentName}`,
              content:     `[${err.code || "error"}] ${err.message || "summoning failed"}`,
              intent:      "chat",
              correlation: randomUUID(),
              inReplyTo:   messageId,
              sentAt:      new Date().toISOString(),
              error:       true,
            });
          }
        });
      return;
    }

    // none: ACK accepted; nothing else to do.
    await markInboxConsumed(inboxNodeId, embodimentName, [messageId], null);
    return ackOk(ack, id, { status: "accepted", messageId });
  } catch (err) {
    if (isPortalError(err)) {
      return ackError(ack, id, err.code, err.message, err.detail);
    }
    log.error("Portal", `ibp:talk failed: ${err.message}`);
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
