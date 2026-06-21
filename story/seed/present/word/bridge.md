# The bridge: running `.word` instead of a JS handler (the cherub deletion test)

The step that turns `.word` from a proof-of-parse into a real conversion: the
stamper runs a role's `.word` program in place of its JS handler, and the
handler is **deleted**. First target is **cherub birth** (clean world-strand
handler; the live gate already births via the evaluator).

## The contract

1. **Registry** (host): a map `(role, be-op) -> wordProgram`. Seed it with
   `cherub : birth -> cherub.word`. This is the dual registry of 2.md Phase 4,
   handler-or-`.word`, preferring `.word`.

2. **Stamper lookup** (host, the bridge): where a BE op dispatches to its role
   handler today (cherub's `birth` -> `_registerHumanWithFreshHome`), first
   consult the registry. If a `.word` program is present, run it via the
   evaluator in LIVE mode with the moment's `summonCtx` (the binds `name` /
   `password` come from the summon payload). Else fall to the JS handler. This
   is the ONLY new host code; everything else is deletion.

3. **Run mode** (evaluator, live): `cherub.word`'s flow fires; `form-being`
   dispatches to the real `birthBeing` (the key-mint stays host, the escape
   hatch); the five facts land in the real `deltaF`. The evaluator already does
   this (verify-word-cherub.mjs proves it).

4. **Diff gate** (extends the live gate): run the JS handler and the `.word`
   path on the SAME input, diff the sealed `deltaF` (the 5 facts: create-space,
   be:birth, set-space, grant-role, set-being) + the fold. Match (or a reviewed,
   intended difference) -> deletion is justified. The actor model is now RESOLVED
   in `cherub.word` (Tabor): all five acts are **by I_AM, through Cherub** (the
   implicit-actor rule); **Cherub is the mother, Arrival the father** (the new
   Name's being at the floor); the being is the **new Name's own** (its
   trueName), not I_AM's. The handler's incidental Cherub/I_AM mix is the silent
   assumption being corrected, not a delta to preserve, so the diff validates
   against this clean model (the new being's trueName = the arriving Name, father
   tuple = Arrival, mother = Cherub).

5. **Delete (a SPLIT, not a wholesale replace).** `_registerHumanWithFreshHome`
   mixes two strands; the deletion separates them:
   - **WORLD (→ cherub.word, deleted from the handler):** the act sequencing —
     create the home, form the being (→ birthBeing), set the owner, grant the
     human role, record the lineage. This is exactly cherub.word's five acts.
     birthBeing itself stays (host: the key-mint + the inherited/global grants
     it lays internally are the escape hatch).
   - **HOST (stays, extracted to a small helper):** the session plumbing —
     `generateToken`, `unlockSigning`, `seatBranch`. These are the HOW (the
     transport/session), not world acts, so they don't go in the `.word` and
     don't get deleted; the handler keeps them around the `.word` run.
     So birthHandler becomes: run `cherub.word` (the world acts, via the bridge) +
     do the session plumbing (host). The world-sequencing is what dies. Then run
     the e2e suite (cherub-mate, father-signs, registration). **Green = a `.js`
     died and function is preserved.** That is the moment this stops being a wrapper.

   The diff in step 4 compares only the WORLD strand (the five facts + birthBeing's
   grants); the token/session is host and is not part of the world diff.

## Lanes

- **Mine** (parser + `.word`): `cherub.word` (done, round-trips to the 5-fact
  shape), the diff assertions, naming the actor on the two bookkeeping acts.
- **Engine** (the other agent): the registry + the stamper lookup (step 2), the
  evaluator's live wiring, and the handler deletion once the diff is green.

Genesis is NOT the first deletion — it's the bootstrap (`withIAmAct`, the chain
genesis), too host-entangled to delete safely yet. `genesis.word` is the
narrative; cherub is the first real `.js` to fall.

## Notes for the live cut (from the parser lane)

- **World-strand gate (built, green):** `verify-cherub-shape.mjs` asserts
  `cherub.word` lays exactly the five world acts in order, by I_AM through
  Cherub, the being's trueName = the new Name, lineage mother Cherub / father
  Arrival (6/6). Run it before and after the cut; it's the cheap shape check
  next to the live byte-diff.
- **doVerb-in-live-mode gotcha (the prereq's catch):** when the evaluator's `do`
  acts dispatch through `doVerb` live, the five-act flow runs FIVE ops in ONE
  moment. `sealAct` enforces one-op-per-moment (do.js's `_opCount`), so five
  separate OUTERMOST `doVerb` calls in one `summonCtx` will trip it. The acts
  must run as **nested sub-ops** (do.js skips the increment when `_inOp` is set,
  the recursive-dispatch path the JS handler already rides) — or as separate
  moments. This is the thing to get right in the live-mode change.
