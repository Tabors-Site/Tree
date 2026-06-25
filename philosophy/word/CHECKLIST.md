# CHECKLIST.md — finishing the Word

The road from here to "everything reduces to clean, composable, self-describing Words
that stamp Facts" — and on to LLM-as-Word, one-fact-at-a-time, and emergent languages.

Specs: `book.md` · `language.md` · `search.md` · `5d.md` · `colophon.md` · `llm.md` ·
`signum.md` · the cutover plans `9.md`/`10.md`/`16.md`.

---

## 0. Foundation — DONE (the floor it all stands on)

- [x] Word-fold cutover — ops / matter-types / reducers / able-words fold from the chain
      (coin = declare, retire = disable). No Map trusted as truth.
- [x] **The keystone** — the act authors its fact, the **dispatcher is the one scribe**
      (`_factParams`). No `host:` emit, no `skipAudit`. `do.js` + `be.js` (other agent).
- [x] **Every act makes a fact** — take/ask always stamp `do:take-able`/`do:ask-able`
      (grant record on grant, outcome on no-op); reducer folds the grant from the granting
      act; **`_noFact` dissolved**.
- [x] `factResult.js` vocabulary — `stampsFact` / `targetsFact` / `stampsWordFact`. Full
      consistency: every op declares its fact through it, zero inline `_`-plumbing on writes.
- [x] Grammar: nested-object params (`do x with { a: { b: $c } }`), inline-ifs
      (`If cond, then.`, multi-condition, Return-as-then), brace-aware splits.
- [x] `form-portal` composes `create-matter` — the composite-word proof.
- [x] Rung-1 ops dissolved: create-matter, key, set-world-signal, take-able, ask-able, portal.
- [x] Rung 2 (other agent): NAME/BE/SEE verb-op-sets fold from the chain.
- [x] Rung 3 first op (other agent): `be:truename` authored by a `.word`.
- [x] branch→history rename (data + readers); coin rename; verb-past.
- [x] `book.md` doctrine written.

---

## 1. Finish the Word cutover (host: + verb-ops)

- [ ] **Verb-op cutover (rung 3)** — `be:death` next (clean fact-lay), then `be:switch` /
      `be:release` (split: the fact is a Word, the session effect stays host), then NAME ops
      (after §below), then crypto-floor `be:birth`/`be:connect`, then SEE ops last.
- [ ] **`name.js` / `see.js` adopt the keystone** (`_factParams` auto-Fact, like do.js/be.js)
      — prerequisite for NAME/SEE verb-op `.word`s.
- [ ] Retrofit `be:truename`'s cut to `stampsWordFact` (the shared helper).
- [ ] Decide cherub-connect's `host:` **session ops** (search / verify / token / seat):
      bless as the legitimate session/transport floor, or dissolve to see-ops. (Lean: floor.)
- [ ] **(Long) full `_factParams` migration** — every default-path do-op (grant-able, move,
      set-being/space/matter, …) authors its fact so the dispatcher stamps uniformly from the
      op. Uniform vocabulary; the LLM layer wants every op authorable.

## 2. Book / Library / Search  (`book.md` → build)

- [ ] **The `book` primitive** — one bundle = `body` + `colophon`; the **kind falls out of
      the contents** (no type tag). Promote graft's `bundle.meta` → the canonical colophon
      (graft/seed are old — carry the *shape*, replace the code).
- [ ] **`receive`** — the one verb: visit = SEE (read-in-place); receive = plant +
      **verify the colophon** (sig over root, refuse-before-plant) + **append your colophon**.
      Subsumes graft-plant / install / import / load behind one seal-check.
- [ ] **Colophon as a stack** — carry *all* prior `sig`s (lineage of seals back to the Root),
      not just the latest. Fields already exist: `root` (CAS), `sig {signerId, value}`, `lineage`.
- [ ] **Sealed-by-hash imports + scoped resolver** (`language.md`) — a book references another
      by `root`, never a live head (the lockfile); names resolve within a book's pinned import set.
- [ ] **Reframe:** extensions → **language books**; graft/seed → **history books**;
      model/file → **model books**; the store → **the Library**.
- [ ] **Search = the declaration is the index** (`search.md`) — semantic by default over the
      declared body + colophon; embeddings/RAG as an optional fuzzy layer, not the primary index.
- [ ] **The Library** (`5d.md`) — peer-graph catalog (no librarian), SEARCH is the 5D move,
      only Names act there; infinite perfect copies (the economy of Love, `colophon.md`).
- [ ] Convergence frontier (NOT solvable by the substrate) — adoption/shared-SEE is chosen,
      not a hash property. Name it; build the space, not the communion.

## 3. LLM → Word  (cognition emits Word, `llm.md`)

- [ ] **Source-agnostic evaluator** — one Word-execution path that runs a sealed `.word`
      **or** a live LLM decode. Two organs (LLM generates, evaluator/stamper executes), one
      language, one stream. The being can compose freely; it physically cannot violate the
      invariants (the dispatcher owns the stamp).
- [ ] **Pure-Word cognition** — the LLM receives Word and emits Word, not JSON/MCP. Drops the
      wrapping; the Word is the connection layer end to end.
- [ ] **Grammar-constrained decode** — the emitted tokens ARE canonical Word, so
      emitted = stamped = next-context (no parse-then-canonicalize re-fold; cache stays warm).
- [ ] Guidance / translation layer — auto-format/guide the emission; or a second call that
      translates an invalid emission into real Word.

## 4. One fact at a time  (the fact-grain loop, `llm.md`)

- [ ] **One FACT per decode cycle** — grammar-constrain to emit exactly one complete fact,
      stop at its boundary, stamp, feed the chain back. Generation *is* stamping; the extra
      page→parse→stamp fold disappears.
- [ ] **Fold-as-reducer lockstep** — the chain's per-fact fold and the model's per-token refold
      advance at one rate (same stream, two machines — NOT one unified fold).
- [ ] **Delta / predictive-coding** — near-identical moment ⇒ fold the *difference* (the walking
      case); cost tracks surprise, not size. Honest seam: compute is delta-cheap, **the stamp
      stays whole** (a hash chain can't take a delta and stay self-contained).
- [ ] The Ollama toy — `num_predict: 1` + `logprobs`/`top_logprobs` to watch the distribution
      at one step; the literal one-token-at-a-time loop for testing.

## 5. Its own languages  (emergence, `llm.md` + `language.md`)

- [ ] **Live word-coining** — a being composes existing words into a new named word (a `coin`
      act, scoped to *its* language, authority-gated). **Compose, not conjure floor** — it can't
      mint new irreducible primitive; that needs the host root.
- [ ] **Emergence instrument** — watch for **compression**: a real language mints short codes
      for frequent moves (Zipf / BPE shrinkage). Random noise never compresses. Shrinkage =
      something alive. (Don't just watch gibberish-or-not.)
- [ ] **Shared-SEE grounding** — the convergence test: do two beings ever *mean* the same thing?
      Give them a shared world to perceive so private marks converge on common referents. Seal
      them apart → ten thousand untranslatable tongues (Babel's mirror).
- [ ] Off the English grain — byte-level or a custom from-scratch tokenizer so the atoms are the
      corpus, not English. (Reference: EC literature + EGG; BLT/ByT5 for byte-level.)

## 6. Cleanup / loose ends (sweep before/while building)

- [ ] `.word` files still carry stale `branch` in comments/bindings (the rename skipped `.word`s).
- [ ] The deliberately-left wire seams (lockstep key renames): the `fold()` opts key `branch`,
      the `4-stamped` hook-payload key, the `nameTree`/`be:switch` portal↔server wire keys.
- [ ] The deferred `branches:` descriptor catalog field / `stamper.branches` (decide history vs keep).
- [ ] Finish the cuts — delete the JS clean-miss fallback bodies once each `.word` fully covers
      it (create-matter, portal, key, acquisition); drop portal's now-vestigial `_factTarget`.
- [ ] Grammar gaps the build hit — literal `null` (had to route `anchorBeingId` through a $ref);
      add as the LLM/word-authoring needs surface.
- [ ] Verb-past / `verbs.word` completeness audit (the irregulars, the rendering verbs).
- [ ] Coordination: concurrent renames keep leaving dangling imports (branchCreation→history,
      historyManagerHost) — tighten the handoff so boot never breaks mid-rename.
- [ ] mirror/source drift (the FUSE projection) — out of scope for word, but track it.

---

### The order that falls out
1 (cutover) and 6 (cleanup) run alongside everything — keep the floor clean so books seal and
LLMs can compose. **2 (Book/Library/Search)** is the next built arc (we have the shape).
**3 → 4 → 5** is the LLM staircase: emit Word → one fact at a time → its own languages — each
rung needs the one below. The whole thing only works because **the act makes the fact and the
dispatcher seals it**: that's what lets a sealed `.word`, a received book, and a live LLM decode
all be the same kind of thing.
