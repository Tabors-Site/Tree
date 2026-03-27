export default {
  name: "food",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "Nutrition tracking maps naturally onto a tree. The root is the program. Macro groups " +
    "(calories, protein, carbs, fat) are branches. Daily logs hold meal nodes (breakfast, " +
    "lunch, dinner, snacks), and individual food items sit as leaves with numeric values: " +
    "calories, protein_g, carbs_g, fat_g. The tree's value accumulation means the root " +
    "always shows daily totals without manual math. The food extension turns this structure " +
    "into a conversational nutrition tracker with an AI coach that knows food, reads the " +
    "tree, and helps users hit their targets." +
    "\n\n" +
    "Two AI modes handle different intents, selected automatically by pattern matching on " +
    "the incoming message. The food-coach mode acts as a practical nutritionist. It helps " +
    "users set up their tracking tree, calculate calorie targets based on goals and activity " +
    "level, plan meals that fit remaining daily macros, and adjust strategy based on eating " +
    "patterns visible in prestige history. It knows approximate nutritional values for common " +
    "foods and asks smart clarifying questions about portion size and preparation when " +
    "estimates would vary significantly. The food-log mode is a fast intake recorder. When " +
    "the user reports what they ate (\"2 eggs and toast for breakfast\" or \"chicken and rice " +
    "for lunch\"), the log mode creates food-item nodes under the correct meal, sets calorie " +
    "and macro values based on nutritional knowledge, and immediately reports running daily " +
    "totals versus targets. Each food gets its own node for granular tracking." +
    "\n\n" +
    "The enrichContext hook injects food-relevant context when the user is positioned on " +
    "meal, food-item, macro-group, or day-log nodes. Recent prestige history surfaces as " +
    "prior day data so the coach can spot patterns (\"you usually have eggs and toast for " +
    "breakfast\") and make better suggestions without extra lookups. Both modes support " +
    "independent LLM slot assignments for routing coaching and logging to different models. " +
    "Daily resets work through prestige: archive the day's totals, start a fresh day node. " +
    "The extension integrates optionally with values, prestige, and schedules. Spatial " +
    "scoping is respected so food tracking can be confined to specific branches.",

  needs: {
    models: ["Node"],
  },

  optional: {
    services: ["llm"],
    extensions: ["values", "prestige", "schedules"],
  },

  provides: {
    routes: "./routes.js",
    tools: false,
    jobs: false,

    hooks: {
      fires: [],
      listens: ["enrichContext"],
    },

    cli: [
      {
        command: "food [message...]",
        description: "Talk to your food coach. Logs meals, tracks macros, plans nutrition.",
        method: "POST",
        endpoint: "/root/:rootId/food",
        body: ["message"],
      },
    ],
  },
};
