export default {
  name: "fitness",
  version: "3.0.1",
  builtFor: "TreeOS",
  description:
    "Multi-modality workout tracking. Three languages: gym (weight x reps x sets), " +
    "running (distance x time x pace), bodyweight (reps x sets or duration). One extension, " +
    "one LLM call detects modality and parses. The tree structure defines what exercises " +
    "exist. Gym bro, marathon runner, and someone doing pushups in their apartment all use " +
    "the same command. Progressive overload tracked per modality: weight goes up for gym, " +
    "mileage increases for running, harder variations for bodyweight. Four modes: log " +
    "(universal parser), coach (guided sessions), review (cross-modality analysis), plan " +
    "(program creation). Channels route logged data to exercise nodes. Food channel " +
    "integrates nutrition awareness. Type 'be' at the Fitness tree to start a guided " +
    "workout: the coach walks you through today's program set by set.",

  territory: "physical movement, training, exercise, how your body performs",
  classifierHints: [
    /\b\d+\s*x\s*\d+/i,                                        // "135x10"
    /\b(bench|squat|deadlift|press|curl|row|pull-?up|dip)\b/i,  // gym exercises
    /\b(push-?ups?|sit-?ups?|burpees?|plank|lunges?)\b/i,       // bodyweight
    /\b(ran|run|jog|sprint|mile|marathon|pace|tempo|5k|10k)\b/i, // running
    /\b(workouts?|exercises?|training|sets|reps)\b/i,               // fitness-specific
    /\b(chest|back|legs|shoulders|core|calves|bicep|tricep)\b/i, // muscle groups
    /\b(yoga|stretching|plank|hold.*seconds|pose)\b/i,           // flexibility
    /\b(pr|personal record|fastest|heaviest|longest)\b/i,        // records
  ],

  needs: {
    models: ["Node", "Note"],
    services: ["hooks", "metadata"],
  },

  optional: {
    services: ["llm"],
    extensions: [
      "values",          // numeric tracking on exercise nodes
      "channels",        // signal paths from log to exercise nodes
      "breath",          // session timing
      "schedules",       // workout schedule
      "scheduler",       // missed workout detection
      "food",            // nutrition integration via channels
      "notifications",   // missed workout alerts
      "phase",           // suppress during focus
      "treeos-base",     // tool navigation registration
      "html-rendering",  // dashboard page
    ],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: false,
    guidedMode: "tree:fitness-coach",

    hooks: {
      fires: [],
      listens: ["enrichContext", "onCascade", "afterBoot"],
    },

    cli: [
      {
        command: "fitness [message...]",
        scope: ["tree"],
        description: "Log any workout, start a guided session, or ask about progress.",
        method: "POST",
        endpoint: "/root/:rootId/fitness",
        bodyMap: { message: 0 },
      },
    ],
  },
};
