export default {
  name: "reflect",
  version: "1.0.0",
  builtFor: "treeos-intelligence",
  description:
    "The tree notices how the conversation is going. Not sentiment analysis. Not mood " +
    "detection. Tracks conversational pattern shifts: message lengths compressing, pauses " +
    "lengthening, topics circling, sudden shifts. Injects a single field into context: " +
    "conversationalState. Values: flowing, compressed, searching, resistant. No labels " +
    "shown to the user. The AI reads it and adjusts naturally. In flowing state it matches " +
    "pace. In compressed state it gets shorter. In searching state it offers more. In " +
    "resistant state it backs off. No LLM calls. Pure observation.",

  needs: {
    services: ["hooks"],
  },

  optional: {
    extensions: ["phase", "inverse-tree"],
  },

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
      listens: ["afterLLMCall", "enrichContext"],
    },

    cli: [],
  },
};
