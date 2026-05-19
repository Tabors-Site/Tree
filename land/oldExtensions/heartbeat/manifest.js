export default {
  name: "heartbeat",
  version: "1.0.1",
  builtFor: "TreeOS",
  description:
    "The tree knows it's alive. Pure in-memory presence detection. No database writes. " +
    "No metadata. No LLM. Two hooks record when humans interact. enrichContext injects " +
    "one field: landHeartbeat. Values: alive (someone is here), quiet (recent but gone), " +
    "dormant (nobody for a while). The AI at a quiet tree says welcome back. The AI at " +
    "a busy tree knows others are here. The AI at a dormant tree understands the weight " +
    "of a return after silence.",

  needs: {
    services: ["hooks"],
  },

  optional: {},

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    hooks: {
      fires: [],
      listens: ["afterLLMCall", "afterNavigate", "enrichContext"],
    },
    cli: [],
  },
};
