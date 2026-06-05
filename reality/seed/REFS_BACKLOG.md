# Refs Migration Backlog

> *This document is the punch list of ID-bearing fields that have NOT YET been migrated to typed Refs. It is markdown documentation, NOT runtime code. The substrate does not consult this file at any point. When a field migrates, its row gets checked off. When the last row is checked, this document is deleted.*

## Status: ACTIVE — Phase 1.6 in flight

The Ref primitive (`seed/REFS.md`) is the substrate's identity primitive going forward. The migration sweep brings every existing site into compliance. There is no runtime fallback path: the substrate either uses Refs for a given field or that field hasn't migrated yet (and is on the backlog). There is no "either is fine" mode.

The runtime manifest registry was deleted on 2026-06-04 — `seed/materials/refs.js`, `seed/materials/seedRefs.js`, and `.test/scripts/verify-refs.js` no longer exist; `genesis.js` and `extensions/loader.js` no longer harvest refs. This backlog is the only remaining artifact of the manifest model, and it lives only to track migration progress.

When the backlog reaches zero entries:
- This file is deleted.
- The Ref primitive remains as the only ID-passing mechanism in the substrate.

## How to use this file

When you migrate a field:

1. Pick a row below (start with the smallest unit — see `REFS_SWEEP.md` for wave order).
2. Migrate handler, reducer, storage, all consumers, and tests atomically (no half-migration).
3. Check off the row in this file in the same commit.
4. Run the full regression suite; confirm green.

Half-migrated rows are not acceptable. They create the same "two correct answers" problem as a permanent fallback path.

## Schema-field migration units

Each row = one ID-bearing schema field. Migrate handler → reducer → all consumer sites → tests, atomically.

- [x] **Being.parentBeingId** (kind: being) — done 2026-06-04. Migrated: set-being handler, birthBeing (validation + spec emission), seedDelegates/cherub/be:birth/summon callers wrap via ref(), beingsCatalog + identity/lookups consume via refId(), projections.js Mongo queries use `.id` subpath, projection index updated. applySetField + applyBirth reducers are value-agnostic and need no change.
- [x] **Being.homeSpace** (kind: space) — done 2026-06-04. Migrated alongside Being.position. Schema.Mixed; emitters wrap via ref(); consumers use refId(); foldEngine extracts refId for denormalized position cache.
- [x] **Being.position** (kind: space) — done 2026-06-04. Set-being handler validates space-Ref; birth.js stores Ref in spec; positionId extracted via refId for substrate lookups. Mongoose Being schema now Mixed. foldEngine extracts refId for top-level `position` denormalized cache (stays string for fast findByPosition queries).
- [x] **Space.parent** (kind: space) — done 2026-06-04. Mongoose Space schema → Mixed; Projection schema added `state.parent.id` lineage index; all create-space emitters wrap parent via ref(); all Mongo queries on state.parent → `state.parent.id`; consumers (descriptor, ancestorCache, resolver, branchScope, position, isDescendant, isBeingRoot, sprout repair) use refId() to extract bare id. verify-subtree-branch plantSpace updated to write Refs.
- [ ] **Space.rootOwner** (kind: being) — sites: set-space, applySetField, spaces.js, spaceCircuit.js, birthBeing coupling
- [ ] **Matter.spaceId** (kind: space) — sites: create-matter, applyCreate, moveOp.js, llm-assigner/ops.js, source.js, do.js
- [x] **Matter.parentMatterId** (kind: matter) — done 2026-06-04. Schema flipped to Schema.Types.Mixed (matter.js); createMatter handler wraps targetIdOf into ref("matter",id) when target is a matter, validates spec.parentMatterId as matter-Ref or null via isAggregateRef+refKind; set-matter doesn't accept parentMatterId writes so no handler branch needed; applyCreate is value-agnostic; new sparse projection index `state.parentMatterId.id`. source.js (filesystem mirror) does direct Mongoose writes that bypass DO ops — out of scope, needs its own "migrate source.js to DO ops" row. Regression: 162/162 green across all 7 suites.
- [ ] **Matter.beingId (creator)** (kind: being) — sites: create-matter, applyCreate

## Params-only migration units (no projection field)

- [ ] **move.to** (kind: space) — sites: move handler, applyMove (in space + matter reducers)
- [ ] **move.target.id** (kind: space|matter) — sites: move handler signature

## Qualities-namespace migration units

- [ ] **qualities.beings.\<role\>.beingId** (kind: being) — qualities.beings reducer paths, descriptor.js, summon.js, address.js
- [ ] **qualities.beings.\<role\>.parentBeingId** (kind: being) — birthBeing coupling, descriptor.js
- [ ] **qualities.beings.\<role\>.homeSpace** (kind: space) — descriptor.js
- [ ] **qualities.connection.inhabitedBy** (kind: being) — be:connect + be:release, resetReels.js, descriptor.js, identity/lookups.js, beingsCatalog.js
- [ ] **qualities.connection.inhabitsHomeSpace** (kind: space) — be:connect, descriptor.js
- [ ] **qualities.wakes.\<key\>.spaceId** (kind: space) — wake-scheduled emission, scheduler
- [ ] **qualities.wakes.\<key\>.beingId** (kind: being) — wake-scheduled emission, scheduler
- [ ] **qualities.contributors.\<key\>.beingId** (kind: being) — set-space contributors writes + reads

## Wire-layer migration

- [ ] **Portal client wraps IDs in `ref()` before sending DO/BE/SUMMON** — portal/3d-app/src/* call sites
- [ ] **Wire dispatcher refuses bare-string IDs in known-Ref positions** — protocols/ibp/verbs/* (after schema-field migrations complete so the validator can check structurally)
- [ ] **Tests construct Refs via `ref()` in setup** — .test/scripts/verify-*.js

## What is NOT on the backlog (already structural, no migration needed)

- **`target.id` on facts** — already structurally typed by the surrounding `target: { kind, id }` envelope. No ambiguity.
- **`beingId` on facts (actor)** — substrate-internal; not user-facing ID. Stays bare string for actor reference.
- **`branch` on facts** — a branch path, not an aggregate ID. Stays bare string.
- **Role names, roleflow names, pointer names, world-signal namespaces** — name-keyed; not aggregate IDs. Never need Refs.
- **`qualities.llmConnections.<key>`** — keys are per-being-local; never cross substrate boundaries.
- **`qualities.cognition.assignedConnection`** — connection key, local.
- **Schema fields like `actId`, `sessionId`, `homeReality`** — substrate metadata, not aggregate references.

## When done

This file moves to `seed/done/REFS_BACKLOG.md` (or just gets deleted with a one-line note in `REFS.md` pointing at the git history). Phase 1.6 closes; Phase 4 (replicate) and Phase 5 (graft) become buildable on Refs-only substrate.
