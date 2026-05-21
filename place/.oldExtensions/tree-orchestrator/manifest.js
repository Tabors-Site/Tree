export default {
  name: "tree-orchestrator",
  version: "2.0.0",
  builtFor: "TreeOS",
  description:
    "Routing index utility — tracks which extensions are scaffolded in " +
    "which tree. Read by sprout, misroute, treeos-base, and go. " +
    "\n\n" +
    "The orchestration loop (chat/place/query/be dispatch, sub-Ruler " +
    "recursion, plan execution, mode switching, classifier routing) " +
    "was retired in 2.0 when tree-zone CHAT/PLACE/QUERY moved to " +
    "SUMMON. The Ruler being at the tree root receives messages in " +
    "its inbox; the per-being scheduler invokes rulerRole.summon. " +
    "No orchestration code path remains; what's left is the routing " +
    "index utility other extensions still consume. " +
    "\n\n" +
    "Eventually replaced by extensionSeeds (scaffold primitive that " +
    "would make `which extensions are present at this position` a " +
    "substrate fact, not a derived index). At that point this " +
    "extension retires entirely.",

  needs: {
    services: ["hooks"],
    models: ["Node"],
    extensions: [],
  },

  optional: {},

  provides: {
    routes: false,
    tools: false,
    jobs: false,
    hooks: {
      fires: [],
      listens: ["afterBoot", "afterMetadataWrite", "beforeNodeDelete", "afterScopeChange", "afterNodeMove"],
    },
  },
};
