export default {
  name: "water",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "The full picture at any position. Combines perspective, codebook stats, memory, gaps, " +
    "flow, and evolution into one view. What is flowing through this node right now? Perspective " +
    "shows what it drinks. Memory shows who it has talked to. Gaps show what it is missing. " +
    "Flow shows recent signals. Codebook shows compression stats. water land gives the operator " +
    "dashboard: pulse health plus aggregated gaps plus .flow stats plus peer health. Every " +
    "extension contributes one piece. water assembles the picture at any position. The tree knows " +
    "its own hydration.",

  needs: {
    models: ["Node"],
  },

  optional: {
    extensions: [
      "perspective-filter", "codebook", "long-memory",
      "gap-detection", "flow", "pulse", "evolution",
    ],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [],

    cli: [
      {
        command: "water [action]", scope: ["tree"],
        description: "The full picture. No action shows node hydration. Actions: land.",
        method: "GET",
        endpoint: "/node/:nodeId/water",
        subcommands: {
          "land": {
            method: "GET",
            endpoint: "/water/land",
            description: "Land-wide dashboard. Pulse, gaps, flow, peers.",
          },
        },
      },
    ],

    hooks: {
      fires: [],
      listens: [],
    },
  },
};
