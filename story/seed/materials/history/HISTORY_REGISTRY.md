# Branch registry (named pointers) and canonical-path grammar

Status: SPEC. Not yet implemented. Captured here so merge-mediator UX
work and any future addressing change has a clean starting point.

## Why

Today every branch is named by a canonical path: `#0`, `#1`, `#1a2`,
`#7b3`. The canonical path describes the branch's position in the
branch tree by construction; once assigned, it never changes.

What's missing: mutable labels. After a merge, an operator probably
wants "the new merged branch" to be the new `main` without forcing
every bookmarked address to break. The named-pointer model gives
that: canonical paths stay immutable, named labels (`#main`,
`#prod`, `#release-v2`) live in a per-reality registry and can be
re-pointed.

Same pattern as git refs. Same reasoning.

## The split

**Canonical paths** are immutable structural identifiers determined
by the branch tree:

- `#0` = canopy / original main. Forever.
- `#7` = the seventh top-level branch off canopy. Forever.
- `#1a2` = the second number-branch off the first letter-branch off
  the first top-level branch. Forever.

Once a canonical path is assigned to a branch, no future operation
re-points it. `#0` always refers to the original main, even after a
hundred merges. Historical addresses survive forever.

**Named pointers** are mutable labels stored per-reality:

```
qualities.pointers = {
  "main":       "0",       // currently points at #0
  "prod":       "7",       // currently points at #7
  "release-v2": "5a3",     // currently points at #5a3
}
```

A pointer can be re-pointed at any time. Pointer changes are facts
on the registry's reel; pointer history is queryable via fold.

## The grammar

Canonical paths alternate number-segments and letter-segments. Top
level is a number; the next level is letters; the next is numbers;
the next is letters; and so on.

```
Path        := "#" NumberSegment (LetterSegment NumberSegment)* LetterSegment?
NumberSegment := positive integer (or "0" for canopy)
LetterSegment := alphabetic counter: a, b, ..., z, aa, ab, ..., az, ba, ..., zz, aaa, ...
```

Letter segments use the same convention as spreadsheet columns:
`a`..`z`, then `aa`..`az`, `ba`..`bz`, ..., `zz`, then `aaa`...

**Two layers of validation:**

1. **Structural validity** at parse time: does the string match the
   grammar? `#3ab` is structurally valid (after `#3` we expect a
   letter segment; `ab` is a legal alphabetic counter value).
   `#3-z` or `#0a` (no number before letter) are structurally
   invalid and rejected at parse.

2. **Existential validity** at dispatch: does the path refer to a
   branch that actually exists in the registry? `#3ab` is
   structurally valid but might not exist if `#3` only has a few
   letter-children so far. Existential failures throw `SPACE_NOT_FOUND`
   (or a dedicated `BRANCH_NOT_FOUND` code), distinct from grammar
   errors.

## Disambiguation: pointer vs. canonical

The parser tells them apart by structure:

- `#0`, `#7`, `#1a2`, `#3z` — match the grammar → treat as canonical
  → bypass the registry.
- `#main`, `#prod`, `#release-v2` — don't match the grammar (first
  char isn't a digit) → treat as named pointer → consult the
  registry to resolve to a canonical path.

The disambiguation rule is purely structural. Names always start
with a letter; canonical paths always start with a digit. A pointer
named `main` and a canonical path `m` would collide, but `m` is
already invalid (canonical must start with digit).

## Architectural surface

This is "Diff B" relative to the merge work that just landed.
Roughly two days of focused effort.

### 1. The registry being

A reality-level delegate `@branch-registry` holds `qualities.pointers`.
Per-reality, planted at genesis alongside `@branch-manager` and
`@llm-assigner`.

Permissions: pointer updates restricted to reality-root or
branch-manager. Reads open to any authenticated being (or arrival).

### 2. Registry ops

On `@branch-registry`:

- `set-pointer({ name, canonical })` — creates or updates. Validates
  that `canonical` is structurally valid AND existentially valid
  (the branch exists).
- `delete-pointer({ name })` — removes a named pointer. Reserved
  names (`main`, possibly others) cannot be deleted (or only by
  reality-root).
- `list-pointers` — SEE returns the current map.

Each op stamps a fact on the registry's reel; pointer history is
foldable.

### 3. Parser extension

`seed/ibp/address.js` learns to recognize named pointers:

```js
// In parseStance or similar:
if (branchSegment matches /^[a-z][a-z0-9-]*$/) {
  // Named pointer; mark for resolution.
  stance.branchPointer = branchSegment;
  stance.branch = null;  // unresolved until registry lookup
} else if (branchSegment matches CANONICAL_PATH_RE) {
  // Canonical; use as-is.
  stance.branch = branchSegment;
}
```

A new async `resolveBranchPointers(expanded, ctx)` step (parallel
to the existing `resolveBeingIds` from Diff A) consults the
registry and fills `stance.branch` with the canonical path. From
there, every existing branch-aware path (lineage walk, fold, wire
gates) operates unchanged.

### 4. Merge op interaction (already partially there)

The `merge-branches` op already accepts `afterAction: keep|pause|
delete` for the source branches. Add one more option:

- `repointMain: true` — after creating the merged branch, also
  update the `main` pointer in the registry to point at the new
  merged branch's canonical path.

Front-end flow:

1. Operator triggers merge.
2. Merge creates the new canonical branch (e.g., `#7`).
3. Front-end asks: "Update `#main` to point at `#7`? Pause or delete
   the source branches?"
4. The single merge-branches call carries `afterAction` and
   `repointMain` based on the answers.

### 5. Grammar validation

A new `isValidCanonicalPath(path)` helper alongside `isValidBranch`
in address.js. Parser throws clear errors:

```
"Branch path \"#0a\" is invalid: canonical paths start with a digit
 (top level is a number-segment)."

"Branch path \"#3-z\" is invalid: segments must be alphanumeric;
 hyphens are not allowed."
```

The existing `BRANCH_RE` regex covers most of this already; just
needs a doc comment and a clearer error message.

### 6. Doctrine to pin in FACTORY.md "Branches"

> **Canonical paths are immutable structural identifiers.** Every
> branch has a unique canonical path determined by its position in
> the branch tree. Once assigned, a canonical path never changes
> meaning and never refers to anything other than the branch it
> names. `#0` is forever canopy; `#7a4` is forever the fourth
> number-branch off the first letter-branch off the seventh
> top-level branch.
>
> **Named pointers are mutable labels.** A per-reality registry maps
> names (`main`, `prod`, etc.) to canonical paths. Pointer updates
> are facts on the registry's reel; pointer history is queryable.
> Cross-reality addresses like `treeos.ai#main/library` always reach
> whatever main currently is; bookmarks survive merges, rollbacks,
> deployment swaps.
>
> **The path grammar alternates number and letter segments.**
> Letters use alphabetic counting (`a..z, aa..zz, aaa...`). A path
> is structurally valid if it matches the grammar; existentially
> valid if it refers to a branch that has been created. Structural
> failures are parse errors; existential failures are dispatch
> errors.

## What this enables

- **Stable addressing across merges.** Bookmarked `#main` addresses
  keep working after every merge.
- **Historical addressability.** Walk back through canonical paths
  to see every past state. `#0` is the original; `#7` was the
  state after the first merge; etc.
- **Multiple pointers per branch.** `#main` and `#prod` can both
  point at the same canonical path during stable mode.
- **Rollback by re-pointing.** Bad state on `#main`? Update the
  pointer to point at a prior canonical path. No data movement,
  just a registry update.
- **Deployment swaps.** A feature branch `#9c1` is ready for prod?
  Update `#prod` to point at `#9c1`. Both canonical paths still
  exist; only the pointer moved.

## What stays the same

- All current canonical paths (`#0`, `#1`, `#1a`, ...) continue to
  work as-is.
- The branchPoint snapshot and lineage walk machinery operate on
  canonical paths only (named pointers resolve before dispatch).
- The grammar already encoded in `BRANCH_RE` is correct; this work
  just adds a parser branch for named pointers and the registry
  to back them.
