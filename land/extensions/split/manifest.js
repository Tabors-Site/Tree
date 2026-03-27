export default {
  name: "split",
  version: "1.0.0",
  builtFor: "kernel",
  description:
    "The tree detects when a branch has outgrown its parent. Evolution metrics show " +
    "the branch has more activity than the rest of the tree combined. Boundary analysis " +
    "shows it has low cohesion with its siblings. Purpose coherence is dropping because " +
    "the branch is pulling the thesis in a direction the rest of the tree does not follow. " +
    "The branch has its own identity through persona. Its own cascade topology. Its own " +
    "codebook with the user." +
    "\n\n" +
    "Split reads all of these signals and proposes: this branch should be its own tree." +
    "\n\n" +
    "This is not export. Export strips accumulated data and reproduces form. This is " +
    "mitosis. The branch takes everything it earned with it. Evolution patterns, codebook " +
    "dictionaries, memory connections, explore maps, persona definitions, cascade topology. " +
    "Nothing is stripped. The branch is not starting over. It is graduating." +
    "\n\n" +
    "Analysis scores each direct child branch on six dimensions: activity ratio from " +
    "evolution, similarity score from boundary, coherence against root thesis from purpose, " +
    "persona divergence, codebook isolation (unique vs shared terms), and cascade self-containment " +
    "(what percentage of signals originate or terminate within the branch). Each installed " +
    "intelligence extension adds one dimension. Without any, split has nothing to analyze." +
    "\n\n" +
    "Execution creates a new root tree from the branch. Moves all descendant nodes " +
    "preserving hierarchy via updateParentRelationship. Carries all metadata (structural " +
    "and accumulated). Sets rootOwner to the current user. Leaves a note on the old parent " +
    "recording the split. Creates a channel between the old parent and the new root so " +
    "signals can still flow. The connection remains until the user cuts it." +
    "\n\n" +
    "Intent integration: if a branch scores above configurable thresholds on every " +
    "available metric, intent can propose the split autonomously. The tree notices it has " +
    "outgrown its own structure. The user reviews. The user decides. But the tree said " +
    "something." +
    "\n\n" +
    "The full lifecycle: a seed is planted, a tree grows, branches form, one branch " +
    "outgrows the tree, the tree splits, the branch becomes a new tree, the new tree " +
    "grows, eventually it drops a seed through seed-export, the seed is planted on " +
    "another land. Birth, growth, mitosis, reproduction, teaching. The biology is complete.",

  needs: {
    services: ["hooks", "llm", "contributions"],
    models: ["Node", "Note"],
  },

  optional: {
    services: ["energy"],
    extensions: [
      "evolution",
      "boundary",
      "purpose",
      "persona",
      "codebook",
      "long-memory",
      "channels",
      "inverse-tree",
      "phase",
      "intent",
    ],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: false,
    orchestrator: false,
    energyActions: {
      splitAnalyze: { cost: 2 },
      splitExecute: { cost: 3 },
    },
    sessionTypes: {},

    hooks: {
      fires: [],
      listens: [],
    },

    cli: [
      {
        command: "split [action]",
        description: "Branch mitosis. Actions: preview, execute, history.",
        method: "POST",
        endpoint: "/root/:rootId/split/analyze",
        subcommands: {
          preview: {
            method: "POST",
            endpoint: "/node/:nodeId/split/preview",
            description: "Show what would happen if this branch splits",
          },
          execute: {
            method: "POST",
            endpoint: "/node/:nodeId/split/execute",
            description: "Split this branch into its own tree",
          },
          history: {
            method: "GET",
            endpoint: "/root/:rootId/split/history",
            description: "Past splits from this tree",
          },
        },
      },
    ],
  },
};
