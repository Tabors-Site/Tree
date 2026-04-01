export default {
  name: "browser-bridge",
  version: "1.0.0",
  scope: "confined",
  builtFor: "treeos",
  description:
    "The AI sees and acts through your browser. A Chrome extension connects via Socket.IO. " +
    "The AI gets accessibility trees, clicks elements, types text, navigates pages, takes screenshots. " +
    "Confined scope: inactive everywhere until explicitly allowed per branch. " +
    "Write actions require operator approval unless auto-approved by site scoping. " +
    "Read actions (page state, extract, screenshot) are always allowed. " +
    "Every browser action is logged as a note. The most powerful and most dangerous extension " +
    "in the ecosystem. All safety layers active by default.",

  needs: {
    services: ["hooks", "websocket", "metadata"],
    models: ["Node"],
  },

  optional: {
    extensions: ["approve", "kb", "study", "api-keys"],
  },

  provides: {
    models: {},
    routes: false,
    tools: true,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [],

    hooks: {
      fires: [],
      listens: ["beforeToolCall", "enrichContext"],
    },
  },
};
