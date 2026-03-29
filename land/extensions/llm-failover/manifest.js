export default {
  name: "llm-failover",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Failover stack management for LLM connections. Push backup connections " +
    "onto per-user and per-tree stacks (max 10 each). When the primary " +
    "connection fails (429, 500, 502, 503, 504, timeout), the conversation " +
    "system walks the tree-level stack first, then the user-level stack, " +
    "until one succeeds. Tree-level failover lets tree owners configure " +
    "backup connections that apply to everyone in that tree.",

  needs: {
    services: ["llm"],
    models: ["User", "Node"],
  },

  optional: {
    extensions: ["html-rendering"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},

    cli: [
      // User-level failover
      { command: "llm failover", scope: ["home"], description: "Show your failover stack", method: "GET", endpoint: "/user/:userId/llm-failover" },
      { command: "llm failover-push <connectionId>", scope: ["home"], description: "Add a connection to your failover stack", method: "POST", endpoint: "/user/:userId/llm-failover", body: ["connectionId"] },
      { command: "llm failover-pop", scope: ["home"], description: "Remove last connection from your failover stack", method: "DELETE", endpoint: "/user/:userId/llm-failover" },
      // Tree-level failover
      { command: "llm tree-failover", scope: ["tree"], description: "Show tree failover stack", method: "GET", endpoint: "/root/:rootId/llm-failover" },
      { command: "llm tree-failover-push <connectionId>", scope: ["tree"], description: "Add a connection to tree failover stack", method: "POST", endpoint: "/root/:rootId/llm-failover", body: ["connectionId"] },
      { command: "llm tree-failover-pop", scope: ["tree"], description: "Remove last connection from tree failover stack", method: "DELETE", endpoint: "/root/:rootId/llm-failover" },
    ],
  },
};
