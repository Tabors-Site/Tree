// harmony:step . direction → set-being:coord, or STAY → record-and-hold.
//
// The dancer's only op. Takes a compass direction or the literal
// "STAY", reads the dancer's current coord, decides:
//   . direction (N..NW)  . compute next cell, call set-being:coord.
//   . STAY                . record the held coord (set-being:coord
//                           with the same value) so the chain shows
//                           "this dancer chose to stay at (x,y) on
//                           this tick" . a deliberate hold IS an act.
//
// The seed enforces bounds on the inner set-being:coord (throws on
// OOB); the PositionProjection fold writes the cached row. No bump
// rule, no grid-event fact action, no harmony-side reducer . the
// world is the world; if two dancers land on the same cell, they
// overlap. STAY-on-same-cell stamps a fact identically; the reel
// shows the dancer chose to stand still.


const DIRS = {
  N:  { dx:  0, dy: -1 },
  NE: { dx:  1, dy: -1 },
  E:  { dx:  1, dy:  0 },
  SE: { dx:  1, dy:  1 },
  S:  { dx:  0, dy:  1 },
  SW: { dx: -1, dy:  1 },
  W:  { dx: -1, dy:  0 },
  NW: { dx: -1, dy: -1 },
};

export default {
  name: "step",
  targets: ["being"],

  async handler({ target, params, identity, moment }) {
    // A dancer steps ITSELF. The acting being is the caller. The seed
    // `do` tool defaults an unspecified target to the story root, so
    // we must NOT read the being from `target` unless it explicitly
    // names a being. Resolve order: explicit being target, then the
    // caller's identity, then the seed-injected params.beingId. Reading
    // `target` blindly was the bug: the default root-space target made
    // every step land on the place root, never the dancer.
    const explicitBeing =
      target && typeof target === "object" && target.kind === "being" && target.id
        ? String(target.id)
        : null;
    const beingId =
      explicitBeing ||
      (identity?.beingId ? String(identity.beingId) : null) ||
      (params?.beingId ? String(params.beingId) : null);
    if (!beingId || beingId === "undefined") {
      throw new Error(
        "harmony:step: could not resolve the acting being (no explicit being target and no caller identity).",
      );
    }

    const dir = String(params?.direction || "").toUpperCase();
    const isStay = dir === "STAY";
    const delta = isStay ? { dx: 0, dy: 0 } : DIRS[dir];
    if (!delta) {
      throw new Error(
        `harmony:step: direction must be one of ${Object.keys(DIRS).join(",")},STAY; ` +
        `got "${params?.direction}".`,
      );
    }

    const me = await moment.read("being", beingId);
    const meCoord = me?.coord || me?.qualities?.coord;
    const cur = (meCoord && Number.isFinite(meCoord.x) && Number.isFinite(meCoord.y))
      ? { x: meCoord.x, y: meCoord.y }
      : { x: 0, y: 0 };
    const next = { x: cur.x + delta.dx, y: cur.y + delta.dy };

    // set-being:coord . the seed enforces bounds and the
    // PositionProjection fold writes the cached row. Throws on
    // out-of-bounds; cognition refaces. For STAY, the inner write
    // is to the same value the row already holds; the seed records
    // the fact so the dancer's reel shows a deliberate hold, not
    // a silent gap.
    await moment.do(
      { kind: "being", id: beingId },
      "set-being",
      { field: "coord", value: next },
    );

    // _factTarget pins the harmony:step auto-Fact onto the DANCER's
    // being reel (not the call's default root-space target). This keeps
    // the act on the actor's own reel (single-writer) and lets the
    // fact-arrival push animate the right character: factPush only
    // forwards facts whose target is a being or matter, and the dancer's
    // render block maps action "harmony:step" to its step clip.
    return {
      stepped: !isStay,
      stayed: isStay,
      from: cur,
      to: next,
      direction: dir,
      _factTarget: { kind: "being", id: beingId },
    };
  },
};
