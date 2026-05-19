// IBP (Inter-Being Protocol): WebSocket dispatch.
//
// Per [[project_ibp_wire_shape]] + [[project_protocol_transport_separation]],
// the canonical wire shape is ONE event carrying a unified envelope:
//
//   socket.emit("ibp", { id, verb, address, payload, identity? }, ackCallback)
//
// `verb`     one of "see", "do", "summon", "be"
// `address`  the canonical position / stance / land string
// `payload`  operation-specific data (action+args for DO, op+credentials
//            for BE, message+threading for SUMMON, options for SEE)
//
// The synchronous response is delivered via the socket.io ack callback.
// Async out-of-band updates (SUMMON replies, live SEE patches) arrive
// via the `ibp:update` event keyed by correlation id.
//
// The same dispatcher serves WebSocket and HTTP transports — see
// dispatchIbp() in this file; the HTTP adapter (../routes/api/ibp.js)
// wraps it for express req/res.

import log from "../seed/log.js";
import { handleSee } from "./verbs/see.js";
import { handleDo } from "./verbs/do.js";
import { handleSummon } from "./verbs/summon.js";
import { handleBe } from "./verbs/be.js";
import { parseUnifiedEnvelope, ackError } from "./envelope.js";
import { PORTAL_ERR, isPortalError } from "./errors.js";

const VERB_HANDLERS = {
  see:    handleSee,
  do:     handleDo,
  summon: handleSummon,
  be:     handleBe,
};

/**
 * Core IBP dispatcher. Used by every transport (WS + HTTP + CLI).
 *
 * Validates the envelope, looks up the verb handler, and runs it. The
 * handler receives the parsed envelope and the optional `socket`
 * (present for WS; the HTTP adapter constructs a minimal socket-shaped
 * carrier with `beingId` + `username` from the JWT).
 *
 * The ack callback is the transport's response sink: socket.io ack for
 * WS, an HTTP-response-translating function for HTTP. Either way the
 * handler calls it with the same `{ id, status, data | error }` shape.
 */
export async function dispatchIbp(socket, msg, ack) {
  const id = msg?.id || null;
  let env;
  try {
    env = parseUnifiedEnvelope(msg);
  } catch (err) {
    if (isPortalError(err)) {
      return ackError(ack, id, err.code, err.message, err.detail);
    }
    log.error("IBP", `envelope parse failed: ${err.message}`);
    return ackError(ack, id, PORTAL_ERR.INTERNAL, err.message || "Internal portal error");
  }

  const handler = VERB_HANDLERS[env.verb];
  return handler(socket, env, ack);
}

function registerSocketHandlers(socket) {
  socket.on("ibp", (msg, ack) => dispatchIbp(socket, msg, ack));
}

/**
 * Hook the IBP handler onto every new socket connection.
 * Called by initIBPWS in index.js.
 */
export function attachPortalHandlers(io) {
  io.on("connection", (socket) => {
    registerSocketHandlers(socket);
  });
  log.info("IBP", "IBP attached (unified `ibp` event)");
}
