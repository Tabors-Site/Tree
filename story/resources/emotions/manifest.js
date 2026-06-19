// emotions pack (RESOURCES.md).
//
// Eight modifier roles that beings stack onto their primary role via
// RoleFlow `stack: true` clauses. Each modifier is a short prompt
// body the LLM weighs alongside the primary frame; the substrate
// composes them by concatenating each role's prompt with a divider,
// so a being acting as `factory_worker` with `bored` stacked sees
// both intent frames at once.
//
// PACK CONTENTS:
//   roles/bored/         — easily distracted, drawn to novelty
//   roles/tired/         — shorter responses, prefers rest
//   roles/focused/       — declines tangents, orients to the goal
//   roles/curious/       — probes the unexplained, asks questions
//   roles/cautious/      — verifies before acting, reversible steps
//   roles/urgent/        — fastest acceptable over best
//   roles/playful/       — unexpected angles, willing to be unobvious
//   roles/formal/        — measured language, observes protocol
//
// No code piece. The role-kind handler registers each modifier
// directly from its role.js. None carry capability (no can* entries);
// they're prompt-only voice shapers.

export default {
  kind:    "pack",
  name:    "emotions",
  version: "1.0.0",
  description:
    "Eight modifier roles (bored, tired, focused, curious, cautious, urgent, playful, formal) for stacking onto primary roles via RoleFlow.",

  requires: [
    { type: "role", ref: "emotions:bored"    },
    { type: "role", ref: "emotions:tired"    },
    { type: "role", ref: "emotions:focused"  },
    { type: "role", ref: "emotions:curious"  },
    { type: "role", ref: "emotions:cautious" },
    { type: "role", ref: "emotions:urgent"   },
    { type: "role", ref: "emotions:playful"  },
    { type: "role", ref: "emotions:formal"   },
  ],
};
