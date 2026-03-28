export default {
  name: "scheduler",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "The clock that watches the calendar. Reads schedule data from nodes, builds " +
    "an in-memory timeline, and signals when items are upcoming, due, or overdue. " +
    "Syncs to the tree's breathing rhythm. Tracks completion patterns over time. " +
    "The AI sees what's due without being asked.",

  needs: {
    models: ["Node"],
    services: ["hooks", "metadata"],
  },

  optional: {
    extensions: [
      "schedules",       // reads schedule data from nodes
      "breath",          // syncs to breath cycle
      "notifications",   // persistent reminders
      "gateway",         // push to external channels
      "intent",          // overdue items become intents
      "purpose",         // prioritize by coherence
      "phase",           // suppress during focus
      "digest",          // morning timeline
    ],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: true,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    hooks: {
      fires: ["scheduler:itemDue"],
      listens: ["breath:exhale", "afterStatusChange", "enrichContext"],
    },
    cli: [
      {
        command: "schedule-check",
        scope: ["tree"],
        description: "Show due, upcoming, and overdue items",
        method: "GET",
        endpoint: "/scheduler/check",
      },
      {
        command: "schedule-reliability",
        scope: ["tree"],
        description: "Show completion patterns at this node",
        method: "GET",
        endpoint: "/scheduler/reliability",
      },
    ],
  },
};
