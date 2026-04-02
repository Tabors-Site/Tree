export default {
  name: "taste",
  version: "1.0.3",
  builtFor: "treeos-intelligence",
  description:
    "The tree learns what you like. Not from settings. From watching. " +
    "Signals accumulate on nodes as users interact. AI-generated content that gets kept is positive. " +
    "Content that gets edited is mild negative. Content that gets deleted is strong negative. " +
    "Navigation frequency is implicit preference. Every breath cycle, accumulated signals compress " +
    "into a one-sentence learned preference per node. enrichContext injects it. The AI at every " +
    "position adapts to your taste. Spatial, not global. You like complex workouts but simple meals. " +
    "The tree knows both.",

  needs: {
    services: ["hooks", "llm", "metadata"],
    models: ["Node", "Contribution"],
  },

  optional: {
    extensions: ["breath"],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [],

    hooks: {
      fires: [],
      listens: [
        "afterNote",
        "beforeNodeDelete",
        "afterToolCall",
        "onNodeNavigate",
        "enrichContext",
        "breath:exhale",
      ],
    },
  },
};
