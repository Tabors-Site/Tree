# THE DANCE — harmony's first test: many beings, one beat, a shared world

*Builder spec. The first real multi-being test of the model and a better hello-world than a single LLM being, because it exercises the thing you most need to see work: many beings, each folding its own face of a shared world on a shared beat, each acting by its own rule, synchronizing through facts on shared reels. No LLMs. Pure scripted, deterministic cognition. If it dances, the world-facing half of the model is alive.*

*Build first, before INNER-FOLD / THE-GROWING-BEING / EMERGENT-LANGUAGE. This is the foundation those build on. It is all forward + DO — no inward turn needed yet (the dancers only look outward).*

---

## 0. The cast

- **Drum** — Matter. Its reel gets one `tick` fact per beat. Matter is done-to: it has a reel, no act-chain. The drum's reel is the beat-history.
- **Grid** — a Space (`<reality>/dance-floor`). 2D, small (≤10×10 so every reel is eyeball-readable). Its reel is the audit/timelapse of every move — folding it tick-by-tick gives every being's position at every beat.
- **Drummer** — a scripted Being. Its only job is to keep the beat: stamp a tick on the drum and fire a bare SUMMON to each dancer. Self-scheduled via the existing wakeSchedule.
- **Dancers** — 3–5 scripted Beings. Each carries a fixed, different rule (its "voice"). When summoned, a dancer **folds the grid itself** to see the board, applies its rule, does one move.

Voices (keep dumb and distinct so the dance reads as a dance, not noise): step toward nearest neighbor; step away from nearest neighbor; mirror the move of the being to my east; clockwise box around my start cell; inward on even beats / outward on odd. Five rules, five different trajectories folding the same shared world — that is harmony in the literal sense.

---

## 1. The two non-negotiables (these were corrected from the first plan — hold them)

### 1.1 Dancers fold the world themselves — the drummer does NOT hand them a snapshot

The drummer keeps the beat and nothing else: stamp the tick, fire a bare SUMMON to each dancer carrying only the beat number and the tick's seq-ceiling (§1.2) — **no positions, no snapshot of the board.** Each dancer, inside its own moment, **folds the grid space** (findByPosition / SEE the grid) to see where everyone is, then applies its rule. The dancer sources its own view of the world.

Why this matters: the whole point of the test is watching each being independently fold the shared world. If the drummer pre-bakes everyone's view and distributes it, the dancers aren't folding — the drummer became a central observer and the dancers are executing a handed-down snapshot, which sidesteps exactly the thing you're trying to prove works. Do not pass positions in the summon.

### 1.2 Lockstep via a shared seq-ceiling, not via a snapshot

Rungs 1–3 are lockstep: every dancer this tick reads the **same** start-of-tick board, so writes never race reads and the shared-cell conflict stays parked for rung 5. But now that dancers fold the grid themselves, lockstep comes from the data model, not a handed-out frame:

- When the tick fires, capture the grid space reel's head seq → call it `tickSeq`.
- Every dancer this tick folds the grid **up to `tickSeq` only** — it ignores any move-fact with seq > `tickSeq`. So all dancers fold the identical start-of-tick board even though their own writes land *during* the tick. Reads-before-writes, enforced by a seq ceiling.
- The drummer passes `tickSeq` (and the beat number) in the SUMMON. That one number is fine to pass — it's a clock reference, not a pre-folded view. Each dancer still does its own fold; it just folds up to the shared ceiling.

This preserves lockstep AND keeps each being genuinely folding the world. When you flip to sequential (rung 5) you just drop the ceiling and let dancers fold the live board — which is exactly when the shared-cell conflict is supposed to appear.

---

## 2. The move must be ONE atomic multi-reel seal

`harmony:move` writes two facts: the dancer's new position (on the **dancer's** reel) AND the move event (on the **grid space's** reel — the basis of the replay timelapse). That's one act, two reels — a genuine multi-reel ΔF. **It must seal in a single transaction** via sealFacts / the moment-level ΔF accumulator.

Do NOT implement it as a nested `do:set` that commits the dancer write, then separately stamps the grid write — that's two commits, and a crash between them leaves a dancer whose position and whose grid-trail disagree, so the replay silently stops matching reality. This is the **first real multi-reel act in the system.** If the seal-is-the-only-commit-site path (handlers push to the accumulator; seal calls sealFacts once) isn't wired yet, wire it before rung 3 — the dance waits behind it, it does not ship on two-commits-per-move. The whole replay-matches-reality guarantee (the reason the timelapse is trustworthy) depends on this.

---

## 3. What's reusable (most of it) and the one new seam

Reusable: scripted-being summon dispatch (register dancer ables with `triggerOn:["message"]`, scripted `summon()` returning `{ok:true, content}`); `findByPosition(spaceId)` for a dancer to read the board; scheduled wakes (`place.declare.schedule(beingId, {intervalMs, content, id})`) for the drummer's beat; `do:set` on matter for the drum's tick; `place.summon(stance, message)` for the drummer fanning bare SUMMONs; seed planting for scaffolding the floor in one act; per-reel facts as the replay source (the grid reel IS the timelapse); the 3D portal already renders beings at `b.position?.coords`.

**The one new seam (seed, ~5–10 lines):** the 3D portal reads `b.position?.coords` but the descriptor's `enrichBeings` doesn't surface it. Reserve a **seed-known** quality namespace `qualities.position` for spatial position (separate from extension qualities), and have `enrichBeings` lift `being.qualities.position.coords` onto the descriptor entry as `b.position.coords`. Seed-known (not extension-owned) because any future spatial extension reads the same field and the portal already expects this shape — extensions shouldn't have to coordinate on whose namespace owns coords. Everything else is extension code.

---

## 4. Build order (rungs)

**Rung 1 — Drummer alone.** Plant just drum + drummer. Drummer scheduled to tick (~1.5s). Each tick stamps a tick fact on the drum matter. Watch with `place.see(<reality>/dance-floor)` — confirm the drum's tick count grows. No dancers, no movement, no portal. Proves: scripted able + `triggerOn:["message"]` + scheduled wake + `do:set` on matter all work end-to-end. Single-reel only — safe.

**Rung 2 — One dancer, lockstep, polled portal.** Add one dancer (e.g. step-toward) alone with the drummer. Add the descriptor seam (§3). Add a temporary portal poll (a 1s `navigate(gridAddr)` timer — trivial, ugly, fine for first sight). The dancer folds the grid, applies its rule, moves. Proves: descriptor.coords wiring + portal placement + `harmony:move` op + drummer→dancer bare-SUMMON path + dancer-folds-grid-itself. Single-reel-ish; verify the move op here (§2, §5).

**GATE before rung 3:** the move op seals as ONE atomic multi-reel transaction (§2); dancers fold the grid themselves with the `tickSeq` ceiling (§1); and the replay-matches-live check passes on ONE dancer (§5). Do not scale to five until these three are green.

**Rung 3 — N dancers, lockstep, 5 voices.** Add the other four voices. Plant 5 dancers in a known layout (e.g. a row across the top). Watch them dance — this is the moment they "come alive." Replace the portal poll with push-on-move (fire a descriptor push to anyone in the grid room after each move; polling 5 beings/sec is wasteful). After ~30s the pattern is visibly NOT random — toward/away/mirror produce distinct trajectories. Keep N small (3–5) so when it looks wrong you can read every reel by eye.

**Rung 4 — Replay.** A `harmony:replay-grid` tool: fold the grid space's reel in seq order → `[{tick, beingId, x, y}, …]`. Row count = dancers × ticks elapsed; positions match what the portal showed. Optionally a portal "replay" button that animates from t=0. This proves the timelapse is the reel — free, and guaranteed to match reality *because* the move op is atomic (§2).

**Rung 5 — Sequential mode (the architectural test).** Switch the drummer from "fan all SUMMONs at once" to "fan one, await its seal, fan next," and **drop the seq ceiling** so dancers fold the LIVE board. Now a later dancer can collide with an earlier dancer's just-sealed move — the shared-cell conflict appears, visibly. Resolve it with **Strategy A** (let both land, the grid reducer bumps the later-seq dancer to the nearest free neighbor at fold time — see the concurrency build instructions). This is where you watch the spatial-conflict adjudication work with something you can see. Worth its own focused pass; out of scope to fully build here beyond turning the conflict on.

---

## 5. Verification (per rung)

**Rung 1:** boot; plant `harmony:dance-floor`; wait ~5s; SEE the dance-floor; expect the drum's tick count > 3 and growing.

**Rung 2:** open portal at `<reality>/dance-floor`; see one dancer cube at its start coord; within a few seconds it moves one cell per tick; server log shows a Moment line per tick.

**The two checks that gate rung 3 (run on ONE dancer):**
- `do:set` on `qualities.position.coords` persists the full `{x,y}` and **survives a re-fold from the reel.** Nested Mixed fields have bitten us before (the timestamps overwrite, Mixed dropping empty `{}`). Confirm with one moved dancer before building five.
- **Replay-matches-live:** fold the grid reel from scratch and assert the position you get equals the live row, for the one dancer. If that holds for one, scale up.

**Rung 3:** 5 cubes at staggered starts, each moving by its own rule; after ~30s the spatial pattern is visibly non-random; a SEE on the grid reel shows interleaved move-facts from all 5 in one sequence.

**Rung 4:** `harmony:replay-grid` outputs `(tick, beingId, x, y)` rows; row count = dancers × ticks; positions match the portal; re-running replay is identical.

**Rung 5:** two dancers deterministically aimed at one cell on one tick → earlier-seq lands in the cell, later-seq renders in the adjacent free cell; replay reproduces the bump identically (deterministic tiebreak — no Math.random, no wall-clock); NO seal rejected, NO retry (Strategy A is non-blocking); a deliberately-slow dancer does not delay the others' folds, only its own append queues briefly at seal.

---

## 6. The drum's tick — small but get it right

The drummer stamps the tick via `do:set` on the **drum matter** (e.g. a `qualities.harmony.tickAt` / tick-count field). Confirm the target resolves to the drum matter, NOT the drummer-being — the tick fact must land on the drum's reel (the beat-history), or the drum's reel is empty and replay is confused. The drummer's own moment seals (its act is "I ticked + summoned the dancers"); the dancers' moments run after, triggered by the bare SUMMONs.

---

## 7. Do NOT

- Do not pass positions/snapshot in the dancer SUMMON. Dancers fold the grid themselves; the summon carries only beat number + `tickSeq`. (§1.1)
- Do not implement the move as two commits. One atomic multi-reel seal, or replay rots. (§2)
- Do not add adjudication logic to rungs 1–3. Lockstep + seq-ceiling means no conflict can occur; if one does, the ceiling fold is broken — fix that, don't paper over it with a reducer. (§1.2)
- Do not let the rung-5 reducer tiebreak be non-deterministic. Pure function of seq + cell geometry, or replay breaks.
- Do not resolve a cell conflict by rewriting/deleting the loser's move-fact. The past is fixed; resolution is a fold-time reducer concern. (Strategy A)
- Do not scale past 5 dancers or 10×10 until the small case is green. Small enough to read every reel by eye is the whole debugging strategy.
- Do not use LLM dancers. The point is scripted/deterministic so failures localize. LLM dancers are a much later thing.

---

## 8. Out of scope for this pass

- Sequential-mode full build + Strategy B (scarce-resource) — rung 5 turns the conflict on; the full adjudication build is its own pass (see the concurrency build instructions).
- LLM-driven dancers.
- Grids larger than 10×10; persistent/multiple dance floors; auth around the dance (it's public — anyone SEEs, only the planter re-plants).
- The descriptor push (rung 3) on rung 2 — use the polling hack first, promote to push when it actually helps.

---

## 9. Why this is the right first test

It exercises, in the smallest watchable case, the whole world-facing half of the model: summon, fold, DO, multi-reel atomic seal, the position projection, replay, and (at rung 5) concurrency adjudication. The harmony — the thing you want to *see* — is an emergent property of N beings each folding one shared world (grid + beat) and answering by its own voice. Nothing is scripted to produce the *pattern*; the pattern emerges from independent folding plus a shared beat. If it dances, the model is alive — and every later spec (inner fold, the growing being, emergent language) builds on the machinery this one proves.
