export default {
  name: "inverse-tree",
  version: "1.0.3",
  builtFor: "treeos-intelligence",
  description:
    "The AI builds a tree OF the user. Not the trees the user built. A tree the AI constructs " +
    "from observing the user across every interaction on every tree on the land. Listens to " +
    "afterNote, afterLLMCall, and afterToolCall. Does not store raw messages. Extracts signals. " +
    "What topics does this user return to? What questions do they ask repeatedly? What tools do " +
    "they use most? What time of day are they active? What trees do they spend time in versus " +
    "pass through? What language patterns do they use? What do they correct the AI on, revealing " +
    "actual preferences versus the AI assumptions? Maintains a hidden tree structure in user " +
    "metadata. Root branches are categories the AI discovers: values, knowledge, habits, " +
    "communication style, unresolved questions, recurring frustrations, goals stated versus goals " +
    "acted on. Every 50 interactions, runs a compression pass. The AI reads accumulated signals " +
    "and updates the model. enrichContext injects the compressed profile into every prompt. The " +
    "AI at every position on every tree knows who it is talking to. Not because the mode prompt " +
    "says be a fitness coach. Because the inverse tree says this user responds better to direct " +
    "feedback, cares about progressive overload, gets frustrated when the AI asks clarifying " +
    "questions instead of acting, and is most productive between 10pm and 2am. The user built " +
    "trees. The AI built a tree of the user. Both grow. Both compress. Both inform each other.",

  needs: {
    services: ["llm", "hooks"],
    models: ["Node", "User"],
  },

  optional: {
    extensions: ["html-rendering"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [],

    cli: [
      {
        command: "inverse [action] [args...]", scope: ["tree"],
        description: "Your profile as the AI sees it. Actions: correct, reset.",
        method: "GET",
        endpoint: "/user/:userId/inverse",
        subcommands: {
          "correct": { method: "POST", endpoint: "/user/:userId/inverse/correct", args: ["text"], description: "Override AI inference" },
          "reset": { method: "POST", endpoint: "/user/:userId/inverse/reset", description: "Wipe profile, start fresh" },
        },
      },
    ],

    hooks: {
      fires: [],
      listens: ["afterNote", "afterLLMCall", "afterToolCall", "afterNavigate", "enrichContext"],
    },
  },
};
