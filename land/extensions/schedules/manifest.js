export default {
  name: "schedules",
  version: "1.0.0",
  description: "Date scheduling and calendar views for nodes",

  needs: {
    models: ["Node"],
  },

  optional: {
    services: ["energy"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: false,
    orchestrator: false,
    energyActions: {
      editSchedule: { cost: 1 },
    },
    sessionTypes: {},
    cli: [
      { command: "schedule <date>", description: "Set schedule on current node", method: "POST", endpoint: "/node/:nodeId/editSchedule" },
      { command: "calendar", description: "Show scheduled nodes for current tree", method: "GET", endpoint: "/root/:rootId/calendar" },
    ],
  },
};
