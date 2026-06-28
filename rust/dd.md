---
name: project_moment_ord_basis
description: "IDEA (Tabor 2026-06-28, evaluated as REAL but defer-don't-overbuild): the moment reads the global ord (the world's 'now'); the act records its landing ord; the gap = causal staleness in EVENTS, not seconds (a laggy sensor's act is N events stale). Clock-free read-version/commit-version. NOT built — global ord is still stubbed (per-reel stand-in); build when a consumer needs it."
metadata:
  node_type: memory
  type: project
  originSessionId: 741e6389-2945-478e-b1c4-fccf0509b5fe
---

A design idea Tabor floated, with the explicit caution "only go off this if it's actually a treeos idea and don't complicate everything and is needed." My verdict: it IS a real TreeOS idea, but defer building it until a consumer exists.

**The idea** (motivated by Tabor's real sun-sensor on his roof, sending ~3 acts/day with send→receive lag):

- A being can't act without a moment ([[project_name_check_at_moment]]). When it takes the **moment**, it reads the **global ord** = "the world is at event N" — its snapshot of now.
- When its **act** lands, the act records its own landing global ord M.
- The gap **M − N = how many events the world moved** between perceiving and the act landing → causal staleness / lag / "real intent vs reality," measured in EVENTS, not seconds.

**Why it's genuinely TreeOS (not a gimmick):**

- CLOCK-FREE: "lag" is an ord delta, never a wall-clock duration — the same way TreeOS already treats time as causal order ([[project_time_purge]]: time is never a dependency; ord/bornOrd is the clock-free order).
- It's the read-version / commit-version pattern (optimistic concurrency / snapshot isolation): the moment-ord is what the act was DECIDED against; the landing-ord is where it COMMITTED. The window between them is the conflict/staleness window.
- It reinforces "you can't act without a moment": the moment is precisely WHERE you read the world's now (the global ord) and get your key ([[project_name_check_at_moment]]); the act carries that basis forward.

**Status — NOT built, and resting on a stub:**

- There is NO global ord source in the Rust port. `treeibp::seal_one` passes `ord = read_reel_head(...).seq + 1.0` — a PER-REEL monotonic stand-in, NOT a global counter (two acts on different reels can collide on ord). It's non-digest (excluded from every \_id), so chain integrity + the act-sig are unaffected; it only matters once something SORTS by global order, which nothing in the Rust port does yet. So the stand-in is a harmless placeholder for now.
- The on-disk JS facts DO carry a real global `ord` (e.g. 204); the Rust port reads/folds/verifies but does not yet source or consume it.

**Build it WHEN a consumer arrives** (don't build speculatively — Tabor's caution). Natural triggers: the cross-reel global timeline / book-view, OR the first remote/sensor actor (when "how stale was this act" starts to matter). Three small touch-points then:

1. A global ord SOURCE — a per-store append counter (one forest = one append-order space; per [[project_federation]] forests don't share ords). Replaces the `seal_one` stand-in; passed into `commit_moment`.
2. `moment` RETURNS the current global ord (the world's now at perception) — cheap, non-breaking (one field on the percept).
3. The act CARRIES its `basis` ord (the moment-ord it acted from), distinct from its landing ord — non-digest field, like ord. The gap is then readable on the stamped act.

Relates to [[project_ibp_two_primitives]] (moment+act), [[project_spacebar_moments]] (one word = one moment), [[project_higher_qualities]] (human wall-clock pins LLM beings to 'now' — the ord is the clock-free alternative).
