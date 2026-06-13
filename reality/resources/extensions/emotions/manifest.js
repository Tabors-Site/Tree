// TreeOS extension: emotions.
//
// Ships a small set of modifier roles that beings stack onto their
// primary role via RoleFlow `stack: true` clauses. Each modifier is a
// short prompt body the LLM weighs alongside the primary frame; the
// substrate composes them by concatenating each role's prompt with a
// divider (`\n\n---\n\n`), so a being acting as `factory_worker` with
// `bored` stacked sees both intent frames at once.
//
// None of these roles are summonable on their own — they're shape-
// modifiers, not jobs. Their canSee/canDo/canSummon/canBe lists are
// empty; they add nothing to capability surface, only to tone.
//
// Authoring pattern:
//
//   qualities.roleFlow = [
//     { role: "factory_worker" },  // primary
//     { stack: true, when: { "time.sinceLastMoment": { gte: 60 } },
//       role: "emotions:bored" },
//     { stack: true, when: { "world.weather.condition": "storm" },
//       role: "emotions:cautious" },
//   ]
//
// Worker stays a worker; the stacked modifiers shape how the LLM
// reads the situation. Stacking is additive; remove a modifier by
// changing the world such that its `when` no longer matches.

export default {
  name: "emotions",
  version: "1.0.0",
  description:
    "Eight modifier roles (bored, tired, focused, curious, cautious, urgent, playful, formal) for stacking onto primary roles via RoleFlow.",

  needs: {
    services: ["declare"],
    models:   [],
    extensions: [],
  },

  optional: { services: [], extensions: [] },

  provides: {
    roles: true,
    routes: false,
    tools: false,
    jobs: false,
    models: {},
  },
};
