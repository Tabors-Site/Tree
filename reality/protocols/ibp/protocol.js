// IBP — the single dispatcher.
//
// One function handles every IBP call regardless of transport (WS, HTTP,
// CLI, or in-process). Transports translate their shape into a unified
// envelope and call dispatchIbp; the response comes back via the ack
// callback the transport supplies.
//
// Wire shape ([[project_ibp_wire_shape]]):
//
//   { id, verb, address, payload, identity? }
//
//   verb     "see" | "do" | "summon" | "be"
//   address  position / stance / place string
//   payload  per-verb: { live? } for SEE, { action, args } for DO,
//            { op, credentials } for BE, { message, ... } for SUMMON
//   identity caller's JWT-decoded { beingId, name } when applicable
//
// Sync response: returned through the ack callback as
// { id, status: "ok", data } or { id, status: "error", error: {...} }.
// Async updates (SUMMON replies, live SEE patches) arrive on the
// `ibp:update` event keyed by correlation id.
//
// Cross-domain calls flow through canopy: dispatchIbp detects a foreign
// target place, signs the envelope with this place's private key, and
// POSTs to the peer's `/ibp/<verb>/<addr>` endpoint. The peer's
// verifyIncoming middleware authenticates against the RealityPeer registry
// before re-entering dispatchIbp on the receiving side. See
// [[project_canopy_folds_into_ibp]].

import log from "../../seed/parentReality/log.js";
import { handleSee } from "./verbs/see.js";
import { handleDo } from "./verbs/do.js";
import { handleSummon } from "./verbs/summon.js";
import { handleBe } from "./verbs/be.js";
import { parseUnifiedEnvelope, ackError } from "./envelope.js";
import { IBP_ERR, isIbpError } from "../../seed/ibp/protocol.js";
import { getForeignTargetDomain, forwardToPeer } from "../canopy/dispatch.js";

const VERB_HANDLERS = {
  see:    handleSee,
  do:     handleDo,
  summon: handleSummon,
  be:     handleBe,
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
    env = parseUnifiedEnvelope(msg);
  } catch (err) {
    if (isIbpError(err)) {
      return ackError(ack, id, err.code, err.message, err.detail);
    }
    log.error("IBP", `envelope parse failed: ${err.message}`);
    return ackError(ack, id, IBP_ERR.INTERNAL, err.message || "Internal IBP error");
  }

  // 2. Cross-domain check. If the target lives on another place AND this
  //    call didn't already arrive verified from canopy (which would mean
  //    we're the receiving place, not the sender), canopy-sign and forward
  //    to the peer. The local verb handler is skipped.
  if (!carrier?.canopyVerifiedSender) {
    const foreign = getForeignTargetDomain(env.address);
    if (foreign) {
      const peerAck = await forwardToPeer(env);
      if (typeof ack === "function") ack(peerAck);
      return;
    }
  }

  // 3. Local verb handler. Calls into seed primitives (resolver,
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
