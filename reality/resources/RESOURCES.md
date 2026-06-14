# RESOURCES: the substance that flows through The Root System

> _"A resource is anything that goes through roots from tree to tree for new abilities."_
>
> _"The kernel is fixed; abilities arrive only as resources, which compose from the primitives and never alter them."_

A reality grows by drawing in resources. The substrate exposes one
primitive (`resource`) with several typed kinds, each shipping a specific
manifest shape and registering itself with a kind-specific registry at
install time. The six kinds today are **code**, **role**, **roleflow**,
**seed**, **asset**, and **pack** (the meta-kind that glues a group of
resources together). New kinds can be added without changing the catalog
or the wire; the registry is open.

This doc is the source of truth for how resources are shaped, how they
load, how they depend on each other, and how existing extensions migrate
into the new model. The Roots doctrine ([philosophy/OS/ROOTS.md](../philosophy/OS/ROOTS.md))
tells you how resources move between realities; this doc tells you what
they ARE on a single reality.

> **Status.** Phase 1 (the folder rename `extensions/` → `resources/`)
> landed. Phase 2 (kind tagging on existing manifests, supporting files
> lifted to `resources/`) is in progress. Phase 3 (graph-aware loader,
> lockfile, role-handler split, per-extension splits into packs) is
> queued next. See "Migration order" below.

---

## The filesystem is the bootstrap form of the in-TreeOS shape

Resources live on the host's filesystem today because Node has to read
code from disk to execute it. **Long-term, resources are spaces and
matter inside the reality itself**, drawn from Roots and folded into the
substrate the same way every other space and matter is. The filesystem
layout is the bootstrap; the in-TreeOS layout is the final form.

The on-disk shape mirrors the future space/matter tree exactly. Every
folder is (a draft of) a space; every file is (a draft of) matter on
that space. When a resource lives inside TreeOS, drawing it from Roots
fetches its bytes, plants the space tree, and creates matter from the
files. The migration is mechanical: "fold the on-disk tree into the
substrate."

The seed's own `./source` heaven space already does this for the kernel
files; resources extend the same pattern. `reality/resources/`
corresponds to a heaven-style space sibling to `./source`. Designing the
disk layout to match the space tree means there's no impedance mismatch
when resources migrate from disk to substrate.

---

## localStore: every reality's unconditional CAS

Every reality has a **localStore**, a content-addressable store of
owned bytes, hash-sharded and deduplicated. It's populated automatically
whenever matter is created via [contentStore.js](../seed/materials/matter/contentStore.js).
"Every tree has one no matter what."

```
reality/localStore/cas/<hash[0..2]>/<hash>     the bytes
                                     <hash>.meta.json  { mimeType, size, name }
```

Not all bytes in localStore are "installed" or "active":
- Matter your reality currently uses (file content, model bytes, etc.).
- Drafts and works-in-progress.
- Mirrors of things drawn from other realities' stores.
- Items the operator hasn't chosen to expose via the store pack.

localStore is the foundation under the four-layer network model:

| Layer | Always there? | What it is |
|---|---|---|
| localStore | Yes | The CAS of all owned bytes. |
| Federation | Yes | Canopy wire, cross-reality verbs, GRAFTs. |
| Peering pack | Opt-in | Be findable in a peer directory. |
| Store pack | Opt-in | Host a publishable catalog. |

A reality can plant either pack independently. See
[philosophy/OS/ROOTS.md](../philosophy/OS/ROOTS.md) for the doctrine.

### Resources auto-anchor into localStore at boot

When the loader discovers resources, every file under each resource's
folder is read once and put into localStore via
`contentStore.putContent`. The bytes land in `localStore/cas/<shard>/<hash>`
alongside user-uploaded matter, same store, same dedup, same content
door for serving. The lockfile at `reality/resources/.lockfile.json`
records the per-file CAS refs plus a `rootHash` per resource (merkle of
sorted file hashes). After boot, peers asking for any byte by hash get
served through the existing CAS path regardless of whether the bytes
came from a user upload or a reality-shipped resource file.

The on-disk files don't go away. Node still imports code from
filesystem paths. But the canonical byte storage is localStore;
publishing a resource (when the store pack is planted) becomes "sign
the existing rootHash + metadata," no separate byte-upload step.
**Dropping the Mongo db never touches localStore.** Your CAS persists
across chain resets. Old bytes from prior runs become orphaned
references (no fact in the new chain points at them) and the retention
sweeper eventually reclaims them.

---

## The six kinds

Each resource has a `manifest.js` (matter on its space) with a `kind`
field plus kind-specific shape.

### `resource:code`

Substrate code that gives the reality new abilities. Loads at boot,
runs `init(reality)`, registers DO ops, cognition handlers for roles,
hooks, routes, jobs. This is what today's "extension" is. A code
resource may declare that other resources must be installed for it to
work (roles it expects to find, seeds it expects to be plantable).

Entry: `index.js` exporting `init(reality)`. Manifest carries the
existing extension fields (`needs`, `optional`, `provides.*`).

### `resource:role`

A standalone role definition: `canSee`, `canDo`, `canSummon`, `canBe`,
`prompt(ctx)`, `defaultOrientation`. Pure data, no inline `summon`
function. Registers into the reality's role registry as a spec.

The substrate's default LLM cognition runs when a role is summoned and
no code-cognition handler is registered. Code resources can register
code-cognition handlers against a role by name via
`reality.declare.registerRoleHandler("<role-name>", handlerFn)`.

A role's `requires` typically names the code resource that implements
its handler (when not LLM).

Entry: `role.js` exporting the role spec.

### `resource:roleflow`

Composition data: an ordered list of `{ when, role, stack? }` clauses
that compose roles per moment from world state. References
`resource:role` entries by name in its `requires` manifest.

Entry: `roleflow.json` carrying the clause list.

### `resource:seed`

A structural template: a shell world with spaces / matter / beings that
gets PLANTED into a reality at a specified position. Registers with
`templateRegistry`; available via `plant-template-by-name`.

Distinct from `pack`: a seed plants STRUCTURE; a pack INSTALLS a group
of resources together. A seed actually materializes spaces; a pack
just brings dependencies along.

`requires` names every resource the seed expects to be present at plant
time (code that hosts roles the seed references, those roles
themselves, any other seed templates the bundle composes).

Entry: `seed.json` carrying the bundle. Optional `params` declarations
for substitution.

### `resource:asset`

Standalone owned bytes (models, sounds, large data). Hash-addressed.
Other resources reference them by hash via the content door.

Entry: `assets/` folder with bytes. Manifest lists each asset by
relative path + SHA-256 hash + mimeType. The loader registers assets
into CAS at boot; references resolve by hash. Asset resources usually
have no `requires` of their own.

### `resource:pack`

A meta-kind: a group of resources that travel together as one unit. A
pack has no content of its own beyond its manifest; its `requires`
lists the pieces (and any external resources) the pack glues together.
Drawing a pack pulls every member of its closure.

A pack space contains child spaces for each of its pieces, one per
kind. The pack manifest sits at the pack space's root (just like
package.json sits at the root of an npm package).

Entry: the pack's own `manifest.js` (kind: "pack") plus kind subfolders
containing each piece. The kind subfolder names are plural by convention
(`code/`, `roles/`, `roleflows/`, `seeds/`, `assets/`) except `code/`
which holds a single code piece per pack.

Use a pack when several resources are designed to travel together. A
single role authored on its own does not need a pack wrapper.

**Future kinds.** `resource:os` (a pack with default-config and
orchestrator declarations) lands when an OS distribution wants to ship.
The kind registry is open; specific kinds add as needs surface.

---

## Common manifest shape

Every resource manifest carries the same five common fields:

```js
export default {
  kind:        "code" | "role" | "roleflow" | "seed" | "asset" | "pack",
  name:        "roots-registrar",       // local name within this reality
  version:     "0.1.0",
  description: "...",
  publisher:   null | "<realityId>",    // null for substrate-shipped; set when authored elsewhere
  requires:    [
    { type: "code",  ref: "<hash> | <publisher>/<name>@<range>" },
    { type: "role",  ref: "..." },
    { type: "asset", ref: "..." },
  ],
};
```

Plus the kind-specific additions listed above per kind.

**`requires`** is the resource graph's edge list. Each entry names a
`type` and a `ref`. The ref can be either:

- **A hash** (`sha256:<...>`) for exact, reproducible-forever,
  never-updates references.
- **A pointer** (`<publisher>/<name>@<version-range>`) for flexible
  references that follow publisher claims.

Authors write against pointers (so fixes flow); install resolves the
closure and freezes it to a hash-locked set (so the runtime is
reproducible and tamper-proof). The frozen set is the lockfile.
Re-resolving is an explicit, auditable act stamped on the reality's
chain, not silent drift. Same shape as npm's package.json-range vs
package-lock-hash split, same reason.

---

## On-disk shape

The shape is resource-first: each top-level folder under `resources/` is
one resource (one space). A standalone single-kind resource has its
manifest at the top of that folder. A pack has its own pack-manifest at
the top and kind subfolders (plural: code, roles, roleflows, seeds, assets; one piece per code, multiple in each other) inside for each piece.

```
reality/resources/                      ← heaven-style space (mirrors a future tree)
├── RESOURCES.md                        ← matter on the resources space
├── README.md                           ← short pointer
├── loader.js                           ← bootstrap loader (substrate)
├── manifestDeps.js                     ← bootstrap dep resolver (substrate)
├── EXTENSION_FORMAT.md                 ← code-kind format doc
├── assets.md                           ← assets doctrine
├── _templates/                         ← one template per kind
│   ├── pack/
│   ├── code/
│   ├── role/
│   ├── roleflow/
│   ├── seed/
│   └── asset/
│   (singular here because _templates/ holds one template per kind, not pieces)
│
├── roots/                              ← a PACK
│   ├── manifest.js                       (kind: "pack")
│   ├── README.md
│   ├── code/                           ← single code piece (one per pack)
│   │   ├── manifest.js                   (kind: "code")
│   │   ├── index.js
│   │   ├── handlers.js
│   │   └── lib/
│   │       └── claims.js
│   ├── roles/                          ← role pieces, each in a subfolder
│   │   ├── registrar/
│   │   │   ├── manifest.js               (kind: "role")
│   │   │   └── role.js
│   │   └── publisher/
│   │       ├── manifest.js
│   │       └── role.js
│   └── seeds/
│       └── catalog/                    ← seed piece
│           ├── manifest.js               (kind: "seed")
│           └── seed.json
│
├── emotions/                           ← a PACK of roles
│   ├── manifest.js                       (kind: "pack")
│   └── roles/
│       ├── bored/
│       │   ├── manifest.js
│       │   └── role.js
│       ├── tired/
│       └── ... (six more)
│
├── hello-world/                        ← STANDALONE code resource
│   ├── manifest.js                       (kind: "code")
│   ├── index.js
│   └── README.md
│
└── treeos-characters/                  ← STANDALONE asset resource
    ├── manifest.js                       (kind: "asset")
    └── assets/
        ├── dancer.glb
        └── musician.glb
```

**Loader walk.** Read every top-level folder's manifest. If its kind is
`"pack"`, recurse into the pack's kind subfolders (plural: code, roles, roleflows, seeds, assets; one piece per code, multiple in each other) to find the pieces.
Otherwise the folder IS a single-kind resource.

**Naming inside packs.** Each piece declares its own `name` field
(usually `<pack>-<piece>`, e.g. `roots-registrar`). The piece's name is
globally unique across the reality; the pack relationship is encoded in
its `requires` and in its physical location under the pack folder. The
folder name is documentation; the manifest name is authority.

---

## Resources form a verified dependency graph

Resources don't live in isolation; they reference each other through
their `requires` manifest. Those edges form a graph. Grouping isn't a
manual folder structure but the transitive closure of that graph: draw
a roleflow, you pull its roles, which pull their code, which pull their
assets. A pack is a named root whose closure is the whole pack's
content; an OS pack is a named root that pulls many packs.

Two integrity properties of this graph are separable and worth keeping
distinct so "broken dependency" always resolves to one or the other.

### Resolvable

The cryptographic question: does each hash in the closure name valid,
verifying content? Always answerable locally. Walk the graph, resolve
each ref to a hash, verify the bytes hash to what they claim.

A dependency by hash can never be tampered or substituted, so the
"supply-chain attack via dependency swap" class is structurally
impossible. This is the upside of content-addressing the graph.

### Available

The network question: will some Roots node actually serve the bytes for
a given hash? This can genuinely fail (a dep delisted everywhere, no
mirror left). Mitigated by more Roots nodes; never fully guaranteed.
Same availability concern from the Roots trust model.

### Two integrity moments

- **At publish.** When a publisher publishes a resource, Roots resolves
  the declared deps and refuses (or flags `status: "incomplete"`) if
  any aren't present in some reachable catalog. Lying about deps is
  detectable at publish time.
- **At draw/install.** When a reality draws a resource, it resolves the
  full closure, fetches every member by hash from the content door,
  verifies each, installs in topological order (assets first, then code,
  then roles, then roleflows that compose them). Any missing or failing
  dep refuses the entire install atomically.

### Granularity is a judgment call

A monolithic code resource has zero external deps and can't have a
dependency fail. Shattering it into code + three roles + an asset makes
each piece reusable but adds edges, and every edge is a way for "deps
to not hold." **Split where reuse is real, not reflexively into atoms.**
A code resource that ships ten internal roles only used by its own
handlers is fine staying monolithic; splitting them out adds edges with
no reuse benefit. The graph is a cost as well as a capability.

---

## The loader

`reality/resources/loader.js` is a multi-kind dispatcher that resolves
the dependency graph before loading anything:

```
loadResources():
  // Phase 1: discover. Walk every top-level folder of reality/resources/.
  // If a folder's manifest.js is kind: "pack", recurse into its kind
  // subfolders to find each piece. Build the full resource table.
  resources = scanResources(reality/resources/)
  for r in resources:
    r.lockedRefs = resolveRefs(r.requires)    // pointer → hash via lockfile

  // Phase 2: verify resolvable. Walk the closure of selected resources
  // (per .treeos-profile + their transitive deps). Every ref must point
  // at content that hashes to its declared hash.
  closure = transitiveClosure(selectedResources, resources)
  for r in closure: verifyHash(r)
  if any unverified: refuse-load with the missing/broken list

  // Phase 3: topological install. Sort by dep edges, then run each
  // kind's loader in order so dependents see their deps already
  // installed. Packs themselves have nothing to install — their
  // pieces install instead.
  for r in topoSort(closure):
    if r.kind == "pack": continue            // pack is glue; pieces install
    kindHandler[r.kind].install(r)
```

Per-kind install handlers:

- `code`: existing extension loader path. Run `init(reality)`, register
  provides, attach routes/tools/hooks.
- `role`: read `role.js`, `reality.declare.registerRole(name, spec, ownerExtension)`.
- `roleflow`: read `roleflow.json`, register with the (new) roleflow registry.
- `seed`: read `seed.json`, `templateRegistry.registerTemplate(name, bundle, owner)`.
- `asset`: read manifest, CAS-store each asset, register `(resourceName, assetPath) → hash` reference table.
- `pack`: nothing to install directly; the pack's pieces (named in
  its `requires`) install via their own kind handlers.

Three properties fall out of having the graph at the loader level:

- **Install is atomic per closure.** If any one resource in the selected
  set's closure fails to verify, nothing loads. No half-installed states.
- **The lockfile is the resolved-refs snapshot.** When a reality boots,
  the loader writes the resolved closure (hash-locked refs) to
  `reality/resources/.lockfile.json`. Re-resolution is an explicit
  operator act, not silent drift.
- **Re-resolution stamps a fact.** A `do:resolve-resources` op walks the
  pointer refs, resolves to current hashes, refuses if the new closure
  doesn't verify, then writes a new lockfile and stamps a fact on the
  reality's reel. The chain audits "this reality moved from hash set A
  to hash set B at time T."

The `.treeos-profile` filter still applies, now selecting resources of
any kind by name. Selecting a pack by name pulls every piece via its
`requires` closure. Profile format stays one-name-per-line.

---

## Catalog listing format (Roots)

A Roots node's registrar catalog keys by `publisher → name → versions`.
The version entry carries the resource's kind, hash, and dep declarations:

```js
qualities.roots.catalog = {
  "<publisher>": {
    "<name>": {
      pointer: <signed claim>,    // current version pointer
      versions: {
        "0.1.0": {
          kind:        "code" | "role" | "roleflow" | "seed" | "asset" | "pack",
          listingHash: "<sha256>",
          requires:    [{ type, ref }, ...],
          publishedAt: <date>,
          builtFor:    "<...>",
          status:      "complete" | "incomplete" | "delisted",
        }
      }
    }
  }
}
```

`publish-listing` SUMMON intent carries the new `kind` and `requires`
fields. The registrar handler validates kind is one of the recognized
kinds, walks the declared deps, and marks the listing `"complete"`
(every dep is reachable through this Roots node's catalog) or
`"incomplete"` (the listing is real but installs will fail until the
missing deps land).

---

## Migration order

These steps are the path from today's `resources/extensions/<name>/`
shape to the full multi-kind resource-first shape. Other agents can
pick up steps 9-13 in parallel once steps 1-8 land.

1. ~~Write `reality/resources/RESOURCES.md`~~ (this doc).
2. Lift the support files up one level:
   `git mv reality/resources/extensions/loader.js reality/resources/loader.js`
   and the same for `manifestDeps.js`, `EXTENSION_FORMAT.md`,
   `README.md`, `assets.md`.
3. Lift each existing extension up one level:
   `git mv reality/resources/extensions/<name> reality/resources/<name>/`
   for `roots`, `harmony`, `hello-world`, `emotions`, and `_template`.
   The `resources/extensions/` folder retires.
4. Update all loader path imports from
   `./resources/extensions/loader.js` to `./resources/loader.js`.
   Update `plant.js`, `graft.js`, `.gitignore`, `.env.example`. The
   `.treeos-profile` path becomes `reality/resources/.treeos-profile`.
5. Add `kind: "code"` + `requires: []` to every existing extension
   manifest. (They will become packs in step 9, but this is the safe
   intermediate state where the loader can still treat them as single
   code resources.)
6. Rewrite the loader as multi-kind, graph-aware (the three-phase
   discover/verify/install dispatcher; pack recursion in discover).
7. Implement the lockfile (`reality/resources/.lockfile.json`,
   gitignored). Loader writes on first boot; reads on subsequent boots;
   refuses if any locked hash no longer verifies.
8. Add the `registerRoleHandler` API in
   `reality/seed/present/roles/registry.js`. Role registry stores the
   spec; handler registry stores `(roleName, handlerFn)` separately.
9. **Convert `roots/` to a pack.** Split into `roots/code/`,
   `roots/roles/registrar/`, `roots/roles/publisher/`,
   `roots/seeds/catalog/`. The pack manifest at `roots/manifest.js`
   names every piece in `requires`. The code resource registers
   handlers for the two roles via `registerRoleHandler`. End-to-end
   verify: publish a listing via SUMMON; the registrar handler runs.
10. **Convert `emotions/` to a pack of roles.** Eight role pieces
    under `emotions/roles/<name>/`, no code piece. Pack manifest
    requires each.
11. **Convert `harmony/` to a pack.** Code + roles + any seeds.
12. **Keep `hello-world/` as a standalone code resource** (single-kind,
    no pack needed). Just `kind: "code"` at `hello-world/manifest.js`.
13. **Asset migration.** Scan packs for asset files. Either move into
    a sibling `roots/asset/<name>/` piece, or keep inside the owning
    code resource at `roots/code/assets/` declared in the manifest.
14. Extend `roots/code/handlers.js` `publishListing` to validate
    `kind` and walk `requires` against the catalog, marking listings
    `"complete"`/`"incomplete"`.
15. Add the `do:resolve-resources` op that re-resolves pointer refs
    against the current catalog, writes the new lockfile, and stamps
    a fact on the reality's reel.
16. Fill in `_templates/<kind>/` under each kind showing the minimal
    shape.
17. Drop DB, boot fresh, run the verification scenarios below.

Steps 1-4 land the doctrine and the folder structure without behavior
change. Steps 5-8 enable the graph-aware multi-kind loader and lockfile.
Steps 9-13 are the per-extension splits. Steps 14-17 close out.

Tasks 10-12 are independent of each other and parallelizable across
agents.

---

## Per-extension migration matrix

### `roots/` → pack with 4 pieces

This is the canonical multi-kind example. Do it first; it exercises
every piece of the new model.

- `roots/manifest.js` — pack manifest. `kind: "pack"`,
  `requires: [{ type: "code", ref: "roots-code" }, { type: "role", ref: "roots-registrar" }, { type: "role", ref: "roots-publisher" }, { type: "seed", ref: "roots-catalog" }]`.
- `roots/code/manifest.js` + `index.js` + `handlers.js` + `lib/claims.js` +
  `ops/delist.js`. `index.js` no longer registers roles inline; it
  registers code-cognition handlers for the roles via
  `reality.declare.registerRoleHandler` (instead of registering the
  roles inline). `kind: "code"`, `name: "roots-code"`,
  `requires: [{ type: "role", ref: "roots-registrar" }, { type: "role", ref: "roots-publisher" }, { type: "seed", ref: "roots-catalog" }]`.
- `roots/roles/registrar/manifest.js` + `role.js` — the spec from
  today's `code/roots/roles/registrar.js`, minus the `summon` function
  (the function moves to `roots/code/handlers.js` and gets registered
  by the code resource's init). `kind: "role"`,
  `name: "roots-registrar"`, `requires: [{ type: "code", ref: "roots-code" }]`.
- `roots/roles/publisher/manifest.js` + `role.js` — pure-data role,
  LLM cognition. `kind: "role"`, `name: "roots-publisher"`,
  `requires: []`.
- `roots/seeds/catalog/manifest.js` + `seed.json` — the bundle.
  `kind: "seed"`, `name: "roots-catalog"`,
  `requires: [{ type: "role", ref: "roots-registrar" }]`.

### `emotions/` → pack of 8 roles

The eight modifier-role files (`bored.js`, `tired.js`, `focused.js`,
`curious.js`, `cautious.js`, `urgent.js`, `playful.js`, `formal.js`)
become eight role pieces under a pack:

- `emotions/manifest.js` — pack manifest. `kind: "pack"`,
  `requires: [{ type: "role", ref: "emotions-bored" }, ... seven more]`.
- `emotions/roles/bored/manifest.js` + `role.js`. `kind: "role"`,
  `name: "emotions-bored"`, `requires: []`.
- ...seven more, same shape.

Today they're registered by `emotions/index.js`'s `init()`. After
migration: each role registers on its own. `emotions/index.js`
retires; there's no `emotions/code/` piece because nothing in the
current `emotions/` was substrate code.

### `harmony/` → pack with code + multiple roles

`harmony/` ships substrate code (`index.js`, handlers) plus
dancer/musician/listener/etc. roles. Split:

- `harmony/manifest.js` — pack manifest.
- `harmony/code/` — the substrate code. Registers cognition handlers
  for the role names via `registerRoleHandler`.
- `harmony/roles/dancer-llm/`, `harmony/roles/musician-llm/`, etc. — one
  per role currently in `harmony/roles/`.
- Any seeds harmony ships go to `harmony/seeds/<name>/`.

`harmony/code/manifest.js` declares
`requires: [{ type: "role", ref: "harmony-dancer-llm" }, ...]` so
install order is enforced.

### `hello-world/` → standalone code resource

Single-kind extension. No pack wrapper needed. Just:
`hello-world/manifest.js` (`kind: "code"`, `requires: []`) + `index.js`.

---

## Open questions

Worth pinning so the migration doesn't quietly close any of these.

- **Roleflow registry implementation.** Roleflow waits on its own
  design pass. Until that lands, roleflow stays unimplemented at the
  registry level. The first roleflow resource forces the design.
- **Asset resource boundaries.** Should every binary asset be its own
  resource, or do they cluster (one asset resource = a collection of
  bytes shipped together)? Probably the latter: a `treeos-characters`
  asset resource ships ten `.glb` files, declared in the manifest.
  Individual hashes available for reference.
- **Code-registered roles vs published roles.** A code resource can
  register an "inline" role at init time (not a separate published
  resource). The clean answer is "allowed, but discouraged" — for
  one-off internal roles, inline is fine; for anything publishable or
  composable across resources, make it a role piece in a pack.
- **`publisher` field on substrate-shipped resources.** The substrate
  ships its own roots/harmony/hello-world. Is their publisher the
  reality running them at first plant, or `null` (substrate-canonical)?
  Decide so the Roots catalog knows how to attribute.
- **Pointer-range grammar.** `<publisher>/<name>@^1.x` style. Pick a
  constraint grammar (semver caret/tilde or simpler exact/major) and
  pin in the doctrine. Probably semver, since the existing manifest
  already uses `@^x.y.z` shapes.
- **Resolvable-but-not-available at install.** If the closure resolves
  locally (every ref names a hash, every hash is cached locally) but a
  peer trying to fetch the same closure can't find the bytes anywhere,
  install fails for the peer. The lockfile is shared but availability
  isn't. Doctrine: a drawing reality must verify availability across
  its preferred Roots nodes before depending on a closure.
- **`resource:os` as a kind.** A pack with `defaultConfig` and
  `orchestrators` declarations. Defer until an OS distribution wants
  to ship; the kind registry is open.
- **In-TreeOS migration mechanics.** When resources move from disk to
  spaces-and-matter, what triggers the migration? Probably a one-shot
  boot pass that folds the on-disk tree into the substrate, after
  which the loader reads from the substrate's spaces rather than the
  filesystem. The filesystem becomes the cache; the substrate is the
  source of truth. Mirrors how `./source` works today.

---

## Verification

End-to-end test scenario after migration (drop DB, fresh boot):

1. `mongosh reality --eval 'db.dropDatabase()'`
2. `node reality/plant.js` — wizard discovers packs and standalone
   resources; offers roots; user says yes.
3. `npm start` — boot resolves the closure of the selected profile,
   verifies every hash, writes `.lockfile.json`, installs in
   topological order. The roots pack's code piece installs after its
   required role and seed pieces are in place.
4. SEE on the catalog address — confirm the registrar being is birthed
   and owns the catalog space.
5. SEE on `<reality>/./roles` — confirm `roots-registrar` and
   `roots-publisher` are registered.
6. SUMMON the registrar with
   `intent: "publish-listing", kind: "code", publisher: "<some-id>",
   name: "test", version: "0.1.0", listingHash: "<sha>",
   requires: [{ type: "code", ref: "..." }]`. Confirm a listing lands
   in the registrar's qualities AND the listing carries
   `status: "complete"` or `status: "incomplete"`.
7. Run the existing e2e at
   `reality/.test/e2e/roots-catalog-e2e.mjs`. Update the listing shape
   for kind + requires + status. Should still pass.
8. Confirm `emotions-bored` role is registered after boot.
9. Confirm `harmony` pack loaded its required role pieces first, then
   the code piece wired the cognition handlers.
10. **Negative.** Add a `requires` ref to a non-existent role in
    `roots/code/manifest.js`. Boot refuses-load with "missing dep" and
    names the broken edge. No partial state. Restore the ref, boot
    again — clean.
11. **Negative.** Corrupt one byte of a resource (edit a file in
    `harmony/code/`). Boot refuses-load with "hash mismatch" naming
    the resource. The lockfile's recorded hash no longer matches.
12. `do:resolve-resources` — verify it walks pointer refs, resolves to
    new hashes, writes a new lockfile, stamps a fact on the reality's
    reel. Replay should reproduce the same closure.

---

## See also

- [philosophy/OS/ROOTS.md](../philosophy/OS/ROOTS.md) — how resources
  move between realities through The Root System.
- [philosophy/OS/GRAFT-AND-SEED.md](../philosophy/OS/GRAFT-AND-SEED.md) —
  agents (grafts) vs templates (seeds), the boundary the Roots catalog
  enforces.
- [philosophy/OS/IDENTITY.md](../philosophy/OS/IDENTITY.md) — why every
  resource is publisher-signed and every reality is key-addressed.
- [resources/EXTENSION_FORMAT.md](EXTENSION_FORMAT.md) — the deeper
  format doc for `resource:code` (what an extension's manifest carries,
  how `provides.*` resolves at boot).
