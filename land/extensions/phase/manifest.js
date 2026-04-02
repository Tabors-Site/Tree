export default {
  name: "phase",
  version: "1.0.2",
  builtFor: "TreeOS",
  description:
    "The tree knows whether you are collecting or spending. Not from a toggle. Not from " +
    "a setting. From what you actually do. " +
    "\n\n" +
    "Three phases. Awareness: open, exploratory, gathering. Browsing nodes, reading notes, " +
    "asking questions, jumping between branches. Not building. Orienting. Attention: focused, " +
    "creative, producing. Writing notes, creating nodes, changing structures, running tools. " +
    "Spending what was gathered. Scattered: bouncing between many branches without depth. " +
    "Four or more distinct nodes touched with low write activity. Movement without traction. " +
    "\n\n" +
    "Every afterNote, afterNodeCreate, afterNavigate, afterToolCall fires a typed signal " +
    "into a rolling window of the last 20 interactions per user. The window size, awareness " +
    "threshold, attention threshold, scattered branch threshold, and history depth are all " +
    "land-configurable. Detection runs on every signal. Navigate, read, and query count as " +
    "read types. Write, create, and tool count as write types. The ratio determines the " +
    "phase. Scattered triggers when the distinct node count crosses the branch threshold " +
    "and write ratio stays below 30%. " +
    "\n\n" +
    "enrichContext injects the detected phase into the AI prompt. During awareness the AI " +
    "shifts toward showing, surfacing, connecting. During attention the AI shifts toward " +
    "doing, building, executing. During scattered the AI gently reflects what it sees. " +
    "You have touched four branches in the last ten minutes without writing anything. " +
    "Are you looking for something specific? Not judgment. Observation. The tree reflects " +
    "you back so you can see your own pattern. " +
    "\n\n" +
    "The most valuable moment is the transition. The user was in awareness for twenty " +
    "minutes. Now they write their first note. The AI sees the transition signal and says: " +
    "you have been exploring this branch for a while. Based on what you read, here is what " +
    "I think you are about to work on. The gathered context crystallizes into the prompt " +
    "for attention. The reverse: deep attention for two hours, then navigation. The AI says: " +
    "good stopping point. Here is a summary of what you just built. Transition detection " +
    "feeds inverse-tree when installed, sending phase-transition signals with from/to and " +
    "confidence scores. " +
    "\n\n" +
    "Phase history tracks every transition with start time, end time, duration, and origin " +
    "phase. Cycle stats compute the percentage split across awareness, attention, and " +
    "scattered over all tracked time. The user sees their own patterns. 70% attention, " +
    "10% awareness, 20% scattered. Three API endpoints: current phase with recent " +
    "interactions, full transition history, and the awareness vs attention ratio. The " +
    "tree does not tell you how to work. It shows you how you already do.",

  needs: {
    services: ["hooks"],
    models: ["User"],
  },

  optional: {
    extensions: ["inverse-tree", "evolution"],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},

    hooks: {
      fires: [],
      listens: ["afterNote", "afterNodeCreate", "afterNavigate", "afterToolCall", "enrichContext"],
    },

    cli: [
      {
        command: "phase [action]", scope: ["tree"],
        description: "Current phase and session stats. Actions: history, cycle.",
        method: "GET",
        endpoint: "/user/:userId/phase",
        subcommands: {
          "history": { method: "GET", endpoint: "/user/:userId/phase/history", description: "Your phase patterns over time" },
          "cycle": { method: "GET", endpoint: "/user/:userId/phase/cycle", description: "Awareness vs attention ratio" },
        },
      },
    ],
  },
};
