export default {
  name: "sprout",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Auto-detects when a message implies a capability the tree doesn't have. " +
    "Confirms with the user, then scaffolds the domain. The tree grows from conversation.",

  needs: {
    services: ["hooks", "llm", "metadata"],
    models: ["Node"],
    extensions: ["life"],
  },

  optional: {
    extensions: ["tree-orchestrator", "navigation"],
  },

  provides: {
    models: {},
    routes: false,
    tools: true,
    jobs: false,
  },
};
