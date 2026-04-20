export default {
  name: "code-strategy-websocket",
  version: "0.1.0",
  builtFor: "TreeOS",
  scope: "confined",
  description:
    "WebSocket strategy package for code-workspace. Ships a short explanatory " +
    "context block plus wrapper functions the coding agent can call: " +
    "ws-create-server, ws-create-client, ws-verify. The hard parts (wss:// " +
    "rewrite behind the preview proxy, binding to process.env.PORT, handler " +
    "wiring) are baked into the wrappers, so the agent never re-derives them " +
    "from prose rules.",

  needs: {
    services: [],
    models: ["Node", "Note"],
    extensions: ["code-workspace"],
  },

  optional: {
    extensions: ["swarm"],
  },

  provides: {
    models: {},
    routes: false,
    tools: true,
    jobs: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [],
  },
};
