// IBP (Inter-Being Protocol): WebSocket op registration.
//
// IBP exposes four ops on the Socket.IO instance:
//
//   ibp:see     observe an address (one-shot or live)
//   ibp:do      mutate the world at an address
//   ibp:summon  deliver a message to a being's inbox and wake them
//   ibp:be      manage be-er identity
//
// See portal/docs/protocol.md for the conceptual model and
// portal/docs/server-protocol.md for wire-level rules.
//
// Envelope address field is named per verb:
//   ibp:see     { id, position OR stance, identity?, live? }
//   ibp:do      { id, position OR stance, action, payload, identity }
//   ibp:summon  { id, stance, message, identity }
//   ibp:be      { id, operation, land, payload?, identity? }
//
// All four IBP verbs are wired: SEE, DO, SUMMON, BE.

import log from "../seed/log.js";
import { handleSee } from "./verbs/see.js";
import { handleDo } from "./verbs/do.js";
import { handleSummon } from "./verbs/summon.js";
import { handleBe } from "./verbs/be.js";

function registerSocketHandlers(socket) {
  socket.on("ibp:see",    (msg, ack) => handleSee(socket, msg, ack));
  socket.on("ibp:do",     (msg, ack) => handleDo(socket, msg, ack));
  socket.on("ibp:summon", (msg, ack) => handleSummon(socket, msg, ack));
  socket.on("ibp:be",     (msg, ack) => handleBe(socket, msg, ack));
}

/**
 * Hook portal handlers onto every new socket connection.
 * Called by initIBPWS in index.js.
 */
export function attachPortalHandlers(io) {
  io.on("connection", (socket) => {
    registerSocketHandlers(socket);
  });
  log.info("IBP", "IBP attached (ibp:see, ibp:do, ibp:summon, ibp:be wired)");
}
