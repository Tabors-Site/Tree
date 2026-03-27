export default {
  name: "changelog",
  version: "1.0.0",
  builtFor: "treeos-maintenance",
  description:
    "The tree remembers what changed and why. Every structural change, every compression, " +
    "every prune, every reroot move gets a human-readable entry. Not the contribution log. " +
    "That is the audit trail of who did what and when. The changelog is the narrative of why " +
    "the tree looks the way it does now. " +
    "\n\n" +
    "Contributions record operations: user X created node Y at timestamp Z. Factual, " +
    "complete, mechanical. The changelog records decisions: the fitness branch was " +
    "reorganized because workouts were scattered across three sections, and the prune " +
    "extension identified the overlap. The old cooking branch was archived because evolution " +
    "showed 90 days of dormancy and zero cascade activity. Two duplicate project nodes were " +
    "merged by reroot after boundary detected a 0.92 similarity score between them. " +
    "\n\n" +
    "Hooks listen to the extensions that reshape trees. When prune removes dead branches, " +
    "the changelog records what was pruned and why the pruning criteria were met. When " +
    "reroot moves orphaned nodes, it records where they came from, where they went, and " +
    "what evidence triggered the move. When tree-compress runs and produces new summaries, " +
    "the changelog notes the compression scope and what changed in the tree's understanding " +
    "of itself. " +
    "\n\n" +
    "When a new contributor joins a tree, they read the changelog to understand the tree's " +
    "history without reading every note. When the owner returns after a month away, the " +
    "changelog shows what the autonomous extensions did while they were gone. When two " +
    "lands peer through canopy, the changelog gives the remote land context about how " +
    "the tree evolved. The tree's memory of its own structural decisions.",

  needs: {
    services: ["hooks"],
    models: ["Node"],
  },

  optional: {
    extensions: ["prune", "reroot", "tree-compress"],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    cli: [],
    hooks: { fires: [], listens: [] },
  },
};
