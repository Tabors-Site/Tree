export default {
  name: "tree-compress",
  version: "1.0.0",
  builtFor: "treeos-intelligence",
  description:
    "A tree outgrows its usefulness. Too many nodes. Too much metadata. The AI context window " +
    "cannot hold the summary. The circuit breaker is approaching threshold. The tree needs to " +
    "shrink without dying. tree-compress walks from leaves to root, compressing content at each " +
    "level, carrying the essential meaning upward, and trimming what has been absorbed. The tree " +
    "gets smaller. The knowledge survives. Three triggers: manual via CLI or tool, automatic via " +
    "onDocumentPressure when a tree approaches size limits, automatic via onTreeTripped as a " +
    "revival strategy when the circuit breaker fires. The algorithm starts at leaf nodes, sends " +
    "notes to the AI with a compression prompt, writes summary and fact dictionary to " +
    "metadata.compress.essence, marks the leaf as trimmed. Moves up one level. Parent absorbs " +
    "children essences plus its own content into one merged compression. Continues until " +
    "compressionCeiling (default 2 levels from root). Size budget mode compresses until the tree " +
    "fits under targetSizeBytes then stops. The tree crown stays readable. The branches are " +
    "trimmed. Notes on trimmed nodes stay in the database. tree-compress does not delete data. " +
    "It compresses the active context while preserving the raw data. Each compression pass is a " +
    "prestige. The tree carries more meaning in less space.",

  needs: {
    services: ["llm", "hooks", "tree"],
    models: ["Node"],
  },

  optional: {
    extensions: ["long-memory", "codebook"],
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
        command: "compress [action] [args...]", scope: ["tree"],
        description: "Tree compression. Actions: branch, status, undo, budget. No action compresses full tree.",
        method: "POST",
        endpoint: "/root/:rootId/compress",
        subcommands: {
          "branch": { method: "POST", endpoint: "/node/:nodeId/compress", description: "Compress from current node down" },
          "status": { method: "GET", endpoint: "/root/:rootId/compress", description: "Compression state of tree" },
          "undo": { method: "POST", endpoint: "/node/:nodeId/decompress", description: "Decompress current node" },
          "budget": { method: "POST", endpoint: "/root/:rootId/compress/budget", args: ["size"], description: "Compress until under target size" },
        },
      },
    ],

    hooks: {
      fires: [],
      listens: ["onTreeTripped", "onDocumentPressure", "enrichContext", "beforeNote"],
    },
  },
};
