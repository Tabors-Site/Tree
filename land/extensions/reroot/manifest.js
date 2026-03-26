export default {
  name: "reroot",
  version: "1.0.0",
  description:
    "The tree reorganizes itself. Nodes end up in the wrong place over time. " +
    "A task that started under Work actually belongs under Side Projects. A note " +
    "about nutrition is buried three levels deep in a fitness branch when it should " +
    "be a sibling of the food node. The tree grew organically and the organic " +
    "structure doesn't match the logical structure anymore. " +
    "\n\n" +
    "Reroot runs an analysis pass. It reads every node's content, its enrichContext " +
    "snapshot, its codebook relationships, its cascade connections, its evolution " +
    "patterns. It builds a similarity graph: which nodes reference similar concepts, " +
    "share codebook entries, exchange cascade signals frequently, or have overlapping " +
    "perspective filters. " +
    "\n\n" +
    "Then it compares the similarity graph against the actual tree structure. Nodes " +
    "that are semantically close but structurally far apart are candidates for " +
    "reorganization. Nodes that are structurally adjacent but semantically unrelated " +
    "are candidates for separation. " +
    "\n\n" +
    "It generates a reorganization plan. Not a flat 'move X to Y' list. A proposed " +
    "tree structure showing where every misplaced node would fit better. The AI " +
    "produces it with constraints: do not break ownership boundaries, do not move " +
    "nodes with rootOwner set, preserve cascade configurations. " +
    "\n\n" +
    "The plan writes to metadata.reroot.proposal on the tree root. The user reviews " +
    "it. reroot preview shows the proposed changes with before/after. reroot apply " +
    "executes the moves. reroot reject discards the proposal. " +
    "\n\n" +
    "The tree rebuilt itself. Not by growing new branches. By rearranging the ones " +
    "it has so the structure matches the meaning.",

  needs: {
    services: ["llm", "hooks", "contributions"],
    models: ["Node", "Note"],
  },

  optional: {
    services: ["energy"],
    extensions: [
      "codebook",
      "evolution",
      "understanding",
    ],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {
      rerootAnalyze: { cost: 3 },
    },
    sessionTypes: {},

    cli: [
      {
        command: "reroot [action]",
        description: "Analyze and propose reorganization. Actions: preview, apply, reject.",
        method: "POST",
        endpoint: "/root/:rootId/reroot/analyze",
        subcommands: {
          "preview": { method: "GET", endpoint: "/root/:rootId/reroot", description: "Show proposed moves with reasons" },
          "apply": { method: "POST", endpoint: "/root/:rootId/reroot/apply", description: "Execute the reorganization" },
          "reject": { method: "POST", endpoint: "/root/:rootId/reroot/reject", description: "Discard proposal" },
        },
      },
    ],
  },
};
