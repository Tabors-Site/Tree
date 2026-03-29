export default {
  name: "treeos",
  type: "os",
  version: "1.0.0",
  builtFor: "kernel",
  description:
    "The first operating system built on the seed. " +
    "Four bundles, twenty base extensions, nine standalone. " +
    "Install once and the tree thinks, navigates, structures, edits, reads, writes, " +
    "responds, cascades, compresses, detects contradictions, acts autonomously, " +
    "breathes, remembers every age, and connects to the world through eight channel types. " +
    "The operator decides what to keep.",

  bundles: [
    "treeos-cascade@^1.0.0",
    "treeos-connect@^1.0.0",
    "treeos-intelligence@^1.0.0",
    "treeos-maintenance@^1.0.0",
  ],

  standalone: [
    "treeos-base@^1.0.0",
    "tree-orchestrator@^1.0.0",
    "land-manager@^1.0.0",
    "navigation@^1.0.0",
    "starter-types@^1.0.0",
    "console@^1.0.0",
    "dashboard@^1.0.0",
    "notifications@^1.0.0",
    "monitor@^1.0.0",
    "llm-response-formatting@^1.0.0",
    "team@^1.0.0",
    "user-tiers@^1.0.0",
    "html-rendering@^1.0.0",
    "water@^1.0.0",
    "heartbeat@^1.0.0",
    "purpose@^1.0.0",
    "phase@^1.0.0",
    "remember@^1.0.0",
    "breath@^1.0.0",
    "instructions@^1.0.0",
    "persona@^1.0.0",
    "mycelium@^1.0.0",
    "peer-review@^1.0.0",
    "seed-export@^1.0.0",
    "channels@^1.0.0",
    "governance@^1.0.0",
    "teach@^1.0.0",
    "split@^1.0.0",
    "approve@^1.0.0",
  ],

  config: {
    cascadeEnabled: true,
    treeCircuitEnabled: true,
  },

  orchestrators: {
    tree: "tree-orchestrator",
    land: "land-manager",
    home: "treeos-base",
  },
};
