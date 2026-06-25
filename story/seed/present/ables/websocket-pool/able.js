// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// websocket-pool — the WebSocket pool as a being.
//
// nodeServerTest Phase 1. Homed at ./host/websocket. One connection
// matter per live socket: the pool creates it on connect, updates
// qualities.connection.branch on a branch reseat (identity never
// rebinds on a live socket), and ends it on disconnect. The pool's
// act-chain is the connection log; stale rows from a previous
// process get swept (ended) at boot. A connection is MATTER, not a
// being: it never sees, does, or summons — the being ON the socket
// acts, the socket is the conduit's record. The lifecycle code lives
// in seed/materials/host/host.js.

export const websocketPoolAble = Object.freeze({
  name: "websocket-pool",
  description:
    "The WebSocket pool as a being. Homed at ./host/websocket; one " +
    "connection matter per live socket, created on connect, branch " +
    "updated on reseat, ended on disconnect. Its act-chain is the " +
    "connection log.",
  requiredCognition: "scripted",
  permissions: ["see", "do"],
  respondMode: "async",
  triggerOn: ["message"],

  can: [
    { verb: "see", word: "connections" },
    { verb: "see", word: "http-stats" },
    {
      verb:        "do",
      word:        "create-matter",
      description: "Create a connection matter when a socket connects",
    },
    {
      verb:        "do",
      word:        "set-matter",
      description: "Update a connection's branch on reseat",
    },
    {
      verb:        "do",
      word:        "end-matter",
      description: "End a connection matter on disconnect (and sweep stale rows at boot)",
    },
  ],
  label: "WebSocket Pool",
});
