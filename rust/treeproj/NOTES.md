# treeproj NOTES

Tier 5: the projection cache. Two layers now stand here, both ported byte-compatible from the JS:

1. **The OWN-HISTORY leaf** (`index.rs` + `snapshot.rs`, prior steps): the `.proj` folded-state
   snapshot + the derived inverted index + the own-history `find_by_*` reads (ported from
   `seed/past/fileStore.js`). A single history's lookup. UNCHANGED by this step.
2. **The CROSS-HISTORY lineage walk** (`lineage.rs`, THIS step): the PROJECTION LINEAGE-INHERITANCE
   walk ported from the JS facade `seed/materials/projections.js` (its lineage half). Sits ABOVE the
   leaves and makes the read side CROSS-HISTORY: walk the parent chain, gate inherited rows by the
   per-reel branchPoint, shadow them with the child's own (live OR tombstoned) slot.

---

## STEP (this one) - the cross-history walk, `src/lineage.rs` (ADDITIVE, leaves UNCHANGED)

### What was still JS, and why this is the right seam

`treeproj`'s `find_by_*` (index.rs) are **OWN-HISTORY ONLY** - they read one history's inverted index.
The cross-history half (inherit a parent history's rows, gated by branchPoint, shadowed by divergence)
was still the JS facade in `projections.js`: `findByName` / `findByParent` / `findByPosition` /
`listByType` each do a history-local leaf read, then a lazy walk into the parent histories. That walk is
a READ-side layer over the same `.proj` snapshots + index the leaves read, calling back per-history. So
it ports as a module ABOVE the leaves (`treeproj::lineage`), not a rewrite of them.

The reel-level lineage substrate it needs already landed in `treestore` Step 4
(`resolve_history_lineage` / `branch_point` / `load_history`). This step composes that registry read
with the own-history leaves; no new storage logic, no leaf change.

### The JS semantics ported (projections.js, locked with Tabor 2026-06-03/04)

- **"Main is just-another-history with no parent."** On `MAIN ("0")` every query IS the own-history
  leaf - nothing to inherit. The cross-history wrappers short-circuit to the leaf when `history == MAIN`.
  (`isMain` from treestore: "0" or "".)
- **The divergence SHADOW.** `historyShadows(history, type, id)` = `loadSnapshot(history, type, id) !=
  null` - ANY own slot, **live OR tombstoned**, makes this history's view authoritative and an inherited
  row must NOT leak through. The leaf `find_by_*` HIDE a tombstoned slot from a find; the shadow check
  reads the **raw** snapshot (`snapshot::load_snapshot`), so a tombstone still shadows - "I deleted it
  here" must not resurrect the parent's row. (`lineage::history_shadows`.)
- **The branchPoint GATE,** `bp && bp > 0`. `branch_point(history, kind, id)` (treestore) returns `None`
  for main (never the gated history in these frames), `Some(0)` for "the reel had no facts at branch
  time" (the aggregate did NOT exist when the child forked -> **invisible**), `Some(seq>0)` for a real
  divergence point (**visible**). The Rust gate is `matches!(branch_point(...)?, Some(v) if v > 0.0)`
  (`lineage::predates_fork`). A corrupt lineage (a registry row missing partway up) PROPAGATES as
  `HistoryError` (the JS `BRANCH_NOT_FOUND`) - surfaced as `Result`, never a silent main fallback.
- **The recursion gates at EACH unwind step against the CURRENT frame's history.** `findByName` /
  `findByParent` / `listByType` recurse into `historyRow?.parent || MAIN` (to main through the FULL
  lineage, so nested histories inherit through their whole chain), and re-apply the shadow + branchPoint
  gate of THAT level's history as the recursion unwinds. The recursive Rust shape reproduces this
  exactly. (`parent_or_main` reads `load_history(...).parent`, JS `|| MAIN`: only a non-empty string
  survives.)
- **`findByPosition` is the ASYMMETRIC one - it does NOT recurse.** The JS `findByPosition` unions the
  history's OWN occupants with **MAIN's** occupants *directly* (`findByPosition(spaceId, MAIN)`), each
  gated by the shadow + branchPoint - it never walks intermediate ancestors. `lineage::find_by_position`
  mirrors that (own ++ MAIN-only). (For a depth-1 branch MAIN *is* the parent, so it coincides; for a
  nested history the JS position view inherits straight from main, and we match it.)
- **UNION ORDER.** Visible inherited rows come FIRST, then the own rows: `[...inheritedVisible, ...here]`
  (name returns the single matched slot; position/parent/list return the union). Same rows, gated +
  shadowed the same way, same order as the JS walk.

### Shapes (composes ON the leaves, returns their shapes)

The leaf shapes are returned unchanged - `find_by_name -> { id, ...slot }`, `find_by_position` /
`find_by_parent -> [{ kind, id, ...slot }]`, `list_by_type -> [id]`. The walk reads each candidate's
`id` to apply the gates. `list_by_type` keeps the **id-string** projection the leaf returns (the JS
materializes occupant rows then maps back to ids; the membership + order are identical, just the lighter
id shape the Rust read side already uses).

### `list_live_histories` - the enumerator, in `treestore/src/history.rs` (a registry read)

The cross-history layer (and `projections.findMatterByContentHash`, the cross-history content-hash
refcount) needs the LIVE-HISTORY set. JS `histories.listLiveHistories` = `HistoryCollection.find({
deleted: { $ne: true } }).sort({ path: 1 })`. The Rust enumerator lives WITH the registry it reads
(`treestore::history`, next to `resolve_history_lineage` / `load_history`), surfaced to the read side by
re-export through `treeproj` (`pub use treestore::list_live_histories`).

- **`list_live_histories(root) -> Vec<String>`**: every NON-deleted history PATH, ascending. Reads the
  `_index.json` scan cache the JS `FileCollection.find` reads (`Object.values(_index)` - the values are
  full rows), filters `deleted !== true` (only an explicit `true` excludes; absent / null / false pass
  the `$ne: true`), returns the paths sorted ascending (Rust `str` Ord == the JS cursor's `<` on these
  ASCII paths). MAIN ("0") is the implicit no-row root, so it is NOT in the set - exactly as the JS
  returns only rows; callers that want main prepend it (`findMatterByContentHash` does). A missing /
  corrupt index reads as empty (the cache is rebuildable, never truth). Public/additive; no existing
  treestore surface changes.

### Public surface (additive)

- `treeproj::lineage::{find_by_name, find_by_position, find_by_parent, list_by_type}` - the cross-history
  walk, each `-> Result<_, treeproj::lineage::LineageError>` (== `treestore::HistoryError`; map to the JS
  `BRANCH_NOT_FOUND` at the FFI boundary). The own-history `treeproj::{find_by_name, ...}` (index.rs
  leaves) are UNCHANGED - the lineage walk is a distinct namespace ABOVE them.
- `treeproj::list_live_histories` (re-export of `treestore::list_live_histories`).
- `treestore::list_live_histories` (new export from `history.rs`).

### The test (`tests/lineage_queries.rs`, 2 tests, all green - no Node)

1. `lineage_walk_inherits_shadows_gates_and_tombstones`: a being on main `"0"` + a branch `"1"`. Land
   rows with `create_history` + `commit_moment` (the real act+fact stamp); main reels fold own-history
   (own == lineage on main); the branch's DIVERGENT aggregates are cold-folded the JS way (fork the reel,
   commit the divergence, fold the **lineage union** parent-prefix++branch-tail, save the snapshot - so
   the branch's own `.proj` carries the inherited fields + the divergence, and the index buckets it).
   Asserts all four cross-history semantics, on every walk:
   - **INHERIT**: `find_by_name("1", "Alice")` -> the inherited main `be1` (NOT shadowed); carries main's
     folded state; still own-history on main.
   - **SHADOW**: `be2` diverged to "Bobby" on "1" -> `find_by_name("1","Bob")` is None (inherited Bob
     shadowed by "1"'s own be2 slot), `find_by_name("1","Bobby")` -> be2; MAIN untouched ("Bob" still
     resolves, "Bobby" does not).
   - **branchPoint GATE**: `be3` Carol, born on main AFTER the fork (no branchPoint entry -> gate 0), is
     NOT visible from "1", but IS on main.
   - **TOMBSTONE**: `be5` Eve inherited then KILLED on "1" (`qualities.dead` -> a tombstoned own slot) is
     shadowed (does not resurrect); Eve still lives on main.
   - Cross-checks `find_by_parent` / `find_by_position` / `list_by_type` carry the SAME view from "1"
     (`{be1, be2, be4}` - inherited be1 + diverged be2 + branch-own be4; be5 tombstoned-shadowed, be3
     branchPoint-gated) and the full set on main (`{be1, be2, be3, be5}`).
   - **ENUMERATOR**: `list_live_histories` -> `["1"]` (the branch row; main is the implicit no-row root).
2. `list_live_histories_excludes_deleted_and_sorts_ascending`: create branches `1b`,`1a`,`1`
   out-of-order + a soft-deleted `2` (a row written with `deleted:true`); the enumerator returns
   `["1","1a","1b"]` (ascending, the deleted one excluded).

All pre-existing treeproj tests (index_layer, projection_cache) + all treestore tests (branching,
commit_moment, signed_commit, torn_write, ord, act, stamp/store vectors) stay green; `cargo build` +
`cargo test` workspace-wide stay green.

---

## JS-DELETION NOTE (the projections.js lineage half deletes at the JS-runtime cutover, NOT now)

The cross-history walk in `seed/materials/projections.js` (`findByName` / `findByPosition` /
`findByParent` / `listByType` lineage recursion + `historyShadows` + the branchPoint gating, and the
`listLiveHistories` it imports) is **left in place** until the JS runtime is cut over to call the Rust
read side through the napi addon (the same pattern as the own-history leaf: `projections.js` already
routes the leaf storage call to `native.proj*`, but stays the HISTORY-AWARE QUERY layer for now). When
the cutover lands - the JS `findBy*` calling a `native.projLineage*` (or the read path moving fully into
Rust/treeibp) - the lineage half of `projections.js` deletes, as its own-history leaf storage call
already moved. This step does not modify `projections.js`; it builds the Rust peer the cutover will
point at. Same staging the leaf used: build the Rust, prove it byte-compatible, delete the JS at the
runtime cutover.
