export default {
  name: "recovery",
  version: "1.0.0",
  builtFor: "TreeOS",
  description:
    "The tree that grows toward health. Track substances, feelings, cravings, " +
    "and patterns. Taper schedules that bend around you. Pattern detection that " +
    "finds what you can't see. A mirror, not a judge. Three modes: recovery-log " +
    "for daily check-ins, recovery-reflect for pattern analysis, recovery-plan " +
    "for taper scheduling. Milestone detection. Journal node for unstructured " +
    "writing the AI doesn't analyze. Safety boundaries for dangerous withdrawals " +
    "and crisis situations. Type 'be' at the Recovery tree to check in: the AI asks " +
    "how you're doing today. The person is always the agent.",

  classifierHints: [
    /\b(craving|crave|urge|tempt|slip|relapse|sober|clean|quit)\b/i,
    /\b(taper|reduce|cut down|cut back|wean|withdraw)\b/i,
    /\b(drink|smoke|vape|dose|hit|use|substance)\b/i,
    /\b(streak|days clean|days sober|milestone)\b/i,
    /\b(feeling|anxious|stressed|mood|angry|sad|hopeless)\b/i,
  ],

  needs: {
    models: ["Node", "Note"],
    services: ["hooks", "llm", "metadata"],
  },

  optional: {
    extensions: [
      "values",
      "channels",
      "fitness",
      "food",
      "scheduler",
      "breath",
      "notifications",
      "html-rendering",  // dashboard page
    ],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: true,
    modes: true,
    guidedMode: "tree:recovery-review",

    hooks: {
      fires: ["recovery:milestone", "recovery:patternDetected"],
      listens: ["enrichContext", "breath:exhale"],
    },

    cli: [
      {
        command: "recovery [message...]",
        scope: ["tree"],
        description: "Check in or log how you're doing.",
        method: "POST",
        endpoint: "/root/:rootId/recovery",
        body: ["message"],
      },
      {
        command: "recovery-check",
        scope: ["tree"],
        description: "Today's status.",
        method: "GET",
        endpoint: "/root/:rootId/recovery/check",
      },
      {
        command: "recovery-patterns",
        scope: ["tree"],
        description: "Detected patterns.",
        method: "GET",
        endpoint: "/root/:rootId/recovery/patterns",
      },
      {
        command: "recovery-milestones",
        scope: ["tree"],
        description: "Your milestones.",
        method: "GET",
        endpoint: "/root/:rootId/recovery/milestones",
      },
      {
        command: "recovery-taper",
        scope: ["tree"],
        description: "Show taper plan.",
        method: "GET",
        endpoint: "/root/:rootId/recovery/taper",
      },
    ],
  },
};
