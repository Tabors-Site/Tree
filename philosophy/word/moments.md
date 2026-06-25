# moments — the spacebar at the MOMENT level (each act its own moment, its own commit)

> **Engine-lane doc, parallel to 23.md (verb lane).** 23.md cleans each do-op to ONE fact + fold
> (`stampsFact`, reducer-derives-the-rest, drop `skipAudit`). This doc is the other half of the
> spacebar: a Word of N acts lays **N MOMENTS** — each act opens its own moment, lays its one fact,
> and **commits to store** on its own chain link — not N facts crammed into one moment.
>
> **Handoff board:** live engine↔verb coordination for finishing the skipAudit→spacebar section
> is in **new.md** — append dated `HANDOFF→ENGINE` / `HANDOFF→VERB` lines there. The keystone the
> board turns on: a composite runs as N moments via `runWordToStore`; VERB lands a `.word`, ENGINE
> wires its run + verifies live.

## The lock (Tabor, 2026-06-22, after 23.md's engine sign-off)

When asked the scope of "start do op," Tabor chose **"split to N moments now."** The spacebar
read literally (23.md line 5): *"owner is the next space, the next word, the next fact, the
**NEXT MOMENT**."* So a composite is not N facts in one moment — it is N moments in sequence.
**Genesis already is this** (a sequence of `withIAmAct`/`withBeingAct`, each one act, each sealing
on its own — sprout.js). The composite `.word` just runs the same way.

## ⚠️ Correction for 23.md (verb lane) — the moment-count is superseded

23.md lines 79–87 (the "ENGINE-LANE SIGN-OFF 2026-06-22" + the superseded reading) say a composite
`.word` issuing N field-do's **"seals as opCount=1, the cherub:birth precedent"** — i.e. N facts in
**one** moment via `_inOp`. That sign-off predates this lock and is now **superseded**:

- **Still true (unchanged):** one act = one fact; `stampsFacts` rejected; the composite is a
  `.word`, not a JS wrapper; **N acts each lay ONE fact**; the reducer folds the consequences.
- **Changed:** those N acts are **N MOMENTS**, not one moment with opCount=1. The `_inOp`/`opCount`
  accumulation (the "cherub:birth precedent") is **the run-on the spacebar names** — it is being
  retired, not used as the model. A composite `.word` **runs via `runWordToStore`** (below), which
  opens one moment per act.

So your composite `.word`s (create.word, the llm-connection word, …) are **correct as compositions**
— author them exactly as planned. What changes is only how they *run*: through `runWordToStore`, so
each `do set-X` inside becomes its own moment/commit. Nothing in your tracker has to move; when a
`.word` is ready, it runs in N-moments shape for free.

## What landed (engine lane)

- **`stampOneAct(ctx, label, runFn)`** — `seed/present/word/evaluator.js`. The moment boundary at
  each fact-laying node. In per-act-moment mode (`ctx.perActMoment.open` set) every `do`/`be`/`name`/
  `call`/`emit` opens its OWN moment (the opener runs a `withBeingAct` cycle), lays its one fact, and
  seals it. `ctx.moment` is swapped to the fresh moment for the deed; bindings/laws/world-state stay
  on `ctx` across moments. **No opener set → byte-identical to before** (legacy `runAbleWord` still
  pools into one shared moment). Declarations (`is`/`can`/`law`/…) fold IS-side into `ctx.laws` and
  open no moment (letters — they lay nothing); reads (`see`/`recall`) lay nothing.

- **`runWordToStore(ir, { beingId, name, history, position })`** — `seed/present/word/ableWordRegistry.js`.
  The spacebar word-runner. Opens NO shared moment; sets `perActMoment.open = withBeingAct(beingId,…)`,
  so the evaluator stamps each act as its own moment to store, advancing the being's chain. The being
  acts as itself (signed BY its Name, THROUGH its being). The N-moments peer of `runAbleWord`.

- **Verified:** `verify-word-to-store.mjs` (boot-free, 7/7 — each act its own moment, declarations
  IS-side, **legacy path unchanged**) + `verify-word-to-store-live.mjs` (boot, 7/7 — a 3-deed Word
  grows the chain by 3, three distinct actIds, one fact each, all three spaces real in store).

## The inner word (Tabor, 2026-06-22) — it is NOT a separate "answer" act

The **inner word is the message INSIDE a call / recall / quote** — e.g. `call tabor hello` → "hello"
is the inner word. It is never a standalone content/"answer" act. So a being does not "speak a
response" as a sealed prose act; **it RESPONDS by calling the asker** (`call <asker> <message>`),
and that call is a *deed* — a word on the chain like any other. (This corrected an earlier framing
here that called the cognition-moment's prose "the answer/the inner word" — wrong. The prose is just
the raw text that parses into deeds; the inner words live inside the calls/recalls/quotes among them.)

## The cutover (engine lane owns)

1. **Cognition path → `runWordToStore` — LANDED + VERIFIED LIVE.** A word-native cognition (LLM
   `runWordNativeOutput`, scripted `runReactorMoment`) no longer pools facts into the cognition-moment.
   It parses the emitted Word; a Word with no deed (`wordHasDeeds` false → pure declaration/read) is a
   **SEE**; a Word with deeds runs `runWordToStore` — each deed (do/be/name + calls/recalls/quotes)
   stamps its **own moment to store** — then returns **`cognitionSee()`**. The cognition-moment seals
   **nothing of its own** (it is the DECISION); `moment.js` closes the inbox cleanly. The being's
   **response rides a call-deed** (the inner word inside it), not a prose-content act — so among the
   deeds, the being's own `call` re-invokes the next moment (the generative loop). **verify-cognition-cut-live
   6/6** (a scripted being decides a 2-deed Word → SEE + the chain grows by 2, two distinct actIds, both
   spaces real in store) + substrate boot-free 7/7 + live 7/7. The ripple is now the shape, not a
   question: a being's response is an **explicit `call <asker>` deed** (the inner word inside it), not
   implicit prose.
2. **Composite `.word` callers → `runWordToStore`** (coordinate per `.word` as the verb lane lands them;
   create.word is genesis-critical — careful).
3. **Retire the run-on machinery** once the callers are cut: the `opCount>1` gate (4-stamped.js:185)
   and `_inOp`/`_opCount` (do.js/be.js/call.js) become moot — a moment is one op by construction.
   Coordinate with the verb lane (shared `do.js`).

## Doctrine fix (Tabor, 2026-06-22): no `.js` backup, ever

Every word is a `.word` (a **theorem**, run by the evaluator) UNLESS it is an **axiom** (bottoms out
in the host — a `do.ref` handler or native matter, run by `doVerb`). There is **no JS-handler
fallback** for a theorem; the Phase-4 "dual registry, prefer `.word` else fall through to JS" was the
conversion transition and is over. Stale "fall through to the JS handler" comments in
`ableWordRegistry.js` (header + resolveAbleWord + disableWord) corrected to "refuse / resolve as axiom."

## The payoff: the moments re-invoke each other (the generative loop)

**Tabor, 2026-06-22:** *"once u guys build that pattern it will re-invoke each other."* The
per-act-moment pattern is the generative loop in disguise. Once each act is its own moment that
**seals to store**, the seal is a place to **re-invoke** — the being's next moment. The chain
generates itself:

```
read face → emit a word → stamp (one moment, one fact, to store)
   → the seal CALLS the being's next moment
   → re-fold (the just-laid fact is now IN the face) → emit the next word → stamp → CALL → …
   → until the being SEES (looks, lays no fact) → nothing to re-invoke → the chain rests
```

So the word chain is a chain of **calls** (summon is drift → **call** — the moments call each
other), and it's **ratification** in motion: each fact ratified into store re-presents the face,
which the next word answers. Termination is intrinsic — a SEE-moment lays nothing, so there is
no seal to re-invoke from. No infinite loop by construction; the being stops by not acting.

`runWordToStore` is the substrate (acts → moments → store); the **re-invocation hook at the
seal** is what makes them re-invoke each other. Open question to settle in the build: one word
per moment + re-invoke after each (purest), vs a multi-word Word per turn (N moments via
runWordToStore) + re-invoke after the turn — the hook is the same either way.

## Doctrine fix (Tabor, 2026-06-22): it's CALL, not summon

The verb is **call** (the drift term "summon" is retired). The dispatch/auth already used `call`
(`callVerb`, `verb === "call"`); the remaining drift was the **`canSummon` capability** + helpers.
Swept: `canSummon → canCall` across 21 `.js` (the ables, auth, descriptor, cognition, innerFace,
rasterStream, parser, services, shared), `permitsSummon → permitsCall`, and the dead `case "summon"`
fall-through in book/assemble retired. All compile; **verify-cognition-cut-live 6/6 still green**
(the rename didn't break auth — it births + acts through `canCall`). (Docs `.md` still say "summon"
in places — cosmetic, swept later; code is clean.)

## Helping the verb lane (engine pitching in)

- **delete-able — DONE (cross-reel re-target).** It was returning a bare `{deleted,name}`, so its
  fact landed on the caller's target, not the able's own reel. Now `targetsFact({deleted,name},
  {kind:"space", id:name})` — same shape as set-able, so `.ables/<name>` reads set→delete in order.
  verify-take-able-cut 11/11 + verify-grantable-cut 7/7 green.
- **Regression after my canSummon sweep + cutover + delete-able:** verb-lane landed conversions
  still green — verify-endmatter-cut 5/5, verify-setrender-cut 4/4, verify-take-able-cut 11/11,
  verify-grantable-cut 7/7. My 21-file rename didn't break their work.
- **Left for the verb lane (their active in-flight, has `.word`+`viaWord`):** set-pointer/delete-pointer
  (history-manager.word), config/share (share-ops), the llm field-sequence `.word`, create.word.

## Lane boundary

- **Engine/moment lane (this doc):** `runWordToStore`, `stampOneAct`, the moment model, the cognition
  cutover, retiring `opCount`/`_inOp`, the JSON-cognition-path removal (24.md).
- **Verb lane (23.md):** the composite `.word`s, `skipAudit`→`stampsFact`, the reducers, recognizing
  non-do verbs (name/see), the LIBRARY-reel history work.
- **Shared (`do.js`):** the `_inOp`/`opCount` retirement — sequence it together so neither seal half
  breaks; verb lane is currently uncommitted only in 23.md, so the code is clear.

**STATUS: runWordToStore landed + verified (boot-free + live). Cutover in progress.**
