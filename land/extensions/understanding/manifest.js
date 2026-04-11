export default {
  name: "understanding",
  version: "1.0.1",
  builtFor: "TreeOS",
  description:
    "A tree with 500 nodes cannot fit in an AI context window. The AI needs to know what the " +
    "tree contains without reading every note on every node. Understanding solves this by " +
    "building a compressed encoding of the entire tree from the bottom up. Leaves first, then " +
    "their parents, then the parents of parents, until the root holds a single encoding that " +
    "captures the semantic meaning of the full tree." +
    "\n\n" +
    "The mechanism is layered compression. A shadow tree of UnderstandingNode documents " +
    "mirrors the real tree. Each understanding node holds a perspectiveStates map keyed by " +
    "run ID. A run begins by building the shadow topology: depth from root, subtree height, " +
    "merge layer for each node. Leaf nodes with content are sent to the LLM for individual " +
    "summarization. Empty leaves auto-commit with a placeholder. Once all children of a " +
    "parent are complete at their own merge layer, the parent merges their summaries into " +
    "one cohesive encoding. The process repeats upward until the root node merges everything." +
    "\n\n" +
    "Runs are incremental. The contribution snapshot on each understanding node records how " +
    "many contributions existed when it was last compressed. On a re-run, nodes whose " +
    "contribution count has changed are marked dirty. Dirtiness propagates upward to the " +
    "root. Only dirty nodes recompress. A 500-node tree where 3 nodes changed reprocesses " +
    "those 3 nodes plus their ancestor chain, not all 500. Structural changes (added, " +
    "removed, moved nodes) are detected by comparing old and new topology." +
    "\n\n" +
    "Each run carries a perspective: a lens for compression. The default is semantic " +
    "compression while maintaining meaning. A custom perspective like financial summary or " +
    "technical architecture compresses the same tree differently. The root encoding and " +
    "perspective are stored in encodingHistory on the run document. enrichContext injects " +
    "the latest completed encoding at every node in the tree so the AI always has the " +
    "compressed understanding of the full structure in its context window. The auto-run " +
    "job and the dreams extension trigger understanding runs on schedules. The pipeline " +
    "uses OrchestratorRuntime for session lifecycle, lock management, and LLM calls.",

  // Required: won't load without these
  needs: {
    services: ["llm", "session", "chat", "orchestrator", "mcp", "contributions", "hooks"],
    models: ["Node", "Contribution"],
  },

  optional: {
    services: ["energy"],
    extensions: ["html-rendering", "treeos-base"],
  },

  provides: {
    hooks: {
      listens: ["enrichContext"],
    },
    models: {
      UnderstandingRun: "./understandingRun.js",
      UnderstandingNode: "./understandingNode.js",
    },
    routes: "./routes.js",
    tools: true,
    jobs: "./autoRunJob.js",
    orchestrator: "./pipeline.js",
    energyActions: {
      understanding: { cost: 1, unit: "per-node" },
    },
    sessionTypes: {
      UNDERSTANDING_ORCHESTRATE: "understanding-orchestrate",
    },
    cli: [
      { command: "understand", scope: ["tree"], description: "Start an understanding run (-i incremental)", method: "POST", endpoint: "/root/:rootId/understandings" },
      { command: "understandings", scope: ["tree"], description: "List understanding runs", method: "GET", endpoint: "/root/:rootId/understandings" },
      { command: "understand-status <runId>", scope: ["tree"], description: "Check progress of a run", method: "GET", endpoint: "/root/:rootId/understandings/run/:runId" },
      { command: "understand-stop <runId>", scope: ["tree"], description: "Stop a running understanding run", method: "POST", endpoint: "/root/:rootId/understandings/run/:runId/stop" },
    ],
  },
};
