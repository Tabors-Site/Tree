export default {
  name: "prune",
  version: "1.0.0",
  description:
    "The tree sheds dead weight. Not compression where meaning is preserved in " +
    "smaller form. Actual removal of content that has no value anymore. " +
    "\n\n" +
    "Prune listens to evolution's dormancy metrics and long-memory's interaction " +
    "history. It identifies nodes that are truly dead. Not sleeping. Dead. No " +
    "visits in 90 days. No cascade signals received or originated. No codebook " +
    "entries. No contradictions referencing them. No other nodes linking to them " +
    "in metadata. Zero connections to anything alive. " +
    "\n\n" +
    "It marks them for pruning. Writes candidates to metadata.prune.candidates on " +
    "the tree root. The intent extension picks these up and presents them to the " +
    "user or, if autoPrune is enabled, trims them directly. Before trimming, it " +
    "runs one final check: sends the node's content to the AI with 'is there " +
    "anything here worth preserving?' If yes, the essential fact gets absorbed " +
    "into the parent's metadata.prune.absorbed dictionary. Then the node is trimmed. " +
    "\n\n" +
    "Trimmed is the same status tree-compress uses. The node stops appearing in " +
    "tree summaries, navigation, and enrichContext. The data stays in the database. " +
    "The AI can't see it. The user can't navigate to it unless they explicitly look. " +
    "The tree shed the leaf. The leaf is on the ground. It's not in the canopy " +
    "anymore but it's still on the land. Someone can pick it up later. " +
    "\n\n" +
    "The difference from tree-compress: compress keeps everything in denser form. " +
    "Prune actually lets go. The node is gone from the canopy. The branch is lighter. " +
    "The tree shed a leaf because autumn came. " +
    "\n\n" +
    "Restoration uses the same path as any trimmed node. decompress-node or " +
    "prune undo <nodeId> sets the status back to active. One status. One recovery " +
    "mechanism. The leaf goes back on the branch. " +
    "\n\n" +
    "If an operator wants true permanent removal, that's a separate purge operation " +
    "that runs on nodes already in trimmed status past a configurable grace period. " +
    "Prune decides what to shed. Purge decides what to destroy. Two different " +
    "decisions. Two different risk levels. Prune is reversible. Purge is not. " +
    "\n\n" +
    "Seasonal cycles. pruneInterval configurable. Some operators run it monthly. " +
    "Some quarterly. Some manually after a big project ends.",

  needs: {
    services: ["llm", "hooks", "contributions"],
    models: ["Node", "Contribution", "Note"],
  },

  optional: {
    services: ["energy"],
    extensions: [
      "evolution",
      "long-memory",
      "codebook",
      "contradiction",
      "pulse",
    ],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: true,
    orchestrator: false,
    energyActions: {
      pruneScan: { cost: 2 },
      pruneAbsorb: { cost: 1 },
    },
    sessionTypes: {},

    hooks: {
      fires: [],
      listens: ["afterBoot"],
    },

    cli: [
      {
        command: "prune [action] [args...]",
        description: "Pruning candidates for current tree. Actions: confirm, undo, history.",
        method: "GET",
        endpoint: "/root/:rootId/prune",
        subcommands: {
          "confirm": { method: "POST", endpoint: "/root/:rootId/prune/confirm", description: "Execute pruning" },
          "undo": { method: "POST", endpoint: "/root/:rootId/prune/undo", args: ["nodeId"], description: "Restore trimmed node" },
          "history": { method: "GET", endpoint: "/root/:rootId/prune/history", description: "What was shed and absorbed" },
        },
      },
    ],
  },
};
