// IBP (Inter-Being Protocol): WebSocket op registration.
//
// IBP exposes four ops on the Socket.IO instance:
//
//   ibp:see   observe an address (one-shot or live)
//   ibp:do    mutate the world at an address
//   ibp:talk  deliver a message to a being's inbox
//   ibp:be    manage be-er identity
//
// See portal/docs/protocol.md for the conceptual model and
// portal/docs/server-protocol.md for wire-level rules.
//
// Envelope address field is named per verb:
//   ibp:see   { id, position OR stance, identity?, live? }
//   ibp:do    { id, position OR stance, action, payload, identity }
//   ibp:talk  { id, stance, message, identity }
//   ibp:be    { id, operation, land, payload?, identity? }
//
// All four IBP verbs are wired: SEE, DO, TALK, BE.

import log from "../seed/log.js";
import { handleSee } from "./verbs/see.js";
import { handleDo } from "./verbs/do.js";
import { handleTalk } from "./verbs/talk.js";
import { handleBe } from "./verbs/be.js";

function registerSocketHandlers(socket) {
  socket.on("ibp:see",  (msg, ack) => handleSee(socket, msg, ack));
  socket.on("ibp:do",   (msg, ack) => handleDo(socket, msg, ack));
  socket.on("ibp:talk", (msg, ack) => handleTalk(socket, msg, ack));
  socket.on("ibp:be",   (msg, ack) => handleBe(socket, msg, ack));
}

/**
 * Hook portal handlers onto every new socket connection.
 * Called by initPortalWs in index.js.
 */
export function attachPortalHandlers(io) {
  io.on("connection", (socket) => {
    registerSocketHandlers(socket);
  });
  log.info("IBP", "IBP attached (ibp:see, ibp:do, ibp:talk, ibp:be wired)");
}
