export default {
  name: "intent",
  version: "1.0.0",
  builtFor: "treeos-intelligence",
  description:
    "The tree acts without being asked. " +
    "\n\n" +
    "Right now every interaction starts with a human. You type. The AI responds. " +
    "You navigate. The AI resolves. Even cascade is triggered by you writing a note. " +
    "Remove the human and the tree sits there. Dormant. Waiting. A real tree doesn't " +
    "wait for someone to tell it to grow toward sunlight. It just grows. " +
    "\n\n" +
    "Intent gives the digital tree the same property. " +
    "\n\n" +
    "A background job runs on a configurable interval. It reads the state of the tree " +
    "from every source available through enrichContext. Pulse says the failure rate is " +
    "climbing. Evolution says a branch went dormant 45 days ago. Contradiction detected " +
    "two conflicting targets three days ago and nobody resolved them. The codebook between " +
    "two nodes hasn't compressed in 200 interactions. A cascade signal arrived carrying " +
    "extension metadata this land doesn't have. " +
    "\n\n" +
    "Intent synthesizes all of that into a queue of actions the tree should take on its own. " +
    "Each intent becomes a real AI interaction. The job calls runChat at the target node with " +
    "the intent as the message. The AI activates in whatever mode is configured at that position. " +
    "It has all the tools available at that node. It does the work. Creates notes. Fires cascade " +
    "signals. Resolves contradictions. Compresses codebooks. Prunes dormant branches. Alerts the " +
    "operator through gateway channels. " +
    "\n\n" +
    "The intent queue lives on a .intent system node under the tree root. Each processed intent " +
    "writes its result as a note. The user wakes up and checks .intent to see what the tree did " +
    "overnight. Or they don't check. The tree handled it. " +
    "\n\n" +
    "What makes this different from a cron job: cron runs the same action on a schedule. Intent " +
    "generates novel actions from observed state. Two trees with identical schedules would generate " +
    "completely different intents because their states are different. The intent generation itself " +
    "goes through the AI. A prompt receives the full state summary and asks: what should this tree " +
    "do next that nobody has asked for? " +
    "\n\n" +
    "Safety: intent respects spatial scoping, ownership (metadata.intent.enabled must be true on " +
    "the tree root), energy budgets (intentMaxTokensPerCycle), and never deletes. It can create, " +
    "write, compress, alert. Destructive actions require a human. Every processed intent is logged " +
    "as a contribution with action: intent:executed. Full audit trail. " +
    "\n\n" +
    "The user can talk back. Navigate to .intent. Chat: stop nudging me about running. The " +
    "contradiction extension marks that as an intentional gap. The inverse-tree records the " +
    "correction. Intent stops generating that nudge. The tree learned. " +
    "\n\n" +
    "Dependencies are all optional. Each one that's installed adds signal to the intent generation. " +
    "Without any of them, intent has nothing to observe and generates nothing. With all of them, " +
    "the tree is fully autonomous between human interactions. " +
    "\n\n" +
    "You planted the seed. The seed grew a tree. The tree learned to think. And now the tree " +
    "learned to want.",

  needs: {
    services: ["llm", "hooks", "contributions", "session", "chat", "orchestrator"],
    models: ["Node", "User"],
  },

  optional: {
    services: ["energy"],
    extensions: [
      "pulse",
      "evolution",
      "contradiction",
      "codebook",
      "gap-detection",
      "inverse-tree",
      "long-memory",
      "treeos-cascade",
      "gateway",
    ],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: true,
    orchestrator: false,
    energyActions: {
      intentGenerate: { cost: 3 },
      intentExecute: { cost: 2 },
    },
    sessionTypes: {
      INTENT_CYCLE: "intent-cycle",
    },

    hooks: {
      fires: [],
      listens: ["afterBoot", "enrichContext"],
    },

    cli: [
      {
        command: "intent [action] [args...]", scope: ["tree"],
        description: "Autonomous intent queue and recent executions. Actions: pause, resume, history, reject.",
        method: "GET",
        endpoint: "/root/:rootId/intent",
        subcommands: {
          "pause": { method: "POST", endpoint: "/root/:rootId/intent/pause", description: "Pause autonomous behavior" },
          "resume": { method: "POST", endpoint: "/root/:rootId/intent/resume", description: "Resume autonomous behavior" },
          "history": { method: "GET", endpoint: "/root/:rootId/intent/history", description: "What the tree did on its own" },
          "reject": { method: "POST", endpoint: "/root/:rootId/intent/reject", args: ["id"], description: "Tell the tree not to do that again" },
        },
      },
    ],
  },
};
