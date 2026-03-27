export default {
  name: "treeos-maintenance",
  version: "1.0.0",
  type: "bundle",
  builtFor: "kernel",
  description:
    "Hygiene and reorganization. Two extensions that keep the tree clean. " +
    "\n\n" +
    "Intelligence makes the tree self-aware. Maintenance makes the tree " +
    "self-cleaning. Different concerns. Different install decision. A small " +
    "personal tree might want intelligence but never need maintenance because " +
    "the operator manually reorganizes. A large team tree might need maintenance " +
    "desperately but not want autonomous intent behavior. " +
    "\n\n" +
    "Prune sheds dead weight. It identifies nodes that are truly dead. No visits " +
    "in 90 days. No cascade signals. No codebook entries. No contradictions " +
    "referencing them. Zero connections to anything alive. Before trimming, it " +
    "asks the AI if anything is worth preserving. If yes, the essential fact gets " +
    "absorbed into the parent. Then the node is trimmed. The tree shed a leaf " +
    "because autumn came. The leaf is on the ground. Still on the land. Someone " +
    "can pick it up later. Purge permanently removes nodes past a grace period. " +
    "Prune is reversible. Purge is not. Two different decisions. " +
    "\n\n" +
    "Reroot reorganizes the living tree. Nodes end up in the wrong place over " +
    "time. A task under Work belongs under Side Projects. A note about nutrition " +
    "is buried in a fitness branch when it should be beside the food node. Reroot " +
    "builds a semantic similarity graph, compares it against actual structure, and " +
    "proposes moves that minimize distance between related nodes. The user reviews " +
    "and applies. The tree rebuilt itself by rearranging branches so structure " +
    "matches meaning. " +
    "\n\n" +
    "Install: treeos ext install treeos-maintenance",

  needs: {
    extensions: [
      "prune",
      "reroot",
      "changelog",
      "purpose",
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
