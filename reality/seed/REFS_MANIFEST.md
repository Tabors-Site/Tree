# Refs Manifest — ID-bearing fields across the substrate

> *Prerequisite for replicate + graft (publishing.md #4 + #5). Catalogs every field across action params and qualities namespaces that carries a reference to an aggregate's `_id`. Without this map, the graft layer can't fill remapped IDs into the creation facts it stamps.*

## What this is

Every action handler that emits a fact may carry references to *other* aggregates by ID — `parentBeingId` in a `set-being` write, `homeSpace` in a being's qualities, `parent` in a space, etc. Each of these is an `_id` that lives only within the substrate that issued it.

When a replicate is grafted, the graft layer must:

1. Walk the replicate's aggregates and the facts it plans to stamp.
2. Find every ID field per this manifest.
3. Substitute the placeholder ID with the new local ID from the remap table.
4. Stamp the fact.

Without this manifest, the only options are *guess what's an ID* (fragile regex on UUID shapes) or *hardcode the substitution per action* (un-extensible). The manifest is the clean answer: each action handler and each qualities namespace declares its ID-bearing paths.

(Future: clones — full fact-chain bundles — use the same manifest for their planting operation when targets need ID remapping. See publishing.md's "Future: Clones + Plant" section.)

## How extensions contribute

Each extension that registers an op or owns a qualities namespace contributes its own entry. The shape:

```js
// In the extension's manifest.js or init() return:
{
  refs: {
    "ops": {
      "library:checkout": {
        params: {
          "beingId":  "being",   // params.beingId is a being _id
          "matterId": "matter",  // params.matterId is a matter _id
        },
      },
    },
    "qualities": {
      "library.checkouts": {
        // path inside the namespace → kind
        "current.byBeing.*.beingId": "being",
        "current.byBeing.*.matterId": "matter",
        "history.*.beingId": "being",
      },
    },
  },
}
```

The `*` segment in qualities paths matches any single key. Deeper wildcards (`**`) are reserved for future use; today every ID-bearing path is at a known depth.

The seed loader merges all contributed entries into a single manifest at boot. The replicate + graft layer reads from the merged registry. Conflicts between contributions are loud (two extensions claim the same path with different kinds → throw at load).

## Conventions

- **Kind values**: `"being"`, `"space"`, `"matter"`. Anything else is rejected at registration.
- **External markers**: when a field's value should resolve to the graft-initiator rather than be remapped (e.g., `parentBeing` of a top-level being in the replicate), use the sentinel `<GRAFT_INITIATOR>` in the replicate bundle. The graft substitutes at the very end.
- **Insertion-point markers**: `<INSERTION_POINT>` substitutes the operator-chosen parent path in the target.
- **Reality-local refs**: pointer names (`#main`), role names (`librarian`), roleflow names (`librarian-with-mood`), world-signal namespaces are name-keyed and NEVER remapped. They resolve through the target's registries.
- **Per-being keys** like `qualities.llmConnections.<key>` are local IDs but NOT remapped across substrates — they're keys into the being's own namespace, meaningful only within that being. Grafts re-create connections from manifest hints, not by remapping.

## Seed inventory

What follows is the seed's own contribution to the manifest. Extensions add their own entries on top.

### Operations (params → ID kind)

#### Materials — being

**`set-being`** (`seed/materials/being/ops.js`)

| Field condition | params path | kind | notes |
|---|---|---|---|
| `params.field === "parentBeingId"` | `params.value` | being | direct schema-field write |
| `params.field === "homeSpace"` | `params.value` | space | direct schema-field write |
| `params.field === "position"` | `params.value` | space | being's location |
| `params.fromPosition` (auto-set on position changes) | `params.fromPosition` | space | for live-SEE invalidation |
| `params.field === "rootOwner"` (set-space, not set-being; cross-reference) | n/a | n/a | covered under set-space |
| `params.field.startsWith("qualities.")` | varies | see qualities table | namespace-level substitutions |

**`end-being`** — no ID params; targets the being itself.

**`add-llm-connection` / `update-llm-connection` / `delete-llm-connection` / `assign-llm-slot`** — connection keys are per-being, NOT remapped across substrates.

#### Materials — space

**`create-space`** (`seed/materials/space/ops.js`)

| Field condition | params path | kind | notes |
|---|---|---|---|
| always (when present) | `params.spec.parent` | space | parent space; null for reality root |
| always (when present) | `params.spec.rootOwner` | being | the home-root owner |
| `params.spec.spaceId` | `params.spec.spaceId` | space | placement of the new space (rare) |
| `params.spec.position` | `params.spec.position` | space | for sized-space children |

**`set-space`** (`seed/materials/space/ops.js`)

| Field condition | params path | kind | notes |
|---|---|---|---|
| `params.field === "parent"` | `params.value` | space | re-parent |
| `params.field === "rootOwner"` | `params.value` | being | who owns this home |
| `params.field === "contributors"` | `params.value.<key>.beingId` | being | per-contributor entries |
| `params.field.startsWith("qualities.")` | varies | see qualities table | |

**`end-space`** — no ID params.

#### Materials — matter

**`create-matter`** (`seed/materials/matter/ops.js`)

| Field condition | params path | kind | notes |
|---|---|---|---|
| always | `params.spec.spaceId` | space | container space |
| always (when present) | `params.spec.parentMatterId` | matter | nested matter parent |
| always | `params.spec.beingId` | being | creator (typically remapped to graft-initiator) |

**`set-matter`** (`seed/materials/matter/ops.js`)

| Field condition | params path | kind | notes |
|---|---|---|---|
| `params.field === "parentSpace"` | `params.value` | space | re-containerize |
| `params.field === "parentMatterId"` | `params.value` | matter | re-nest |
| `params.field.startsWith("qualities.")` | varies | see qualities table | |

**`end-matter`** — no ID params.

#### Materials — move

**`move`** (`seed/materials/moveOp.js`)

| Field condition | params path | kind | notes |
|---|---|---|---|
| `params.to` (cross-space mode) | `params.to` | space | destination space |
| `params.target` (when overriding target) | `params.target` | space \| matter | explicit target override |
| (`params.coord` is a coord pair, not an ID) | | | |

#### Materials — seeds / plant

**`plant`** (`seed/materials/seeds.js`)

| Field condition | params path | kind | notes |
|---|---|---|---|
| target | varies | space | the space the seed plants into |
| `params.spec.*` | per-seed | varies | seed handlers receive arbitrary spec; per-seed entries belong to whichever extension owns the seed (e.g. harmony's `dance-floor` seed declares its own refs) |

#### Materials — seed-render

**`set-render`** (`seed/ibp/setRender.js`)

| Field condition | params path | kind | notes |
|---|---|---|---|
| target | varies | space \| matter \| being | the aggregate getting the render override |
| no ID-bearing params beyond target | | | render payload is a name + visual spec, not IDs |

#### Heaven — config

**`set-config`** / **`delete-config`** (`seed/realityConfig.js`)

No ID-bearing params. Config keys are string-typed values stored on the `.config` heaven space.

#### Heaven — roles

**`set-role`** (`seed/present/roles/role-manager/ops.js`)

| Field condition | params path | kind | notes |
|---|---|---|---|
| `params.name` | n/a | name | role names are NEVER remapped |
| `params.canSee` / `canDo` / `canSummon` | n/a | name | refs to operations / addresses, name-keyed |
| `params.prompt` / `params.body` | text | text | no IDs |

**`delete-role`** — `params.name` (name-keyed; no IDs).

**`set-world-signal`** (`seed/present/roles/role-manager/ops.js`)

| Field condition | params path | kind | notes |
|---|---|---|---|
| `params.namespace` / `params.key` / `params.value` | n/a | n/a | name-keyed; values may carry IDs depending on extension semantics — flag as needed by the extension owning the namespace |

**`set-being-roleflow`** (`seed/present/roles/role-manager/roleFlowOp.js`)

| Field condition | params path | kind | notes |
|---|---|---|---|
| `params.beingId` | `params.beingId` | being | the being whose roleflow is being set |
| `params.roleFlow[*].role` | n/a | name | role refs are name-keyed |
| `params.roleFlow[*].when` | n/a | name | world-signal refs |

#### Heaven — branches

These ops mutate Branch rows directly; they don't appear in replicate bundles (replicates don't carry branch state). Listed for completeness.

- `create-branch` — `params.parent` is a path (`"0"`, `"1a"`), not a UUID. Pointer arg is name-keyed.
- `pause-branch` / `unpause-branch` / `delete-branch` / `undelete-branch` — target a branch path; no aggregate IDs.
- `merge-branches` — branch paths only; reconciliation facts emitted DURING merge fall under whatever op they invoke (typically `set-being` / `set-space`).
- `set-pointer` / `delete-pointer` — name-keyed.

#### Heaven — llm-assigner

Per-being connection management. Connection keys are local; no cross-substrate ID exposure. (`llm-assigner:set-reality-llm` and `set-space-llm` reference space IDs via target; covered by target's ID kind.)

#### Credentials

**`credential-read` / `credential-reset` / `credential-detach` / `credential-attach`** (`seed/materials/being/credentialOps.js`)

| Field condition | params path | kind | notes |
|---|---|---|---|
| target | varies | being | credential ops target a being |
| `params.beingId` (credential-attach) | `params.beingId` | being | when attaching to a different being |
| credential payloads themselves are hashed secrets, NOT remapped | | | |

### Qualities namespaces (path inside namespace → ID kind)

These paths apply within a qualities namespace (e.g., for `being.qualities.connection`, the path `inhabitedBy` resolves to the being's qualities.connection.inhabitedBy field).

#### `qualities.beings` (on Space)

Maps role-name → entry. Each entry references a being.

| Path | Kind | Notes |
|---|---|---|
| `<name>.beingId` | being | the registered being for this role-name slot |
| `<name>.parentBeingId` | being | optional; some entries carry parent refs |
| `<name>.homeSpace` | space | the being's home (rarely set here; usually on the being) |

#### `qualities.connection` (on Being or Space)

| Path | Kind | Notes |
|---|---|---|
| `inhabitedBy` | being | resets on merge (per resetReels.js); when captured in a replicate, should resolve to graft-initiator or be re-occupied post-graft |
| `inhabitsHomeSpace` | space | the home the being inhabits |

#### `qualities.wakes` (on Being)

Carries scheduled wakes. Time fields re-anchor on graft (per publishing.md).

| Path | Kind | Notes |
|---|---|---|
| `<key>.spaceId` | space | the position whose inbox the wake targets |
| `<key>.beingId` | being | (when set) the actor; usually the being itself |
| `<key>.scheduledAt` | timestamp | re-anchor on graft |
| `<key>.intervalMs` | number | re-anchor relative |

#### `qualities.memory` (on Being)

Optional namespace some roles use to track relationship state.

| Path | Kind | Notes |
|---|---|---|
| `partners.*.id` | being | conversation partners (per-role; the role's owning extension declares the exact path) |

#### `qualities.cognition` (on Being)

| Path | Kind | Notes |
|---|---|---|
| `defaultKind` | enum | "llm" / "human" / "scripted" — NOT remapped |
| `assignedConnection` | name | connection key; local; NOT remapped across substrates |

#### `qualities.llmConnections` (on Being)

Per-being connection map. Keys + payloads are local-only.

| Path | Kind | Notes |
|---|---|---|
| `<key>.url` / `<key>.model` / `<key>.apiKey` | secret | NEVER included in replicates (manifest declares connection requirements; operator re-attaches at install) |

#### `qualities.contributors` (on Space)

| Path | Kind | Notes |
|---|---|---|
| `<key>.beingId` | being | each contributor entry |

#### `qualities.roleFlow` (on Being, future migration to ref-by-name)

| Path | Kind | Notes |
|---|---|---|
| `clauses[*].role` | name | NOT an ID |
| `clauses[*].when` | name | world-signal ref |
| `ref` (when using the registry indirection) | name | roleflow registry key |

#### `qualities.history` / `qualities.audit` (where extensions log refs to past acts)

| Path | Kind | Notes |
|---|---|---|
| varies by extension | varies | typically stripped during replicate (history doesn't transfer) |

### Fact-level metadata

Independent of action-specific params, every fact the graft synthesizes carries some standard fields that need handling:

| Field | Kind | Graft behavior |
|---|---|---|
| `beingId` (actor) | being | re-stamp with the graft-initiator's beingId |
| `target.id` (aggregate the fact mutates) | being \| space \| matter (per `target.kind`) | substitute via remap table |
| `branch` | branch path | re-stamp with the graft's destination branch path |
| `params._merge` | metadata | strip during replicate; never carried into the graft |
| `actId` / `sessionId` | act-correlation | strip during replicate; new IDs assigned during graft |
| `homeReality` | string | strip during replicate; target carries its own |

## What the graft layer does with this

Pseudocode:

```js
async function stampGraftFact(fact, remap, graftInitiator, targetBranch) {
  // 1. Get the action's refs entry
  const refs = manifest.ops[fact.action] || {};
  // 2. Substitute params per the refs
  const params = { ...fact.params };
  for (const [path, kind] of Object.entries(refs.params || {})) {
    const placeholder = getPath(params, path);
    if (placeholder?.startsWith?.("@")) {
      setPath(params, path, remap[placeholder]);
    } else if (placeholder === "<GRAFT_INITIATOR>" && kind === "being") {
      setPath(params, path, graftInitiator);
    }
  }
  // 3. Substitute target.id
  const targetId = remap[fact.target.id] || fact.target.id;
  // 4. Substitute beingId
  const beingId = graftInitiator;
  // 5. Strip stale metadata
  delete params._merge;
  // 6. Stamp
  await emitFact({
    verb: fact.verb,
    action: fact.action,
    beingId,
    branch: targetBranch,
    target: { kind: fact.target.kind, id: targetId },
    params,
  });
}
```

## What's NOT in the seed inventory

- **Extension-owned ops** (`harmony:*`, `library:*`, `food:*`, etc.) — each extension contributes its own entry per the contribution shape at the top.
- **Hooks** — beforeFact handlers can mutate params; if a hook adds ID-bearing fields, the extension owning the hook contributes the refs entry.
- **Custom matter origins** — extensions defining matter with non-`ibp` origin (e.g., `filesystem`, `assets`) declare any IDs in their `originContext` payload.

## Status

- Inventory: this document.
- Wiring: registry not yet implemented. Loader merge needs to land alongside the replicate + graft operations (publishing.md Phase 1 finish).
- Validation: TBD — at registration time, refuse contributions that name unknown kinds or claim paths already taken by other contributors.

## Open questions

1. **Wildcard depth.** Today only `*` (single-segment wildcard) is in scope. If qualities paths grow deep (e.g., `qualities.threads.<id>.messages.*.replies.*.fromBeing`), do we need `**`? Defer until a concrete need surfaces.

2. **Composite IDs.** Some refs are `(spaceId, key)` pairs (e.g., a beings-table entry keyed by role-name). The manifest treats each leaf field independently. Cross-field correlation (e.g., "if beingId remaps, also remap the key") is not currently modeled. May need a future extension.

3. **Optional vs required refs.** A field declared as a being-ref may legitimately be null. The manifest doesn't distinguish today — null stays null. Fine for v1.

4. **Forward refs in fact ordering.** When stamping creation facts in dependency order, all refs must point to already-stamped IDs. The replicate should sort topologically (parents before children) so the graft can walk in order. The manifest doesn't constrain ordering, but the replicate operation must.
