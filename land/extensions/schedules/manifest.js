export default {
  name: "schedules",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Nodes exist in time, not just in space. A task has a due date. A goal has a review " +
    "cadence. A project milestone has a target ship date. Schedules attaches a date and a " +
    "reeffect interval to any node in the tree. The date is when. The reeffect time is how " +
    "many hours until the next occurrence after prestige advances the version. Together they " +
    "create recurring rhythms. A weekly review node with a 168-hour reeffect time will reset " +
    "its schedule forward by exactly one week every time it prestiges." +
    "\n\n" +
    "The calendar endpoint walks the entire tree from root, collecting every node that has " +
    "a schedule date set, optionally filtered to a date range. This gives a temporal view of " +
    "the tree. Not what is where, but what is when. The same tree that organizes by topic " +
    "also organizes by time without any structural compromise. A node under /Projects/Launch " +
    "shows up in the March calendar because it has a March 15th schedule, not because someone " +
    "duplicated it into a calendar branch." +
    "\n\n" +
    "enrichContext injects the schedule and reeffect time at every node so the AI knows about " +
    "temporal context. The AI at a node with a schedule date two days from now responds " +
    "differently than the AI at a node with no deadline. The prestige extension reads schedule " +
    "data through the exported updateSchedule function to advance dates on version completion. " +
    "Without prestige installed, schedules are still fully functional as standalone dates.",

  needs: {
    services: ["contributions", "hooks"],
    models: ["Node"],
  },

  optional: {
    services: ["energy"],
    extensions: ["html-rendering"],
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
      { command: "schedule <date>", scope: ["tree"], description: "Set schedule on current node", method: "POST", endpoint: "/node/:nodeId/editSchedule" },
      { command: "calendar", scope: ["tree"], description: "Show scheduled nodes for current tree", method: "GET", endpoint: "/root/:rootId/calendar" },
    ],
    hooks: {
      fires: [],
      listens: ["enrichContext"],
    },
  },
};
