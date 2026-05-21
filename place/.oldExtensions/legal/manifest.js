export default {
  name: "legal",
  version: "1.0.3",
  builtFor: "TreeOS",
  description:
    "Terms of Service and Privacy Policy pages. Renders on /terms and /privacy. " +
    "The register page conditionally shows agreement text and modals when this " +
    "extension is installed. Without it, no legal pages, no agreement checkbox.",

  needs: {},

  optional: {
    extensions: ["html-rendering", "treeos-base"],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [],
    hooks: { fires: [], listens: [] },
  },
};
