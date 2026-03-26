export default {
  name: "contradiction",
  version: "1.0.0",
  description:
    "The tree's immune system. Notes on different nodes might contradict each other. Both valid " +
    "in isolation. Together a conflict the user has not noticed. Listens to afterNote. On every " +
    "note write, reads the current node enrichContext snapshot including codebook dictionaries, " +
    "perspective tags, and parent summaries. Sends the new note plus contextual summary to the AI: " +
    "does this note contradict anything in the existing context? When a contradiction is found, " +
    "writes to metadata.contradictions on both nodes. The entry contains what conflicts, which " +
    "nodes, when detected, severity (factual vs intentional vs temporal). Factual is wrong data. " +
    "Intentional is a deliberate change not propagated. Temporal is something that was true before " +
    "but is not now. enrichContext injects active contradictions at every position. The AI sees " +
    "them and can surface them. The cascade integration is what makes it architectural. When a " +
    "contradiction is detected locally, the extension fires a cascade signal with the contradiction " +
    "payload. Propagation carries it to related nodes. Perspective filters determine which nodes " +
    "care. The tree becomes aware of its own inconsistencies across branches. The AI does not " +
    "resolve contradictions. It surfaces them. The user decides. But the tree cannot hold " +
    "conflicting truths silently anymore. The immune system detects infection. The operator treats it.",

  needs: {
    models: ["Node"],
  },

  optional: {
    extensions: ["propagation", "perspective-filter", "codebook"],
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
        command: "contradictions",
        description: "Show active contradictions at current node",
        method: "GET",
        endpoint: "/node/:nodeId/contradictions",
      },
      {
        command: "contradictions-resolve <contradictionId>",
        description: "Mark a contradiction as intentionally resolved",
        method: "POST",
        endpoint: "/node/:nodeId/contradictions/resolve",
        body: ["contradictionId"],
      },
      {
        command: "contradictions-scan",
        description: "Force a full-tree contradiction scan from current position",
        method: "POST",
        endpoint: "/root/:rootId/contradictions/scan",
      },
    ],

    hooks: {
      fires: [],
      listens: ["afterNote", "enrichContext"],
    },
  },
};
