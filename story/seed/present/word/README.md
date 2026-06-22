# The Word evaluator (Phase 2)

The first real build of The Word: the **cherub birth flow**, hand-built as IR and run by an evaluator skeleton. Background: `reality/philosophy/word/` (1.md what it is, 2.md the plan, 5.md the IR schema, 3.md the tracker).

> **`examples/` is teaching scaffolding slated for eventual deletion.** The demo runners, hand-built IR modules, and demo `.word` programs now live in `examples/`; they exist to illustrate and exercise the engine and will be removed once they have served their purpose. The engine files (`parser.js`, `evaluator.js`, `wordFold.js`, `ableWordRegistry.js`, `verbTense.js`, `wordStore.js`, `cond.js`) and the `verify-*.mjs` gates stay here.

## Files

- `evaluator.js` — walks the IR and emits facts. It folds facts into `ctx.state`; registers flows as standing watches; `pump`s the choq on events (rules 6, 12); matches watches over state (`when: { state: {...} }`); and `drive`s a state wheel (the coupled clock). Two modes: `dryRun` (collects facts, no DB) and live (`emitFact` into the moment; `form-being` calls the real `birthBeing`).
- `parser.js` — a minimal template parser (prose -> IR); the larval form of the recursive-descent grammar (Phase 3).
- `verify-word-cherub.mjs` — the **live gate**: boots a real reality (Mongo + genesis) and runs the evaluator's `form-being` against the real `birthBeing`, asserting a real being is born (5/5).
- `ableWordRegistry.js` — the **bridge** (Phase 4, host): `(able, be-op) -> .word`, the dual registry preferring `.word`; `resolveAbleWord` returns the parsed IR or null (fall through to the JS handler), `runAbleWord` runs it live in the moment. Seeded with `cherub:birth -> cherub.word`. The only new host code; the rest of a conversion is deletion. See `bridge.md`.
- `verify-bridge.mjs` — sanity check: the registry resolves `cherub:birth` to the 5-act `cherub.word` and falls through for everything else (5/5).

### `examples/` (teaching scaffolding, slated for deletion)

- `cherub-birth.ir.js` — the cherub birth flow, hand-built as Word IR (slice 1; no parser yet, Phase 3 adds that).
- `harmony.ir.js` — harmony (drummer + dancer), the pulse (slice 2).
- `sun.ir.js` — the sun, the coupled sun/moon wheel over state (slice 3).
- `harmony.word` / `sun.word` / `genesis.word` / `give.word` / `being.word` / `matter.word` / `space.word` — demo `.word` prose.
- `demo.js` / `harmony-demo.js` / `sun-demo.js` — dry-run the hand-built slices and print.
- `word-demo.js` / `sun-word-demo.js` / `genesis-word-demo.js` / `cherub-word-demo.js` — the round-trip: parse a `.word` file and run it (no hand-built IR).

## Run

```
node reality/seed/present/word/examples/demo.js
```

Lays five facts, the same five the JS handler lays:

```
do:create-space   by Cherub   -> space:<home>
be:birth          by <being>  -> being:<being>     (form-being -> birthBeing; +inherited +global live)
do:set-space      by I_AM     -> space:<home>      (owner)
do:grant-able     by Cherub   -> being:<being>     (human)
do:set-being      by I_AM     -> being:<being>     (lineage)
```

## Slice 2: harmony (the pulse)

```
node reality/seed/present/word/examples/harmony-demo.js
```

```
beat 1:  Drummer strikes the drum
         Dancer steps
beat 2:  Drummer strikes the drum
         Dancer steps
...
... (the rhythm continues, unobserved)
```

This is the choq (rules 6, 8, 12) running with no clock: the drummer's able carries a flow that fires on each beat and strikes again (self-coupled, "again and again"), and the dancer's flow fires on the same beat and steps (coupled, it follows). The reel advances by **completion**, each strike's fact is the beat the next watch waits for, never a timer. `ctx.maxBeats` bounds the observation of an in-principle-endless rhythm. The evaluator gained `register` (collect flows as watches) and `pump` (drain the trigger queue, firing watches on each new fact) for this slice.

## The sun: the coupled wheel (state + the driver)

```
node reality/seed/present/word/examples/sun-demo.js
```

```
Sun rises,  sky is now day
Sun sets,  sky is now dusk
               Gardener waters the garden
Moon rises,  sky is now night
Moon sets,  sky is now dawn
...
```

The sun validates the three general engine capabilities a stateful program needs:

- **state / fold** (`ctx.state`): a fact with `sets` folds into the world state (here, `sky`).
- **watches over state** (`when: { state: { sky: "dusk" } }`): a watch fires on a _state_, not only an event.
- **the driver** (`drive`): a wheel that, each turn, fires every watch matching the current state. A _transition_ (Sun sets) writes the next state; a _rider_ (the gardener) just acts. The new state enables the next turn.

Coupling, not a clock: the sun setting writes `sky=night`, which the moon's watch was waiting on; the moon setting writes `sky=dawn`, which the sun's watch was waiting on. The wheel turns itself. `ctx.maxTurns` bounds the observation. This is the choq from rule 12 with state: a lawful dance, no timer.

## Slice 3: real `.word` (the round-trip, Phase 3 begun)

```
node reality/seed/present/word/examples/word-demo.js
```

Reads `harmony.word` (actual prose), parses it to the IR, and runs the pulse, no hand-built IR. `parser.js` is a minimal template-matcher over the sentence forms in use (`A X is a space.`, `A X is a able for a Y.`, `When a Z happens, the R verbs the O.`, and the derivation `When the R verbs the O, that is a Z.`). It is the larval grammar; grow it by adding templates, then replace with real recursive descent. This is the path off hand-built IR: write `.word`, run it.

## The gate (2.md, Phase 2) — PASSING (live)

```
node reality/seed/present/word/verify-word-cherub.mjs   ->   5 passed, 0 failed
```

`verify-word-cherub.mjs` boots a real reality (an isolated Mongo DB + genesis: `ensureSpaceRoot` + `ensureIAm` + `ensureSeedDelegates`, with a retry wrapper for the fresh-DB transaction quirks) and runs the evaluator's `form-being` **live** against the real `birthBeing`. It asserts the produced `be:birth` fact names `@worduser` and parents to cherub, that `birthBeing` lays its inherited + global able grants (one act, many facts), and that the being **materializes from the chain** after seal. So the evaluator drives the real substrate, not just a dry-run.

Findings it surfaced (real substrate requirements the idealized IR glossed):

- A fresh being's `trueName` must be a **NAME-declared** Name first; the IR's "mint a new Name" is really a NAME-verb act (its own slice). The gate defaults to the declared mother Name to exercise the birth path.
- The read-model is folded lazily; look up beings with `findByName` (fold-aware), not the raw projection.

Remaining for the full gate: run the whole five-act sequence live (the `create-space` making the home, then `set-space` / `grant-able` / `set-being` via `doVerb`), and a byte-for-byte diff against a JS-handler baseline.

## What is faithful

- The five-act sequence and order, from the real handler.
- `verb` + `op` dispatch (`do:create-space`, `be:form-being`, ...).
- The `by` / `through` split: `form-being` is `by Cherub` with no `through` (the new being has no being yet).
- One act, many facts: `form-being` dispatches to `birthBeing`, which lays `be:birth` plus the inherited-able and global grants (Tabor's "one act lays on multiple reels").

## What is stubbed or deferred (on purpose)

- The **first-being path** (parent = I_AM, the post-seal `grant-able:angel` via `summonCtx.afterSeal`).
- The **connect** ops (credential bind, owned, inherit / father-priority).
- Dry-run **placeholders** for the content-hash beingId and for `birthBeing`'s internal grant facts (they materialize when `form-being` runs live).
- **Live stamper wiring (the bridge)**: resolve a able's logic as a `.word` program OR (legacy) a JS handler, preferring `.word`. Word is NOT a cognition kind — it is the stamper's medium. A `.word` able runs the same whether scripted, llm, or human cognition decides inside it (1.md: declarations are uniform across cognitions; the stamper only records who authored each). Cognition (scripted / llm / human) stays its own axis: the logic for how a being decides which words to make and how to handle the words coming in.
- The **parser** (Phase 3): this IR is hand-built; the surface prose is not parsed yet.

## Note: the IR gained a field

Building this surfaced that the act node needs **`op`**, the operation within a verb (`do` + `op:"create-space"`, `be` + `op:"form-being"`). Recorded in 5.md. Everything else in 5.md held against a real slice.
