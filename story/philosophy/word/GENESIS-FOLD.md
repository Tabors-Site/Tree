# GENESIS-FOLD — wiring the boot to fold the seed's self-description

The twenty `.word`s in `seed/words/` now declare the whole seed (word, iam, base, chain, branch,
reality, fold, weave, see, do, be, name, call, recall, being, space, matter, can, able, flow).
This plan wires the boot to read them and lay them as I `declare-word` facts on branch 0, so a
boot opened to the story view reads the seed declaring itself, line by line. It is the seam where
the `.word`s (this half) meet `wordStore.js` (the registry half), so it is written to hand to the sync.

## Current state, grounded in the code

- `seed/present/word/wordFold.js` reads `FOUNDATION_WORDS` = [`word.word`, `verbs.word`] and parses
  `X is a verb. / Its past is Y.` into `declarePast` (the verb conjugations). `foldWords()` exists.
- GAP: `foldWords()` has no call site (grep is empty). The fold is not wired to boot at all yet.
- `seed/present/word/wordStore.js` (the registry half): `bindWord(name, descriptor)` lays a
  `declare-word` fact carrying a serializable binding through an I act; `getWord` folds the
  `declare-word` / `disable-word` facts back into the descriptor. The registry IS a fold.
- `seed/present/book/assemble.js:211` already renders `declare-word` as `spoke the word X`
  (and `disable-word` as `silenced the word X`), but from `p.op` and only the name, not the body.

## The wiring

1. **Fold list, in descent order** (declare before use): word, iam, base, chain, branch, reality,
   fold, weave, see, do, name, being, space, matter, be, call, can, recall, able, flow. The verb
   instances (`verbs.word`) keep their own pass for `declarePast`, unchanged.

2. **Fold step.** For each `.word`: the word name is the filename (`chain.word` is `chain`); the body
   is the declaration (the `is` / `has` / `can` lines); the `#` header is the axiom and host pointer,
   not folded. Call `bindWord(name, descriptor)` with the actor as I and branch `"0"`.

3. **Descriptor for a CONCEPT word (the open shape).** An op `.word` (like `key.word`) binds with
   `do.ref` + targets (the wordStore shape). A concept `.word` is a description, not an op, so it
   binds the declaration itself: `{ kind: "concept", says: <body>, axiom: <header> }`. The story
   renders `says`; executability stays the host, the bottom turtle. Parsing `says` into
   `{ is: [], has: [], can: [] }` is optional, for richer rendering later.

4. **Wire `foldWords()` into boot.** After the reality is established, before the book renders any
   past tense. This closes the existing gap and runs both the verb-past fold and the concept fold.

5. **Render.** Extend `assemble.js`'s `declare-word` case so a concept fact shows its declaration,
   not only `spoke the word chain` but the lines beneath it, so the story reads the seed in full.
   Note the field mismatch to reconcile: the render reads `p.op`; `bindWord` writes `params.word`.

## Resolved with the sync (the wordStore half answered)

- **Binding shape:** `{ kind: "concept", says: <body>, axiom: <header> }`. Text now, parse later.
  `bindWord` stores it verbatim, the render shows `says`, executability stays host.
- **One path:** the same `bindWord` for all three kinds, read by `kind`. NOT a separate concept fold,
  that would be a second truth-system, the exact thing we removed. The wordStore half adds the `kind`
  tag to `declareOpsToFold` so ops and concepts read uniformly.
- **Render (theirs):** read `params.word` for the name, `params.binding.says` for the body.
  ableWordRegistry's legacy `params.able`/`op` shape is handled until it folds into wordStore.
- **Idempotency:** dedup by word, skip a declare whose latest binding already matches (the
  ableWordRegistry on-chain pattern), on both the concept declaration and `declareOpsToFold`.
- **Ownership:** they own `wordStore.js` (`bindWord`, `getWord`, `declareOpsToFold`, the dedup, the
  render); this half owns the `.word`s and the descent order; the boot call is the shared seam.

## The convergence: one fold, three shapes

The do-ops migration and the concept descent are the SAME genesis fold, binding different shapes.
One boot step lays three things, all through `bindWord`, all folded together, read by `kind`:

1. the verb pasts, `declarePast` (the runtime tense, `foldWords`, sync);
2. the concept `.word`s, `bindWord {kind:"concept", says, axiom}` (this half, `declareConcepts`);
3. the do-ops, `bindWord {kind:"op", do:{ref}, ...}` (the wordStore half, `declareOpsToFold`).

So the story reads the seed in full: the concepts as their bodies, the ops declared beside them.

## Built so far

- `seed/present/word/wordFold.js`: `declareConcepts({moment, branch})` reads the twenty `.word`s in
  descent order, splits body (`says`) from `#` header (`axiom`), and `bindWord`s each as
  `{kind:"concept"}`. `seedFold({moment, branch})` runs all three: `foldWords()` then
  `declareConcepts()` then `declareOpsToFold()`.
- Nothing is wired to boot yet: `foldWords`, `declareOpsToFold`, `seedFold` all have no call site.
  So `seedFold` is the ONE call to wire, the shared seam.
- **The boot point:** the genesis sequence in `seed/sprout.js`, after `ensureIAm()` (the I exists)
  and `ensureSpaceRoot()` (branch 0, heaven, exists), before the surface serves. `await seedFold()`.

## The result

Boot, open the story view, and read: `I spoke the word word` / `a word is a word` / `I am that I
am` / down through `flow`. The seed, declaring itself, as facts on the chain — language no longer
the one exception to fact, fold, reality.
