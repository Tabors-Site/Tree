export default {
  name: "phase",
  version: "1.0.0",
  description:
    "The tree knows whether you're collecting or spending. " +
    "\n\n" +
    "Two states. Awareness: open, exploratory, gathering. You're browsing nodes, " +
    "reading notes, asking questions, jumping between branches. You're not building. " +
    "You're orienting. Attention: focused, creative, producing. You're writing notes, " +
    "creating nodes, changing structures, running tools. You're spending what you gathered. " +
    "\n\n" +
    "The extension detects which phase you're in from your behavior. Not from a toggle " +
    "you set. From what you actually do. Every afterNote, afterNodeCreate, afterNavigate, " +
    "afterToolCall fires a signal. The extension maintains a rolling window of the last " +
    "20 interactions per user. Navigation-heavy, read-heavy, low writes: awareness. " +
    "Write-heavy, create-heavy, tool-heavy: attention. Mixed with frequent branch " +
    "switching: scattered. " +
    "\n\n" +
    "How it changes the AI. During awareness the AI shifts toward showing, surfacing, " +
    "connecting. During attention the AI shifts toward doing, building, executing. During " +
    "scattered the AI reflects back what it sees. You've touched four branches in the last " +
    "ten minutes without writing anything. Are you looking for something specific? Not " +
    "judgment. Observation. The tree reflects you back so you can see your own pattern. " +
    "\n\n" +
    "The most valuable moment is the transition between phases. The user was in awareness " +
    "for twenty minutes. Now they write their first note. The AI says: you've been " +
    "exploring this branch for a while. Based on what you've read, here's what I think " +
    "you're about to work on. The gathered context crystallizes into the prompt for " +
    "attention. The reverse: deep attention for two hours, then navigation. The AI says: " +
    "good stopping point. Here's a summary of what you just built. " +
    "\n\n" +
    "Phase history tracks durations over time. The user sees their own patterns. I spend " +
    "70% in attention and 10% in awareness. The remaining 20% is scattered.",

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
        command: "phase [action]",
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
