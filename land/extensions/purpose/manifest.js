export default {
  name: "purpose",
  version: "1.0.0",
  description:
    "Holds the root purpose of the tree and measures everything against it. When the tree is new, " +
    "purpose reads the root node and derives a thesis: what is this tree's core purpose, in one " +
    "sentence. The thesis writes to metadata.purpose.thesis on the tree root. Every 100 notes, " +
    "the thesis re-derives from the current state. It evolves as the tree grows but always connects " +
    "to the original intent. The tree might grow from 'track my fitness' to 'holistic health " +
    "management' but it never drifts to 'random notes about everything.' The thesis expands. It " +
    "does not scatter. afterNote fires a lightweight AI coherence check: does this note serve the " +
    "thesis? Score 0 to 1. High coherence (0.8+): on-thesis, no signal. Medium (0.4-0.8): adjacent, " +
    "drifting, gentle signal in enrichContext. Low (below 0.4): tangent, suggest moving it or " +
    "starting a new tree. Never blocking. Never restricting. Just holding the mirror. Every other " +
    "extension makes the tree smarter, faster, more aware, more autonomous. None of them ask the " +
    "question that matters most: is this tree still about what it was planted to be. Purpose " +
    "prevents the slow death of drift. It holds. Gently. Persistently. Without letting go.",

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
