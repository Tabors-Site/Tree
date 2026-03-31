export default {
  name: "approve",
  version: "1.0.1",
  builtFor: "TreeOS",
  description:
    "The AI pauses and waits for you. Any tool call can be put on a watchlist. When the AI " +
    "tries to call a watched tool, the call freezes. A notification goes out. The operator " +
    "sees what the AI wants to do, with what arguments, and why. They approve or reject. " +
    "The AI resumes or adapts. No timeout pressure. The human decides when they're ready. " +
    "Works with gateway notifications so you can approve from your phone.",

  needs: {
    services: ["hooks", "metadata", "websocket"],
    models: ["Node"],
  },

  optional: {
    services: ["energy"],
    extensions: ["notifications", "gateway"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},

    hooks: {
      fires: [],
      listens: ["beforeToolCall", "enrichContext"],
    },

    cli: [
      {
        command: "approve [action] [args...]",
        scope: ["tree"],
        description: "Tool approval watchlist and pending requests. Actions: watch, unwatch, pending, approve <id>, reject <id>",
        method: "GET",
        endpoint: "/node/:nodeId/approve",
        subcommands: {
          watch: {
            method: "POST",
            endpoint: "/node/:nodeId/approve/watch",
            args: ["toolName"],
            description: "Add a tool to the watchlist",
          },
          unwatch: {
            method: "POST",
            endpoint: "/node/:nodeId/approve/unwatch",
            args: ["toolName"],
            description: "Remove a tool from the watchlist",
          },
          pending: {
            method: "GET",
            endpoint: "/node/:nodeId/approve/pending",
            description: "Show pending approval requests",
          },
          approve: {
            method: "POST",
            endpoint: "/node/:nodeId/approve/resolve",
            args: ["id"],
            body: ["decision"],
            description: "Approve a pending request",
          },
          reject: {
            method: "POST",
            endpoint: "/node/:nodeId/approve/resolve",
            args: ["id"],
            body: ["decision"],
            description: "Reject a pending request",
          },
        },
      },
    ],
  },
};
