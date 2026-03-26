export default {
  name: "dreams",
  version: "1.0.0",
  description:
    "Trees accumulate entropy. Nodes end up under the wrong parent. Dense notes pile up " +
    "on a single node instead of branching into structure. Deferred items sit in short-term " +
    "memory waiting to be placed. Compress summaries go stale. Left alone, a tree drifts " +
    "from organized knowledge into a cluttered attic. Dreams is the nightly maintenance " +
    "cycle that fights this. " +
    "\n\n" +
    "Each tree can set a dream time (HH:MM). A background job checks every 30 minutes " +
    "whether any tree's dream time has passed and whether it has already dreamed today. " +
    "When a tree is due, the full pipeline runs. Phase 1: cleanup. The AI analyzes the " +
    "tree structure and moves misplaced nodes to better parents, deletes empty orphans, " +
    "and expands dense notes into proper subtree branches. Cleanup runs up to five passes, " +
    "stopping early when a pass produces zero changes. Phase 2: short-term drain. Pending " +
    "items in the ShortMemory collection are clustered by theme, scouted for placement " +
    "locations in the tree, planned with confidence scores, then placed as notes on the " +
    "correct nodes. Items that fail three drain attempts are escalated to holdings for " +
    "human review. Drain runs up to five passes. Phase 3: understanding. If the " +
    "understanding extension is installed, a compression run updates the bottom-up " +
    "summaries across the tree. Phase 4: notifications. The AI reviews all chat records " +
    "from the dream's sessions and generates two outputs: a factual summary of what " +
    "changed and a reflective thought about the tree's direction. Both are saved as " +
    "notifications and dispatched to gateway channels if the gateway extension is present. " +
    "\n\n" +
    "Seven custom AI modes power the pipeline: cleanup-analyze, cleanup-expand-scan, " +
    "drain-cluster, drain-scout, drain-plan, dream-summary, and dream-thought. Each has " +
    "its own LLM slot mapping so land operators can assign different models to different " +
    "phases. The cleanup slot, drain slot, and notification slot are independently " +
    "configurable per tree. " +
    "\n\n" +
    "Concurrency is controlled by the kernel's lock system. Only one dream can run per " +
    "tree at a time. Trees with no children, no LLM connection, or no configured dream " +
    "time are skipped. The lastDreamAt timestamp on root metadata prevents double-runs " +
    "within the same day. Holdings (deferred items) are accessible via CLI and API for " +
    "manual review, detail inspection, and dismissal.",

  needs: {
    services: [],
    models: ["Node", "Contribution"],
    extensions: ["understanding"],
  },

  optional: {
    services: ["energy", "llm"],
    extensions: ["gateway", "notifications"],
  },

  provides: {
    models: {
      ShortMemory: "./model.js",
    },
    routes: "./routes.js",
    tools: false,
    jobs: "./treeDream.js",
    orchestrator: false,
    energyActions: {},
    sessionTypes: {
      DREAM_ORCHESTRATE: "dream-orchestrate",
      DREAM_NOTIFY: "dream-notify",
      SHORT_TERM_DRAIN: "short-term-drain",
      CLEANUP_REORGANIZE: "cleanup-reorganize",
      CLEANUP_EXPAND: "cleanup-expand",
    },
    cli: [
      { command: "dream-time <time>", description: "Set daily dream time (HH:MM) for current tree", method: "POST", endpoint: "/root/:rootId/dream-time" },
      { command: "holdings", description: "List deferred items for current tree", method: "GET", endpoint: "/root/:rootId/holdings" },
      { command: "holdings-dismiss <id>", description: "Dismiss a deferred item", method: "POST", endpoint: "/root/:rootId/holdings/:id/dismiss" },
      { command: "holdings-view <id>", description: "View details of a deferred item", method: "GET", endpoint: "/root/:rootId/holdings/:id" },
    ],
    hooks: {
      fires: [],
      listens: [],
    },
  },
};
