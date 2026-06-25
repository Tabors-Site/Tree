# ABLES-UNIFICATION — fold ableWordRegistry into wordStore (the last word-conversion step)

Status: BUILT + VERIFIED 2026-06-20 (all 4 phases green: verify-word-fold 11/0, verify-ablewordfold
4/0, verify-bedrock 4/0, all bridge/cut verifiers green; the 3-function API kept, REGISTRY is the
pre-genesis buffer only, bedrock generalized into wordStore over every word kind). The THREE
Map-as-truth registries (operations, matter-types, reducers) folded this session; verb-past and ables were ALREADY fold-backed before it (verb-past =
verbs.word folded into verbTense's `pastOf` projection via foldWords/declarePast — NOT a Map-as-truth;
modulo a hardcoded bootstrap remnant of ~20 irregular pasts still migrating to verbs.word per 9.md
Phase 3. ables = ableWordRegistry's own declare-word fold). ableWordRegistry is the last fold system to
UNIFY, and it is ALREADY a proper fold (its declare-word / disable-word facts are the truth; REGISTRY
is a live projection like wakes). So this is a CONSOLIDATION — two fold systems into one — not a
Babel-center removal. No correctness gap rides on it; the win is one fold path, one projection
pattern, one bedrock guard.

## The two fold systems today

Both lay `do:declare-word` / `do:disable-word` facts, on the same act names, with DIFFERENT params:

|             | wordStore.js                                             | ableWordRegistry.js                                         |
| ----------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| fact params | `{ word, ownerExtension, binding }`                      | `{ able, op, source }`                                      |
| projection  | `_projection` (Map, heaven "0" only, sync)               | `REGISTRY` (Map) + `_historyDisabled` (per-branch, sync)    |
| read        | `getWord` (async, per-branch) / `getWordSync` ("0" only) | `resolveAbleWord` (sync, per-branch, returns the parsed IR) |
| declare     | `bindWord` (+ `declareOpsToFold` etc.)                   | `registerAbleWord` (buffer) + `declareWordsToChain`         |
| disable     | `disableWord(name)`                                      | `disableWord(able, op)` / `enableWord(able, op)`            |
| rehydrate   | `rehydrateWordProjection("0")`                           | `rehydrateWordsFromFacts` (per-branch + bedrock)            |
| bedrock     | none                                                     | `_genesisWords` (I genesis on "0" is immutable)             |
| host extras | host-handler table (ref -> fn)                           | `irCache` + `wordOf`, `runAbleWord`, `bornBeingFrom`        |

The duplication is the declare/disable/rehydrate/projection machinery. ableWordRegistry has THREE
things wordStore does not: a SYNC per-branch enabled-state overlay, I bedrock protection, and the
able-specific host layer (IR cache + the evaluator runner + the birth-cut reader).

## Caller surface (what must keep working)

- `registerAbleWord(able, op, url)` — ~13 store-word bundles self-register at module load
  (create-matter, move, credential x4, portal, set-world-signal, grant-able, key, model, acquisition,
  set-render, branch-pointers, cherub). Pre-genesis (the chain is not writable yet).
- `resolveAbleWord(able, op, branch)` + `runAbleWord(ir, {...})` — every bundle's `_viaWord` handler
  resolves its `.word` IR and runs it. THE BRIDGE/STAMPER HOT PATH (every BE op + every wired do-op).
- `disableWord` / `enableWord` — the word-management ops.
- `bornBeingFrom(deltaF)` — the cherub birth cut.
- `declareWordsToChain` (genesis) + `rehydrateWordsFromFacts` (boot).
- `assemble.js` (the book view) imports ableWordRegistry — AUDIT its exact usage (WP-6).

DESIGN LOCK: keep this public API byte-for-byte. The ~13 bundles + the bridge do NOT change; only
ableWordRegistry's BACKEND swaps from its own REGISTRY/declare/rehydrate to wordStore's fold.

## The unified model

A able-word becomes a wordStore word, `kind:"ableword"`:

- word NAME = the able:op key (`"cherub:birth"`, `"being:grant-able"`, `"matter:create-matter"`, ...).
- binding = `{ kind:"ableword", able, op, source }` (source = the `.word` file URL string).
- wordStore is the ONE fold: `bindWord` declares, `disableWord` disables, `getWord`/`getWordSync` read.
- ableWordRegistry becomes a thin ABLE-LAYER over wordStore: registration buffer + IR resolution +
  the evaluator runner + the birth reader. It no longer owns a fact-emission path or a REGISTRY Map.

`resolveAbleWord(able, op, branch)` then = read wordStore's sync projection for `able:op` (existence +
enabled-on-branch) -> the `source` -> `wordOf(source)` (IR cache, unchanged) -> the parsed IR, or null.
`runAbleWord` / `bornBeingFrom` / `irCache` are HOST (the bottom turtle); they stay verbatim.

## The gap, and the two ways to close each half

### Gap A — the SYNC per-branch overlay

`resolveAbleWord` is synchronous and per-branch (a word can be disabled on branch X but live on "0").
wordStore's `getWordSync` is "0"-only; `getWord` is per-branch but async. Two options:

- A1 (smaller, recommended first): ableWordRegistry KEEPS `_historyDisabled` as a thin sync overlay.
  EXISTENCE (declared + backed) comes from `wordStore.getWordSync(able:op)`; the per-branch
  ENABLED-state stays in `_historyDisabled`, folded by a rehydrate that reads wordStore's disable
  facts grouped by branch. Removes the REGISTRY Map + the declare path; keeps the per-branch overlay.
- A2 (full): wordStore grows a sync per-branch read — `getWordSync(name, branch)` backed by a
  per-branch disabled overlay in the projection. Then resolveAbleWord is pure wordStore, and the
  overlay serves ALL words (an op/type could be branch-disabled too). Bigger; do it only if other
  words need per-branch disable.

### Gap B — I bedrock (the genesis-vocabulary immutability)

`_assertMayChange` forbids a non-I actor from disabling/re-declaring an I genesis word ON "0"
(per-branch shadowing still allowed). This is the general "words stack EXCEPT I bedrock" rule
(project_iam_genesis_immutable), not a ableword quirk. Recommended: MOVE it into `wordStore.bindWord`
/ `disableWord` as a guard over ALL words (ops/types/reducers/concepts are all I-on-"0" bedrock
too — they should be equally protected). One guard, every word. This is a strict improvement the
unification earns.

## Work packages

- WP-1 — ableword binding + key scheme. Define `kind:"ableword"` + the `able:op` name. VERIFY no
  collision with op/type/concept/reducer word names (the colon distinguishes, but confirm by grep +
  a boot assertion that no two words share a name across kinds). The colon must NOT trip the
  authorize ext-scope gate (it reads `args.action`, an op name, never a ableword key — confirm).
- WP-2 — declareAbleWordsToFold (wordStore). Mirror declareOpsToFold: read ableWordRegistry's pending
  registrations, `bindWord(able:op, {kind:"ableword", able, op, source})`. Wire in seedFold beside
  the ops/types/reducers (the able bundles register at module load, so they are present early) +
  the boot-end pass for extension able-words. `declareWordsToChain` becomes a thin call to this.
- WP-3 — resolveAbleWord reads wordStore. Existence from `getWordSync(able:op)` (the binding's
  `source`), enabled-state from Gap-A1's overlay. `wordOf`/`irCache` unchanged. Delete REGISTRY.
- WP-4 — disable/enable + rehydrate delegate. `disableWord(able,op)` -> `wordStore.disableWord(able:op)`
  - flip the overlay; `enableWord` -> `bindWord` re-declare. `rehydrateWordsFromFacts` reads
    wordStore's ableword facts (existence) + builds `_historyDisabled` from the per-branch disable facts.
- WP-5 — bedrock to wordStore (Gap B). Move `_assertMayChange` into `wordStore.bindWord`/`disableWord`
  as a general I-genesis-on-"0" guard; delete ableWordRegistry's `_genesisWords`/`_assertMayChange`.
- WP-6 — audit assemble.js + the book view. Confirm/repoint its ableWordRegistry usage onto the
  unified read (listFoldedAblewords or getWord). Any other inspector too.
- WP-7 — verification (the hot-path gate). Full boot. Then the bridge verifiers green: verify-cherub-_
  (birth), verify-connect-_, verify-take-able-\*, verify-grantable-cut, verify-credread/credreset-cut,
  verify-setpointer/deletepointer-cut, verify-setworldsignal-cut, verify-setmodel-cut,
  verify-creatematter-cut, verify-bridge-live. Plus: auth able-walk (a granted able still authorizes),
  a per-branch DISABLE test (a ableword off on branch X, on at "0"), and a bedrock test (a non-I
  disable of an I genesis word on "0" is refused, but shadowing on a branch is allowed).

## Risks

- THE BRIDGE/STAMPER HOT PATH: `resolveAbleWord` runs on every BE op and every wired do-op. A wrong
  null breaks birth/connect/auth. WP-7's bridge verifiers are the gate; run them after EVERY WP.
- SYNC timing: resolveAbleWord must stay synchronous (no await) — the overlay read is in-memory only.
- The bedrock move (WP-5) changes behavior for ALL words; verify ops/types can't be overridden on "0"
  by a non-I actor (a strict tightening — confirm nothing legitimately re-declares on "0").
- registerAbleWord is PRE-GENESIS (buffer); the bindWord flush must wait for the writable chain
  (seedFold), exactly as declareOpsToFold already does.

## Recommended phasing

1. WP-1 + WP-2 (declare path unifies; both folds coexist, ableword facts now wordStore-shaped). Boot.
2. WP-3 + WP-4 (read + disable unify onto wordStore; REGISTRY deleted; Gap-A1 overlay stays). Bridge verify.
3. WP-5 (bedrock to wordStore; general guard). Bedrock verify.
4. WP-6 + WP-7 (book view + full verification gate).
5. (Optional, later) Gap-A2: wordStore grows a sync per-branch read, only if other word kinds need
   per-branch disable. Until then A1 is the line.

Outcome: ONE fold system (wordStore) for every word — op, type, reducer, concept, ableword — with one
declare path, one projection, one bedrock guard. ableWordRegistry shrinks to the able HOST layer:
the IR cache, the evaluator runner (runAbleWord), the birth reader (bornBeingFrom). The bottom turtle,
and nothing else.
