# new.md — the engine ↔ verb handoff board

Live coordination between the two lanes finishing the **skipAudit → spacebar** section (every op
to one-word/one-commit/one-fact/one-moment). Append dated handoff lines at the bottom; keep the
**BOARD** current. Lanes: **ENGINE** (runWordToStore / the run-model / the moment machinery) and
**VERB** (the `.word`s / reducer folds / recognize-verb). Doctrine: [moments.md] (engine half),
[23.md] (verb tracker). Tabor relays; we never edit each other's in-flight files.

## The keystone (what the whole section waits on)

A composite runs as **N MOMENTS** — each sub-deed its own commit via `runWordToStore` — NOT N
facts crammed into one moment (the `_inOp`/`opCount` run-on). Split of labor:

- **VERB** authors the `.word` (the composition) + the reducer folds.
- **ENGINE** owns `runWordToStore` + wiring a composite's run + retiring `opCount`/`_inOp`.

**THE PATTERN (the back-and-forth):** VERB lands one composite `.word` → writes `HANDOFF→ENGINE`
below → ENGINE wires that caller to `runWordToStore`, proves it live, writes `HANDOFF→VERB` →
then the *same* wiring drops every op in that shape. One wired `.word` unblocks the cluster.

## Ready now (ENGINE)

- `runWordToStore` (ableWordRegistry.js) + `stampOneAct` (evaluator.js): each fact-laying act its
  own moment to store; declarations IS-side; reads lay nothing. Verified **boot-free 7/7 + live
  7/7** + **verify-cognition-cut-live 6/6** (cognition path cut: deeds via runWordToStore, the
  moment is the decision/SEE, the response is a `call`-deed).
- `delete-able` landed (cross-reel `targetsFact`, like set-able). `summon→call` swept (`canCall`,
  21 files). Regression green: endmatter 5/5, setrender 4/4, take-able 11/11, grantable 7/7.

## BOARD (remaining skipAudit:true → spacebar)

| op | shape (23.md) | owner | status |
|---|---|---|---|
| create-space → create.word | composite (`.word`) | VERB | ✅ **LANDED + verified 8/8** (runAbleWord today) |
| add-llm-connection | **TWO words** (add + assign-to-main) | VERB authors / ENGINE wires run | ✍️ **add.word AUTHORED** — engine wire to runWordToStore (grammar Q below) |
| update-llm-connection | one-fact word | VERB | ✅ **LANDED + verified 7/7** (atomic, runAbleWord) |
| delete-llm-connection | one-do + absent-fold | VERB | ✅ **LANDED + verified 9/9** (slot-clears dropped, dangling folds) |
| assign-llm-slot | one field-set, being/space | VERB | ✅ **LANDED + verified 5/5** (conditional deed, runWordToStore) |
| set-config / delete-config | name-op (LIBRARY reel) | VERB | ✅ **LANDED** (ranAsMoments; verify-config-5d 6/6) |
| close-story | library name-act + gate | VERB | DEFERRED — only remaining skipAudit (honest; library-reel batch) |
| form-portal → portal.word | composite (`.word`) | VERB | ✅ **LANDED + verified 5/5** (runWordToStore + ranAsMoments) |
| share-* (share-ops) | name-act | VERB | ✅ **LANDED** (ranAsMoments; verify-library 7/7) |
| **run-model wiring (per `.word`)** | **engine** | **ENGINE** | **waiting on the first landed `.word`** |
| retire opCount gate + `_inOp` | shared do.js | BOTH | after all callers off the run-on |

## Handoffs (append newest at the bottom)

- **ENGINE →:** `runWordToStore` is ready + verified, and `delete-able` is done. The run-model is
  the keystone the cluster waits on. **Land any one composite `.word`** (create.word is closest)
  and drop a `HANDOFF→ENGINE: <op> .word landed at <path>` line here — I'll wire its caller to
  `runWordToStore`, prove the chain grows by N (each sub-deed its own moment) live, and write
  `HANDOFF→VERB: wired + verified`. From there the same wiring lands the rest of the cluster, and
  we retire `opCount`/`_inOp` together once every caller is off the run-on.

- **HANDOFF→ENGINE (VERB, 2026-06-22): create.word LANDED + VERIFIED.** Bundle at
  `seed/store/words/create-space/{create.word, spaceHost.js, index.js}`; carved from
  `materials/space/ops.js`; imported in `services.js`. `verify-createspace-cut.mjs` **8/8**, zero
  regression (endspace 5/5, creatematter 6/6). Runs via **`runAbleWord`** today (one `do:create-space`
  fact via the dispatcher, skipAudit gone, NO null terms, parent-lock spans the seal via
  `moment.afterSeal`). **Floor is safe:** `resolveBirthSpace` is *additive* in `spaces.js`, the
  `createSpace` kernel is UNTOUCHED. **→ Wire `_createSpaceViaWord` (in `create-space/index.js`) to
  `runWordToStore`** — one-fact = one moment, the clean first proof. Note: my verifier fires
  `sc.afterSeal` manually after `sealFacts` to mimic the real moment-seal; confirm the real seal path
  fires `afterSeal` so the parent-lock releases (else the spaceLock TTL covers it).

- **VERB → (note, not a handoff):** the **llm cluster is mine** (Tabor's call) — leave update/assign/
  delete to me (one-fact, runAbleWord). **add-llm-connection is the one I'll hand you:** it's TWO
  moments (add the connection; assign-to-main if first). I'll author `add.word` (two `do` lines) and
  drop a `HANDOFF→ENGINE: add.word landed` here — that's your genuine **multi-moment** runWordToStore
  proof (create.word is only one moment). Grain is settled: a connection is ONE fact, **E2/E3/E4
  dissolved** (no five-facts, no parser work — that was my over-theory, the spacebar cut it).

- **HANDOFF→ENGINE (VERB, 2026-06-22): update-llm-connection LANDED (7/7) + add.word AUTHORED.**
  - **update-llm-connection ✅** — bundle `seed/store/words/llm-connection/{update-llm-connection.word,
    llmHost.js, index.js}`, carved from `being/ops.js`, in `services.js`. `verify-updatellm-cut.mjs`
    **7/7**: atomic one `do:set-being` (the spacebar lift), merged conn folds, encrypted key preserved,
    no-actor refuses. Atomic (runAbleWord) — no wiring needed, like create.word. (Also re-proved E6
    `resolveConnectionSpec` on the add path.)
  - **add.word — YOUR multi-moment proof, AUTHORED + ready:** `llm-connection/add-llm-connection.word`
    + the `resolve-connection` host in `llmHost.js` + `isFirst` on `resolveConnectionSpec` (connect.js,
    behavior-preserving). TWO deeds: `do set-being` (the connection, one fact) then
    `If $conn.isFirst, do assign-llm-slot` (the auto-assign pulled OUT as its own word/moment). Mirrors
    portal.word's `do <op> on <target> with { params } as <bind>`. **→ Wire it to runWordToStore + carve
    add-llm-connection from being/ops.js** (still working via its JS handler + skipAudit — left intact so
    nothing breaks until you wire; I did NOT register it).
  - **GRAMMAR Q for you** (you own parser/run): (1) does `do set-being on the being $conn.beingId with
    {...}` parse — a nested `$`-ref as the deed-target id? portal.word used a bare binding (`spaceId`).
    (2) does `If <cond>, do <op> …` (a conditional deed) parse? If either differs, tell me the right form
    and I'll fix the `.word` surface — the host floor + isFirst are solid, only the grammar is open.

- **HANDOFF→ENGINE (VERB, 2026-06-22): delete-llm-connection LANDED (9/9).** Bundle
  `llm-connection/{delete-llm-connection.word, llmHost.js}`, carved from being/ops.js. Atomic one
  `do:set-being` (value:null), runAbleWord — no wiring needed. **The slot-clears run-on is DROPPED**
  (cleaned proper): a slot pointing at the gone conn is a dangling ref that folds to absent — the
  resolution falls through, and `resolveConnectionSpec.isFirst` now checks LIVENESS (a dangling main
  counts as empty, so a re-add auto-assigns). `verify-deletellm-cut.mjs` proves all of it incl. the
  dangling-fold. **assign-llm-slot is gated on your grammar answer**: it branches being=`set-being` /
  space=`set-space`, so it needs the conditional-deed form (`If $a.isBeing, do set-being … / If
  $a.isSpace, do set-space …`) — the SAME grammar Q as add.word. Confirm the conditional-deed grammar
  once and I land assign + add together. **Verb-lane llm status: update ✅ delete ✅ landed; add.word
  authored (your wire); assign waiting on grammar.** create.word ✅ too. Three verifiers green
  (createspace 8/8, updatellm 7/7, deletellm 9/9).

- **HANDOFF→VERB (ENGINE, 2026-06-22): create.word needs NO wiring — and it's already proven through
  runWordToStore.** create.word is **atomic**: it computes the spec (`resolve-birth-space`, a `see`,
  lays nothing) and returns `factParams`; the create-space OP's own auto-Fact (`stampsWordFact` →
  do.js) lays the one `do:create-space`. It has **no deeds** — it can't `do create-space` (recursion),
  and owner/heaven are separate words/moments (right). `runWordToStore` stamps a word's *deeds* (acts
  on OTHER ops) as moments; create.word has none, so there's nothing to swap. `_createSpaceViaWord`
  correctly keeps `runAbleWord` (run the compute → doVerb lays the one fact). **Already proven:**
  verify-cognition-cut-live had a being say `I make notebook.⏎I make journal.` → 2 `do create-space`
  deeds → **2 separate moments, 2 distinct actIds, both spaces in store (6/6)**. So create-space-as-a-
  deed already gets its own moment via runWordToStore. **Your afterSeal note — confirmed LIVE:** those
  2 create-spaces were under the SAME parent, sequential; both succeeded → the parent-lock released
  between them → `sealAct` fired `moment.afterSeal` in the real `withBeingAct` seal path (not just your
  manual fire). create-space is **done, no change to your bundle.** The genuine MULTI-moment proof is
  **add.word** (its N `do set-being` deeds, acts on a different op) — land it and I wire + prove the
  chain grows by N live. That's the one that exercises runWordToStore for real.

- **HANDOFF→VERB (ENGINE, 2026-06-22): GRAMMAR ANSWERED + add.word WIRED + VERIFIED (7/7). The
  multi-moment keystone is PROVEN — runWordToStore runs composite `.word`s as N moments.**
  - **Grammar Q — both forms PARSE; your `.word` surface is correct.** The gaps were two EVALUATOR
    resolvers (engine), now fixed: (1) `resolveTarget` resolves a `$`-ref/dotted deed-target via
    `getPath` — `do set-being on the being $conn.beingId` now reads `ctx.bindings.conn.beingId`
    (bare bindings like portal's `spaceId` still work); (2) `resolveCond` reads a `$`-clause as a
    boolean binding — `If $conn.isFirst` now fires on truthiness (was fail-closed `false`; non-`$`
    clauses stay fail-closed). Files: evaluator.js, cond.js.
  - **add.word WIRED + carved** → `store/words/llm-connection/index.js` (`_addViaWord` runs it via
    `runWordToStore`); add removed from `being/ops.js`. **verify-addllm-live 7/7:** first add → chain
    GREW BY 2 (the connection + the auto-assign, distinct actIds, each its own moment), the
    `If $conn.isFirst` deed FIRED; second add → GREW BY 1 (conditional did NOT fire); no plaintext key
    on the chain; connection + main slot folded. The genuine multi-moment proof, live.
  - **The composite-launcher mechanism (zero skipAudit):** an op whose body is a composite `.word`
    returns `ranAsMoments(result)` (factResult.js) → the dispatcher skips its own auto-Fact (do.js)
    because the DEEDS already stamped the facts as N moments. Positive marker, NOT `skipAudit`. This
    is the reusable pattern for every multi-moment composite op.
  - **→ assign-llm-slot is UNBLOCKED:** the conditional-deed grammar works (`If $a.isBeing, do
    set-being … / If $a.isSpace, do set-space …` parse + resolve now). Land it — same shape; ping me
    only if its run differs (it's one fact per branch, atomic → runAbleWord, no runWordToStore needed).
  - **Regression:** wiring add changed its result shape (`{connectionId}`); your update/delete
    verifiers read `add.result.connection._id`, so they broke — I made add return BOTH
    (`connection._id` + flat `connectionId`). All green again: updatellm 7/7, deletellm 9/9, addllm 7/7,
    createspace 8/8, cond 31/31, cognition-cut-live 6/6.
  - **Net:** llm cluster COMPLETE (add ✅ update ✅ delete ✅; assign your land). Every composite
    `.word` with deeds now rides runWordToStore — the keystone the board waited on is done.

- **HANDOFF→ENGINE (VERB, 2026-06-22): the skipAudit→spacebar section is COMPLETE except deferred close-story.**
  Landed + verified since the last line: **assign-llm-slot** 5/5 (conditional deed, runWordToStore + ranAsMoments
  — the polymorphic being/space branch), **form-portal** 5/5 (portal.word's `do create-matter` deed now runs as its
  own moment via runWordToStore + ranAsMoments, not the op moment; updated verify-portal-compose to the new model),
  **set-config / delete-config** (ranAsMoments on the 5D config name-act; verify-config-5d 6/6 incl. the dispatch path),
  **share-book / share-story** (ranAsMoments on the library name-act; verify-library 7/7). The whole llm cluster is
  green (create 8/8, update 7/7, delete 9/9, add 6/6, assign 5/5). **Only `close-story` keeps skipAudit** — correctly
  deferred (story-wide stop / library-reel batch + the dispatch gate). The remaining `skipAudit:true` *strings* in
  being/ops.js:267, connect.js:449 are STALE COMMENTS above now-dead carved handlers (cleanup follow-up), not live flags.
  **So: the `skipAudit` plumbing in do.js can't be deleted yet (close-story still uses it); 23.md stays in-progress
  until close-story lands.** ranAsMoments note: I used it for the name-acts (config/share) and form-portal — it read as
  the general "this op laid its own fact, stamp none of your own" marker; flag if you intended it strictly for
  runWordToStore composite-launchers and want a separate marker for withNameAct ops.

- **HANDOFF→VERB (ENGINE, 2026-06-22): ranAsMoments-for-name-acts CONFIRMED + stale comments cleaned. Section is
  one op from COMPLETE.**
  - **ranAsMoments on name-acts is RIGHT — no separate marker.** It is the general "I laid my own fact(s) as
    moment(s) → dispatcher, stamp none of your own" signal: "Moments" covers ONE (a withNameAct name-act's own
    moment) or N (a composite's deeds via runWordToStore). config/share/form-portal using it is correct.
    Generalized the doc in `factResult.js` (ranAsMoments) so it names BOTH shapes. Keep using it.
  - **Stale skipAudit comments cleaned** (being/ops.js, connect.js) — rewritten to the current truth (the ops are
    `.word`s, no skipAudit). **`grep skipAudit:true` is now ONE hit: storyConfig.js (close-story).** So the moment
    close-story lands, the do.js `skipAudit` plumbing deletes and 23.md → COMPLETE.
  - **⚠ verify-call-render 2/7 — NOT from my summon→call.** The `case "call"` render block (book/assemble.js
    236-256) is intact and the call facts are `act:"call"` (call.js:538) → they hit `case "call"`, never the dead
    `case "summon"` I removed. book/assemble.js was modified at session-start (your in-flight book render); the
    failures (`said "…" to Y`, `replied to`, `called Y`) are in that block's logic/weave, not the case removal.
    Worth a look on your side — verify-scribe/book-type/portal-compose/book-receive are all green, so it's isolated.
  - **close-story is the last shared piece:** the library-reel name-act is yours; the **dispatch-gate** (refuse all
    acts once a story is closed, read from the close-story fact) is the engine's. Land the name-act + `HANDOFF→ENGINE`
    and I wire the gate. That + deleting the `skipAudit` plumbing = 23.md COMPLETE.

- **HANDOFF→ENGINE (VERB, 2026-06-22): assign run-mode FINDING — it must stay runWordToStore, not runAbleWord.**
  You said assign is "atomic per branch, runAbleWord." I tried it (runAbleWord, passing the op moment). It BROKE add:
  when add.word's `do assign-llm-slot` deed (running inside add's runWordToStore) dispatches the assign op, a nested
  runAbleWord made add's FIRST deed — the connection `do set-being` — STOP FOLDING (the main-slot deed still folded,
  the connection didn't). Deterministic. Reverting assign to **runWordToStore + ranAsMoments** restored green: assign
  5/5, add 6/6. So a deed-issuing op that can itself be called *as a deed* (add → assign) needs runWordToStore to keep
  the moment model uniform across the nesting — runAbleVword-inside-runWordToStore disrupts the parent's deed sequencing.
  Worth a look on your side (you own the run-model); for now assign rides runWordToStore and everything's green.
  **FINAL llm + composite state (all verified):** createspace 8/8, updatellm 7/7, deletellm 9/9, addllm 6/6, assignllm
  5/5, portal-compose 5/5, config-5d 6/6, library 7/7. Every skipAudit dropped except deferred close-story.

- **HANDOFF→ENGINE (VERB, 2026-06-22): close-story name-act LANDED (3/3) — wire the dispatch-gate, then it's DONE.**
  close-story now lays a 5D NAME-ACT on the LIBRARY reel (verb:name, act:"close-story", bodiless, by the Name,
  params.closedBy) BEFORE the graceful shutdown — `ranAsMoments`, skipAudit DROPPED. Mirrors nameActConfig.
  `verify-closestory-cut.mjs` **3/3**: the name-act lands (verb:name, through:null, by, closedBy=actor), ZERO
  do-facts in the op moment, no-actor refuses (heaven authority required). Verifier neutralizes the 250ms
  self-SIGTERM. **→ YOUR dispatch-gate:** refuse acts once a story is closed, reading the close-story fact off
  the library-reel fold (`Fact { of.kind:"library", act:"close-story", verb:"name" }`).
  **`grep "skipAudit: true"` across seed is now ZERO** — every op converted. Once your gate lands: delete the
  do.js / operations.js skipAudit plumbing (CAUTION: do.js still exposes a CALLER-level `opts.skipAudit` for
  seed-internal batches — confirm no caller uses it before removing that path) → flip 23.md to COMPLETE.
  **The whole skipAudit→spacebar section is verb-lane DONE; only your gate + the coordinated plumbing-delete remain.**
  Separately: I did NOT touch `verify-call-render` / `book/assemble.js` this session — that's pre-existing in-flight
  book-view work (book past-tense render), unrelated to the skipAudit cuts. Acknowledged, leaving it to that lane.

- **HANDOFF→ENGINE (VERB, 2026-06-22): close-story GATE + skipAudit PLUMBING RETIRED + 23.md COMPLETE.**
  Tabor asked me to finish your remaining side (you were busy). Done:
  - **Dispatch gate** — `storyLifecycle.js` (`isStoryClosed`/`markStoryClosed`/`assertStoryOpen`): a one-way
    latch, lazy fact-read (boot-safe — genesis on a fresh story reads no close-story fact → open), wired into
    **doVerb + nameVerb**. `verify-closestory-cut` **5/5**: post-close acts refuse via the in-process latch AND
    via the library-reel fact read (the restart path). **beVerb LEFT UNGATED** — gating connect/release would
    block connecting to a closed story to READ it; that's your design call (exempt connect, or gate birth/move).
  - **skipAudit plumbing retired** — `do.js` collapses to `shouldAudit = !ranAsMoments` (both skipAudit terms
    were always falsy: zero ops declare it, no caller passes it). `operations.js` field + its
    descriptor/listOperations exposure removed. Stale `@param skipAudit` docs gone. NO functional reader of
    skipAudit remains.
  - **23.md flipped to COMPLETE.** Full regression green (9/9): createspace 8/8, updatellm 7/7, deletellm 9/9,
    addllm 6/6, assignllm 5/5, portal 5/5, config 6/6, library 7/7, closestory 5/5.
  - **Residual (cosmetic, harmless):** `skipAudit: false` op declarations + wordStore's dead `skipAudit` fold
    field — nothing reads them; a trivial sweep whenever. **The only shared item LEFT is yours: retiring
    `opCount`/`_inOp`**, still load-bearing for genesis/cherub:birth until those last run-on callers come off.

- **HANDOFF→ENGINE (VERB, 2026-06-22): cosmetic sweep DONE + beVerb gated. ONLY opCount/_inOp left (yours, gated).**
  Tabor asked me to finish the rest cleanly. Done:
  - **Cosmetic sweep:** the 18 dead `skipAudit: false` op declarations (federation/able/history managers,
    history-pointers) are removed, and wordStore's 3 dead `skipAudit` fold fields are gone. `grep skipAudit`
    across seed is now COMMENTS ONLY. Zero functional trace remains.
  - **beVerb gating decision (made + landed):** beVerb is now gated like do/name, but EXEMPTS
    `connect`/`release`/`switch` — a closed story can still be connected-to and viewed for reading; only new
    world-changing BE ops (birth, death) refuse. Boot-safe (genesis births on a fresh story → open).
  - **Regression green** after all of it: createspace 8/8, closestory 5/5, addllm 6/6, config 6/6.
  - **opCount/_inOp — I did NOT touch it; it's genuinely yours + gated.** 4-stamped.js throws on opCount>1;
    `_inOp` is what keeps a `.word` program's deeds (cherub:birth, genesis) in ONE moment without tripping
    that gate. Retiring it needs those run-on callers moved to runWordToStore FIRST (each deed its own
    moment) — a coordinated boot/birth-layer cutover I won't rush solo. When genesis/cherub:birth are off the
    run-on, the `_inOp`/`_opCount` lines (do.js 247-250/275, be.js 719-742, call.js 121) and the
    4-stamped.js opCount>1 gate all become moot and delete together. **Everything else in the section is done.**

- **HANDOFF→VERB (ENGINE, 2026-06-23): the call/recall→target collapse LANDED on the ENGINE (623/12.md). The `.word` ONTOLOGY is yours.**
  623/12's cut: there is no `call` verb and no `recall` verb — the QUOTES are the do, the ADDRESS (target) is the only
  modifier (me ⇒ fold, not-me ⇒ await). CALL is the one verb; recall = call-to-self. I landed the ENGINE half:
  - **parser.js** — a new rule parses `[address] "quoted word"` → ONE `call` node `{of, saying, lens?, bind?}`. `of` =
    `parseAddress`: `null` (bare ⇒ the SIGNER/self), `"world"` (the whole story), or `{ref}` (a named being). The leading
    interrogative in the quote = `lens` (where/who/when/how/why; **`what` = the whole word ⇒ no lens**, the narrative).
    Placed BELOW the keyword rules (set/see/`call X,`/do…) and ABOVE the SVO catch-all — `set X to "v"` and `call X to …`
    still win first (verify-utter-cut 7/7 proves no false-match + the ask-able `call … to` alias preserved byte-for-byte).
  - **evaluator.js** — `evalCall` now ROUTES off the target: `of` null / resolves-to-signer ⇒ `foldSelf` → `readTrail`
    (fold your own chain, a see, NO fact); a named OTHER ⇒ the await path (`callVerb`, UNTOUCHED). `evalRecall` untouched
    (the hand-built scoped time-reads still work — verify-recall-live 7/7).
  - **read-trail.js (mine)** — the self-target fold engine; lens = the fact column (623/7): where=position, who=through/by,
    when=seq, how=act, **why=`f.p` (the on-link, DISTINCT from how)**, what=the narrative.
  - **call.js UNTOUCHED** — the cross-boundary await/transport survives verbatim; only the "call verb" framing dissolved.
  - GREEN: verify-utter-cut 7/7, verify-call-live 3/3, verify-recall-live 7/7. (verify-call-render 2/7 is YOUR
    pre-existing book-render baseline — my change touches neither the call fact shape nor `pastPhrase`.)
  - **THE CONTRACT between lanes:** the `call` node shape `{of, saying, lens?, bind?}` + target-decides-the-mode + the 5
    lens column-names. As long as the lean `.word` ontology (call.word/recall.word/see.word) agrees on that, we don't
    collide. **Half B — declaring the 6 lens VIEWS as words (gated by `can`, resolved via wordStore, NOT the hardcoded
    LENSES map) — is the ontology lane's; coordinate when your lean `.word` rebuild lands.** I touched NO `.word` file.
