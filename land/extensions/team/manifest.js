export default {
  name: "team",
  version: "1.0.0",
  description:
    "How people work together on trees. Trees start with one owner. Team adds the ability " +
    "to invite contributors, transfer ownership, remove users, and retire trees. The invite " +
    "system is atomic: pending invites transition to accepted or declined in a single " +
    "findOneAndUpdate to prevent double-processing. Ownership transfers are immediate. " +
    "The old owner becomes a contributor. The new owner's LLM assignments clear because " +
    "they do not own the old connections.\n\n" +
    "Cross-land invites work through Canopy federation. Invite a user by username@domain " +
    "and the extension auto-peers with the remote land via Horizon, resolves the remote " +
    "user, sends an invite offer, and creates a local pending record. When the remote user " +
    "accepts, a canopy event fires back and the contributor is added.\n\n" +
    "@mentions in notes are first-class. The beforeNote hook rewrites @username references " +
    "to canonical usernames (case-insensitive lookup, single DB query for all mentions in " +
    "a note). The afterNote hook syncs NoteTag records so tagged users can query all notes " +
    "they were mentioned in, with date filtering and pagination. Tags auto-cleanup on note " +
    "deletion. The /user/:userId/tags endpoint returns the full mention history. Every " +
    "invite action (create, accept, deny, remove, transfer, retire) writes to the " +
    "contribution log for a complete audit trail.",

  needs: {
    services: ["contributions"],
    models: ["User", "Node", "Note"],
    extensions: [],
  },

  optional: {
    services: ["energy", "websocket"],
  },

  provides: {
    models: {
      Invite: "./model.js",
      NoteTag: "./model.js",
    },
    routes: "./routes.js",
    tools: false,
    jobs: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [
      { command: "invites", description: "List pending invites", method: "GET", endpoint: "/user/:userId/invites", userIdParam: true },
      { command: "invite", description: "Invite a user to the current tree", method: "POST", endpoint: "/root/:rootId/invite", rootIdParam: true, bodyMap: { userReceiving: 0 } },
      { command: "transfer-owner", description: "Transfer tree ownership to another user", method: "POST", endpoint: "/root/:rootId/transfer-owner", rootIdParam: true, bodyMap: { userReceiving: 0 } },
      { command: "remove-user", description: "Remove a contributor from the tree", method: "POST", endpoint: "/root/:rootId/remove-user", rootIdParam: true, bodyMap: { userReceiving: 0 } },
      { command: "retire", description: "Retire (soft-delete) a tree you own", method: "POST", endpoint: "/root/:rootId/retire", rootIdParam: true },
    ],
  },
};
