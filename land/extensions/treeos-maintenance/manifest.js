export default {
  name: "treeos-maintenance",
  version: "1.0.0",
  type: "bundle",
  builtFor: "kernel",
  description:
    "Hygiene, memory, and awareness. Seven extensions that keep the tree clean and informed. " +
    "\n\n" +
    "Prune sheds dead weight. Identifies truly dormant nodes, absorbs their essence into " +
    "the parent, trims the branch. The tree shed a leaf because autumn came. Reversible. " +
    "\n\n" +
    "Reroot reorganizes the living tree. Builds a semantic similarity graph, compares " +
    "against actual structure, proposes moves that minimize distance between related nodes. " +
    "\n\n" +
    "Changelog reads the contribution audit trail and constructs a narrative of what changed. " +
    "What's new, what completed, what stalled, what the tree did autonomously. " +
    "\n\n" +
    "Purpose derives a thesis for each tree and checks coherence. Notes that drift from " +
    "the thesis get flagged. The tree stays focused on what it's for. " +
    "\n\n" +
    "Remember keeps a memorial when nodes are pruned, split off, or retired. One line on " +
    "the parent. What this branch was and when it left. The tree remembers what it lost. " +
    "\n\n" +
    "Digest assembles the daily briefing. Reads from every other extension and writes a " +
    "morning summary. What happened overnight. What needs attention. Pushes to gateway if " +
    "configured. The tree's daily newspaper. " +
    "\n\n" +
    "Delegate matches stuck work to available humans. Reads team contributor lists, activity " +
    "patterns, competence maps. Suggests, never assigns. The tree's social intelligence. " +
    "\n\n" +
    "Install: treeos ext install treeos-maintenance",

  needs: {
    extensions: [
      "prune",
      "reroot",
      "changelog",
      "purpose",
      "remember",
      "digest",
      "delegate",
    ],
  },

  optional: {},

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
  },
};
