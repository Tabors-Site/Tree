# Publishable Units in TreeOS

> *Replicates are projections of current state, packaged for portability. Grafting re-creates content as fresh facts in the target with new local IDs. History does not transfer; only current shape. The chain in each reality stays the truth of what happened there.*
>
> *IDs are typed at the substrate level. Every reference to a being, space, or matter is a tagged Ref, never a bare string. The substrate detects refs by structure; replicate and graft consume them through the walker without per-action declarations. See seed/REFS.md for the Ref doctrine.*

## What this document is

TreeOS supports three layers of publishable content. Understanding the layering is essential for authoring extensions, sharing features across realities, and reasoning about what flows where in the ecosystem.

This document is the canonical reference for the publishing model. It pins the doctrinal commitments, names the three layers and what each does, and describes the underlying mechanism (snapshot-and-graft) that makes replicates work without contaminating any reality's chain.

For implementation status and the concrete build, see the "Build Status" section at the end. For the prerequisite refs inventory that #4 and #5 depend on, see `REFS_MANIFEST.md` in this directory.

## Vocabulary

The three publishable kinds, locked:

| Term | What it names | Verb forms |
|---|---|---|
| **Extension** | Code package providing new primitives | install / uninstall an extension |
| **RoleFlow** | Declarative behavior composition over existing roles | install / publish a roleflow |
| **Replicate** | Portable snapshot of current state (a subtree's projected shape, no history, no source IDs) | **replicate** (extract a subtree → portable artifact); **graft** (apply a replicate into your reality) |

Two core verbs for replicates:

- **Replicate** *(verb)*: take a subtree from your reality and turn it into a portable replicate artifact. *"Replicate the `/library` subtree."* Produces a `.replicate` bundle.
- **Graft** *(verb)*: import a replicate into your reality. The substrate assigns new local IDs, surfaces conflicts via the merge mediator, and stamps fresh creation facts on a new branch. *"Graft `library-v2.replicate` into my main."*

Other phrasings accepted as synonyms in docs and UI:

- *Snapshot* a subtree → same as *replicate* (the verb)
- *Apply* / *import* a replicate → same as *graft*
- *Publish* a replicate → upload to Horizon
- *Share* a replicate → send the artifact directly
- *Fork* a replicate → make a local editable copy of someone else's published replicate

### What "replicate" means and why not "clone"

A replicate behaves identically to its source from the outside — same beings, same roles, same world state — but is genuinely separate on the inside: new local IDs, fresh reels, its own chain going forward. This is biological mitosis: the daughter cell is functionally equivalent but is its own cell, living its own life.

A **clone**, in contrast, is bit-for-bit identical: every fact preserved, every ID preserved, every reel intact. Used for full backups, literal restoration, copying a whole reality to a new substrate location. Clones are a separate (future) mechanism with its own verb (**plant** a clone — restoring it into a substrate the way you plant a seed). See the "Future: Clones + Plant" section below.

Replicates are the common case (share a feature, distribute starter content). Clones are the rare case (full backup-and-restore). Reserving "clone" for the literal-copy case keeps both vocabularies clean.

### Why "graft"

A replicate doesn't just install — it joins your reality's reel. The mediator's conflict resolution is exactly what makes the graft take. Biology again: grafting joins living tissue. The new branch the replicate lives on grows from the same root as your main; the content is yours to tend going forward.

The seed already has a `plant` op (it fans a registered seed structure into a space — different semantics from grafting a replicate). The two never overlap: `plant` runs a code-defined seed; `graft` lands a content snapshot.

## The three layers

### Layer 1: Extensions (code + content)

**What they are.** Code packages that introduce new primitives or executable logic to a substrate. Extensions can define:

- New verb handlers or sub-handlers for DO operations
- New role specifications (the role definitions referenced by roleflows)
- Scripted-cognition handlers (executable behavior for scripted beings)
- New slice definitions for the SEE registry
- Assets (3D models, sounds, images) referenced by render slices
- New matter types or being seed types
- New qualities namespaces and their semantics
- Hooks (beforeFact, enrichContext, afterMatter, etc.)

**When to publish as an extension.** Whenever your contribution requires running code in the substrate. If you need to interpret a new fact action, dispatch a new verb operation, or run logic in a scripted-cognition handler, you need an extension.

**Dependencies.** Extensions can depend on other extensions. Declared in the manifest, enforced at load time.

**Distribution.** Extensions are code packages. They are NOT fact streams. The snapshot-and-graft story below applies to replicates and roleflows; extensions flow through the existing extension-loader path (Horizon → registry → loader).

### Layer 2: RoleFlows (pure content)

**What they are.** Declarative compositions of existing roles via when-conditions. RoleFlows are pure content — no executable code, no new primitives. They describe how roles stack and switch based on world state.

**When to publish as a roleflow.** Whenever your contribution is a behavioral pattern that uses existing extension capabilities. If you've designed a clever way to compose existing roles (a multi-phase judge that switches between opening, evidence, and ruling based on world state), and you don't need new primitives, publish a roleflow.

**Dependencies.** A roleflow depends on the extensions that provide the roles it references. Declared in the roleflow manifest.

**Storage.** RoleFlow definitions live in heaven (the `.roleflows` seed space). Beings reference them by name. Same name-keyed indirection as roles.

### Layer 3: Replicates (current-state snapshots)

**What they are.** Bundles of current state from a subtree — the projected shape of beings, spaces, and matter at replicate time. References to the roles and roleflows they need. NO history. NO source-reality IDs. NO foreign facts.

**When to publish as a replicate.** Whenever your contribution is actual world content that others would want to instantiate. A courtroom with judges and witness chairs. A library with shelves, books, and a librarian. A dance floor with a chosen layout.

**Dependencies.** Replicates depend on the extensions and roleflows referenced by their content. Declared in the replicate manifest.

**Authoring.** Replicates are produced by *replicating* a subtree from an existing reality. The replicate operation walks the subtree, snapshots current projections, packages with a manifest. NOT a fact-stream walk.

### Combinations

A complete published package can include all three layers:

- An extension providing new primitives (code).
- RoleFlows composing those primitives into behaviors (content).
- A replicate showing a working configuration (content snapshot).

A "library-system" package might publish: `library-extension` (code for library matter types, verbs, roles), `library-flows` (roleflows for librarian-with-mood, checkout-procedures), `library-starter.replicate` (a working library snapshot with shelves and a librarian being).

A consumer installs the extension, installs the roleflows, then grafts the replicate. They get a working library, with their own local IDs.

## The underlying mechanism: snapshot-and-graft

For replicates (and the same primitive applies to within-reality subtree moves, partial backups, and cross-reality content flow), the substrate operation is:

1. **Snapshot the current state.** Walk the projections of in-scope aggregates. Capture content (name, qualities, role, position, lineage) with placeholder IDs that are local to the replicate. Snapshot, not chain.

2. **Manifest dependencies.** Required extensions (with version constraints). Required roles. Required roleflows. Required qualities namespaces. The minimum the target needs for the graft to produce equivalent behavior.

3. **Validate at graft.** Check the target has the dependencies. Surface missing pieces as install prompts.

4. **Detect conflicts.** Walk the replicate against the target's existing content. Name collisions in the insertion scope. Position collisions. Role definition disagreements. Surface as the same conflict catalog the merge mediator already walks.

5. **Build the remap table.** For each placeholder ID in the replicate, assign a new local ID in the target.

6. **Stamp creation facts in dependency order.** Spaces first (containers before contents). Beings in their home spaces. Matter in its positions. Quality fields filled per the refs manifest, with IDs filled from the remap table. Each fact is a fresh creation fact in the target's chain.

7. **Stamp a `graft-completed` meta-fact.** A record on the target's reality-level reel: who grafted what, when, producing which aggregates. The audit anchor.

8. **Return the new branch.** The graft lands on a fresh branch the operator can pause-while-resolving, accept, or reject.

## Why snapshot-and-graft (not fact-stream-replay)

The fact-stream-replay model had real problems. Snapshot-and-graft avoids each:

- **The chain stays the truth.** Every reality's chain shows what actually happened in *that reality*. The graft operation IS a fact ("grafted replicate X at T producing these beings"). The created beings have facts showing their birth in the local reality. No foreign facts contaminating the local chain.

- **The interaction-with-outside problem disappears.** Current state has no historical references to outside beings — those interactions already shaped the current state, and the current state is what transfers.

- **Performance.** One fact per aggregate (one fresh creation), not one fact per historical event. Replicates for subtrees with months of history still graft quickly.

- **Audit clarity.** The target's chain shows clearly when content arrived. Each grafted being's reel starts at the graft moment.

- **No replay-rot.** Old facts whose semantics changed (deprecated actions, retired ops) don't replay incorrectly. Grafts produce facts that the target's CURRENT substrate accepts.

What is lost in this model:

- **History.** The grafted beings have no biography from before the graft. Their reels start at the graft moment.
- **Causal relationships across the boundary.** Past interactions with outside beings don't replay; their effect was already absorbed into the current state.

For most use cases (sharing features, distributing replicates, instantiating starter content), losing history is the right tradeoff. The capability transfers; the biography stays with the source.

For cases where history matters (full backup-and-restore, audit transfer, literal reality preservation), the *Clone + Plant* primitive applies (see below).

## What a replicate artifact actually contains

```
{
  "manifest": {
    "name": "small-library",
    "version": "1.0.0",
    "kind": "replicate",
    "replicatedAt": "2026-06-04T18:00:00Z",
    "replicatedFrom": "treeos.example",
    "scope": "/library",
    "requires": {
      "extensions": ["library@^1.0", "emotions@^2.0"],
      "roles": ["librarian", "patron"],
      "roleflows": ["librarian-with-mood"],
      "qualities": ["library.shelves", "library.checkouts"]
    },
    "schemaVersion": "1.0.0"
  },
  "aggregates": {
    "spaces": [
      {
        "placeholderId": "@space-1",
        "name": "library",
        "parent": "<INSERTION_POINT>",
        "position": null,
        "qualities": { "library.layout": {...} }
      },
      {
        "placeholderId": "@space-2",
        "name": "reading-room",
        "parent": "@space-1",
        "qualities": {...}
      }
    ],
    "beings": [
      {
        "placeholderId": "@being-1",
        "name": "alice",
        "role": "librarian",
        "roleFlow": { "ref": "librarian-with-mood" },
        "homeSpace": "@space-2",
        "parentBeing": "<GRAFT_INITIATOR>",
        "qualities": {...}
      }
    ],
    "matter": [
      {
        "placeholderId": "@matter-1",
        "parentSpace": "@space-2",
        "origin": "ibp",
        "qualities": {...}
      }
    ]
  },
  "assetRefs": [
    { "sha256": "abc123...", "purpose": "librarian-3d-model", "size": 1024 }
  ]
}
```

File extension: `.replicate`.

What a replicate does NOT contain: historical facts, source-reality IDs, source-reality chain, anything outside the replicated subtree.

## How graft resolves the hard cases

### External-parent resolution

A being inside scope whose `parentBeing` is outside scope. The placeholder `<GRAFT_INITIATOR>` resolves to the operator running the graft by default. A "pick local parent" conflict-catalog row surfaces only for top-level beings the operator wants explicit control over.

### Wake re-anchoring

A being with `qualities.wakes` containing scheduled-at timestamps. Re-anchored to graft time: target-wake-at = graft-time + (replicate-wake-at − replicate-time). Preserves relative timing within the subtree. Manifest carries both absolute and relative times so the grafter can override at install.

### Internal-reference remapping at qualities depth

A being's qualities might reference other beings by ID (e.g., `qualities.memory.partners.0.id`). The refs manifest extends from "fact action params" to "qualities namespace fields" — extensions declare which qualities-path fields carry IDs. The graft substitutes per the manifest.

### Role-definition collision

The replicate bundles role definitions; the target has the same role name with different code. Conflict-catalog row: replace, keep target's, or fork ("librarian-from-graft"). Mediator walks the choice.

### Schema-version mismatch

The replicate's `schemaVersion` doesn't match the target's substrate version. Graft refuses with a clear error. Future: migration paths via the existing schema-migration machinery.

## Doctrine

**Principle 1: Identity is local. Content is universal.**

A being's `_id` is a substrate's local bookkeeping. It has no meaning outside the substrate that issued it. When content moves between substrates via replicate, new local IDs are assigned in the target. Cross-references within the grafted content are remapped during graft. References from grafted content to pre-existing content in the target are resolved by name, by lineage, or by user-mediated conflict resolution.

**Principle 2: Current state is the unit of portability. History stays local.**

The substrate's commitment to event-sourced state means current state is a projection of facts. The replicate captures the projection; the graft reconstructs the projection in the target by stamping fresh facts. Two substrates produce the same content shape through different historical paths.

This extends the branch model across realities. Branches inherit parent state at branch-point with their own divergent history. Grafted replicates inherit source state at graft-point with their own fresh history. Same primitive at different scope.

**Principle 3: The chain in each reality is the truth of what happened there.**

No foreign facts. No replayed reels. Every fact in a reality's chain was stamped in that reality, by an actor of that reality, at the moment named. Grafts are themselves facts ("grafted replicate X at T"); the content they create is stamped by the local substrate.

This is what makes audits trustworthy. A reality's chain is a complete record of its own existence. Nothing grafted pretends to be local-from-the-beginning.

## Authoring guidance

When deciding what to publish:

- **Publish an extension** if your contribution requires new fact actions, new verb operations, new scripted handlers, or new slice definitions. Anything that requires code in the substrate.
- **Publish a roleflow** if your contribution is a behavioral pattern composed from existing roles via when-conditions. No new code required.
- **Publish a replicate** if your contribution is actual instantiated content (beings, spaces, matter) that demonstrates or provides a working configuration.
- **Publish a combined package** if your contribution requires all three: the new primitives (extension) plus the behavioral patterns (roleflows) plus a working demonstration (replicate).

Consumers install the extensions they need, install the roleflows that compose those extensions' capabilities, and graft replicates that provide working starting points. Each layer is independently usable and combinable.

## Future: Clones + Plant (full fact-chain portability)

Replicates and clones answer different needs.

A **clone** preserves *every fact* from a source — the full chain from genesis forward. Used for:

- **Full backup of a reality.** Periodic export captures the whole substrate; restore plants the clone in a fresh substrate and re-runs reality from genesis.
- **Literal reality copy.** Move a reality to a different host. The new substrate becomes the old one — same history, same IDs, same audit trail.
- **Forensic preservation.** A reality is archived with full causal history intact for later inspection or rebuild.

The verb is **plant** (extending the existing `plant` op for seeds — you plant a clone the way you plant a seed, fanning a complete reality from a snapshot of its origin). A `.clone` bundle is the artifact.

**How clone-and-plant differs from replicate-and-graft:**

| Aspect | Replicate + Graft | Clone + Plant |
|---|---|---|
| What's captured | Current state (projections) | Every fact (the chain) |
| Target | Existing reality; new branch | Typically fresh substrate; from genesis |
| IDs in target | New local IDs | Source IDs preserved (or remapped for cross-substrate) |
| History | Lost; reels start at graft | Preserved; reels match source |
| Use case | Share a feature, distribute starter content | Backup, restore, literal preservation |
| Conflict resolution | Mediator UX (name/position collisions) | None when planting in fresh substrate; rare when targeting existing one |
| Bundle size | O(aggregates) | O(facts) — much larger for old realities |
| Authoring frequency | Common (every share is a replicate) | Rare (backups, migrations) |

**Why both are needed.** Replicates are the every-day primitive: small, fast, lossy-of-history but full-of-capability. Clones are the every-once-in-a-while primitive: large, slow, lossless. Conflating them muddies both. Reserving "clone" for the literal-copy case lets each name carry its intended weight.

**Implementation status:** Clones are not yet built. The substrate's commitment to event-sourced state makes them straightforward to add (export the chain; plant it on a target by replaying with consistent ID handling), but the use cases are less urgent than replicates. Build status: future phase, after replicate+graft has shipped.

## Build status

| Layer / capability | Status |
|---|---|
| Extensions (existing model) | shipped |
| Within-reality merge + conflict catalog + mediator | shipped (2026-06-04) |
| Heaven (reality-level metadata that never branches) | shipped |
| Pointers (`#main`, `#prod`) | shipped |
| **Typed Refs primitive** (`ref()`, `isRef()`, walker) | shipped (2026-06-04) |
| Subtree branching | shipped (2026-06-04) |
| Refs runtime manifest registry | **deleted** (2026-06-04) — was transition bridge; no runtime code consults it now |
| Refs migration sweep (seed ops + qualities → Refs) | Phase 1.6 (in flight) — backlog tracked in `seed/REFS_BACKLOG.md` |
| Asset content-addressing | not yet (Phase 3) |
| Replicates (replicate + graft) | not yet (Phase 4 + 5) |
| RoleFlows as first-class publishable (in Horizon) | not yet (Phase 6) |
| Horizon three-tab UX | not yet (Phase 7) |
| Cross-reality replicate flow | not yet (Phase 8) |
| Clones + plant (full fact-chain) | future (after replicates) |
| Reality forking | future direction |

## Build order

**Doctrinal commitment: there is no fallback path.** The substrate's identity primitive is typed Refs (`{ __ref: kind, id }`); there is one way to reference an aggregate, and bare-string IDs are not it. The legacy refs manifest exists as a temporary transition bridge while the seed's existing op handlers and qualities sites migrate; once the sweep is complete, the manifest is deleted. New code — seed or extension — uses `ref()` from day one. Builders never write a manifest entry.

This commitment is the same shape as `assertBranch` (no `|| "0"` defaults), heaven-never-branches (no exceptions), and address-as-identity (no separate identity field). Absolute doctrines hold their shape; fallback paths rot architectures.

### Phases

1. **~~Refs manifest registry~~** — shipped and then deleted on the same day (2026-06-04). The runtime registry was architectural overhead pretending to be a transition bridge; deleted before it could metastasize. No code consults it now. The seed inventory it once held is now markdown in `seed/REFS_BACKLOG.md`.

1.5. **Typed Refs primitive** — `ref()`, `isRef()`, `refKind()`, `refId()`, sentinels, walker (`findRefs`, `remapRefs`, `collectUniqueAggregateIds`). Shipped 2026-06-04. See `seed/REFS.md` for the doctrine.

1.6. **Refs migration sweep** — every seed action handler migrates to emit Ref-typed params; every qualities namespace stores Refs. Each migration is atomic per field (handler + reducer + storage + all consumers + tests). Backlog tracked as markdown in `seed/REFS_BACKLOG.md`; entries get checked off as fields migrate. **Required before Phase 4 (replicate) ships** so the graft layer can be Refs-only with no fallback. When the backlog reaches zero entries the file is deleted and the substrate is uniformly Ref-typed.

2. **Subtree branching** — shipped (2026-06-04). Branches scoped to a path; write gate at fact-emission boundary refuses out-of-scope writes; reads pass through.

3. **Asset content-addressing** — sha256 hashes for binaries; `.assets/<hash>` directory; `Matter.origin = "assets"` references by hash.

4. **Within-reality replicate** — `replicateSubtree(branch, scopePath, opts) → replicateBundle`. Walks projections (NOT chains). Snapshots current state with Refs throughout. Manifest of dependencies. Walker uses `findRefs` to discover what to remap.

5. **Within-reality graft** — `graftReplicate(bundle, targetParentPath) → graftedBranch`. Validates dependencies, resolves insertion point, detects conflicts via existing merge catalog, builds remap table, walker (`remapRefs`) substitutes placeholder Refs with new local Refs, stamps creation facts in dependency order, records `graft-completed` meta-fact.

6. **RoleFlow registry + install pipeline** — `.roleflows` heaven space, `install-roleflow` DO op, by-name references from beings, conflict detection on definition disagreement.

7. **Horizon three-tab UX** — manifest schema covers all three kinds (extension / roleflow / replicate), browse + install flows, dependency surface to operator, signing + hash verification.

8. **Cross-reality replicate flow** — IBP-carried bundles, canopy-advertised replicates, foreign-graft via the same graft operation.

9. **Clones + plant** (future phase) — full fact-chain export, planting into fresh substrate (or grafting into existing one with full-history option). Built on the same Ref primitive; the same merge mediator handles the rare collision cases.

## Smallest viable v1

Minimum-viable proof of the snapshot-and-graft doctrine:

- Refs manifest (#1) for the seed's own ops (extensions can contribute later)
- Replicate of a single being (projection + manifest)
- Stamp `birth-being` + `set-being` on graft (one fact per quality namespace)
- One conflict type (name collision in target's scope)
- Portal "save as replicate" / "graft a replicate here" buttons

Two weeks of focused work. Proves the doctrine. Everything else (subtrees, multi-aggregate, roleflows-as-publishable, Horizon tabs, cross-reality, eventually clone+plant) extends from there.

## What this does NOT cover

- **Live cross-reality summon** (a being in reality A directly invokes a being in reality B). Federation territory, separate protocol. Not in scope.
- **Code-bearing replicate grafts.** Replicates don't bundle code; extensions do. A replicate that needs new code surfaces a "this replicate requires extension X" install prompt; the operator installs the extension separately, then the graft proceeds against it.
