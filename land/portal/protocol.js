// IBP (Inter-Being Protocol): WebSocket op registration.
//
// IBP exposes four ops on the Socket.IO instance:
//
//   portal:see   observe an address (one-shot or live)
//   portal:do    mutate the world at an address
//   portal:talk  deliver a message to a being's inbox
//   portal:be    manage be-er identity
//
// See portal/docs/protocol.md for the conceptual model and
// portal/docs/server-protocol.md for wire-level rules.
//
// Envelope address field is named per verb:
//   portal:see   { id, position OR stance, identity?, live? }
//   portal:do    { id, position OR stance, action, payload, identity }
//   portal:talk  { id, stance, message, identity }
//   portal:be    { id, operation, land, payload?, identity? }
//
// All four IBP verbs are wired: SEE, DO, TALK, BE.

import log from "../seed/log.js";
import { handleSee } from "./verbs/see.js";
import { handleDo } from "./verbs/do.js";
import { handleTalk } from "./verbs/talk.js";
import { handleBe } from "./verbs/be.js";

function registerSocketHandlers(socket) {
  socket.on("portal:see",  (msg, ack) => handleSee(socket, msg, ack));
  socket.on("portal:do",   (msg, ack) => handleDo(socket, msg, ack));
  socket.on("portal:talk", (msg, ack) => handleTalk(socket, msg, ack));
  socket.on("portal:be",   (msg, ack) => handleBe(socket, msg, ack));
}

/**
 * Hook portal handlers onto every new socket connection.
 * Called by initPortalWs in index.js.
 */
export function attachPortalHandlers(io) {
  io.on("connection", (socket) => {
    registerSocketHandlers(socket);
  });
  log.info("Portal", "IBP attached (portal:see, portal:do, portal:talk, portal:be wired)");
}
