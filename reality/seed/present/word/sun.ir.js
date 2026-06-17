// The sun, hand-built as Word IR (Phase 2 slice 3): the coupled wheel.
//
// Validates the three engine capabilities the sun needs: a state/fold (ctx.state),
// watches over state (when: { state: {...} }), and the driver (the wheel). The
// rhythm is a choq: each phase is a role's law whose act advances the state, and
// the next phase's watch was waiting on that state. Coupling, not a clock:
//   dawn -> Sun rises -> day -> Sun sets -> dusk -> Moon rises -> night -> Moon sets -> dawn ...
// The gardener is a rider: it waters when it is day, acting on the state without
// turning the wheel. Genesis day 4: the luminaries are appointed to rule the
// rhythm; the order (the choq) is prior to the bearers (Sun, Moon).

const phase = (sky, by, op, becomes) => ({
  kind: "flow", when: { state: { sky } },
  effects: [{ kind: "act", verb: "do", op, by, sets: { sky: becomes } }],
});

export const sun = [
  { kind: "is", subject: "sky", isA: "space" },
  { kind: "is", subject: "sun", isA: "role", scope: "sky" },
  { kind: "is", subject: "moon", isA: "role", scope: "sky" },
  { kind: "is", subject: "gardener", isA: "role", scope: "garden" },

  // the coupled wheel: each phase's act writes the state the next phase waits on
  phase("dawn", "Sun", "rise", "day"),
  phase("day", "Sun", "set", "dusk"),
  phase("dusk", "Moon", "rise", "night"),
  phase("night", "Moon", "set", "dawn"),

  // a rider: the gardener waters when it is day (acts on the state, does not turn it)
  {
    kind: "flow", when: { state: { sky: "day" } },
    effects: [{ kind: "act", verb: "do", op: "water", by: "Gardener", of: { kind: "space", id: "garden" } }],
  },
];

export const start = { sky: "dawn" }; // the reality begins at dawn

export default sun;
