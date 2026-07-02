# The Store (`treeseed`)

One place holding **every word of the story with its floor Rust beside it**. The engine (treeos) boots
from THIS store; the JS `seed/` tree is a dead reference corpus, kept only to diff against.

```
store/
  book/                  the genesis book
    index.word           THE reading order — one `I read <word>.` per line; the ONE declaration
    genesis*.word        the creation sequence (spaces, delegates, home, grants)
  words/
    <name>.word          flat file  = a pure CONCEPT (English only, no floor)
    ables/<name>.word    an able-spec (its own namespace: `I read the able <name>.`)
    <bundle>/            a dir = an IMPLEMENTATION — op .word file(s) + the floor .rs BESIDE them
  src/lib.rs             the resolver seam (AuthCtx/HostResolver/Resolvers), the #[path]
                         registrations, the lookup API (word/op_word/able_word/book/vocabulary),
                         and assert_no_drift()
  build.rs               DATA ONLY: embeds every .word (include_str!) + build-time invariants
```

## The seam law

- To see what a word **means**, open its `.word`. To see the **floor** it stands on, open the `.rs`
  next to it.
- A floor `.rs` with no sibling `.word` fails the build (build.rs invariant 1).
- Meaning in an `.rs` that its `.word` does not say is drift — the parser/reader drift gates
  (`treeword/tests/drift_gate.rs`, `treeibp/tests/drift_gate.rs`) ratchet it toward zero.
- A word is in the store **iff** it is in the book (`assert_no_drift`, boot + test). The only door is
  the `UNINDEXED_PENDING` list in src/lib.rs — words present but not yet coined at genesis — and it
  only shrinks.

## Adding or migrating a bundle (THE TEMPLATE)

1. **The word**: put the `.word` in `words/<bundle>/`. If migrating from `seed/`, copy **byte-verbatim**
   (`cp` then `cmp`) — re-wording a `.word` is a meaning change and is never part of migration.
2. **The floor** (only if the word genuinely needs one — hash/sign/disk/fold/crypto/net): the `.rs`
   sits in the same dir. Register it in `src/lib.rs` with a `#[path] mod` line, and add its op(s) to
   the `Resolvers` match. If a `see <op>(…)` in the `.word` has no resolver yet, add the op to the
   PENDING list with its JS reference path — never a silent stub.
3. **The book**: add `I read <word>.` to `book/index.word` (at the END unless dependency order demands
   otherwise — the index is the coined chain's order; inserting reorders genesis and changes the
   fingerprint, which must then be regenerated and reviewed).
4. **Prove it**: `cargo test -p treeseed` (store gates), then
   `cargo test -p treebook --test genesis_conformance` — if you did not intend to change the coined
   chain, the fingerprint MUST pass without REGEN. An intentional change regenerates
   (`REGEN=1 cargo test -p treebook --test genesis_conformance`) **in the same change**, and the
   fingerprint diff is the review surface: every changed line must be explainable.
5. Delete nothing from `seed/`.

## Naming rules

- Coined name = the file stem (`kill.word` coins `kill`), literally — the transitional
  `create.word`-coins-as-its-dir exception died with the M1C rename.
- A word is ONE act of ONE thing, ONE token (rain.md): verbs are never noun-disambiguated, so a base
  verb like `make` never coins as an act — COMPOUNDS are the words. `create-space`→`makespace`
  (`words/space/makespace.word`), `create-matter`→`makematter` (`words/matter/makematter.word`); the
  coin name, the fact/act name, and the file stem are the same one token. A human's "I make a space X"
  is the language layer translating down to `makespace`.
- Coined names are unique outside `ables/` (build.rs invariant 2). The able-specs are a separate
  namespace — an able may share a stem with an op word (`cherub` the able vs `cherub` the op).
- Op resolution (`op_word(op, noun)`): the noun bundle's `words/<noun>/<op>.word` first, then the
  unique bundle claiming the coined name.

## Dev iteration

Words are embedded into the binary at build time. To iterate on word text without recompiling, set
`TREE_STORE_DIR=/path/to/rust/store` — lookups read from that live tree instead.
