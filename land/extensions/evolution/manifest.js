export default {
  name: "evolution",
  version: "1.0.0",
  description:
    "The tree learns which structures work. A branch that grows, accumulates notes, generates " +
    "cascade signals, builds codebook entries, gets revisited frequently is a successful pattern. " +
    "A branch that was created, received two notes, and went dormant for three months is a failed " +
    "pattern. Tracks structural fitness metrics per node: activityScore, cascadeScore, " +
    "revisitScore, growthScore, codebookScore, dormancyDays. Periodically runs an analysis pass " +
    "on the full tree. Identifies patterns. Nodes of type goal that have exactly three children " +
    "of type task have a 4x higher completion rate than goals with more than ten tasks. Branches " +
    "deeper than 5 levels have 90% dormancy rates. These patterns are structural DNA. Written to " +
    "metadata.evolution.patterns on the tree root. When the user creates a new branch, enrichContext " +
    "injects relevant patterns. The AI says: based on how your other goals evolved, breaking this " +
    "into three specific tasks works better than listing everything. The tree teaches itself how to " +
    "grow. Past structure informs future structure. Cross-land evolution through cascade is the long " +
    "game. When two lands peer and share cascade signals, evolution patterns travel with them. The " +
    "ecosystem learns collectively which tree shapes work for which purposes.",

  needs: {
    models: ["Node"],
  },

  optional: {
    extensions: ["codebook", "long-memory", "propagation"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: true,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [],

    cli: [
      {
        command: "evolution",
        description: "Show fitness metrics at current position",
        method: "GET",
        endpoint: "/node/:nodeId/evolution",
      },
      {
        command: "evolution-patterns",
        description: "Show discovered structural patterns for this tree",
        method: "GET",
        endpoint: "/root/:rootId/evolution/patterns",
      },
      {
        command: "evolution-dormant",
        description: "List dormant branches that stopped growing",
        method: "GET",
        endpoint: "/root/:rootId/evolution/dormant",
      },
    ],

    hooks: {
      fires: [],
      listens: ["afterNote", "afterNodeCreate", "afterNavigate", "onCascade", "enrichContext"],
    },
  },
};
