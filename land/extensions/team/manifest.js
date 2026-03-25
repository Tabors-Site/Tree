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
    routes: true,
    tools: false,
    jobs: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [
      {
        name: "invites",
        description: "List pending invites",
        method: "GET",
        path: "/user/:userId/invites",
        userIdParam: true,
      },
      {
        name: "invite",
        description: "Invite a user to the current tree",
        method: "POST",
        path: "/root/:rootId/invite",
        rootIdParam: true,
        body: { userReceiving: "<arg0>" },
      },
      {
        name: "transfer-owner",
        description: "Transfer tree ownership to another user",
        method: "POST",
        path: "/root/:rootId/transfer-owner",
        rootIdParam: true,
        body: { userReceiving: "<arg0>" },
      },
      {
        name: "remove-user",
        description: "Remove a contributor from the tree",
        method: "POST",
        path: "/root/:rootId/remove-user",
        rootIdParam: true,
        body: { userReceiving: "<arg0>" },
      },
      {
        name: "retire",
        description: "Retire (soft-delete) a tree you own",
        method: "POST",
        path: "/root/:rootId/retire",
        rootIdParam: true,
      },
    ],
  },
};
