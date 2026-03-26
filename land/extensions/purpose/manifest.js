export default {
  name: "purpose",
  version: "1.0.0",
  description:
    "Holds the root purpose of the tree and measures everything against it. Every other " +
    "extension makes the tree smarter, faster, more aware, more autonomous. None of them " +
    "ask the question that matters most: is this tree still about what it was planted to be. " +
    "\n\n" +
    "When the tree is new and accumulates its first few notes, purpose reads the root node " +
    "name, type, branch names, and early note content. An LLM call derives a thesis: the " +
    "core purpose of this tree in one sentence. Not 'organize information.' What specific " +
    "domain, goal, or intention does this tree exist to hold. The thesis writes to " +
    "metadata.purpose.thesis on the tree root. Every 100 notes (configurable via " +
    "rederiveInterval), the thesis re-derives from the current state. It reads the existing " +
    "thesis and refines it. The tree might grow from 'track my fitness' to 'holistic health " +
    "management' but it never drifts to 'random notes about everything.' The thesis expands. " +
    "It does not scatter. " +
    "\n\n" +
    "afterNote fires a coherence check on every new text note. Notes are batched " +
    "(configurable via minNotesBetweenChecks, default 3) and scored in a single LLM call " +
    "against the thesis. Each note gets a score from 0 to 1 and a reason, written to " +
    "note metadata. High coherence (0.8+): on-thesis, no signal needed. Medium (0.4 to 0.8): " +
    "adjacent, drifting. enrichContext injects a gentle signal: recent content here is " +
    "loosely connected to the tree's core purpose. It might belong here or it might be the " +
    "seed of a new tree. Low (below 0.4): tangent. The AI suggests moving it or starting " +
    "a new tree for this topic. Never blocking. Never restricting. Just holding the mirror. " +
    "\n\n" +
    "Three MCP tools. tree-thesis shows the current thesis and derivation stats. " +
    "rederive-thesis forces re-derivation from the current tree state. check-coherence " +
    "scores arbitrary text against the thesis before the user even writes the note. " +
    "Two CLI commands mirror the first two tools. Two HTTP endpoints at " +
    "/root/:rootId/thesis for reading and /root/:rootId/thesis/rederive for forcing. " +
    "\n\n" +
    "enrichContext works at two levels. At the tree root, it surfaces the thesis itself " +
    "so the AI can reference it in conversation. At any child node, it finds the most " +
    "recent note with a coherence score and, if the score is below the high threshold, " +
    "injects the purpose signal with the thesis and the drift observation. The AI sees " +
    "it and can surface it naturally. " +
    "\n\n" +
    "Purpose prevents the slow death of drift. It holds. Gently. Persistently. " +
    "Without letting go.",

  needs: {
    services: ["llm", "hooks"],
    models: ["Node", "Note"],
  },

  optional: {
    services: ["energy"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: true,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [],

    cli: [
      {
        command: "thesis",
        description: "Show this tree's root thesis and coherence stats",
        method: "GET",
        endpoint: "/root/:rootId/thesis",
      },
      {
        command: "thesis-rederive",
        description: "Force re-derivation of the thesis from current tree state",
        method: "POST",
        endpoint: "/root/:rootId/thesis/rederive",
      },
    ],

    hooks: {
      fires: [],
      listens: ["afterNote", "enrichContext"],
    },
  },
};
