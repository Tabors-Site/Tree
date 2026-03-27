export default {
  name: "teach",
  version: "1.0.0",
  builtFor: "kernel",
  description:
    "When a tree has been alive long enough, it accumulates wisdom that is not " +
    "structure and is not content. It is meta-knowledge. Evolution discovered that " +
    "branches with 3 children complete 4x more than branches with 10. Purpose " +
    "learned that the thesis drifts when the user adds too many top-level branches. " +
    "Prune learned which patterns indicate dead weight. Codebook learned what " +
    "language compresses best between this user and this domain." +
    "\n\n" +
    "Teach extracts this meta-knowledge from every installed intelligence extension " +
    "and packages it as a transferable lesson set. Not the raw data. The conclusions. " +
    "Each lesson names its source extension, states the insight in natural language, " +
    "carries a confidence score derived from sample size and consistency, and records " +
    "the sample size so the receiving tree can weigh it." +
    "\n\n" +
    "Three delivery paths. Export writes the lesson set to a JSON file that travels " +
    "alongside a seed-export. Import reads a lesson file into a tree's metadata where " +
    "enrichContext surfaces it to the AI. Share sends the lesson set to a peered land " +
    "through canopy as a cascade signal. The receiving tree absorbs the lessons without " +
    "ever sharing content." +
    "\n\n" +
    "Lesson extraction is LLM-powered. For each installed intelligence extension, teach " +
    "reads its accumulated state (evolution fitness scores, prune history, purpose " +
    "coherence trends, codebook compression stats, boundary similarity matrices) and " +
    "asks the AI to distill the data into actionable insights with confidence ratings. " +
    "The AI sees the numbers. It produces the sentences." +
    "\n\n" +
    "Lessons are not permanent. They can be dismissed if they do not apply to the " +
    "receiving tree's context. Dismissed lessons are excluded from enrichContext but " +
    "retained in metadata for audit. Lessons decay: confidence drops over time as the " +
    "receiving tree accumulates its own experience that may contradict the imported wisdom." +
    "\n\n" +
    "seed-export captures form. Teach captures understanding. Together they let a new " +
    "tree start with both the shape and the wisdom of the tree that came before it.",

  needs: {
    services: ["hooks", "llm", "contributions"],
    models: ["Node"],
  },

  optional: {
    services: ["energy"],
    extensions: [
      "evolution",
      "prune",
      "purpose",
      "codebook",
      "boundary",
      "tree-compress",
      "inverse-tree",
      "phase",
      "seed-export",
    ],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: false,
    orchestrator: false,
    energyActions: {
      teachExtract: { cost: 3 },
    },
    sessionTypes: {},

    hooks: {
      fires: [],
      listens: ["enrichContext"],
    },

    cli: [
      {
        command: "teach [action]", scope: ["tree"],
        description: "Tree wisdom transfer. Actions: import, share, lessons, dismiss.",
        method: "POST",
        endpoint: "/root/:rootId/teach/export",
        subcommands: {
          import: {
            method: "POST",
            endpoint: "/root/:rootId/teach/import",
            description: "Import lessons to this tree",
          },
          share: {
            method: "POST",
            endpoint: "/root/:rootId/teach/share",
            description: "Send lessons to a peered land's tree",
            bodyMap: { peer: 0 },
          },
          lessons: {
            method: "GET",
            endpoint: "/root/:rootId/teach",
            description: "Show active lessons at this position",
          },
          dismiss: {
            method: "POST",
            endpoint: "/root/:rootId/teach/dismiss",
            description: "Dismiss a lesson that does not apply",
            bodyMap: { id: 0 },
          },
        },
      },
    ],
  },
};
