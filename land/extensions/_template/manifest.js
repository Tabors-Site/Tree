export default {
  name: "my-extension",
  version: "1.0.0",
  description: "Description of what this extension does",

  needs: {
    services: [],
    models: ["Node"],
    extensions: [],
  },

  optional: {
    services: ["energy"],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    energyActions: {},
    sessionTypes: {},
    cli: [],
  },
};
