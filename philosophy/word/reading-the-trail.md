# Reading the Trail — `recall` / `call`, the lens, and the chain/fold model

> Realized in 623/7.md + 623/8.pdf ("READING THE TRAIL · What From"), reshaped with Tabor live
> (2026-06-23). This doc is the plan + what-it-is, written as it's built. The point: **reading the
> chain back is the view — and the inner face, the book, and the creation story are one read at
> different lengths.** Companion to moments.md (the spacebar at the WRITE side); this is the READ
> side. Engine: `seed/present/book/read-trail.js` (recall.word's lensed engine).

## The model this rests on (the crux — Tabor)

- **One act = the DO = the stamp.** One stamp lays one fact (the spacebar).
- **A fact is a noun or an act-word.** A **SEE** is inert content (a noun, read-only). A **DO** is an
  act-word — it _acts when a fold reads it_. The instant a fact is laid it is past = inert; a noun is
  just content for the next read, but **an act-word re-fires when the fold replays it** — and that is
  the generative loop (the moments re-invoke each other; the reducer applying a do during the fold =
  autoregression, 26.md).
- **Every moment is a word; every word is a do; a do makes a SEE or a DO.** SEE is the only "noun";
  everything else is a do — you never write "do," it just _is_ one. **be / call / name are do's with a
  type**, not separate verbs (verb-collapse, 17.md).
- **It's chain / fold, not be / is.** The **chain** is the laid order (the past, the trail, sealed).
  The **fold** is the read into the present (the view, the face). `be → chain`, `is → fold`.

## What it is — the target decides, the quotes are the do, the lens is the facet (623/12.md)

Reading the trail is folding a chain into a view — a SEE of the past (it lays no fact). But **the verb
is gone**: there is no `call` and no `recall`. The **quotes are the do** ("utter this word"); the
**address (the target) is the only modifier**, and it decides the kind by one question — _is the target
me, or not-me?_

- **`"what from?"`** (no address) — the target defaults to the **signer** (every stamp is signed, so
  the bare quote inherits you for free). Self-target → you **fold your own chain** (the read you can
  do); the next moment shows it. What we used to call a _recall_.
- **`salem "what from?"`** — a named other → `from` must walk a reel that isn't yours → you can't read
  it, you ask and **await** his stamp. What we called a _call_. The await is **forced** by the target
  being across the boundary, not a flag you set.

So the mode is never declared — it falls out of who the target is (self → fold, other → await). `I` is
special because it's the **signature**, not a word; the bare quote inherits the signer for free, so the
minimal form is just `"what from?"`. The collapse is the same one run deeper: four cans → see/do → the
verb into the word → **call/recall into the target.**

The **lens** is which facet you read off each passed fact — the interrogative inside the quoted word,
**orthogonal to the target** (same lens whether self or other). It is recall's **view**, a granted word
per a being's `can`. `from` is the on-link (walk the chain back); the lens is the column you pull:

| lens  | the facet (the column)                 |
| ----- | -------------------------------------- |
| what  | the thing's genesis / kind (its birth) |
| where | the place it happened                  |
| who   | the signer / actor                     |
| when  | the order down the chain (seq)         |
| how   | the act that did it                    |
| why   | the parent / on-link (the because)     |

No lens = fold the **full word** per fact: the narrative story (assembleStory's weave). A lens =
**actually filter** to that one facet, walked down the trail.

## The floor — `render(genesis → head)` = the creation story

The LONGEST recall — fold the whole chain from its first mark — is the creation story, and it begins
**"I am."** Not by authorship: a chain of being, read from its own first mark, can only say one thing
about where it came from. The self-read of 623/4 (`render(genesis → head) = "I AM THAT I AM"`) is just
the longest recall; it falls out for free once the chain exists. **The view is never stored** — the
chain stores words and order; the view is what the fold makes, fresh, every time (place-is-folded-from-
facts, at the scale of a whole history).

## Two things that must be right (Tabor, corrected live)

- **The branch is never defaulted.** A recall is always OF a branch (the `history`); the caller threads
  its own (people read different branches). There is no `getDefaultBranch` and no pin like `"0"` in
  library code — a recall with no branch is a bug, so `requireHistory` throws. (Tests may pin `"0"`
  explicitly.)
- **`world` is a real, defined scope.** It is the WHOLE story — every fact in the branch, across ALL
  reel-kinds (being · space · matter · name · library), all authors, in chain order. The convergence
  (reality=chain, place=fold, world=agreement among folds). It is NOT a single chain: a single chain is
  one being's / space's / matter's thread (scope `being` / `space`). `render(genesis → head)` is the
  world recall.

## Book sharing = choosing the view (which parts you want)

Sharing a book is **sharing a chosen recall**: the lens (view) × the scope (whose chain / where) × the
span (since / until). You get exactly the parts you want — one being's thread, a place's history, the
whole story from genesis — re-folded fresh by whoever opens it.

## The build

- **`seed/present/book/read-trail.js`** — the SELF-TARGET fold engine. `readTrail({ history, scope,
lens, since, until, being, space })` folds the chosen span/lens; `renderGenesis(history)` is the
  whole-chain fold. It delegates the full-word gloss to `assembleStory` and does the per-fact facet
  projection for a lens. `history` required; `world` defined.
- **Connection (623/12.md) — LANDED:** the parser parses `[address] "quote"` → a single **`call`**
  node `{of, saying, lens?, bind?}` (parser.js, below the keyword rules, above the SVO catch-all);
  `evalCall` routes off `of` — `of` null / resolves-to-signer → `foldSelf` → `readTrail` (fold your own
  chain), a named other → the await path (`callVerb`, untouched). **CALL is the one verb; recall =
  call-to-self;** the mode is never declared. verify-utter-cut 7/7; verify-call-live 3/3 +
  verify-recall-live 7/7 (no regression).
- **The lens itself should be DECLARED, not hardcoded.** The current `LENSES` JS map is drift
  (all-rules-fold / words-stack): the six interrogatives belong as declared **view-words** (coined on
  heaven `0`, resolved via `wordStore`, gated by `can` like every recall view), each naming one fact
  column — what→`of`, who→`through‖by`, when→`seq`, how→`act`, where→reconstructed from `params`/`of`,
  **why→`actId`** (the causing wake; the current `rootCorrelation`→`p` read is a BUG — `rootCorrelation`
  is an Act field, never on a Fact). Wiring the parse = Half A; declaring the view-words = Half B.
- **Demo (next):** `render(genesis → head)` on a live chain reads as a coherent creation story.

## Placement (factory: PAST vs PRESENT)

The sealed facts are the **PAST** (`seed/past` — the chain, the trail). The **fold** that reads them
into a view is the **PRESENT** (the live IS, the head holding still). So `read-trail.js` is
`seed/present/book/` — it reads the past, it does not live in it.

**STATUS — LANDED (engine, 623/12):** the parser parses `[address] "quote"` → ONE `call` node;
`evalCall` routes self (`foldSelf`→`readTrail`) vs other (await). CALL is the one verb; recall =
call-to-self. `why` = the on-link (`f.p`), distinct from `how` = the act (623/7; the earlier `actId`
rec was wrong, corrected). Green: verify-utter-cut 7/7, verify-call-live 3/3, verify-recall-live 7/7
(verify-call-render 2/7 = the verb lane's pre-existing book baseline, not this).

**`render(genesis → head)` PROVEN (verify-genesis-read 3/3):** a live 389-act chain reads back as the
creation story, in chain order, as readable Word — opening _"I gave birth to I and declared
I. I spoke the word word… I spoke the word iam: I am that I am…"_. 623/8's floor + 623/4's
`render(genesis → head) = "I AM THAT I AM"`, realized. The book is never stored — it is the read.

**NEXT:** Half B — declare the 6 lens views as words (gated by `can`, via wordStore, retiring the
hardcoded LENSES map), coordinated with the verb lane's lean `.word` rebuild.
