// emotions pack (RESOURCES.md).
//
// Eight modifier ables that beings stack onto their primary able via
// Flow `stack: true` clauses. Each modifier is a short prompt
// body the LLM weighs alongside the primary frame; the substrate
// composes them by concatenating each able's prompt with a divider,
// so a being acting as `factory_worker` with `bored` stacked sees
// both intent frames at once.
//
// PACK CONTENTS:
//   ables/bored/         — easily distracted, drawn to novelty
//   ables/tired/         — shorter responses, prefers rest
//   ables/focused/       — declines tangents, orients to the goal
//   ables/curious/       — probes the unexplained, asks questions
//   ables/cautious/      — verifies before acting, reversible steps
//   ables/urgent/        — fastest acceptable over best
//   ables/playful/       — unexpected angles, willing to be unobvious
//   ables/formal/        — measured language, observes protocol
//
// No code piece. The able-kind handler registers each modifier
// directly from its able.js. None carry capability (no can* entries);
// they're prompt-only voice shapers.

export default {
  kind:    "pack",
  name:    "emotions",
  version: "1.0.0",
  description:
    "Eight modifier ables (bored, tired, focused, curious, cautious, urgent, playful, formal) for stacking onto primary ables via Flow.",

  requires: [
    { type: "able", ref: "emotions:bored"    },
    { type: "able", ref: "emotions:tired"    },
    { type: "able", ref: "emotions:focused"  },
    { type: "able", ref: "emotions:curious"  },
    { type: "able", ref: "emotions:cautious" },
    { type: "able", ref: "emotions:urgent"   },
    { type: "able", ref: "emotions:playful"  },
    { type: "able", ref: "emotions:formal"   },
  ],
};
