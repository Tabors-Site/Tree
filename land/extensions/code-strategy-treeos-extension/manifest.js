export default {
  name: "code-strategy-treeos-extension",
  version: "0.1.0",
  builtFor: "TreeOS",
  scope: "confined",
  description:
    "TreeOS-extension strategy package for code-workspace. Ships a short " +
    "explanatory context block plus wrapper functions for scaffolding a new " +
    "extension: treeos-ext-scaffold, treeos-ext-add-mode, treeos-ext-add-tool, " +
    "treeos-ext-verify. The manifest contract, metadata namespace rules, and " +
    "hook semantics are baked into the wrappers so the agent never re-derives " +
    "them from prose rules.",

  needs: {
    services: [],
    models: ["Node", "Note"],
    extensions: ["code-workspace"],
  },

  optional: {
    extensions: ["swarm"],
  },

  provides: {
    models: {},
    routes: false,
    tools: true,
    jobs: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [],
  },
};
