export default {
  name: "browser-bridge",
  version: "1.0.1",
  scope: "confined",
  builtFor: "treeos-connect",
  description:
    "The AI sees and acts through your browser. A Chrome extension connects via Socket.IO. " +
    "The AI gets accessibility trees, clicks elements, types text, navigates pages, takes screenshots. " +
    "Confined scope: inactive everywhere until explicitly allowed per branch. " +
    "Write actions require operator approval unless auto-approved by site scoping. " +
    "Read actions (page state, extract, screenshot) are always allowed. " +
    "Every browser action is logged as a note. The most powerful and most dangerous extension " +
    "in the ecosystem. All safety layers active by default.",

  classifierHints: [
    /\b(click|type|navigate|browse|open|visit|go to|read.*page|what.*page|this site|this page|webpage|website)\b/i,
    /\b(post|comment|reply|submit|login|sign in|search.*web|fill.*form|enter.*field)\b/i,
    /\b(browser|tab|screen|what do you see|what's on)\b/i,
  ],

  guidedMode: "tree:browser-agent",

  needs: {
    services: ["hooks", "websocket", "metadata", "modes"],
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
