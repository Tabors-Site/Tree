export default {
  name: "life",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Scaffolding library for domain trees. Creates Life roots, group nodes, " +
    "and domain scaffolds. Pure machinery. Sprout is the user-facing entry point. " +
    "Operators can use `life add <domain>` as an admin shortcut.",

  needs: {
    models: ["Node"],
    services: ["hooks", "metadata"],
  },

  optional: {
    extensions: ["food", "fitness", "study", "recovery", "kb", "channels"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,

    cli: [
      {
        command: "life",
        scope: ["home"],
        description: "Life tree management. Use: life add <domain>, life domains",
        method: "GET",
        endpoint: "/life/domains",
        subcommands: {
          add: {
            method: "POST",
            endpoint: "/life/add",
            description: "Add a domain to your Life tree. e.g. life add food",
            args: ["domain"],
          },
          domains: {
            method: "GET",
            endpoint: "/life/domains",
            description: "List available and scaffolded domains",
          },
        },
      },
    ],
  },
};
