export default {
  name: "food",
  version: "2.0.0",
  builtFor: "TreeOS",
  description:
    "Nutrition tracking through tree structure. One node to talk to, three nodes that " +
    "count, one node that sees the picture. You say 'chicken breast and rice for lunch' " +
    "at the Log node. One LLM call parses it into macros. Cascade signals route protein " +
    "to the Protein node, carbs to the Carbs node, fats to the Fats node. Each macro " +
    "node increments its running total. Zero additional LLM calls. The Daily node reads " +
    "all siblings and shows the assembled picture. Navigate there, ask 'how am I doing' " +
    "or 'what should I eat for dinner', and the AI has everything it needs. The tree IS " +
    "the app. Nine kernel primitives and five extension systems working together through " +
    "the tree's own structure.",

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
    ],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: true,

    hooks: {
      fires: [],
      listens: ["enrichContext", "onCascade", "breath:exhale"],
    },

    cli: [
      {
        command: "food [message...]",
        scope: ["tree"],
        description: "Log food intake. Parses macros and routes to tracking nodes.",
        method: "POST",
        endpoint: "/root/:rootId/food",
        body: ["message"],
      },
    ],
  },
};
