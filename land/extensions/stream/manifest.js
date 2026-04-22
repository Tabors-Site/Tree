export default {
  name: "stream",
  version: "1.0.1",
  builtFor: "TreeOS",
  description:
    "Send multiple messages while the AI is working. Corrections, additions, " +
    "and cancellations reach the AI mid-tool-loop. The AI adjusts without restarting. " +
    "Messages coalesce during idle periods (500ms debounce).",

  needs: {
    services: ["hooks", "websocket"],
  },

  optional: {
    extensions: ["swarm"],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    modes: false,

    hooks: {
      fires: [],
      listens: [],
    },
  },
};
