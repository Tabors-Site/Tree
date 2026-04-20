export default {
  name: "code-strategy-http",
  version: "0.1.0",
  builtFor: "TreeOS",
  scope: "confined",
  description:
    "HTTP backend strategy package for code-workspace. Ships a short " +
    "explanatory context block plus wrapper functions: http-create-server, " +
    "http-add-route, http-verify. The hard parts (binding to " +
    "process.env.PORT, JSON body parsing, static serving, CORS) are baked " +
    "into the wrappers so the agent never re-derives them from prose rules.",

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
