export default {
  name: "fitness",
  version: "3.0.3",
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

  // Territory vocabulary split by part of speech.
  // Verbs: actions the domain handles (lifting, running, holding).
  // Nouns: the things the domain tracks (exercises, muscle groups, PRs, sets).
  // Adjectives: states or qualities that trigger the domain (sore, heavy, ready).
  // Matching is a union across all three. The split is for authorship clarity.
  vocabulary: {
    verbs: [
      // Gym lift actions (same word as noun, but in action context)
      /\b(benched|squatted|deadlifted|pressed|curled|rowed|lifted|hoisted|racked)\b/i,
      // Running/cardio actions
      /\b(ran|run|running|jogged|jogging|sprinted|sprinting|biked|biking|swam|swimming|rowed)\b/i,
      // Bodyweight and calisthenics
      /\b(did|doing|knocked\s+out)\s+(?:\d+\s+)?(?:push[- ]?ups?|sit[- ]?ups?|burpees?|pull[- ]?ups?|dips?|lunges?|squats?)\b/i,
      // Session verbs
      /\b(trained|training|worked\s+out|working\s+out|hit\s+the\s+gym|crushed)\b/i,
      /\b(stretched|stretching|held|hold.*seconds|yoga|warmed\s+up|cooled\s+down)\b/i,
    ],
    nouns: [
      // The "135x10" signature pattern (sets x reps, weight x reps)
      /\b\d+\s*x\s*\d+\b/i,
      // Gym exercises by name
      /\b(bench\s*press|bench|squat|deadlift|ohp|overhead\s*press|curl|row|pull[- ]?up|chin[- ]?up|dip|lunge|leg\s*press|lat\s*pulldown)\b/i,
      // Bodyweight exercises
      /\b(push[- ]?ups?|sit[- ]?ups?|burpees?|plank|lunges?|pull[- ]?ups?|dips?|handstand)\b/i,
      // Running terms
      /\b(mile|miles|marathon|pace|tempo|5k|10k|half[- ]marathon|stride|cadence|splits?)\b/i,
      // Session / program nouns
      /\b(workouts?|exercises?|training|sessions?|reps?|sets?|volume|tonnage|rest\s+day)\b/i,
      // Muscle groups
      /\b(chest|back|legs|shoulders|core|calves|biceps?|triceps?|glutes?|quads?|hamstrings?|abs|lats|delts)\b/i,
      // Records and progression
      /\b(pr|personal\s+record|one\s+rep\s+max|1rm|3rm|5rm|max\s+effort)\b/i,
      // Equipment/modalities
      /\b(barbell|dumbbell|kettlebell|cable|machine|bodyweight|resistance\s+band)\b/i,
      // Gym environment and gear
      /\b(gym|studio|treadmill|squat\s*rack|power\s*rack|bench\s*rack|weight\s*room)\b/i,
    ],
    adjectives: [
      // Progression and goal states
      /\b(heaviest|lightest|fastest|slowest|longest|strongest)\b/i,
      // Physical states that indicate fitness context
      /\b(sore|tired|fatigued|pumped|gassed|dead|wrecked|fresh|rested|recovered)\b/i,
      // Exercise qualities
      /\b(progressive\s+overload|one[- ]rep\s+max|drop\s+set|superset|giant\s+set)\b/i,
    ],
  },

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
