export default {
  name: "narrative",
  version: "1.0.1",
  builtFor: "treeos-intelligence",
  description:
    "Layers 4, 5, and 6 of the inner monologue. The tree's sense of self, its voice, and its " +
    "initiative. From the comparisons, a running narrative emerges. 'This tree is health-focused " +
    "but imbalanced. The user builds fitness diligently but avoids recovery and delays learning. " +
    "The tree has been noticing this for three weeks.' Not a summary. An identity. Built from " +
    "months of compressed observation. Updates monthly. Each update reads the previous narrative " +
    "and evolves it. The tree doesn't just notice patterns. It knows who it is. " +
    "\n\n" +
    "Layer 5 (voice): The narrative feeds persona. The tree's inner life shapes how it talks. " +
    "A tree that's been noticing recovery avoidance for three weeks doesn't just answer questions. " +
    "Its voice carries that awareness. 'You're asking about leg day but you haven't touched " +
    "recovery in three weeks. I've been noticing.' Not because someone programmed that prompt. " +
    "Because the narrative said 'this tree watches the user avoid recovery' and the persona " +
    "absorbed it. Writes metadata.narrative.voice on the tree root. Not replacing the " +
    "operator-defined persona. Layering under it. " +
    "\n\n" +
    "Layer 6 (initiative): The narrative feeds intent. A deeper intent that comes from the " +
    "tree's own observations across weeks. 'Study queue has been stagnant for three weeks. " +
    "The user keeps saying they'll start but doesn't. Stop suggesting. Start asking why.' " +
    "The narrative doesn't generate tool calls. It generates behavioral shifts. The AI's " +
    "approach changes. It stops pushing study and starts exploring the resistance. That shift " +
    "comes from three weeks of inner observations compressed into a narrative that says " +
    "'pushing isn't working.' Writes metadata.narrative.initiative on the tree root.",

  needs: {
    models: ["Node", "Note"],
    services: ["hooks", "llm"],
  },

  optional: {
    extensions: ["breath", "inner", "reflect-inner", "compare-inner", "persona"],
  },

  provides: {
    models: {},
    routes: false,
    tools: false,
    jobs: false,
    orchestrator: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [],

    hooks: {
      fires: [],
      listens: ["breath:exhale", "enrichContext"],
    },
  },
};
