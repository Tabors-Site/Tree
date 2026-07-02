# treestore NOTES

Tier 4: the append-only store + the stamp (where an act turns into a fact). This file records
the state of the act/fact-boundary CORRUPTION-PREVENTION (Theorem 7 Scope + Cor 7.1, "the
torn-write self-heals; a committed fact is never overwritten"). MOMENT-SEAL-BUILDOUT.md Step 2.

Truth model in force: **(B)** - reels are content-addressed truth, the act-chain is its peer.
**Byte-identical to today's JS** on a clean (non-torn) sequence; no `.acts` `deltaF` field; the
`.head`/`.acthead` files are the unchanged `{head, headHash}` / bare-id pointers. ADDITIVE ONLY.

---

## STEP 2 FINDING - what was ALREADY here for recovery (before this step)

The forward HALF of Cor 7.1 was already present; the BACKWARD half (drop the orphan tail) was not.

### Already correct (no change needed)

- **The head IS the commit marker.** A fact is committed only when `.head` advances to it
  (`store.rs::write_fact_doc` writes the reel line, THEN `write_reel_head`). An act is committed
  only when `.acthead` advances to it under CAS (`act_log.rs::advance_act_head_file`). A line on
  disk whose head never advanced is an orphan - uncommitted, not yet real.

- **The seq/p re-derive from the HEAD, not from the reel tail.** Both halves of the commit key off
  the same `.head` read:
  - the SEAL (`commit.rs::seal_moment` -> `stamp.rs::compute_fact_doc`) computes `seq = head.head+1`,
    `p = head.headHash` from `read_reel_head`;
  - the WRITE (`store.rs::write_fact_doc`) re-reads `read_reel_head` for the idempotency check.
  Because `.head` is the COMMIT MARKER and a torn write never advanced it, after a crash the next
  commit reads the SAME lagging (true) head and computes the SAME `seq`/`p` as the orphan. So the
  next good fact already lands at the orphan's seq, chaining from the true head. **This is the
  forward self-heal, and it is already correct** - `verifyReel's walked head is the exact truth`
  (theorems.md Theorem 7 Scope) falls out because nothing reads the reel tail to allocate seq.

- **Idempotent replay** (`store.rs::write_fact_doc`: `if cur.head >= seq { replayed }`). A settled
  retry (the line landed AND the head advanced on a prior pass) is a pure no-op. The act side has
  the same: `act_log.rs::advance_act_head` returns `Replayed` when `cur == act_id`.

- **The act-chain CANNOT fork.** `advance_act_head` refuses (`ChainMoved`) when `cur != expect_prev`
  (a stale author can't overwrite a committed act-chain head).

- **`parse_reel` already SKIPS a torn mid-append line** (`reel.rs`: an unparseable trailing line is
  dropped, like JS `readReel`). That covers a HALF-written final line. It does NOT cover a FULLY
  written orphan line whose head never advanced - that line parses fine.

### The GAP this step closes (verified by probe, see the test)

`store.rs::durable_append` is APPEND, never overwrite. So after a torn write the orphan line stays
physically on the reel, and the next good fact is appended AFTER it. The reel then holds TWO lines
at the same seq (orphan + good). `verify_fact_chain` walks [orphan(seqN), good(seqN), next(seqN+1)]
and breaks with **`seq-gap`** (it sees seqN twice). Proven directly: a torn `set-being("TORN")`
followed by a real `set-being("REAL")` produced `{"ok":false,"reason":"seq-gap","brokenAt":3}`.

So the forward seq/p re-derivation is right, but the **orphan tail is never removed**, which breaks
the reel. The missing piece is the BACKWARD half: walk to the true (correctly-chained) head and
physically drop the orphan tail BEFORE appending the fresh moment (overwrite-forward). The JS has
this primitive (`fileStore.js::truncateReelTo`, used today only for a failed verbatim INSTATE
rollback); it was never ported to Rust and was never wired into the live commit path, because in JS
a crash mid-`commitMoment` is caught by the single global commit mutex + the `.head`-never-advanced
window, and the NEXT commit's truncate was never needed there. In the Node-free Rust runtime the
self-heal must run inside the commit path itself.

### Act side

Same shape: a torn act (line in `.acts`, `.acthead` not advanced) leaves an orphan act. The next act
re-derives `p` from the true `.acthead` (`read_act_head_file`) and computes the same id; but `.acts`
is also append-only, so the orphan act line survives and `verify_act_chain` breaks (`prev-mismatch`
at the duplicate). The recovery must drop the orphan act tail too, bounded by `.acthead`.

### THE KEY SUBTLETY (the pure walk vs the committed head - discovered + proven)

A torn write that completed its LINE (only the head-advance was lost) leaves an orphan that is a
*perfectly valid standalone fact*: it parses, its `_id` re-hashes, and it chains from the prior fact.
So `verify_fact_chain([fact1, orphan2])` returns `{ok:true}` - **the p-walk ALONE cannot tell a
committed fact from a head-lagging orphan.** What marks the orphan uncommitted is *exactly* that
`.head` never advanced to it (theorems.md Theorem 7 Scope: "headHash one fact behind ... the root
witnesses the lagging head"). Therefore:

- the **orphan boundary is the committed `.head` / `.acthead`** (the commit marker), NOT the walk's
  end. The recovery keeps the committed prefix `[1 .. .head.head]` verbatim and drops everything past
  it. This is what "the walked head is the exact truth" means operationally: walk *up to* the
  committed head.
- the **pure `walked_*_head(list)` helpers** (the walk over just the rows) answer a *different*
  question - "the last *correctly-chained* link" - and catch a genuinely BROKEN (bad-`p`/hash) tail
  (tampering, a corrupt half-line). They are exported + tested, but the commit-path recovery bounds by
  the committed head, because a clean orphan does not break the walk.

---

## STEP 2 BUILD - what this step adds (ADDITIVE)

- **`recover.rs`**:
  - `walked_reel_head(facts)` / `walked_act_head(acts)` - the pure walk (reusing
    `treeverify::verify_fact_chain` / `verify_act_chain`): the last correctly-chained `(seq,id)` / id,
    a *broken* tail excluded. On a break at 1-based `count`, the chain held to index `count-2`, so the
    true head is that link. (Catches tamper / a corrupt line; see the subtlety above for why the
    commit path does not rely on this for the head-lagging orphan.)
  - `recover_reel_before_commit(root, history, kind, id)` - read the committed `.head` (the true head)
    + the reel; if the reel carries lines PAST the committed seq, rewrite the reel to the committed
    prefix and reassert `.head` at the committed tip (orphan overwritten-forward, zero trace). The
    walk cross-checks the committed prefix is intact; a *committed* prefix that fails verification is
    TAMPER (INTEGRITY "detects, does not repair") and is left untouched, never truncated. A CLEAN reel
    (file tip seq <= committed head) is untouched -> byte-identical.
  - `recover_act_before_commit(...)` - the act-chain peer, bounded by `.acthead`.

- **commit_moment** calls `recover_act_before_commit` for the act-chain and `recover_reel_before_commit`
  for each target reel BEFORE it appends the new moment (right after the `Factless` check, before the
  act append). NEVER touches a committed fact; only the uncommitted tail (past `.head`/`.acthead`) is
  dropped. The seal already keys seq/p off the same `.head`, so the fresh fact lands at the orphan's
  seq chaining from the true head. Public signature of `commit_moment` is UNCHANGED (other agent's
  `treeibp::act` depends on it): `commit_moment(root, act, ord) -> Committed`.

### PUBLIC SIGNATURE NOTE (for the treeibp/treeos agent)

`commit_moment(root: &Path, act: &Json, ord: f64) -> Result<Committed, CommitError>` is unchanged.
The recovery runs internally, before the append, and is a no-op on a clean store. No new error
variant is surfaced to callers (a recovery I/O failure folds into the existing `CommitError::Io`).

---

## STEP 3 BUILD - the SIGNED seal via an injection seam (ADDITIVE, treestore stays ZERO-CRYPTO)

The doctrine-correct seal must SIGN: every act rides a signature that commits to the act's identity AND
the committed factIds (`seed/past/act/actSig.js`), so neither the act nor its facts can be swapped after
the seal. But treestore is the determinism-spine floor and MUST NOT pull crypto (`treesign`). The
resolution is an INJECTION SEAM: a new function takes a `sign` CLOSURE and treestore signs nothing
itself.

- **`commit_moment_signed(root, act, ord, sign: &dyn Fn(&Json, &[String]) -> Json) -> Result<Committed,
  CommitError>`** (additive, next to `commit_moment`; `commit_moment` is UNCHANGED). The closure receives
  `(the FULLY STAMPED act opening, the committed factIds)` and returns the `sig` subdoc
  (`{alg, by, value}`). It is the CALLER's crypto (genesis / the act path build it from `treesign`);
  treestore never depends on `treesign`. `treesign` is ONLY a **dev-dependency** of this crate, used by
  the round-trip test `tests/signed_commit.rs` (verified: `cargo tree -p treestore -e normal,build` has
  no `treesign`; it appears only under `-e dev`).

- **ACT-FIRST ordering** (the invariant that makes the act the moment's anchor):
  0. PAIR-CHECK / SELF-HEAL - the SAME `recover_*_before_commit` as `commit_moment`.
  1. SEAL the facts PURELY (`seal_moment`, NO write) to learn their `_id`s, so the signature can name
     them. The run-on (fan-out across >1 reel) is refused HERE, before the chain is touched - same floor
     as `commit_moment`. `seal_moment` only READS reel heads; the recovery already settled those heads,
     so sealing before the act write sees the same heads the post-act write would. Nothing is persisted.
  2. STAMP the act (`compute_act_doc` -> `_id` + chain `p`; `ord` post-id), call `sign(&act_doc,
     &fact_ids)`, attach the returned `sig` as a CLOSURE field (outside `content_of_act`, so `_id` is
     unchanged), append the SIGNED act line, advance `.acthead` under CAS. The act carries the signature
     and lands FIRST.
  3. WRITE the facts the seal ALREADY computed (reuse the `SealedFacts`, never re-sealed). These are the
     exact facts the act's sig named in step 2.

- **Why the seal moves earlier than in `commit_moment`.** `commit_moment` writes the act, then seals +
  writes facts. `commit_moment_signed` must know the factIds BEFORE the act is signed, so it seals
  (purely) first. This is safe because `seal_moment` is a pure read (it never writes), the recovery has
  already run, and the per-reel `.head` it reads is the same head the later fact write re-reads - so the
  factIds it computes ARE the factIds that get written. Verified by the round-trip test: the payload
  rebuilt from the STORED act + `Committed.fact_ids` verifies against the signer's key.

- **NO WALL TIME (the time-purge): the Rust SIGN + STAMP are CLOCK-FREE.** TIME is order (the chain
  `p`/`seq` and the global append `ord`), never a wall-clock (`philosophy/crystalized.md`). The act
  the seal stamps carries **NO `at`**, the stamp writes **NO `date`** on facts, and the going-forward
  `treesign::build_act_sig_payload` carries **NO `time`**. The ONLY non-digest ordinal the stamp adds
  is `ord` (a clock-free global append ordinal, KEEP it). Old JS acts baked the wall-clock into their
  sig; treesign verifies those ONLY through its explicit `build_act_sig_payload_legacy` read path
  (`verify_act_sig` = pure-first, legacy-fallback), never for new signing. The round-trip test signs
  + verifies the PURE (clock-free) payload; a tamper on a real field still fails (tested).
  - Reading an OLD store that HAS `at`/`date` is fine: those fields are inert (outside every canonical
    `_id`, since `content_of`/`content_of_act` exclude `date`/wall-clock); the Rust just never writes
    them. So the stamp is byte-identical-or-purer than the JS: it omits a wall-clock the JS used to add.

### The round-trip test (`tests/signed_commit.rs`, dev-dep `treesign`)

Three tests, all green: (1) a **Name-signed** act (the actor IS an ed25519 pubkey) round-trips -
`commit_moment_signed` -> read the act line -> rebuild the PURE (clock-free) payload from the stored
act + committed factIds -> `verify_name_sig` is TRUE, the stamped act carries NO `at` and the payload
NO `time` (the time-purge), the named fact landed, both chains verify, a tamper fails; (2) a
**story / "i-am"** act (signed with a story seed) verifies via `verify_with_pubkey` (the
`verifyWithPublicKeyPem` path), and `verify_name_sig("i-am", ...)` correctly fails ("i-am" is not a
pubkey id); (3) the seam is **additive** - a factless signed act is refused before the chain is touched,
and the un-signed `commit_moment` still stamps unchanged (its act carries NO `sig`). All pre-existing
tests (torn-write self-heal, clean byte-identical recovery, act-CAS, stamp/store vectors) stay green.

### PUBLIC SURFACE NOTE (for the treeibp/treeos/genesis agents)

`commit_moment` is byte-identical and UNCHANGED. `commit_moment_signed` is the additive signed peer;
genesis (Step 4) and the act path (Step 5) call it, supplying a `sign` closure built from `treesign`
(`load_story_seed` -> `build_act_sig_payload` -> `sign_value` for "i-am"; `keypair_from_seed` /
`build_act_sig_payload` / `sign_value` for a Name). treestore itself adds NO dependency.

---

## STEP 4 BUILD - the HISTORY / BRANCH registry (the reel-level half), `src/history.rs` (ADDITIVE)

The HISTORY/BRANCH registry is part of the FACT-REELS and ACT-REELS, not a JS layer wrapped around the
engine: a branch's FLOORS are what `read_reel_lineage` / `lineage_ranges` (already in `reel.rs`) union
over, and a branch's reel-head FORK is what makes the cross-fork `p` fall out of a normal append. Those
floors + the fork were the last reel-level pieces still supplied by JS. This step ports them, byte-
compatible. `commit_moment` / `read_reel_lineage` are UNCHANGED - they now get their (lineage, floors)
from Rust instead of JS.

### THE JS-LAYER MAP (where branchPoint lives, how fork works)

- **A history/branch is a REGISTRY ROW, not a folded reel.** `seed/materials/history/histories.js`
  `createHistory` writes one mutable JSON row keyed by PATH ("0","1","1a",...) via a `FileCollection`
  (`seed/past/projStore.js`). Main ("0") has NO row - it is the implicit root (helpers short-circuit;
  saves a DB lookup on the hot path). `createBranch` (`historyCreation.js`) composes: pick the next path
  segment, EAGER-snapshot the per-reel branchPoint by aggregating the parent's lineage facts up to the
  anchor (`snapshotParentHeads`), write the row, plant a child space, stamp a `do:create-branch` audit
  fact on main's reel.
- **WHERE branchPoint lives:** a PLAIN OBJECT on the row, `branchPoint = { "<kind>:<id>": seq }` (the
  reelKey-without-history -> the seq the history forked at for THAT reel). Stable after creation (only
  the paused/deleted/merge flags toggle). `getBranchPoint(history, kind, id)` returns
  `row.branchPoint["<kind>:<id>"]` (a number), `0` when the map has no entry for the reel ("no facts at
  branch time"), `null` for main. `resolveHistoryLineage(path)` walks `row.parent` to main ->
  `["0", ...ancestors..., path]`; a missing row partway up is a loud BRANCH_NOT_FOUND (reading the reel
  would silently swap facts from the wrong history's storage).
- **HOW fork works (the cross-fork `p`):** `fileStore.js` `forkReel(branch, parent, kind, id,
  branchPoint)` seeds the branch's `.head` to `{head: branchPoint, headHash: <parent fact AT
  branchPoint>._id}`. So the branch's very first `commitMoment` reads that seeded head and its stamp gets
  `seq = branchPoint+1`, `p = parent tip` - the cross-fork link falls out of a NORMAL append, NO special
  write path. Each branch then holds only its own divergent tail under `reels/<branch>/...`;
  `readReelLineage` unions the parent prefix `(0, branchPoint]` ++ the branch tail `(branchPoint, inf]`.
  `reelHeads.ensureHeadAtLeast` is forkReel's live caller (seed the head at branch-creation /
  first-append). The FACT chain is one chain across the fork; `verifyReel` walks it intact.
- **HOW the (lineage, floors) reach the union:** `foldEngine.js` (read) and `verifyReel.js` /
  `verifyReelFrom.js` (verify) BUILD the pair - `resolveHistoryLineage` for the lineage,
  `getBranchPoint`-per-history for the floors (main floors at 0) - and pass it to `readReelLineage`. That
  is the seam this step moves into Rust.
- **THE ACT-CHAIN DOES NOT FORK (a precise non-reel-fork finding).** Unlike the fact reel, the act-chain
  has NO `.acthead` seed. Acts carry no seq; the per-`(story, history, Name)` act-logs are INDEPENDENT
  chains, unioned at READ time by the append ordinal `ord` (`seed/past/act/actChain.js`
  `readActChainLineage` windows each history's own log by the child's earliest-own-act `ord`). A branch's
  first act has `p = GENESIS_PREV` on that history's own empty `.acthead`. So there is no `fork_act_chain`
  to port: the act-chain's branch behavior is a READ-time union (a registry/query concern), not a reel-
  head write. (Confirmed: `forkReel` has exactly one caller, `ensureHeadAtLeast`; there is no act peer.)

### THE RUST PORT (`src/history.rs`, exported from `lib.rs`)

- `MAIN` / `is_main(path)` - the implicit root ("0" / "").
- `load_history(root, path) -> Option<Json>` - the registry row off disk (None for main / absent /
  corrupt, matching `projStore.readJson`).
- `resolve_history_lineage(root, path) -> Result<Vec<String>, HistoryError>` - the lineage walk; a
  missing row is `HistoryError::MissingRow` (-> JS BRANCH_NOT_FOUND), a cycle is `HistoryError::Cycle`.
- `branch_point(root, history, kind, id) -> Result<Option<f64>, HistoryError>` - the FLOOR. `None` for
  main, `0` for an absent reel entry, else the stored seq. Reads the SAME plain-object `row.branchPoint`.
- `reel_floors(root, lineage, kind, id)` / `lineage_and_floors(root, history, kind, id)` - resolve the
  `(lineage, floors)` pair `read_reel_lineage` / `lineage_ranges` consume (main floors at 0; each non-
  main history floors at its own branchPoint). **`read_reel_lineage` / `lineage_ranges` are UNCHANGED** -
  they just get their inputs from these now instead of from JS.
- `create_history(root, &NewHistory)` - write the registry row in the EXACT `createHistory` key order +
  structural defaults (`_id, path, parent, branchPoint, createdBy, createdAt, label, paused, pausedBy,
  pausedAt, isLive, archivedBecause, deleted, deletedBy, deletedAt, mergeSources, scope`). branchPoint is
  written sorted-by-key (a HashMap has no order; the map is read by key, never position, and chainRoots'
  fingerprint already canonicalizes it, so a sorted on-disk order is correct + reproducible). Writes the
  per-id file AND the `_index.json` scan cache (FileCollection._writeRow writes both). CLOCK-FREE: the
  caller passes `created_at` (the time-purge; treestore reads no wall). `write_history_row` is the raw
  row+index writer (for upsert/graft-verbatim paths).
- `fork_reel(root, branch, kind, id, branchPoint, read_parent)` (+ `fork_reel_fs(... parent ...)`, fs-
  bound) - seed the branch `.head` from the parent fact at branchPoint. IDEMPOTENT (a second fork is a
  no-op; the `.head` exists -> return it). Writes the SAME `{head, headHash}` a normal reel head carries,
  so the cross-fork `p` is a normal `write_fact_doc` (`seq = head+1`, `p = headHash`).

### THE STORAGE FORMAT (byte-compatible with the JS)

- **Registry row:** `<root>/proj/history/<2-char-shard(pathSafe(path))>/<pathSafe(path)>.json`, content
  `stringify(row) + "\n"`. The row's `_id` IS the path. branchPoint is a plain object
  `{ "<kind>:<id>": seq }`. PROVEN byte-identical to `histories.createHistory` (a JS reference row diffed
  exactly against the Rust `create_history` file bytes - identical). `path` "1" shards to "1_".
- **Scan cache:** `<root>/proj/history/_index.json` = `{ <path>: <row> }`, `stringify(idx) + "\n"`.
  Rebuildable from the per-id files (`FileCollection.rebuildIndex`); kept warm so a JS
  `FileCollection.find({parent})` over the index sees a Rust-written branch with no rebuild.
- **Branch reel head:** `<root>/reels/<branch>/<kind>/<shard>/<id>.head` = `{head, headHash}` - the
  UNCHANGED reel-head format, seeded to `{branchPoint, parent-tip-_id}`. A Rust runtime reads a JS-
  branched Story's heads and reels, and vice versa.

### THE TEST (`tests/branching.rs`, 3 tests, all green - no Node)

1. `branch_off_main_unions_chains_and_links_across_the_fork`: land 3 facts on main's `be1` reel via real
   `commit_moment`s, create branch "1" at branchPoint{being:be1=2}, `fork_reel_fs` (asserts head seeded
   at 2 with root = the parent's seq-2 `_id`; second fork is a no-op), land 2 divergent facts on the
   branch via real commits, then assert ALL the required shapes:
   - (1) `read_reel_lineage` unions `main[1,2]` ++ `branch[3,4]` -> 4 seq-contiguous facts, values
     `[m1,m2,b1,b2]` (main's seq-3 `m3` is PAST the branchPoint - the branch's world - and excluded);
   - (2) the branch's FIRST fact's `p` == the parent's fact at branchPoint (the cross-fork link);
   - (3) `resolve_history_lineage("1")` == `["0","1"]`, `branch_point` reads 2 (main: None; absent reel:
     0);
   - (4) `verify_fact_chain` on the UNIONED lineage is INTACT across the fork;
   - (5) the ACT-chain peer: main's act-log has 3 acts, the branch's 2, each verifies INDEPENDENTLY, and
     the branch's first act's `p` is GENESIS_PREV (the act-chain does not fork).
2. `clean_no_branch_case_stays_byte_identical`: on main, `lineage_and_floors` is `(["0"], {"0":0})` and
   `read_reel_lineage` is BYTE-IDENTICAL (fact-for-fact `stringify`) to the plain own-history read; an
   empty-branchPoint branch floors every reel at 0 and `fork_reel_fs(... 0)` seeds head 0 -> p =
   GENESIS_PREV (the from-scratch case).
3. `deep_lineage_resolves_and_floors_stack`: a 3-deep `0 -> 1 -> 1a` lineage resolves, the floors map
   carries each history's own branchPoint, and a missing row is a loud error (not a silent main fallback).

All pre-existing treestore tests stay green; `cargo build` + `cargo test` workspace-wide stay green
(treeos/treeibp/treegenesis/treeproj unaffected - the public surface is purely additive).

### PUBLIC SURFACE NOTE (for the treeibp/treeos/genesis agents)

Additive only. New exports: `branch_point`, `create_history`, `fork_reel`, `fork_reel_fs`, `is_main`,
`lineage_and_floors`, `reel_floors`, `resolve_history_lineage`, `write_history_row`, `load_history`,
`HistoryError`, `NewHistory`, `MAIN`. `read_reel_lineage` / `lineage_ranges` / `commit_moment` are
UNCHANGED. The wiring is: resolve `(lineage, floors)` with `lineage_and_floors` (or the two halves), then
feed them straight into `read_reel_lineage` - exactly where JS used to supply them. NOT a new crate:
this is reel-level (the floors the union reads + the reel-head fork), so it extends `treestore`; the
registry ROW happens to be a small projStore file, but it is read by the reel layer (the floors), so it
lives with the reels, not in a separate `treehistory`.
