export default {
  name: "fitness",
  version: "2.0.0",
  builtFor: "TreeOS",
  description:
    "The tree is the workout. Muscle groups are nodes. Exercises are children. " +
    "Values track sets, reps, and weight. Channels connect exercise nodes to the " +
    "log receiver. One LLM call parses natural language workout input into structured " +
    "data. Cascade routes each exercise to its node. No additional LLM calls. " +
    "Progressive overload tracked through value goals. When all sets hit their rep " +
    "target, the AI suggests increasing weight. History builds reliability patterns. " +
    "Guided workout mode walks you through today's session set by set.",

  needs: {
    models: ["Node"],
    services: ["hooks", "metadata"],
  },

  optional: {
    services: ["llm"],
    extensions: [
      "values",          // sets, reps, weight tracking
      "channels",        // signal paths from log to exercise nodes
      "breath",          // session timing
      "schedules",       // workout schedule
      "scheduler",       // missed workout detection
      "food",            // nutrition integration via channels
      "notifications",   // missed workout alerts
      "phase",           // suppress during focus
    ],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: true,

    hooks: {
      fires: [],
      listens: ["enrichContext", "onCascade", "afterStatusChange"],
    },

    cli: [
      {
        command: "fitness [message...]",
        scope: ["tree"],
        description: "Log a workout, start a guided session, or ask about progress.",
        method: "POST",
        endpoint: "/root/:rootId/fitness",
        body: ["message"],
      },
    ],
  },
};
