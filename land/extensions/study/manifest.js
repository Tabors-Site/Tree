export default {
  name: "study",
  version: "1.0.1",
  builtFor: "TreeOS",
  description:
    "The tree that teaches you. Queue topics. Build curricula. Study through conversation. " +
    "Track mastery. Detect gaps. The AI guides you through the subject, asks questions, " +
    "evaluates understanding, and adapts to your learning style. Integrates with the learn " +
    "extension for URL content fetching. Mastery scoring from 0 to 100: introduced, basics, " +
    "solid understanding, can teach it. When all subtopics hit 80%, the topic completes. " +
    "Gap detection notices missing prerequisites during study and routes you through them. " +
    "Type 'be' at the Study tree to start a guided session: the AI picks the next subtopic " +
    "and begins teaching immediately. Part of the proficiency stack: food fuels, fitness " +
    "builds, recovery heals, study grows.",

  territory: "learning, teaching, quizzes, curriculum, mastery tracking",
  classifierHints: [
    /\b(study|teach me|quiz me|test me|drill me)\b/i,
    /\b(need to learn|want to learn|should learn|add to queue)\b/i,
    /\b(mastery|flashcard|curriculum|lesson|course|tutorial)\b/i,
    /\b(studied|study session|study plan|study streak)\b/i,
  ],

  needs: {
    models: ["Node", "Note"],
    services: ["hooks", "llm", "metadata"],
  },

  optional: {
    extensions: [
      "learn",             // URL content fetching and decomposition
      "values",            // mastery tracking on subtopic nodes
      "channels",          // signal routing from Log to topics
      "scheduler",         // daily study goal reminders
      "notifications",     // study reminders
      "gateway",           // push reminders externally
      "html-rendering",    // study interface with iframe
      "breath",            // sync to activity rhythm
      "treeos-base",       // tool navigation registration
    ],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: false,

    guidedMode: "tree:study-coach",

    hooks: {
      fires: [],
      listens: ["enrichContext", "afterBoot"],
    },

    cli: [
      {
        command: "study [message...]",
        scope: ["tree"],
        description: "Study session, queue management, progress.",
        method: "POST",
        endpoint: "/root/:rootId/study",
        bodyMap: { message: 0 },
        subcommands: {
          switch: {
            method: "POST",
            endpoint: "/root/:rootId/study/switch",
            description: "Activate a queue item by name or number.",
            body: ["topic"],
          },
          stop: {
            method: "POST",
            endpoint: "/root/:rootId/study/deactivate",
            description: "Deactivate topic, move back to queue.",
            body: ["topic"],
          },
          remove: {
            method: "POST",
            endpoint: "/root/:rootId/study/remove",
            description: "Delete from queue or active.",
            body: ["topic"],
          },
          status: {
            method: "GET",
            endpoint: "/root/:rootId/study/status",
            description: "Show active topics and mastery.",
          },
          gaps: {
            method: "GET",
            endpoint: "/root/:rootId/study/gaps",
            description: "Show detected knowledge gaps.",
          },
        },
      },
      {
        command: "needlearn [topic...]",
        scope: ["tree"],
        description: "Add a topic or URL to your study queue.",
        method: "POST",
        endpoint: "/root/:rootId/study/queue",
        bodyMap: { topic: 0 },
      },
    ],
  },
};
