export default {
  name: "prediction",
  version: "1.0.1",
  builtFor: "treeos-intelligence",
  description:
    "Layer 7 of the inner monologue. The narrative plus rings gives the tree temporal depth. " +
    "It knows what it was, what it is, and from those two it can project what's coming. " +
    "'The user's fitness consistency drops every November. It's October. The pattern has held " +
    "for two years of rings. Prepare for decreased activity. Don't interpret November silence " +
    "as abandonment.' Not prediction in the ML sense. Pattern recognition across rings and " +
    "narrative. The tree has seen this season before. It knows what comes next. It adjusts " +
    "expectations instead of reacting to the slowdown as if it's new. " +
    "\n\n" +
    "The cycle is circular, not linear. inner (raw thoughts) -> reflect-inner (themes) -> " +
    "compare-inner (changes over time) -> narrative (sense of self) -> voice (how it speaks) " +
    "-> initiative (what it pursues) -> prediction (what it expects) -> back to inner " +
    "(new thoughts informed by all of the above). Layer 7 feeds back into Layer 1. The tree's " +
    "predictions become the lens through which it generates new thoughts. 'I predicted the user " +
    "would slow down in November. They didn't. Why?' That's a Layer 1 thought generated from a " +
    "Layer 7 prediction. The cycle deepens. " +
    "\n\n" +
    "Each loop around the cycle, the tree knows itself better. Not through more compression. " +
    "Through action informed by self-knowledge producing new observations producing updated " +
    "self-knowledge. Collect, act, collect again. Each cycle deeper than the last.",

  needs: {
    models: ["Node", "Note"],
    services: ["hooks", "llm"],
  },

  optional: {
    extensions: ["breath", "rings", "narrative", "inner"],
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
