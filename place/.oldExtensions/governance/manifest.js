export default {
  name: "governance",
  version: "1.0.1",
  builtFor: "seed",
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
      { command: "governance-status", scope: ["land"], description: "Governance compliance status (cached)", method: "GET", endpoint: "/land/governance" },
      { command: "governance-check", scope: ["land"], description: "Live check against directory policies", method: "POST", endpoint: "/land/governance/check" },
    ],
  },
};
