// Harmony, hand-built as Word IR (Phase 2 slice 2): the pulse.
//
// Surface (4.md example 2):
//   A music room contains a drum.
//   A drummer is a role for a music room.
//   The drummer strikes the drum, again and again.
//   When the drummer strikes the drum, that is a beat.
//   A dancer is a role for a music room.
//   When a beat happens, the dancer steps.
//
// This tests rule 6 (flows as standing watches) and rule 12 (the pulse is a
// being), built on the choq mechanism: the rhythm is a role's law, and the reel
// advances by COMPLETION, each beat begets the next (the drummer self-coupled),
// and the dancer is coupled to the drummer's beats. No clock; ctx.maxBeats bounds
// the observation of an in-principle-endless rhythm.

export const harmony = [
  // structure + roles (the law)
  { kind: "is", subject: "music room", isA: "space" },
  { kind: "is", subject: "drummer", isA: "role", scope: "music room" },
  { kind: "is", subject: "dancer", isA: "role", scope: "music room" },

  // the dancer is coupled to the drummer: on each beat, it steps (no event, so a
  // step does not itself beat; the dancer follows, it does not drive).
  {
    kind: "flow", when: { on: "beat" },
    effects: [
      { kind: "act", verb: "do", op: "step", by: "Dancer", of: { kind: "space", id: "music room" } },
    ],
  },

  // the drummer's choq: each beat begets the next strike (the self-coupled pulse).
  // the strike act counts as a beat ("that is a beat"), so its fact re-fires this.
  {
    kind: "flow", when: { on: "beat" },
    effects: [
      { kind: "act", verb: "do", op: "strike", by: "Drummer", of: { kind: "matter", id: "drum" }, event: "beat" },
    ],
  },
];

// the first strike that kicks the pulse (the drummer's opening beat). After this,
// the choq sustains itself until maxBeats.
export const firstStrike = {
  kind: "act", verb: "do", op: "strike", by: "Drummer", of: { kind: "matter", id: "drum" }, event: "beat",
};

export default harmony;
