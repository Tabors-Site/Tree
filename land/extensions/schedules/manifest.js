export default {
  name: "schedules",
  version: "1.0.0",
  description: "Cron and ISO date scheduling for node versions",

  needs: {
    models: ["Node"],
  },

  optional: {
    services: ["energy"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {
      editSchedule: { cost: 1 },
    },
    sessionTypes: {},
  },
};
