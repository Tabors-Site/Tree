export default {
  name: "home-memory",
  version: "1.0.1",
  builtFor: "seed",
  description:
    "The lobby remembers. Tracks what the user cares about across home-zone conversations. " +
    "Navigation patterns, explicit reminders, session topics. A .home system tree per user " +
    "holds the memories. enrichContext injects them so the home agent greets with context " +
    "instead of amnesia.",

  needs: {
    services: ["hooks", "llm", "metadata", "tree"],
    models: ["Node", "Note", "User"],
  },

  optional: {
    extensions: ["breath", "treeos-base"],
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
        "afterNavigate",
        "afterSessionEnd",
        "beforeLLMCall",
        "breath:exhale",
      ],
    },
  },
};
