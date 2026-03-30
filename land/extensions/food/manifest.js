export default {
  name: "food",
  version: "2.1.0",
  builtFor: "TreeOS",
  description:
    "Nutrition tracking through tree structure. Log node receives food input. One LLM " +
    "call parses macros. Cascade routes to Protein, Carbs, Fats nodes. Meals subtree " +
    "tracks patterns by slot (Breakfast, Lunch, Dinner, Snacks). Profile node holds goals " +
    "and restrictions. History node archives daily summaries with weekly averages and hit " +
    "rates. Three modes: food-log (parser), food-review (advisor with weekly patterns), " +
    "food-coach (setup and goal setting). Fitness channel carries workout data both ways. " +
    "Type 'be' at the Food tree to start logging: just say what you ate. The tree IS the app.",

  classifierHints: [
    /\b(ate|had|eaten|drank|breakfast|lunch|dinner|snack|calories|protein|carbs|fats|macro)\b/i,
    /\b(egg|chicken|rice|bread|salmon|banana|oat|milk|cheese|beef|pork|tofu|yogurt)\b/i,
    /\b(meal|food|nutrition|diet|eat|hungry|cook)\b/i,
  ],

  needs: {
    models: ["Node"],
    services: ["hooks", "metadata"],
  },

  optional: {
    services: ["llm"],
    extensions: [
      "values",          // macro tracking (today/goal per node)
      "channels",        // direct signal paths Log -> macro nodes
      "breath",          // daily reset sync
      "notifications",   // overdue meal reminders
      "phase",           // suppress during focus
      "schedules",       // meal timing
      "html-rendering",  // dashboard page
    ],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: true,
    guidedMode: "tree:food-coach",

    hooks: {
      fires: [],
      listens: ["enrichContext", "onCascade", "breath:exhale"],
    },

    cli: [
      {
        command: "food [message...]",
        scope: ["tree"],
        description: "Log food or ask about nutrition.",
        method: "POST",
        endpoint: "/root/:rootId/food",
        body: ["message"],
      },
      {
        command: "food-daily",
        scope: ["tree"],
        description: "Today's nutrition dashboard.",
        method: "GET",
        endpoint: "/root/:rootId/food/daily",
      },
      {
        command: "food-week",
        scope: ["tree"],
        description: "Weekly nutrition review.",
        method: "GET",
        endpoint: "/root/:rootId/food/week",
      },
      {
        command: "food-profile",
        scope: ["tree"],
        description: "Dietary profile and goals.",
        method: "GET",
        endpoint: "/root/:rootId/food/profile",
      },
    ],
  },
};
