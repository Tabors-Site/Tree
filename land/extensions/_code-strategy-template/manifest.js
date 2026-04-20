export default {
  // Replace "my-domain" with your strategy name, lowercase+hyphens.
  // Convention: prefix with "code-strategy-" so it sorts with its peers.
  name: "code-strategy-my-domain",
  version: "0.1.0",
  builtFor: "TreeOS",
  scope: "confined",
  description:
    "Describe what this strategy covers in one paragraph. Mention the " +
    "domain (e.g. 'React components', 'Rust Axum backend', 'Svelte UI') " +
    "and list the wrapper functions it adds to code-plan.",

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
