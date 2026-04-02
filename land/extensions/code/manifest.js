export default {
  name: "code",
  version: "1.0.0",
  builtFor: "seed",
  scope: "confined",
  description:
    "A codebase becomes a tree. Directories become nodes. Files become notes. " +
    "The AI at /myproject/src/components/Button knows Button's code, its children, " +
    "its siblings, its tests. Navigate somewhere and the AI thinks about that code " +
    "from that position. " +
    "\n\n" +
    "Six modes. Each is a specialist. Chains replace one big loop. " +
    "code-analyze reads and understands. code-search triangulates across the codebase " +
    "with five strategies and convergence scoring. code-plan designs the change. " +
    "code-edit applies diffs. code-test runs and parses tests. code-review checks " +
    "the work. A cheap model handles search and test. A quality model handles planning " +
    "and editing. Total cost for a bug fix: less than one large model call. " +
    "\n\n" +
    "Once code is in the tree, the intelligence bundle works on it automatically. " +
    "Understanding compresses modules. Scout searches across files. Explore drills " +
    "into unfamiliar code. Codebook tracks recurring patterns. Evolve detects gaps. " +
    "Inner monologue thinks about the codebase on breath cycles. " +
    "\n\n" +
    "Automate flows run CI, code review, and documentation generation on schedule. " +
    "The tree watches its own codebase while you sleep.",

  classifierHints: [
    /\b(code|codebase|repository|repo|source code|source file)\b/i,
    /\b(function|class|module|import|export|require)\b/i,
    /\b(bug|fix|refactor|lint|test|compile|build)\b/i,
    /\b(ingest|analyze|diff|blame|commit)\b/i,
  ],

  needs: {
    services: ["hooks", "llm", "metadata", "tree"],
    models: ["Node", "Note"],
  },

  optional: {
    extensions: ["shell", "embed", "understanding", "scout", "explore", "treeos-base"],
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
        command: "code [action] [args...]",
        scope: ["tree"],
        description: "Code operations. Actions: ingest <path>, search <query>, status, git-status, git-diff, git-log.",
        method: "GET",
        endpoint: "/code/status?nodeId=:nodeId",
      },
    ],

    hooks: {
      fires: [],
      listens: ["enrichContext"],
    },
  },
};
