export default {
  name: "tree-compress",
  version: "1.0.0",
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
        command: "compress",
        description: "Compress current tree from leaves up",
        method: "POST",
        endpoint: "/root/:rootId/compress",
      },
      {
        command: "compress-branch",
        description: "Compress from current node downward",
        method: "POST",
        endpoint: "/node/:nodeId/compress",
      },
      {
        command: "compress-status",
        description: "Show compression state of the current tree",
        method: "GET",
        endpoint: "/root/:rootId/compress",
      },
      {
        command: "compress-undo",
        description: "Decompress current node (restore to active)",
        method: "POST",
        endpoint: "/node/:nodeId/decompress",
      },
      {
        command: "compress-budget <size>",
        description: "Compress until tree is under target size in bytes (e.g. 52428800 for 50MB)",
        method: "POST",
        endpoint: "/root/:rootId/compress/budget",
        body: ["size"],
      },
    ],

    hooks: {
      fires: [],
      listens: ["onTreeTripped", "onDocumentPressure", "enrichContext", "beforeNote"],
    },
  },
};
