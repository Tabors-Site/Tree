export default {
  name: "scout",
  version: "1.0.0",
  builtFor: "treeos-intelligence",
  description:
    "Triangulate across the tree. Five search strategies run in parallel: semantic, structural, " +
    "memory, codebook, and profile. Findings that appear in multiple strategies score higher " +
    "(convergence scoring). The AI synthesizes all results into an answer with citations. " +
    "Scout is peripheral vision while explore is focused gaze. Scout asks 'what does the tree " +
    "know about X' across the whole branch. Explore asks 'what's under this node about X' going " +
    "downward. Scout gaps feed intent: the tree notices what it doesn't know and acts on it.",

  needs: {
    services: ["hooks", "llm", "metadata", "session"],
    models: ["Node", "Note"],
  },

  optional: {
    extensions: [
      "embed",
      "long-memory",
      "codebook",
      "inverse-tree",
      "contradiction",
      "gap-detection",
      "intent",
      "explore",
    ],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {
      SCOUT: "scout",
    },

    hooks: {
      fires: [],
      listens: ["enrichContext"],
    },

    cli: [
      {
        command: "scout [query...]", scope: ["tree"],
        description: "Triangulate across the tree",
        method: "POST",
        endpoint: "/node/:nodeId/scout",
        subcommands: {
          history: {
            method: "GET",
            endpoint: "/node/:nodeId/scout/history",
            description: "Previous scout runs at this position",
          },
          gaps: {
            method: "GET",
            endpoint: "/node/:nodeId/scout/gaps",
            description: "Accumulated knowledge gaps",
          },
        },
      },
    ],
  },
};
