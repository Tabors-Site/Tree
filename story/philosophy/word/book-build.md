# book-build.md — building the Book (the §2 sequence, code-grounded)

Companion to `book.md` (the doctrine). This grounds it in what exists and sequences the
build. The key realization from the scout: **two book-forms already exist** — we unify
them, we don't invent.

## What already exists (the two forms to unify)

| form                                                                                    | is a              | where                                                                                                          | colophon today                                                                                    | receive today                                                                                   |
| --------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **store word-bundle** — `store/words/<dir>/` (.word + handler), or a flat `<name>.word` | **language book** | `seed/store/words/*` (`WORDS.md`: "a portable unit — lift the bundle into another factory and it boots there") | — (self-registers via `registerRoleWord`; words = `coin` facts)                                   | side-effect import → `declareOpsToFold`/`registerRoleWord` → `coin` facts                       |
| **graft bundle** — facts/acts/histories/matter                                          | **history book**  | `seed/materials/publish/graft.js` (bundle), `seedTemplate.js`, `templateRegistry.js`                           | `bundle.meta` = `{ storyRoot/graftRoot, storySig/graftSig {signerId,value}, lineage, counts, … }` | `plantTemplate` (fresh-shell, seal-checked) / `plantGraft` / `applyGraft` (identity-preserving) |

Both are "a named, content-addressed, signed bundle you carry into another factory and it
runs." That's a **Book**. The store IS the Library; `materials/publish` is the
capture/plant machinery; graft/seed are the _old code_ — the idea carries, the impl gets
replaced.

## A book carries REELS, not act-chains

**THE ACT-CHAIN KEY IS `<story>:<history>:<beingId>`** — story, history, being (settled,
repeatedly). The being keys the chain (use the being's CAS id, never "name" — ambiguous with
TrueName); the **Name signs** (`by`) — it _spans_ the chains, it is NOT the key. Why all three:

- **`story` — for cross-network acts.** A Name acts across stories (in _other_ realities, through
  a being granted there), so it does NOT have one chain — its acts spread across `(story, being)`
  pairs. Without `story`, a foreign act collides on a local `(history, being)`.
- **`history` — same being across multiple histories (branches) on one story.** Each branch is its
  own chain. The act _already_ tracks history in its content, so you _could_ filter — but a
  dedicated per-`(story, history, being)` chain folds by **walking its own chain** instead of
  filtering all the being's acts. It's the **faster-folding** key.
- **being (CAS)** — the being the act happened through; a Name owns parallel chains, one per being.

A being is **living matter** — a reel (`qualities.memory`, state). It doesn't _author_ its chain
(the Name does), but it _keys_ it. And a **reel is self-contained**: `verifyReel` recomputes each
fact's identity from `p + content` — it never touches the act-chain.

So a content book packs **reels (fact-chains) + matter (CAS) + words (coin facts)** — and
**no act-chains.** The act-chain is the Name's sovereign identity; it can't transfer and the
book never needed it, because **authenticity is the colophon**: one `sig` over the book's
`root` (the reels' fingerprint) vouches the whole book — no per-fact act-sigs, no act-chain.

This **shrinks `receive`**: drop everything act-chain (the `actHead` rows, `verifyActChain`,
the act-fork gates, the act-chain re-key) that today's `applyGraft` carries. What remains:
verify the colophon → instate the **reels** (`verifyReel`, self-contained) → land **matter
CAS** → declare **words** → record the receive as the **receiver's own act** (on their Name's
chain). Simpler than the engine, and aligned with the Name doctrine.

_State: `actHead.js:19` keys `<history>:<beingId>` — missing story. The only fix is to **add
story** → `<story>:<history>:<beingId>`. This **reverses the refactor plan's WP-B** (which
proposed re-keying to `<history>:<nameId>`, one chain per Name): a Name acting across stories can't
be one chain — keep the being key, add story. The current `by`(Name-signs)/`through`(being-keys)
code is closer to right than WP-B. Flag to the cleanup lane as the §2 cross-story enabler._

## The unified shape (one `book`)

```
book = {
  body: {                      // WHAT it packs — the kind falls out of which keys are present
    words?:    [ coin-fact … ]    // language-book: word-defs (the .word source + the coin)
    reels?:    [ { facts, reelHeads, histories } ]   // history-book: fact-chains (NO act-chains)
    matter?:   { casRefs, casBlobs, casManifest }   // model/file-book
    code?:     { ref → bundled-fn }   // the host floor a word-bundle needs (the bottom turtle)
  },
  colophon: {                  // WHO carried it + the trace — UNIFORM for every book
    root:       <cas hash over body>            // = storyRoot/graftRoot, generalized
    sig:        [ { signerId, value } … ]        // a STACK of seals, newest last, back to the Root
    lineage:    { parent, sourceStory, imports: [ { name, root } … ] }   // descent + pinned imports
    provenance: { createdAt, createdBy, bundleVersion }
  }
}
```

The colophon is `bundle.meta` (graft.js:230) promoted to canonical + the `sig` made a
**stack** (every receiver who re-shares appends their seal). `signerId` = a Name/story
pubkey id; `value` = its signing key over `root` — self-certifying (`signedStoryRoot` /
`verifyStoryRootSig` already do exactly this).

## The root book, dependencies, and the master book

The colophon isn't only a seal — it's how books **depend on each other cleanly** and how a
Name builds from a root.

- **The root book = the signed origin.** A Name's _first_ book is the autograph — the bottom
  of every colophon lineage. **Signing is optional** (sign it if you want your own root);
  once signed, everything else **colophons off it**: each later book's `lineage` traces back
  to that root signature. (The reality's `storyRoot`/`signedStoryRoot` — the I-Am's seal — is
  the universal root every reality's books descend from; a Name's own root book is theirs
  within it.)
- **Imports = clean dependencies, sealed by hash.** A book pins what it needs in its colophon:
  `imports: [ { name, root } ]` — _by root hash, never a live head_ (the lockfile, `language.md`).
  A dependency is therefore **immutable**: the meaning a book was sealed against cannot drift.
  The scoped resolver resolves names within a book's pinned import set.
- **Acyclic by construction.** You can only import a book that **already exists and is sealed**
  (an older root), so imports point backward — the graph is a DAG, no cycles: _tree by descent_
  (the colophon lineage, one origin signature) + _DAG by composition_ (the imports, many
  parents). Exactly `book.md`'s shape.
- **The master book = a full OS.** A book whose body is almost entirely **imports** — a manifest
  of thousands of books + languages. It packs little of its own; it _composes_. Receiving it
  resolves + receives the whole pinned graph transitively (the deep book that "pulls everything
  needed," `language.md`). A reality's entire vocabulary + structure can be **one master book**:
  thousands of language/history/model books, all pinned by root, all tracing colophon-lineage
  back to the signed root. That's what makes the library a _system_, not a pile — and what lets
  a single book boot a whole OS.

## Names can't transfer — a book is CONTENT, not an identity

The decision that shapes everything here: **a Name cannot transfer.** A Name is a facet of
its reality's I-Am; cross-reality participation is the **vessel** pattern (the Name stays
home, acts through a being a host grants it). So:

- The old **being-graft** (`applyGraft`) is _identity-preserving sovereign transfer_ — it
  lands a being's own reel + act-chain so it becomes a living sovereign in the target. That
  **semantic is retired**: you don't graft a Name into another's reality.
- A **book is content** — words, matter, a history _thread/parts_, facts. Receiving it adds
  to _your_ library/reality. The content's facts ride with the **source's colophon as
  provenance** (un-strippable — _host the author's words_), but you **hold a copy**, you do
  not _become_ the author. The colophon economy: infinite copies, the signature rides along.
- **Whole-reality migration** (genome / `plantGraft` — _you_ moving to a fresh substrate)
  stays valid. That's you, not a Name transferred into someone else's reality.

**Keep the engine, drop the sovereignty.** The `applyGraft` transfer _machinery_ (cold
fail-closed gates → `landed[]`-tracked verbatim insert → post-insert `verifyReel`/
`verifyActChain` → `graftRoot` recompute → compensating rollback of exactly what landed) is
precisely what `receive` needs and it **works today** (graft.js:1095–1290). Reuse it; strip
the "becomes a sovereign being" part; the receive becomes the **receiver's own act** (a fact
on their reel + their colophon seal) over verbatim-with-provenance content.

## Sharing — saving a book (choosing threads + parts)

The capture side already exists too: `capturePartialGraft` (graft.js:810) selects a _slice_ —
a checkpoint-segment or single-branch _thread_ of a history + its lineage rows, fingerprinted
to a `graftRoot`, signed. That IS "choosing threads and parts." Generalize it from "a being's
reel" to "any selected parts" (a thread, a span of facts, a set of words, a matter set) → the
book's `body`. One capture, one `root`, one `sig`.

## The one `receive`

```
receive(book, { at, as }) =
  1. verify the colophon  — recompute `root` over `body`; check the top `sig` against it.
                            REFUSE-BEFORE-PLANT on mismatch (plantTemplate.js:105 already does this).
  2. dispatch per body-part (the kind falls out):
        words  → declare into the vocabulary (coin facts), scoped to colophon.root (the language)
        facts  → replay (plantGraft = verbatim / plantTemplate = fresh-shell under `at`)
        matter → land CAS blobs (verify each against casManifest — plantTemplate.js:146)
        code   → register host refs (only the floor a language genuinely needs)
  3. append your colophon — you are now a copyist in its lineage; push your {signerId, value}.
```

`visit = SEE` (resolve + render, nothing enters) is the read-in-place sibling; `receive`
is the one commitment.

## Build sequence (each step verifiable on its own)

1. **`book/colophon.js`** — the uniform seal: `computeRoot(body)`, `sealColophon(book, name)`
   (push a `{signerId, value}` over root), `verifyColophon(book)` (recompute + check the
   stack). Reuse `chainRoots.storyRootFromParts` + `storyIdentity.signData` + `verifyStoryRootSig`.
   _Verify: round-trip a book through seal→verify; a tampered body fails._
2. **`book/book.js`** — the shape + `kindOf(book)` (derive from which `body` keys are present;
   no tag). Thin; the contract is the shape.
3. **`book/receive.js`** — the one verb (above). Its per-part handlers WRAP the existing code:
   words → `declareOpsToFold`/`registerRoleWord`; facts → `plantGraft`/`plantTemplate`;
   matter → the CAS land. One seal-check + one colophon-append around them.
   _Verify: receive a tiny language book (one coined word) + a tiny history book (one fact);
   both land, seal verified, colophon appended._
4. **Migrate the two forms onto `book`** — `bundle.meta` → `colophon`; the store word-bundle
   gets a colophon when shared; `plant*` become `receive` per-part handlers. Keep the old
   entry points as thin shims until callers move.
5. **Sealed-by-hash imports + scoped resolver** (`language.md`) — `colophon.lineage.imports`
   pins books by `root`; the resolver resolves a name within a book's pinned import set
   (the one genuinely-new machinery — `getWord` grows from flat-global to per-import).
6. **Library + Search** (`5d.md`/`search.md`) — the store becomes searchable: index the
   declared body + the colophon (`book vouched by X`, `language descended from root R`).
   `SEARCH → visit (SEE) → receive`. Embeddings as an optional fuzzy layer.

## Reuse / replace

- **Reuse:** the colophon fields (graft `bundle.meta`), the seal mechanism (`storyIdentity` +
  `chainRoots.signedStoryRoot/verifyStoryRootSig`), `plantTemplate`'s seal/CAS checks, the
  store's portable-bundle convention (`WORDS.md`), the `coin`/`getWord` fold.
- **Replace:** the _split_ between "graft bundle" and "store word-bundle" as separate shapes
  (one `book`); the special-cased `plantGraft` vs `plantTemplate` vs extension-install as
  separate verbs (one `receive`); the graft/seed naming.

## Invariant (so a Book stays a Book)

The body reduces to substrate the receiver can replay — `coin` facts, world facts, CAS refs,
and only the irreducible host `code` floor. Never opaque bytes that one build alone runs. A
book seals because its weight is in the fact-bytes, not the build (`language.md`) — the same
rule that makes a Word a Word.

---

**First code:** `book/colophon.js` (step 1) — the uniform seal, the foundation every book
shares and every receiver checks.
