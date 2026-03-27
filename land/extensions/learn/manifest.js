export default {
  name: "learn",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Information intake and decomposition. Paste in 50,000 words. The extension scans through, " +
    "labels the main sections, cuts it up into nodes, repeats for each node, and keeps expanding " +
    "until any length text is turned into nodes that are good sized. The opposite of understanding " +
    "compression. Understanding compresses bottom-up. Learn expands top-down. Modular: leaves " +
    "state in metadata and knows how to take breaks. Can stop and start at any time without " +
    "breaking. Queue-based processing, one node at a time. Each step: read the text, ask the " +
    "AI to identify sections, create children, move text, add large children back to the queue. " +
    "For very long text that exceeds AI context, does a structural scan first (headings, " +
    "paragraph boundaries) to chunk into manageable pieces before AI refinement.",

  needs: {
    services: ["llm"],
    models: ["Node"],
  },

  optional: {},

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
        command: "learn-status",
        description: "Check progress of a learn operation at current node",
        method: "GET",
        endpoint: "/node/:nodeId/learn",
      },
      {
        command: "learn-resume",
        description: "Resume a paused learn operation at current node",
        method: "POST",
        endpoint: "/node/:nodeId/learn/resume",
      },
      {
        command: "learn-pause",
        description: "Pause a learn operation at current node",
        method: "POST",
        endpoint: "/node/:nodeId/learn/pause",
      },
      {
        command: "learn-stop",
        description: "Stop a learn operation and clear the queue",
        method: "POST",
        endpoint: "/node/:nodeId/learn/stop",
      },
    ],

    hooks: {
      fires: [],
      listens: [],
    },
  },
};
