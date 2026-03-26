export default {
  name: "embed",
  version: "1.0.0",
  description:
    "Every note gets a vector embedding when written. The tree structure is the skeleton. The " +
    "embeddings are the magnetic field between bones. Two notes on opposite branches that are " +
    "semantically related find each other without any explicit link. The tree hierarchy says " +
    "these are far apart. The vector space says these mean the same thing. Three layers working " +
    "together: the tree is navigation (parent, children, position), the graph is explicit " +
    "connections (cascade, codebook, contributors), the vectors are implicit connections (nobody " +
    "linked these two notes, but they are about the same thing). enrichContext injects related " +
    "notes into the AI context. The AI at /Health/Fitness sees a semantically related note from " +
    "/Health/Food about protein timing without either branch explicitly referencing the other. " +
    "Per-viewer relevance when inverse-tree is installed. The tree holds structure. The vectors " +
    "hold meaning. Together the tree knows not just where things are but what things are like " +
    "each other. Navigation finds things by position. Embedding finds things by resonance.",

  needs: {
    services: ["llm"],
    models: ["Node", "Note"],
  },

  optional: {
    extensions: ["inverse-tree"],
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
        command: "related",
        description: "Semantically similar notes at this position",
        method: "GET",
        endpoint: "/node/:nodeId/related",
      },
      {
        command: "embed [action]",
        description: "Embedding status and management. Actions: status, rebuild.",
        method: "GET",
        endpoint: "/embed/status",
        subcommands: {
          "status": { method: "GET", endpoint: "/embed/status", description: "Embedding coverage percentage" },
          "rebuild": { method: "POST", endpoint: "/embed/rebuild", description: "Re-embed all notes" },
        },
      },
    ],

    hooks: {
      fires: [],
      listens: ["afterNote", "enrichContext"],
    },
  },
};
