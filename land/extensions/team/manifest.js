export default {
  name: "team",
  version: "1.0.0",
  description: "Tree collaboration: invitations, ownership transfer, contributor management, @mentions",

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
