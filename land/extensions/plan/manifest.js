export default {
  name: "plan",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Unified plan primitive. Every node has one metadata.plan namespace " +
    "with a steps[] array. Steps carry a kind discriminator (write, edit, " +
    "branch, test, probe, note, chapter, or extension defined). Branch " +
    "kind steps dispatch into child nodes that run their own plans. " +
    "Other extensions (swarm, code-workspace, book-workspace) call this " +
    "extension's api to add, update, and archive plans. The primitive " +
    "replaces two older namespaces: metadata.swarm.subPlan.branches and " +
    "metadata.code-workspace.plan.steps. One writer, one reader, one " +
    "renderer. Plans sit between chat (free) and structure (concrete) " +
    "on the solidity gradient. Plans graduate into the tree as work " +
    "completes.",

  territory: "planning decomposition steps branches chapters",

  needs: {
    services: ["hooks", "metadata", "tree"],
    models: ["Node"],
  },

  optional: {
    extensions: ["treeos-base", "html-rendering"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [],

    hooks: {
      // No fires declared yet. When step-change / archive hooks become
      // useful (e.g. downstream extensions want to react to plan
      // mutations), add them here AND fire them from plan/state/plan.js.
      // Keeping the manifest honest; declaring hooks that nothing fires
      // is a trap for consumers looking for extension points.
      fires: [],
      listens: [
        "afterMetadataWrite",
      ],
    },

    modes: [],
  },
};
