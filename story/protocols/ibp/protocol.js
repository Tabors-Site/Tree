// IBP — the single dispatcher.
//
// One function handles every IBP call regardless of transport (WS, HTTP,
// CLI, or in-process). Transports translate their shape into a unified
// envelope and call dispatchIbp; the response comes back via the ack
// callback the transport supplies.
//
// Wire shape:
//
//   { id, verb, address, payload, identity? }
//
//   verb     "see" | "do" | "summon" | "be"
//   address  position / stance / place string
//   payload  per-verb: { live? } for SEE, { act, args } for DO,
//            { act, credentials } for BE, { message, ... } for SUMMON
//   identity caller's JWT-decoded { beingId, name } when applicable
//
// Sync response: returned through the ack callback as
// { id, status: "ok", data } or { id, status: "error", error: {...} }.
// Async updates (SUMMON replies, live SEE patches) arrive on the
// `ibp:update` event keyed by correlation id.
//
// Cross-domain calls flow through canopy: dispatchIbp detects a foreign
// target place, signs the envelope with this story's private key, and
// POSTs to the peer's `/ibp/<verb>/<addr>` endpoint. The peer's
// verifyIncoming middleware authenticates against the StoryPeer registry
// before re-entering dispatchIbp on the receiving side.
//

import log from "../../seed/seedStory/log.js";
import { handleSee } from "./verbs/see.js";
import { handleDo } from "./verbs/do.js";
import { handleCall } from "./verbs/call.js";
import { handleBe } from "./verbs/be.js";
import { handleType } from "./verbs/type.js";
import { parseUnifiedEnvelope, ackError } from "./envelope.js";
import { IBP_ERR, isIbpError } from "../../seed/ibp/protocol.js";
import { getForeignTargetDomain, forwardToPeer } from "./canopy.js";

const VERB_HANDLERS = {
  see:    handleSee,
  do:     handleDo,
  call: handleCall,
  be:     handleBe,
  type:   handleType,
};

/**
 * The IBP dispatcher. Every transport ends here.
 *
 * @param {object} carrier  socket-shaped object carrying caller context
 *                          (beingId, name, canopyVerifiedSender, etc.).
 *                          Real socket on WS; minimal stub on HTTP/CLI.
 * @param {object} msg      raw envelope from the transport
 * @param {Function} ack    response sink: socket.io ack on WS,
 *                          response-translating fn on HTTP
 */
export async function dispatchIbp(carrier, msg, ack) {
  const id = msg?.id || null;

  // 1. Parse + validate the envelope against the per-verb address contract.
  let env;
  try {
    env = await parseUnifiedEnvelope(msg);
  } catch (err) {
    if (isIbpError(err)) {
      return ackError(ack, id, err.code, err.message, err.detail);
    }
    log.error("IBP", `envelope parse failed: ${err.message}`);
    return ackError(ack, id, IBP_ERR.INTERNAL, err.message || "Internal IBP error");
  }

  // 2. Cross-story OUTBOUND. If the target lives on another story
  //    AND this call didn't already arrive verified from canopy, route
  //    through crossStoryDispatch: opens a local Act for the actor's
  //    attempt, forwards via canopy with the actor's identity tuple,
  //    applies the peer's response back to the Act (status transition +
  //    inner face attachment). See seed/CROSS-WORLD.md.
  if (!carrier?.canopyVerifiedSender && env.addressKind !== "see-op") {
    const foreign = getForeignTargetDomain(env.address);
    if (foreign) {
      // Caller's home identity. beingId from the carrier; history from
      // the carrier's currentHistory (the actor's home world). Without
      // a beingId we can't open a local Act, so we fall back to a
      // bare forward (anonymous SEE etc.) which doesn't attach to any
      // Act on this side.
      const actorBeingId = carrier?.beingId || null;
      const actorHistory = carrier?.currentHistory || "0";
      // The NAME the actor signs as (carrier-only, never client payload). It
      // is what a foreign story verifies the cross-world deed against.
      const actorNameId = carrier?.nameId || null;
      if (actorBeingId) {
        try {
          const { crossStoryDispatch } = await import(
            "../../seed/ibp/crossWorld.js"
          );
          const { peerAck } = await crossStoryDispatch({
            envelope: env,
            // `branch` tuple key carries the actor's home HISTORY — kept
            // as `branch` because seed/ibp/crossWorld.js reads actor.branch
            // across the cross-world Act-chain (SEAM: rename in lockstep).
            actor: { beingId: actorBeingId, branch: actorHistory, nameId: actorNameId },
            identity: { beingId: actorBeingId, name: carrier?.name || null, nameId: actorNameId },
          });
          if (typeof ack === "function") ack(peerAck);
          return;
        } catch (err) {
          log.error("IBP", `crossStoryDispatch failed: ${err.message}`);
          return ackError(ack, id, IBP_ERR.INTERNAL,
            `cross-story dispatch failed: ${err.message}`);
        }
      }
      // Anonymous / no-identity caller: forward without opening an Act.
      const peerAck = await forwardToPeer(env);
      if (typeof ack === "function") ack(peerAck);
      return;
    }
  }

  // 3. Cross-story INBOUND. A verified canopy request carries the
  //    foreign actor's identity tuple on the carrier. Run the verb
  //    under a synthetic moment that represents the foreign actor;
  //    emitFact stamps any local facts with crossOrigin pointing back
  //    at the home substrate. The response embeds the local
  //    descriptor as the actor's inner face. See seed/CROSS-WORLD.md.
  if (carrier?.crossWorldActor) {
    try {
      const { runVerbAsForeignActor } = await import(
        "../../seed/ibp/crossWorld.js"
      );
      const { descriptor } = await runVerbAsForeignActor({
        verb: env.verb,
        address: env.address,
        payload: env.payload,
        actor: carrier.crossWorldActor,
        carrier,
      });
      if (typeof ack === "function") {
        ack({ id, status: "ok", data: { descriptor } });
      }
      return;
    } catch (err) {
      log.error("IBP", `runVerbAsForeignActor failed: ${err.message}`);
      return ackError(ack, id, IBP_ERR.INTERNAL,
        `cross-story inbound failed: ${err.message}`);
    }
  }

  // 4. Local verb handler. Calls into seed primitives (resolver,
  //    descriptor, authorize, scheduler, operations registry) and acks.
  const handler = VERB_HANDLERS[env.verb];
  return handler(carrier, env, ack);
}

/**
 * Wire dispatchIbp onto every new socket.io connection. Called once
 * by initIBPWS in index.js.
 */
export function attachIbpHandlers(io) {
  io.on("connection", (socket) => {
    socket.on("ibp", (msg, ack) => dispatchIbp(socket, msg, ack));
  });
  log.info("IBP", "WebSocket dispatcher attached");
}
