export default {
  name: "fitness",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "A tree is a natural structure for a training program. A push/pull/legs split is three " +
    "branches. Each branch holds workout days. Each day holds exercises. Each exercise is a " +
    "leaf node with numeric values: weight, reps per set, duration, distance, RPE. The fitness " +
    "extension turns this structure into a living training log with an AI coach who reads the " +
    "tree, builds programs, tracks progress, and spots plateaus." +
    "\n\n" +
    "Two AI modes power the interaction, selected automatically by intent detection on the " +
    "incoming message. The fitness-coach mode is a knowledgeable training partner. It reads " +
    "the current tree structure, asks about goals and constraints, and builds full workout " +
    "programs as properly typed node branches: program nodes at the top, workout-day nodes " +
    "in the middle, exercise leaf nodes at the bottom. It understands progressive overload, " +
    "periodization, and recovery. It references specific numbers from prior sessions and " +
    "recommends weight increases, deloads, or exercise swaps based on the data. The " +
    "fitness-log mode is a fast data recorder. When the user reports workout results in " +
    "natural language (\"bench 135x10, 10, 8\" or \"squat 225 5x5\"), the log mode parses " +
    "the input into structured values on the correct exercise node, archives the session " +
    "via prestige (which snapshots values and resets for next time), and reports what comes " +
    "next. Prestige history becomes the workout log: each version is one completed session." +
    "\n\n" +
    "The enrichContext hook injects fitness-relevant data into the AI context when the user " +
    "is positioned on exercise, workout-day, program, or muscle-group nodes. Recent prestige " +
    "history surfaces as prior session data so the AI can compare across sessions without " +
    "extra lookups. Both modes support independent LLM slot assignments, so a land operator " +
    "can route coaching to a reasoning model and logging to a fast model. The extension " +
    "integrates optionally with values (numeric tracking), prestige (session archival), and " +
    "schedules (training day planning). Spatial scoping is respected: fitness can be blocked " +
    "on branches where it is not relevant.",

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
        command: "fitness [message...]", scope: ["tree"],
        description: "Talk to your fitness coach. Plans workouts, logs exercises, tracks progress.",
        method: "POST",
        endpoint: "/root/:rootId/fitness",
        body: ["message"],
      },
    ],
  },
};
