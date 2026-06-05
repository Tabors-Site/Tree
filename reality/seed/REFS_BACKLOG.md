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
- [x] **Space.rootOwner** (kind: being) — done 2026-06-04. Mongoose Space schema → Mixed; index flipped to `rootOwner.id`. set-space handler validates being-Ref OR bare I_AM sentinel (genesis-only sentinel preserved per pattern). Cherub step-3 set-rootOwner wraps via ref(); spaces.js createSpace emits ref() for isRoot path; ownership.js setOwner/removeOwner/transferOwnership write Refs + read via refId(); spaceCircuit.js Mongo queries use `state.rootOwner.id`; sprout's orphan-root sweep + isBeingRoot use refId(); resolveRootSpace's slotToObj normalizes via refId. Delete-space's parent → DELETED sentinel allowed in set-space:parent handler.
- [x] **Matter.spaceId** (kind: space) — done 2026-06-04. Mongoose Matter.spaceId flipped to Schema.Types.Mixed. create-matter handler wraps targetIdOf into ref("space",id) when target is space; validates spec.spaceId as space-Ref. set-matter handler adds spaceId field branch accepting Ref OR DELETED sentinel ("deleted") for soft-deletion (Ref-or-sentinel coexistence per Sam's Space.rootOwner I_AM pattern). matters.js: createMatter/getMatters/listMattersAt/transferMatter/deleteMatterAndFile all sweep through — emit Refs in fact specs, Mongo queries use `state.spaceId.id` subpath, reads via refId() extraction. moveOp.js reads via refId (tightened per Sam's note — collapsed transition fallback). do.js resolveAuthSpaceId + audit-target extraction via refId; createMatterHandler return ships bare ids alongside Ref-bearing fact spec (matches resolveAuditTarget's `String(result.spaceId)` contract). source.js (filesystem mirror): queries to `.id` subpath, direct `new Matter(...)` writes wrap spaceId+parentMatterId+beingId in Refs so source matter is discoverable via the same subpath queries as ops-driven matter. New sparse projection index `state.spaceId.id`. Regression: 162/162 green.
- [x] **Matter.parentMatterId** (kind: matter) — done 2026-06-04. Schema flipped to Schema.Types.Mixed (matter.js); createMatter handler wraps targetIdOf into ref("matter",id) when target is a matter, validates spec.parentMatterId as matter-Ref or null via isAggregateRef+refKind; set-matter doesn't accept parentMatterId writes so no handler branch needed; applyCreate is value-agnostic; new sparse projection index `state.parentMatterId.id`. source.js (filesystem mirror) does direct Mongoose writes that bypass DO ops — out of scope, needs its own "migrate source.js to DO ops" row. Regression: 162/162 green across all 7 suites.
- [x] **Matter.beingId (creator)** (kind: being) — done 2026-06-04. Landed alongside Matter.spaceId. Mongoose flipped to Mixed. create-matter handler wraps the actor id (identity.beingId or spec.beingId or scaffold-I_AM) into ref("being",id) for storage. set-matter handler beingId branch accepts only the DELETED sentinel (creator is fixed at birth otherwise). matters.js auth checks and getMatters/listMattersAt batch-lookup all extract bare id via refId() before comparing/indexing into being-projection slots. matter/ops.js endMatter reads matter.state.beingId via refId for the deleteMatterAndFile handoff. source.js direct Matter writes wrap beingId=I_AM into ref("being",I_AM) consistent with the schema's typed-Ref doctrine (I_AM is the actual being row id; no sentinel-coexistence carve-out needed here). applyCreate reducer is value-agnostic. Regression: 162/162 green.

## Params-only migration units (no projection field)

- [x] **move.to** (kind: space) — done 2026-06-04. moveHandler validates params.to as space-Ref (refuses bare strings) via isAggregateRef + refKind; extracts bare id once for Space.exists + self-move check + dest-not-found error. params.to STAYS a Ref in the stamped fact so applyMove writes the Ref directly to state.parent (space target) or state.spaceId (matter target). applyMove migrated to detect Ref shape (`to.__ref === "space" && to.id`) instead of `typeof to === "string"`. 4-stamped.js consumes via refId() at both `fromPosition` (set-being:position invalidate path) and `params.to` (move-fact hook fan) — params.fromSpaceId stays bare-string because the live-SEE pipeline uses it as a Mongo key. Also fixed: moveHandler signature now destructures summonCtx (the previous `opts?.summonCtx?.branch` reference was undefined; fell to "0" silently).
- [x] **move.target.id** (kind: space|matter) — done with move.to. The `target: { kind, id }` envelope at the fact layer stays bare-string per substrate doctrine ("target.id is already structurally typed by the surrounding kind"). params.target (the user-passed override in container mode) flows through targetIdOf/detectTargetKind unchanged — both helpers already handle the `{ kind, id }` envelope and stance shapes; no Ref unwrapping needed at the handler boundary because the move op's wire-side callers pass typed envelopes, not Refs, for target identification.

## Qualities-namespace migration units

- [ ] **qualities.beings.\<role\>.beingId** (kind: being) — qualities.beings reducer paths, descriptor.js, summon.js, address.js
- [ ] **qualities.beings.\<role\>.parentBeingId** (kind: being) — birthBeing coupling, descriptor.js
- [ ] **qualities.beings.\<role\>.homeSpace** (kind: space) — descriptor.js
- [ ] **qualities.connection.inhabitedBy** (kind: being) — be:connect + be:release, resetReels.js, descriptor.js, identity/lookups.js, beingsCatalog.js
- [ ] **qualities.connection.inhabitsHomeSpace** (kind: space) — be:connect, descriptor.js
- [ ] **qualities.wakes.\<key\>.spaceId** (kind: space) — wake-scheduled emission, scheduler
- [ ] **qualities.wakes.\<key\>.beingId** (kind: being) — wake-scheduled emission, scheduler
- [x] **qualities.contributors.\<key\>.beingId** (kind: being) — done 2026-06-04. Note: this is actually `Space.contributors[]` (top-level schema field), not under `qualities`. The row title was a misnomer; the migration is a schema-field unit in shape. Mongoose Space.contributors schema flipped from `[{ type: String, ref: "Being" }]` to `[mongoose.Schema.Types.Mixed]`. set-space handler's contributors branch validates each entry as a being-Ref via isAggregateRef + refKind (mirrors set-space rootOwner discipline). ownership.js: addContributor wraps incoming bare-string contributorId via ref("being",id) on push, membership test + filter extract via refId; removeContributor / setOwner / transferOwnership all extract bare ids for membership + filter, wrap on push. ancestorCache.js + spaces.js resolveRootSpace flatten contributors into bare-string arrays at the cache boundary so downstream `=== beingId` comparisons stay direct (no Ref-unwrapping in the hot stance-resolution walks). Mongo queries on contributors do not exist (it's an in-array iteration field, no findByContributor), so no `.id` subpath index needed. Regression: 162/162 green.

## Wire-layer migration

These three are the joint final push. Schema-field + params + qualities should all land before any of these are sequenced, because the wire validator (item 2) needs to know which positions are now Ref-typed in the substrate, and the portal updates (item 1) need to match what the substrate now demands. Audited 2026-06-04 against the current portal source; concrete sites below.

- [ ] **Portal client wraps IDs in `ref()` before sending DO/BE/SUMMON** — `reality/portal/3d-app/src/*` call sites.

    **Known sites that break under the migrated substrate** (these currently send bare-string IDs that the seed handlers now refuse):

    | File:line | Call | What needs wrapping |
    |---|---|---|
    | `main.js:1029` | `set-being { field: "position", value: desc.address.spaceId }` | `value: ref("space", desc.address.spaceId)` |
    | `main.js` move-args block (~line 740) | `args.to = intent.to` | `args.to = ref("space", intent.to)` |
    | `main.js` action-panel `client.do(address, action.action, values)` (~line 1417) | Form-driven `values` carries bare-string IDs when `action.action` is `set-being`/`set-space`/`birth`/etc. | Map known ID fields in `values` to `ref(kind, value)` based on each action's parameter contract |
    | `main.js` action-panel `client.be(action.action, address, values)` (~line 1381) | `birth` payload: `values.parentBeingId`, `values.homeId`, `values.homeSpace` | Wrap each in `ref("being"/"space", value)` before sending |
    | `planter.js:102` | `create-space { spec: { name, type } }` | spec.parent is omitted (resolver fills from `parentAddress`), so no Ref needed today. But if the planter ever passes spec.parent explicitly, wrap it. |
    | `branch-bar.js:369, 1135, 1316` | branch-manager DO ops (`pause-branch`, `merge-branches`, `set-pointer`) | No ID-bearing aggregate params here; only branch paths + pointer names. **No wrapping needed.** |
    | `ui.js` llm-assigner ops | `connectionId`, `spaceId` params | `connectionId` is name-keyed (no wrapping). `spaceId` for `set-space-llm` would need `ref("space", ...)` IF llm-assigner ops migrate to Refs; the seed's llm-assigner handlers haven't been touched in Phase 1.6 yet — extension-owned, sweep when that extension migrates. |

    **Suggested implementation pattern:** add a `seed.ref` exports hook to `portal-client.js` (or import directly from a shared `ref-helpers.js`) and have each call site construct Refs explicitly. Avoid a wire-layer "auto-wrapper" that maps `{kind, id}` → Ref behind the caller's back — same fallback-path corrosion the substrate just removed.

- [ ] **Wire dispatcher refuses bare-string IDs in known-Ref positions** — `protocols/ibp/verbs/*`.

    Once the portal migration is complete, the wire dispatcher can become Refs-strict. It is the substrate's outer firewall: any payload that arrives with a bare string where a Ref is expected is a client bug, not a substrate compromise.

    **Approach:** add per-op param-schema validation at the wire boundary. The schema is small (about 15 ops × 1–3 ID-bearing fields each). Two reasonable shapes:

    1. **Inline check per verb dispatcher** — each `verbs/do.js`, `verbs/be.js`, `verbs/summon.js` checks the action name and asserts the known ID fields are Refs. Simple, no new infrastructure.
    2. **Declarative param schema per op** — each `registerOperation(action, { params: { ... } })` call declares its param shapes (similar to args metadata that already exists for some ops). The dispatcher reads the schema and validates.

    Approach 2 is cleaner long-term (extensions get the validation for free when they declare schemas) but bigger to land. Approach 1 is the minimum for closing Phase 1.6.

    **Cross-reality note:** when Diff B (federation) lands, signed cross-reality envelopes carry the same Ref-typed payloads. The wire validator runs on local AND foreign envelopes identically — there is no "foreign envelope might use bare strings" carve-out. See `protocols/ibp/FEDERATION.md` for the federation context.

- [ ] **Tests construct Refs via `ref()` in setup** — `.test/scripts/verify-*.js`.

    Today's regression suite (7 suites, 162 assertions) passes because the verify scripts exercise high-level operations (merge, branches, heaven, pointers, wakes, subtree, typed-Refs unit). They don't directly stamp `set-being:parentBeingId` etc., so the substrate's new Ref-strict handlers aren't load-bearing for the current tests.

    When the qualities + wire migrations land, new tests should:
    - Import `ref()` from `seed/materials/ref.js` at the top of the script
    - Construct typed Refs anywhere they would have used bare-string IDs
    - Use the substrate's helpers to extract bare ids only where Mongo keys are needed (test setup that bypasses DO ops via direct projection inserts, e.g. `verify-subtree-branch.js`'s `plantSpace` already wraps via `ref("space", rootId)`)

    No retroactive sweep needed on existing tests until something breaks. New tests follow the Ref doctrine from the start.

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
