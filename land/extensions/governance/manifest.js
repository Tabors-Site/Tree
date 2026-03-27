export default {
  name: "governance",
  version: "1.0.0",
  description:
    "Network governance visibility. Fetches governance policies from configured directories " +
    "and surfaces them to the land-manager AI. Shows current seed version, minimum required " +
    "version, recommended version, and compatibility status. Never forces updates. Only informs.",

  needs: {
    services: [],
    models: [],
  },

  optional: {
    extensions: ["land-manager"],
  },

  provides: {
    routes: "./routes.js",
    tools: true,
    jobs: true,
    hooks: {
      listens: ["enrichContext", "afterBoot"],
    },
    cli: [
      {
        command: "governance",
        description: "Show governance status for all configured directories",
        method: "GET",
        endpoint: "/land/governance",
      },
    ],
  },
};
