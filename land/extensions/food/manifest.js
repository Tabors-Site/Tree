export default {
  name: "food",
  version: "2.1.2",
  builtFor: "TreeOS",
  description:
    "Nutrition tracking through tree structure. Log node receives food input. One LLM " +
    "call parses macros. Cascade routes to Protein, Carbs, Fats nodes. Meals subtree " +
    "tracks patterns by slot (Breakfast, Lunch, Dinner, Snacks). Profile node holds goals " +
    "and restrictions. History node archives daily summaries with weekly averages and hit " +
    "rates. Three modes: food-log (parser), food-review (advisor with weekly patterns), " +
    "food-coach (setup and goal setting). Fitness channel carries workout data both ways. " +
    "Type 'be' at the Food tree to start logging: just say what you ate. The tree IS the app.",

  territory: "food, meals, eat, eating, ate, hungry, nutrition, cooking, calories, protein, carbs, diet, snack, breakfast, lunch, dinner",

  // Territory vocabulary split by part of speech.
  //
  // Philosophy: do not enumerate every food. That's a losing game.
  // Instead, declare strong domain markers:
  //   - Verbs of consumption ("ate", "had X", "drank") catch anything followed
  //     by a food-shaped phrase, no matter what the specific food is.
  //   - Nouns are domain-category words (meal slots, macros, "food" itself),
  //     not specific ingredients.
  //   - Adjectives are hunger/fullness states and diet labels.
  //
  // This way "had a dragon fruit" routes to food via the verb without needing
  // "dragon fruit" in a dictionary.
  vocabulary: {
    verbs: [
      // Direct consumption verbs
      /\b(ate|eaten|eating|drank|drinking|drink|eat)\b/i,
      // "had X" where X is something (meal slot, food noun, or anything).
      // "had a/an/some/my/the X", or "had two/three X", or "had X for breakfast".
      /\b(had|having)\s+(?:a|an|some|my|the|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i,
      /\b(had|having)\s+\w+\s+(?:for\s+(?:breakfast|lunch|dinner|a\s+snack))\b/i,
      // Preparation verbs
      /\b(cook|cooking|cooked|prepped|prep|grabbed|made)\s+(?:a|an|some|breakfast|lunch|dinner|snack|meal|food)\b/i,
      // Explicit logging
      /\b(log|logged|track|tracking)\s+(?:my\s+)?(?:food|meal|breakfast|lunch|dinner|snack|calories?|macros?)\b/i,
      // Fasting / skipping
      /\b(fasting|skipping\s+(?:breakfast|lunch|dinner|a\s+meal))\b/i,
    ],
    nouns: [
      // Meal slots and category words
      /\b(meals?|food|foods|nutrition|diet|dieting|appetite)\b/i,
      /\b(breakfast|lunch|dinner|snack|snacks|brunch|supper)\b/i,
      // Macro tracking terms
      /\b(calories?|protein|carbs?|fats?|macros?|fiber|sugar|sodium|nutrients?)\b/i,
    ],
    adjectives: [
      /\b(hungry|starving|full|stuffed|famished|peckish|bloated)\b/i,
      /\b(high[- ]protein|low[- ]carb|keto|vegan|vegetarian|gluten[- ]free|plant[- ]based)\b/i,
    ],
  },

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
      "treeos-base",     // slot registration
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
