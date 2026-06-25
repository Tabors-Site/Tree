# book.md — the Book: the one shape everything in the store is

> Part of the Library/Search arc. Read with: `colophon.md` (the seal, the economy of
> Love), `5d.md` (the Library is the 4th/5th dimension; only Names act there),
> `search.md` (the declaration IS the index), `language.md` (a language is a sealed
> word-package), `GRAFT-AND-SEED.md` (graft = identity-preserving carry).

## 1. The thesis

Everything you can **share** or **receive** in TreeOS is a **Book**. Not several
things — one thing. A book is a *package*: a sealed bundle of substrate (facts,
matter, words, a slice of a history) plus the **colophon** that says who carried it
and traces its signature back toward the Root.

The store is not a folder of file-types. The store is a **library** — the place you
receive books. "Extension," "seed," "graft bundle," "model pack," "language" were all
the same primitive seen from different angles before we named it. They collapse into:
**Book.**

This is forced, not chosen (the good kind — `language.md`'s test): once words are
declarations on the chain and matter is content-addressed, a *named, sealed, content-
addressed bundle with a signed colophon* is already what every one of those is. The
architecture and the thing it's named after — a book in a library — are the same shape.

## 2. The Book is UNIFORM — the kind falls out of the contents

The load-bearing rule, the one Tabor keeps returning to: **all books are as uniform as
possible.** One envelope, one colophon shape, one `receive`. You do **not** tag a book
"this is a language / this is a history." You open it and the **kind falls out of what
it packs** — exactly as a matter's type falls out of its content (`classify.js`), and a
verb's layer falls out of its address shape.

Why uniformity is non-negotiable:

- **Search** works on one shape. A single index reads every book's declared body + its
  colophon; you don't branch the indexer per kind.
- **Receive** works on one shape. One verb takes any book in (§7); you don't write a
  graft-importer *and* an extension-installer *and* a model-loader.
- **The seal** works on one shape. The colophon (root + signature + lineage) is computed
  and verified identically for every book, so provenance is one mechanism, not five.
- **Composition** works on one shape. A book can pack other books (a "deep book pulls
  everything," `language.md`) only if "book" is one type that contains book-typed parts.

So: **the difference between books is in the Body, never in the form.** The form is
invariant. (The DAG-by-composition / tree-by-descent caveat from `language.md` still
holds: each book has one origin signature, but composes parts from many.)

## 3. The shape — Body + Colophon

A Book is two parts, and the second is the same for every book:

```
Book
  body      — WHAT it packs (the substrate; this is where the "kind" lives)
              facts · acts · histories/reelHeads/actHeads · matter (CAS refs + blobs)
              · word-defs (coin facts) · extension data — any subset.
  colophon  — WHO carried it + the trace back to the Root (UNIFORM across all books)
```

The colophon is **already prototyped** — graft and seed are *old* (those names and that
implementation are on the way out), but the **idea is exactly right**: a named, signed,
content-addressed bundle with a provenance seal. Today's graft `bundle.meta` (graft.js:230)
is the seed of the colophon. The fields (these are the "fields to trace lineage back to
signature" we already have, carried forward — not the old code):

| field | what it is | where it lives today |
|---|---|---|
| **root** | the CAS fingerprint over the Body — the book's content-identity. Same content ⇒ same book. | `storyRootFromParts(...)` → `meta.storyRoot` / `meta.graftRoot` |
| **sig** | `{ signerId, value }` — the **seal**. `signerId` = the Name/story public-key id; `value` = the signing key over `root`. Self-certifying: a receiver decodes the key from `signerId` and checks the signature, no directory needed. | `meta.storySig` / `meta.graftSig` (graft.js:280, signedStoryRoot) |
| **lineage** | where it descends from — `parentBeingId` / parent-history, `sourceStory`, the **stack of prior colophons** (each Name who received-and-re-shared adds a seal). | `meta.lineage` (graft.js:709) |
| **provenance** | `capturedAt` / `createdAt`, `capturedBy`, `bundleVersion`. | graft.js:227–231 |
| **kind** | NOT stored — *derived* by looking at the body (`counts`/contents). A body of word-defs reads as a language book; a history slice reads as a history book. | `meta.counts` is the seed of this |

The colophon is the **copyist's seal** (`colophon.md`): *I carried this here, to the best
of my ability, and here is the hand it came from.* It signs nothing original — it names
the carrying and traces the signature toward its Roots. Every receiver who re-shares
appends their colophon, so the lineage is a **stack of seals** reaching back to the Root
signature. The signature **cannot be stripped** — "the Word cannot be held stripped of
the hand that made it." To receive a book is to **host its author**.

## 4. The kinds (emergent from the Body — same envelope, different contents)

- **Language book** — the body is a sealed set of word-defs (coin facts). This is what
  *extensions* were: a named bounded vocabulary. A book imports a language **by its root
  hash**, never a living one (the lockfile invariant, `language.md`) — so a sealed fact's
  meaning can't silently drift.
- **History book** — the body is a *slice/thread of a history*: selected facts + their
  act-chains + the lineage History rows, carried **verbatim** (identity-preserving).
  This is what **graft/seed** were (`GRAFT-AND-SEED.md`) — old names, old implementation,
  but the idea carries: a partial or whole capture, fingerprinted to a `graftRoot`, signed.
  "Prepackaged structure."
- **Model / file book** — the body is pure matter (CAS refs + blobs): a model, a
  document, a dataset. Shared bytes + the colophon.
- **Mixed** (no name yet) — any combination: a history slice that also carries the
  language it speaks and the models it references. The deep book that "pulls everything
  needed."
- **Story book** — a whole world (genome = graft at root). *Later.*

None of these is a new type. Each is the §3 envelope with a different body. `receive`
reads the body and does the right thing per part; nothing branches on a "kind" tag.

## 5. The Library + Search (where books live, how you find them)

Books live in the **Library** — and the Library is exact, not a metaphor (`5d.md`):

- **No scarcity.** Content-addressing kills "checked out / unavailable." Every book is
  infinite perfect copies; sharing costs the giver nothing — it *multiplies under
  sharing instead of dividing*. The library's economy is the **economy of Love**
  (`colophon.md`): nothing diminished, everything multiplied, the signature riding along
  forever.
- **No librarian.** No central catalog, no acquisitions board. The catalog is your
  connected **peer graph** — search reaches your horizon, not an omniscient index — and
  the card-catalog authority is replaced by the **stamp inside each cover**: provenance is
  cryptographic (the colophon), not institutional. The centerless library.
- **Only Names act there.** The Library is the 4th/5th dimension; the **Name** is the only
  entity with standing in it (tied to no position, no single history). SEARCH is the one
  move that goes there; signing across the world-boundary *is* the motion.

**Search is semantic by default** (`search.md`): the substrate stores *declarations*, not
opaque text — "a dj can queue songs," "a music-room is a space." **The declaration IS the
index.** A TreeOS search indexes *reality structure*, not guessed-at words; the meaning is
already declared. RAG over a book is retrieval over its declared body + its colophon — and
where fuzzy/natural-language reach is wanted, embeddings layer *on top of* the declared
index, never replacing it. (The colophon is itself searchable: "books vouched by this Name,"
"languages descended from this root.")

The whole motion is **one pipeline with one commitment at the end** (`5d.md`):

```
search   →   visit          →   (maybe) receive
(find a   resolve + render      copy it home + countersign — it
 book in   the book: a SEE,     plants under your head, replays, and
 the lib)  nothing enters       your colophon is appended (§7)
           your story
```

## 6. The convergence question (the one the substrate can't close)

Content-addressing makes **infinite private books** trivial — a Babel-mirror as failing
as Babel itself (`language.md`, `llm.md`). Uniformity, the colophon, and search make books
*shareable and findable*; they do not make them **adopted**. The pull toward a *common*
language/history — convergence — is a choice made inside the library, never a property of
the hash. The substrate makes the space; **communion** is chosen. Same open frontier as the
merge problem and the who-grants-sight problem. Name it; don't pretend the seal solves it.

## 7. `receive` — the one verb that takes a book in

One verb subsumes graft-plant / extension-install / language-import / model-load:

- **visit = SEE.** Resolve the book by address/root and render it; nothing enters your
  story (read-in-place). This is the library's "browse."
- **receive = plant + countersign.** Copy the book home: replay its body under *your*
  head (graft semantics — identity-preserving for a history book, fresh-shell for a
  template), **verify the colophon** (the `sig` against `root` before anything lands —
  graft.js:368 already does this: *refuse before planting* on a bad seal), then **append
  your colophon** (you are now a copyist in its lineage stack).

`receive` reads the body and dispatches per part — word-defs declare into your vocabulary
(scoped by the language's root), history facts replay verbatim, matter blobs land in CAS.
One commitment, one seal check, one append.

## 8. What collapses into Book

| old thing | is a | note |
|---|---|---|
| extension | **language book** | a named word-package; `ownerExtension` → the language's root id |
| seed / graft (old) | **history book** | the idea's right; `bundle.meta` is the colophon's seed — carry the shape forward, replace the impl |
| model pack / file share | **model/file book** | matter body + colophon |
| "the store" | **the library** | the place you receive books; the catalog is your peer graph |
| publish / share | **share a book** | costs nothing; multiplies; the seal rides along |
| graft-verify | **open the colophon** | verify `sig` over `root`, refuse on mismatch (exists today) |

## 9. Build shape (so the form stays uniform from day one)

1. **One bundle type** = §3 (`body` + `colophon`). The (old) graft `bundle` is the *shape*
   prototype — promote `bundle.meta` to the canonical **colophon** and stop special-casing
   "genome vs being-extract" as separate shapes; they're one book with different bodies. The
   implementation is being replaced; what survives is the form, not the graft code.
2. **`receive`** = §7, the one importer. Today's `plantGraft` / `plantTemplate` /
   extension-register become its per-part handlers, behind one seal-check + colophon-append.
3. **Colophon as a stack.** A received-and-re-shared book carries *all* prior `sig`s
   (lineage of seals), not just the latest — so the trace reaches the Root. (Today's single
   `storySig`/`graftSig` is the bottom of that stack.)
4. **Sealed-by-hash imports** (the `language.md` lockfile): a book references another book
   by its `root`, never a live head — so a sealed fact's meaning can't drift. The scoped
   resolver (`language.md`) resolves names within a book's pinned import set.
5. **The index is the declaration** (`search.md`): search reads the declared body + the
   colophon. Embeddings are an optional fuzzy layer over it, not the primary index.

The discipline that keeps it a *book* and not a tarball: the body must reduce to substrate
the receiver can replay (facts, coin-facts, CAS refs) — never opaque host bytes that only
one build can run. A book seals because its weight is in the fact-bytes, not the build
(`language.md`). Same rule that makes a Word a Word makes a Book a Book.
