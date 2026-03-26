export default {
  name: "monitor",
  version: "1.0.0",
  description:
    "Activity monitoring for the land, accessible through both AI conversation and raw data " +
    "endpoints. Registers the land:monitor mode, a conversational AI that acts like a talking " +
    "dashboard. Instead of dumping raw data, the monitor tells a story: '12 AI conversations " +
    "today, mostly on the Fitness tree. Your bench press had 3 sessions this week, progressing " +
    "from 130 to 140.' The mode has access to land-status, land-ext-list, land-users, " +
    "land-peers, land-system-nodes, land-config-read, get-contributions-by-user, and " +
    "get-root-nodes for gathering data before summarizing.\n\n" +
    "The POST /land/activity endpoint drives the conversational interface. It accepts a " +
    "natural language query, runs it through runChat in the land:monitor mode, and returns " +
    "the AI's narrative summary. The CLI command 'activity' maps to this endpoint, so admins " +
    "can ask 'what happened today' or 'which trees are busiest' from the command line.\n\n" +
    "The GET /land/activity endpoint provides structured data without AI involvement, designed " +
    "for dashboards and health checks. It aggregates contribution counts (today and this week), " +
    "chat session counts (today and this week), action type breakdowns (top 10 actions today), " +
    "AI mode usage breakdowns (top 10 mode/zone combinations today), total user count, loaded " +
    "extension count, and registered hooks. All date ranges are computed server-side (24 hours " +
    "and 7 days from request time). Both endpoints are admin-only.",

  needs: {
    services: ["hooks"],
    models: ["Node", "User", "Contribution"],
  },

  optional: {
    services: ["llm"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},

    hooks: {
      fires: [],
      listens: [],
    },

    cli: [
      {
        command: "activity [query...]",
        description: "Ask about land activity. What happened today, which trees are busiest, AI usage stats.",
        method: "POST",
        endpoint: "/land/activity",
        body: ["query"],
      },
    ],
  },
};
