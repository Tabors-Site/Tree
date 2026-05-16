// TreeOS Portal Protocol: WebSocket op registration.
//
// The protocol exposes four ops on the Socket.IO instance:
//
//   portal:see   observe an address (one-shot or live)
//   portal:do    mutate the world at an address
//   portal:talk  deliver a message to a being's inbox
//   portal:be    manage be-er identity
//
// See portal/docs/protocol.md for the conceptual model and
// portal/docs/server-protocol.md for wire-level rules.
//
// Phase 1 scaffolding (portal:fetch, portal:resolve, portal:discover,
// portal:speak, portal:subscribe, portal:unsubscribe) has been removed.
// The four-verb handlers are wired in subsequent phases:
//
//   Phase 2: portal:see
//   Phase 3: portal:do
//   Phase 4: portal:talk
//   Phase 5: portal:be
//
// This file currently registers no ops. Connections established during
// the gap between demolition and the first verb landing receive nothing
// from the portal protocol. The legacy chat WS handlers in
// seed/ws/websocket.js continue serving traffic during the gap.

import log from "../seed/log.js";

/**
 * Hook portal handlers onto every new socket connection.
 * Called by initPortalWs in index.js.
 */
export function attachPortalHandlers(_io) {
  // Verb handlers wire in below as phases land. The verb-specific address
  // field on each envelope is:
  //   portal:see   { id, position OR stance, identity, live? }
  //   portal:do    { id, position OR stance, action, payload, identity }
  //   portal:talk  { id, stance, message, identity }
  //   portal:be    { id, operation, land, payload?, identity? }
  //
  // Example shape for the future wiring:
  //   io.on("connection", (socket) => {
  //     socket.on("portal:see",  (msg, ack) => handleSee(socket, msg, ack));
  //     socket.on("portal:do",   (msg, ack) => handleDo(socket, msg, ack));
  //     socket.on("portal:talk", (msg, ack) => handleTalk(socket, msg, ack));
  //     socket.on("portal:be",   (msg, ack) => handleBe(socket, msg, ack));
  //   });

  log.info("Portal", "Portal Protocol attached (no verb handlers wired yet; demolition state)");
}
