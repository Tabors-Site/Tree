export default {
  name: "trace",
  version: "1.0.0",
  builtFor: "treeos-intelligence",
  description:
    "Follow one thread through the entire tree. Every node it touched, in order. " +
    "Not broad search like scout. Not downward exploration like explore. One concept, " +
    "every note that references it across the whole tree, chronologically. Where did " +
    "it start? How did it evolve at each stop? What's the current state? What's unresolved?",

  needs: {
    services: ["hooks", "llm", "metadata", "session"],
    models: ["Node", "Note"],
  },

  optional: {
    extensions: ["embed", "codebook", "long-memory", "inverse-tree"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {
      TRACE: "trace",
    },

    hooks: {
      fires: [],
      listens: ["enrichContext"],
    },

    cli: [
      {
        command: "trace [concept...]",
        description: "Follow a concept through the tree",
        method: "POST",
        endpoint: "/node/:nodeId/trace",
        subcommands: {
          map: {
            method: "GET",
            endpoint: "/node/:nodeId/trace/map",
            description: "Show last trace as node map",
          },
        },
      },
    ],
  },
};
