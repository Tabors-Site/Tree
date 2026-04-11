export default {
  name: "explore",
  version: "1.0.1",
  builtFor: "treeos-intelligence",
  description:
    "The AI navigates a tree branch the way Claude Code navigates a codebase. It does not read " +
    "everything. It reads the structure first. Names, types, child counts, depths. No note content. " +
    "Just the skeleton. Then it probes metadata: evolution fitness, long-memory connections, codebook " +
    "entries, embed vectors, contradiction state. Each signal produces a score. Candidates re-rank. " +
    "Then it reads notes only from the top candidates. Recent notes first. Capped per node. If " +
    "confidence is below threshold, it drills deeper. If a branch is a dead end, it backtracks. " +
    "The loop runs until confidence exceeds threshold or max iterations reached. The final output " +
    "is a navigation map: what is where, what was found, what was not explored, what gaps remain. " +
    "Explored 1.15% of the branch. Found the answer. Did not read the other 98.85%. Each explore " +
    "writes its map to metadata so the next explore at the same position starts where the last one " +
    "stopped. The tree is too big for the AI to see all at once. Explore gives the AI eyes that " +
    "move through the tree the way yours move through code.",

  needs: {
    services: ["hooks", "llm", "session"],
    models: ["Node", "Note"],
  },

  optional: {
    extensions: [
      "embed",
      "long-memory",
      "codebook",
      "evolution",
      "contradiction",
      "inverse-tree",
      "scout",
      "intent",
    ],
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
        command: "explore [action] [args...]", scope: ["tree"],
        description: "Explore branch below current position. Actions: map, gaps. No action starts exploration.",
        method: "POST",
        endpoint: "/node/:nodeId/explore",
        subcommands: {
          "deep": {
            method: "POST",
            endpoint: "/node/:nodeId/explore/deep",
            args: ["query"],
            description: "More iterations, lower threshold",
          },
          "map": {
            method: "GET",
            endpoint: "/node/:nodeId/explore/map",
            description: "Show last explore map",
          },
          "gaps": {
            method: "GET",
            endpoint: "/node/:nodeId/explore/gaps",
            description: "Unexplored areas from last map",
          },
        },
      },
    ],

    hooks: {
      fires: [],
      listens: ["enrichContext"],
    },
  },
};
