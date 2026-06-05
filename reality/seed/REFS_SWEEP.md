# Refs Migration Sweep — Phase 1.6

> *The substrate ships typed Refs as its identity primitive. Phase 1.6 migrates every existing site that uses bare-string IDs to use Refs instead. When the sweep completes, the legacy refs manifest is deleted and bare-string IDs become a doctrinal violation. There is no fallback path.*

## Why this document exists

The Ref primitive (`seed/REFS.md`) names what's true going forward. This document names the work to get there — site by site, in dependency order, with a defined migration contract per site type.

The point is to make each migration a **known, bounded unit**, not an open-ended refactor. Each unit has a clear start (one ID-bearing field), a clear contract (handler + reducer + storage + consumers all on Refs), and a clear end (manifest entry deleted, tests green).

Without this document, the migration would chase itself across 49+ consumer sites without ever closing the seam.

## The migration unit

The atomic unit is **one ID-bearing field across its full pipeline**:

```
Op handler emits Ref
    ↓
Reducer reads Ref via refId()
    ↓
Projection field stores Ref
    ↓
Consumers read Ref via refId()
    ↓
Tests use ref() in setup
    ↓
Manifest entry deleted
```

Each step is one site. Each migration unit completes all steps atomically. Half-migrated units are NOT acceptable — they create the same "two correct answers" problem as a permanent fallback.

## Migration contract per site type

### A. Op handler (emits the fact)

**Before:**
```js
handler: async ({ params }) => {
  // ...
  return { beingId: String(target._id), parentBeingId: value || null };
}
```

**After:**
```js
import { isAggregateRef, refKind } from "../refs/ref.js";

handler: async ({ params }) => {
  const value = params.value;
  if (value !== null && !isAggregateRef(value)) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `set-being: field "parentBeingId" requires value to be a Ref (got ${typeof value === "object" ? JSON.stringify(value) : typeof value})`,
    );
  }
  if (value !== null && refKind(value) !== "being") {
    throw new IbpError(IBP_ERR.INVALID_INPUT,
      `set-being: field "parentBeingId" requires being-Ref, got ${refKind(value)}-Ref`);
  }
  return { beingId: String(target._id), parentBeingId: value };
}
```

**Doctrine:** the handler refuses bare-string inputs. There is no `coerceRef` at the handler boundary. Callers (portal, test scripts, internal helpers) construct Refs with `ref()` before the handler call.

### B. Reducer (applies the fact to projection state)

**Before:**
```js
function applySetField(state, fact) {
  if (fact.params.parentBeingId !== undefined) {
    state.parentBeingId = fact.params.parentBeingId;  // bare string
  }
}
```

**After:**
```js
function applySetField(state, fact) {
  if (fact.params.parentBeingId !== undefined) {
    state.parentBeingId = fact.params.parentBeingId;  // Ref or null
  }
}
```

**Doctrine:** the reducer writes Refs to projection state. Storage shape becomes Ref-typed. Reducer code might look identical — only the value's *shape* changed (Ref vs. string).

### C. Projection storage

**Before:** `state.parentBeingId = "abc-123"`
**After:** `state.parentBeingId = { __ref: "being", id: "abc-123" }`

**Mongoose:** the `state` field is already `Mixed`, so no schema change is required. Refs ride along as plain objects.

**Data migration:** existing dev/test DBs need conversion. Provided by a one-shot migration script (`seed/system/migrations/2026-06-04-refs-sweep.js`). New deployments naturally land Refs from genesis once handlers + reducers are migrated.

### D. Consumer (reads from projection state)

**Before:**
```js
const homeSpaceId = slot?.state?.homeSpace ? String(slot.state.homeSpace) : null;
```

**After:**
```js
import { refId } from "../refs/ref.js";

const homeSpaceId = refId(slot?.state?.homeSpace);  // null when missing or not a Ref
```

**Doctrine:** consumers use `refId()` to extract the bare-string id when they need it for downstream operations (e.g., MongoDB queries that use `_id` strings). The `refId()` helper returns null for non-Ref or null input, so the safe-navigation pattern stays clean.

For consumers that pass the value to ANOTHER substrate operation (e.g., `findByName("being", parentBeingId, branch)`), the consumer either constructs a new Ref to pass or extracts the bare id — depends on what the destination expects. As migrations proceed, more downstream APIs accept Refs directly.

### E. Tests

**Before:**
```js
await client.do("/@cherub", "set-being", {
  field: "parentBeingId",
  value: "abc-123",
});
```

**After:**
```js
import { ref } from "../../seed/materials/ref.js";

await client.do("/@cherub", "set-being", {
  field: "parentBeingId",
  value: ref("being", "abc-123"),
});
```

**Doctrine:** test scripts construct Refs explicitly. No test-only coercion path; what the test does is what production callers should do.

### F. Manifest entry

After A–E land for a single field, delete its row from `seed/materials/seedRefs.js`. When `seedRefs.js` is empty, delete it and the `installSeedRefs()` call from genesis. When the registry has no consumers, delete `seed/materials/refs.js` and `REFS_MANIFEST.md`.

## Site inventory

Each migration unit lands one ID-bearing field across its full pipeline. Order by dependency: schema-field writes first (they touch the fewest sites), then qualities (touch more), then the more entangled fields.

### Schema-field migrations (10 units)

| # | Field | Kind | Op handlers | Reducer | Consumer count | Manifest entry |
|---|---|---|---|---|---|---|
| 1 | `Being.parentBeingId` | being | set-being, birthBeing | applySetField, applyBirth | 7 | set-being.params.value (parent) |
| 2 | `Being.homeSpace` | space | set-being, birthBeing | applySetField, applyBirth | 6 | set-being.params.value (home) |
| 3 | `Being.position` | space | set-being | applySetField | 3 | set-being.params.value (pos) |
| 4 | `Space.parent` | space | create-space, set-space | applyCreate, applySetField | 12 | create-space.spec.parent, set-space.value |
| 5 | `Space.rootOwner` | being | set-space, birthBeing+create-space coupling | applySetField, applyCreate | 4 | set-space.value (rootOwner) |
| 6 | `Matter.spaceId` | space | create-matter | applyCreate | 5 | create-matter.spec.spaceId |
| 7 | `Matter.parentMatterId` | matter | create-matter, set-matter | applyCreate, applySetField | 3 | create-matter.spec.parentMatterId, set-matter.value |
| 8 | `Matter.beingId` (creator) | being | create-matter | applyCreate | 2 | create-matter.spec.beingId |
| 9 | `move.to` (params) | space | move op | (no projection field — params-only) | 1 | move.to |
| 10 | `move.target` (params) | space\|matter | move op | (no projection field — params-only) | 1 | move.target |

### Qualities-namespace migrations (~8 units)

| # | Namespace | Path | Kind | Sites that write | Sites that read |
|---|---|---|---|---|---|
| 11 | `beings.<role>.beingId` | on Space | being | 4 | 8 |
| 12 | `beings.<role>.parentBeingId` | on Space | being | 2 | 3 |
| 13 | `beings.<role>.homeSpace` | on Space | space | 2 | 3 |
| 14 | `connection.inhabitedBy` | on Being | being | 2 (be:connect, be:release) | 5 |
| 15 | `connection.inhabitsHomeSpace` | on Being | space | 2 | 3 |
| 16 | `wakes.<key>.spaceId` | on Being | space | 2 (wake-scheduled, wake-cancelled) | 1 (scheduler) |
| 17 | `wakes.<key>.beingId` | on Being | being | 2 | 1 |
| 18 | `contributors.<key>.beingId` | on Space | being | 2 | 2 |

### Wire-layer + portal migrations

| # | Site | Migration |
|---|---|---|
| 19 | Portal client's `do()` call sites | Wrap IDs in `ref()` before sending |
| 20 | Wire dispatcher (`protocols/ibp/dispatch.js`) | Validate that incoming params have Refs in expected positions; refuse bare strings with clear error |
| 21 | Test scripts (verify-*.js) | Wrap IDs in `ref()` |

The wire layer's "validate that incoming params have Refs" is the only place the substrate has to know "this op's param X is a Ref" — and even there, the op's own handler will throw if a bare string slips through. The wire validator is an early-error convenience, not a doctrinal requirement.

## Migration order

Order by minimizing churn at each step:

**Wave 1 — Schema-field migrations on cold paths** (#9, #10):
- The `move` op's params don't land in projection state, so the migration is just handler + tests. No data migration needed.
- Demonstrates the pattern end-to-end with minimum risk.

**Wave 2 — Schema-field migrations on hot paths** (#1, #2, #3):
- Being's three ID fields. Touches 16 consumer sites combined.
- Each is a focused unit; sweep one at a time.
- Each completes with manifest-entry deletion + dev DB migration verification.

**Wave 3 — Space schema fields** (#4, #5):
- Space.parent (12 sites!) is the largest unit. Schedule when there's a clean window.

**Wave 4 — Matter schema fields** (#6, #7, #8):
- Smaller surface area than space.

**Wave 5 — Qualities migrations** (#11–#18):
- Each qualities namespace migrates as a unit. Most are bounded (under 10 sites combined).

**Wave 6 — Wire-layer + tests** (#19, #20, #21):
- Last, because the substrate is now uniformly Ref-typed; the wire just needs to accept Refs in and out.

**Wave 7 — Delete the manifest:**
- When all manifest entries are gone, delete `seedRefs.js` + `refs.js` + `REFS_MANIFEST.md`.
- Remove `installSeedRefs()` from genesis.
- Remove the refs harvesting from extension loader.
- Update REFS.md to remove the "during the transition" caveats.
- Phase 1.6 closes.

## Per-migration checklist

For each unit:

1. [ ] Update op handler: emit Ref; refuse bare-string inputs with clear error
2. [ ] Update reducer: store Ref in projection state
3. [ ] Sweep all consumers (`grep -n` for the field path)
4. [ ] Update tests to use `ref()`
5. [ ] Run verify-* suite; confirm green
6. [ ] Write/update migration script for existing data
7. [ ] Run migration on dev DB; confirm consumer behavior unchanged
8. [ ] Delete the manifest entry for this field
9. [ ] Update CLAUDE.md or other docs if the field is documented

## Risks + mitigations

- **Risk: consumer site missed.** Mitigation: every migration includes a `grep` audit of `state.<field>` across the whole codebase. Tests catch most behavioral regressions.
- **Risk: extension's qualities namespace stores IDs in a custom shape we don't know about.** Mitigation: extensions own their migrations. The substrate documents the migration pattern; extension authors do their own sweep.
- **Risk: schemas in third-party tooling expect bare strings.** Mitigation: at the IBP/HTTP boundary, we expose the bare-id form via accessor helpers (`refId()` on the way out). Internal storage is uniform.
- **Risk: data migration fails mid-flight.** Mitigation: migration scripts are idempotent and resumable. Old fields stay until the migration confirms success.

## What this does NOT cover

- **The `Ref` type extension to new kinds.** If a future kind (e.g., "act", "summon") needs to be referenced by ID, it gets its own Ref kind. Out of scope here.
- **Cross-substrate refs.** Refs from a foreign substrate (e.g., over canopy) carry the foreign substrate's id space. When grafted, they remap. Phase 8 territory.
- **Schema field renames or restructures.** Out of scope; this sweep is purely about identity-value shape, not schema layout.

## When this document is done

This document is "done" when all migration units in the inventory are complete, the manifest is deleted, and the substrate has no remaining bare-string ID fields. At that point this file moves to a `done/` directory or is deleted with a one-line note in REFS.md pointing at the git history.

Until then: every PR that migrates a unit updates the checklist here so progress is visible.
