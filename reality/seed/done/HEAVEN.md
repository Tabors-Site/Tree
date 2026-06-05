# Heaven never branches

This is the substrate-level spec for the "heaven never branches"
doctrine pinned in [FACTORY.md](FACTORY.md). It maps current placement
against the target, defines the migration phases, and lists what
stays unchanged. The principle was decided 2026-06-04 after the
branch pointer registry work surfaced it.

## The principle

The Tier-3 heaven spaces under heaven hold substrate-level metadata
about the reality: which beings exist, what roles are available, how
branches are structured, what tools and operations the reality
supports. Their content is identical across every branch.

Branch-scoped state lives on aggregates (beings, spaces, matter)
whose projections diverge per branch via the reel-lineage walk.
Heaven entries have one projection per reality, regardless of the
caller's branch.

```
Heaven    (reality-scoped, single projection per reality)
.beings   .spaces   .matters   .config
.branches .roles    .tools     .operations

  ↓ ↓ ↓ ↓ ↓

Aggregates (branch-scoped, per-branch projection via reel-lineage)
Being rows · Space rows · Matter rows · their facts · qualities
```

**The split:** branched state is *content*; heaven is *structure*.
A being's position is content (branched). A role's definition is
structure (heaven). A space's world signals are content (branched).
A branch pointer mapping is structure (heaven).

## Current state (audit 2026-06-04)

| Component | Current | Status |
|---|---|---|
| Federation peers (`protocols/ibp/peers.js`) | `RealityPeer` Mongoose model, no branch field | ✅ True heaven |
| Tool registry | In-memory at boot, no persistence | ✅ True heaven |
| Operation registry (`seed/ibp/operations.js:26`) | In-memory at boot, no persistence | ✅ True heaven |
| SEE-resolver registry | In-memory at boot, no persistence | ✅ True heaven |
| Subscriptions (`seed/present/wakes/subscriptions.js`) | In-memory, extension-reloaded | ✅ True heaven |
| `.beings` catalog SEE handler | Cross-reality short-circuit, no branch query | ✅ Heaven-aware |
| `findByName(type, name, branch)` | Branch is required parameter | ✅ Pattern correct |
| `findByHeavenSpace(kind, branch)` | Branch is required; heaven callers pass `"0"` | ✅ Pattern correct |
| Reality config (`.config` space qualities) | Stored on space row; reads hardcoded to MAIN at `realityConfig.js:108` | 🟡 Heaven-semantic reads; substrate-level heaven classifier will route writes correctly |
| Branch pointers (`@branch-registry` qualities) | Stored on a Being row; reads hardcoded to MAIN | 🟡 Heaven-semantic but branch-shaped storage; should move to `.branches` space qualities |
| Role registry persistence (`.roles` children) | Live roles persisted as Space children with `qualities.role` (branch-scoped facts) | 🔴 Branch-scoped storage; needs substrate-level heaven routing |
| `.roles` / `.tools` / `.operations` catalog SEE | Routes through normal space lookup which respects branch | 🔴 Add short-circuits like `.beings` (routing optimization, not access restriction) |
| `.config` catalog SEE | Same as above | 🔴 Same as above |

## Migration plan

Three phases. Phase 1 is the substrate primitives + the heaven-shaped
pointer storage. Phase 2 is the role-registry migration (the real
shift). Phase 3 is the catalog short-circuit pass.

### Phase 1 — primitives + pointer move

**1A. New helper: `findInHeaven`** in `seed/materials/projections.js`.

```js
/**
 * Read a heaven-scoped entry. Same as findByName but locked to MAIN,
 * making the heaven semantics explicit at the call site (no caller
 * has to remember to pass "0"). Used by callers that need a reality-
 * level lookup regardless of which branch they're acting on.
 */
export async function findInHeaven(type, name) {
  return await findByName(type, name, "0");
}

/**
 * Read a heaven seed-space entry. Same as findByHeavenSpace but locked
 * to MAIN.
 */
export async function findHeavenSpace(heavenSpaceKind) {
  return await findByHeavenSpace(heavenSpaceKind, "0");
}
```

Callers that today pass `"0"` explicitly for heaven reads update to
use these helpers. Behavioral no-op; documentation gain.

**1B. Move branch pointers from `@branch-registry` qualities to
`.branches` heaven space qualities.**

Current: `@branch-registry` being's `qualities.pointers`. Reads from
MAIN (heaven-semantic) but storage is on a Being row (branch-shaped
schema).

Target: `.branches` heaven space's `qualities.pointers`. Reads still
locked to MAIN; storage on the heaven space's qualities map; mutations
land via `set-space` on the `.branches` space.

Touched files:
- `seed/materials/branch/branchRegistry.js` — `_readPointerMap()`
  switches to `findHeavenSpace(HEAVEN_SPACE.BRANCHES)`.
- `seed/present/roles/branch-registry/ops.js` — `set-pointer` /
  `delete-pointer` handlers switch from `doVerb(@branch-registry,
  set-being)` to `doVerb(.branches space, set-space)`.
- `seedDelegates.js` — `@branch-registry` being can retire (the
  registry being existed only as a storage carrier). The set-pointer
  / delete-pointer ops live on `@branch-manager` (or stay on a stub
  `@branch-registry` for API clarity, but the storage is on heaven).

This isn't user-facing; the wire surface stays identical.

**1C. Reality-root permission on heaven mutations.** Add a default
permission rule: `do:set-space` on heaven spaces requires `realityRoot`.
Per-position overrides can loosen if a reality wants self-service
config, but the default is locked.

### Phase 2 — role registry to heaven storage

This is the larger migration. Today the role registry is correct in
memory (the runtime registry sees the same roles regardless of
branch). The persistence is wrong: live roles (operator-authored
runtime additions) get written as `.roles/<name>` child spaces with
`qualities.role`. Those child rows are branch-scoped at the schema
level.

Target: live roles persist as heaven-scoped entries under `.roles`,
not as branch-scoped child spaces.

**Heaven classification is derived, not stored.** No new schema
field. A space IS in heaven when:

```
isHeaven(spaceId) = the space is `.` itself
                  OR `.` appears in its parent chain
```

Heaven is the `.` heaven space and every descendant under it.
`.beings`, `.spaces`, `.matters`, `.config`, `.branches`, `.roles`,
`.tools`, `.operations` all sit directly under `.`; their children
(e.g., a specific live role planted under `.roles/<name>`) are
heaven too because their parent chain walks through `.`. Domain
spaces (e.g., `<reality>/my-tree`) sit directly under the reality
root, NOT under `.`, so they're not heaven.

A small helper:

```js
// seed/materials/space/heavenLineage.js
export async function isHeavenSpace(spaceId) {
  // Walk ancestors via the existing ancestor cache; if `.` (the
  // HEAVEN heaven space's id) appears, it's heaven.
  const chain = await getAncestorChain(spaceId);
  const heavenId = await findHeavenRootId();
  return chain.some(node => String(node.id) === heavenId);
}
```

Uses existing `getAncestorChain` (from
`seed/materials/space/ancestorCache.js`) and the existing seed-space
lookup for `.`. Zero schema impact.

The migration is then: `loadProjection` / `loadOrFold` consult
`isHeavenSpace(id)` and rewrite the branch parameter to `"0"` when
true. Lineage walk in `readReelBetween` skips heaven targets
entirely. Mutations to heaven targets land facts with `branch: "0"`
regardless of caller's branch.

This work spans:
- `seed/materials/space/heavenLineage.js` — new file with
  `isHeavenSpace` and `findHeavenRootId` helpers.
- `seed/materials/projections.js` — `loadProjection` / `loadOrFold`
  call `isHeavenSpace` and force `branch: "0"` when true.
- `seed/past/fact/facts.js` — `emitFact` / `sealFacts` override the
  spec's `branch` to `"0"` when the target is heaven (so writes from
  `#1` still land on the single heaven projection).
- `seed/present/beats/2-fold/foldEngine.js` — `readReelBetween`
  short-circuits to `branch: "0"` query for heaven targets.
- `seed/present/roles/registry.js` — `syncRolesToSubstrate` and
  `loadLiveRolesFromSubstrate` use heaven helpers (no special-casing
  needed if the projection layer already routes correctly).
- `seed/present/roles/role-manager/ops.js` — `set-role` calls go
  through normal `doVerb`; the substrate's heaven classifier ensures
  they land on the heaven projection regardless of caller's branch.
- Doctrine update in this file confirming what migrated.

### Phase 3 — catalog SEE short-circuits

**Clarification on "short-circuit":** this is routing-layer
optimization, not visibility restriction. Today's SEE verb dispatches
most paths through `resolveStance → loadProjection → buildPlaceDescriptor`,
which walks the actual space hierarchy. For `.beings` there's an
`if` check at the top of seeVerb that bypasses that dispatch and
returns `describeBeingsCatalog()` directly. That's "the short-circuit"
. it short-circuits the position-resolution machinery for a heaven
catalog that doesn't need a real space walk.

After this phase, `.roles`, `.tools`, `.operations`, `.config` get
the same treatment as `.beings`:

- The catalogs stay fully visible to anyone with SEE permission on
  the heaven space (which today is anyone who's authorized to read
  the reality at all). NOT hidden, NOT restricted.
- Routing goes through the in-memory registry rather than re-walking
  the projection tree on every read . one indexed return instead of
  N projection reads.
- Result is identical regardless of caller's branch (heaven semantics
  via the routing shortcut).

Touched: `seed/ibp/verbs/see.js` — add `.roles`, `.tools`,
`.operations`, `.config` short-circuits alongside the existing
`.beings` and `.branches` ones. Each calls the equivalent in-memory
catalog builder (`catalogRoles()`, `catalogOperations()`,
`catalogTools()`, `getRealityConfigSnapshot()`).

## What stays branch-scoped

Doctrinal commitment: every aggregate's content stays branched. No
heaven backdoor for these.

- **Being state:** position, qualities (including roleFlow per
  being), `inhabitedBy`, parent / home / current space.
- **Space state:** qualities, world signals, ownership, children.
- **Matter state:** content, qualities, position within space.
- **Per-being acts:** the entire `be:*` and `do:*` fact stream.
- **Wake schedules per being.** (Wake-scheduled / wake-cancelled
  facts on the being's reel; inherits through reel-lineage.)
- **Branched permission rules** at any position.

These are content. Branches diverge here intentionally.

## API surface after migration

The substrate exposes two clearly-named lookup primitives:

```js
// Branch-scoped: walks reel-lineage; per-branch projection.
findByName(type, name, branch)
findByHeavenSpace(kind, branch)
loadProjection(type, id, branch)
loadOrFold(type, id, branch)

// Heaven-scoped: MAIN only; no lineage walk; same answer everywhere.
findInHeaven(type, name)
findHeavenSpace(kind)
loadHeavenProjection(type, id)
```

Callers pick by what they're reading. A role lookup: `findInHeaven`.
A being's position: `loadOrFold`. A space's world signals:
`loadOrFold`. A branch pointer: `findHeavenSpace(HEAVEN_SPACE.BRANCHES)`
then read the qualities.

The lineage walk in `readReelBetween` / `loadOrFold` ignores heaven
entries entirely; they don't appear in any branch's reel.

## What to test

Once Phase 1 + 2 land:

1. Plant a reality. Confirm `.` has no `branch: "1"` projection (only
   `branch: "0"`). Same for every descendant of `.`.
2. Create a branch `#1`. Confirm SEE on `<reality>#1/.roles` returns
   the same role list as `<reality>#0/.roles`.
3. Author a live role via `set-role` from branch `#1`. Confirm the
   resulting fact has `branch: "0"` (the substrate auto-routed it to
   heaven) and that the role appears in main's `.roles` too.
4. Run `verify-pointers.js` after migrating pointer storage. All 14
   assertions still pass.
5. New verify script `verify-heaven.js` with:
   - `isHeavenSpace(<seed-space-id>)` returns true for `.`, `.roles`,
     `.beings`, `.tools`, etc.
   - `isHeavenSpace(<domain-space-id>)` returns false.
   - `loadProjection("space", <heaven-id>, "1")` returns the same
     row as `loadProjection("space", <heaven-id>, "0")`.
   - A `set-space` write addressed at `<heaven-id>` from branch `#1`
     produces a fact with `branch: "0"` (auto-routed to heaven).
   - A `set-space` write addressed at a non-heaven space from `#1`
     produces a fact with `branch: "1"` (unchanged from today).

## Open questions

**1. Where does the pointer registry physically live?** Two options:
   (a) `.branches` space's `qualities.pointers`.
   (b) `.config` space's `qualities.pointers`.

Recommendation: (a). Pointer mappings ARE branch metadata; the
`.branches` space is the natural home alongside the branch tree
projections.

**2. Do we keep `@branch-registry` as a stub being for API
discoverability?** The set-pointer / delete-pointer DO ops need to
register on SOME being's address. Either:
   (a) Keep `@branch-registry` as a delegate; storage moves to
       `.branches` heaven space; the being is purely an API host.
   (b) Move the ops to `@branch-manager`; retire `@branch-registry`.

Recommendation: (b). One fewer delegate, the ops live with the
branch-management workflow they participate in.

**3. Authorization for heaven mutations.** Reality-root permission
matches `set-reality-llm`. Does that gate apply uniformly, or do
specific heaven mutations want different rules (e.g., live-role
authoring restricted to authenticated beings but not reality-root)?

Open. Suggest landing the conservative default (reality-root) and
loosening per-mutation as use cases prove themselves.

## Build order

Phases 1A + 1B + 1C can ship as one diff (substrate primitive + the
pointer migration + the permission rule).

Phase 2 is its own focused diff (role registry to heaven; this
touches the most code).

Phase 3 is small and additive (catalog short-circuits).

Total estimate: 2-3 days of focused work, with Phase 2 being the
real shift. Phase 1 is small (the audit confirmed pointer storage
is the only heaven-semantic-but-branch-shaped piece today). Phase 3
is decorative.
