# Refs — TreeOS's typed identity primitive

> *Anywhere the substrate carries an aggregate ID, the value is a tagged Ref, not a bare string. Cross-substrate operations (replicate, graft, mirror, future ops) detect refs by structure and remap them automatically. Builders use `ref()` to wrap IDs; the substrate handles the rest.*

## What this is

Every reference to a being, space, or matter in TreeOS goes through a single typed value: a **Ref**. A Ref is a tagged object that captures both *what kind of aggregate is referenced* and *which instance* — making ID-bearing fields self-describing wherever they appear.

```js
const aliceRef = ref("being", aliceId);
// → { __ref: "being", id: "abc-123-def" }

const libraryRef = ref("space", libraryId);
// → { __ref: "space", id: "456-789-ghi" }
```

This is the substrate's identity primitive. It replaces "ID-is-a-bare-string-and-you-have-to-know-which-strings-are-IDs" with "ID-is-a-tagged-value-and-the-substrate-knows-by-structure."

## Why typed Refs

The earlier model required every action handler and every qualities namespace to declare its ID-bearing fields in a manifest (`REFS_MANIFEST.md`). This works but creates a builder foot-gun: every extension author has to remember to declare; forgetting silently breaks replicate, graft, and any future cross-substrate operation.

Typed Refs eliminate the foot-gun:

- **Self-describing.** The substrate detects refs by structure. No manifest needed for the common case.
- **Compose freely.** Refs work inside arrays, objects, Maps, deeply nested qualities — anywhere the substrate's projection layer stores data.
- **Type-safe end-to-end.** A Ref's `__ref` field names its kind; the graft walker dispatches on that, not on which-string-might-be-an-ID guessing.
- **Builders learn one helper.** `ref(kind, id)` to create. `isRef(v)` to detect. That's the whole API surface most authors need.

## The Ref shape

A Ref is a plain object with exactly two required fields:

```js
{
  __ref: "being" | "space" | "matter" | "graft-initiator" | "insertion-point",
  id:    string  // omitted for sentinel kinds
}
```

Five kinds:

| Kind | Meaning | id required? |
|---|---|---|
| `"being"` | A being identity | yes |
| `"space"` | A space (position) | yes |
| `"matter"` | A matter (in-space content) | yes |
| `"graft-initiator"` | Sentinel: resolves to the operator running the graft | no |
| `"insertion-point"` | Sentinel: resolves to the operator-chosen target parent | no |

Sentinels are how the substrate expresses graft-time behavior in the export bundle. They serialize identically (`{ __ref: "graft-initiator" }`) and the graft walker resolves them via context, not the remap table.

## Public API

### Creating refs

```js
import { ref } from "./seed/materials/ref.js";

ref("being", aliceId);   // → { __ref: "being", id: aliceId }
ref("space", libraryId); // → { __ref: "space", id: libraryId }
ref("matter", bookId);   // → { __ref: "matter", id: bookId }
```

### Sentinels

```js
import { REF_GRAFT_INITIATOR, REF_INSERTION_POINT } from "./seed/materials/ref.js";

REF_GRAFT_INITIATOR;  // → { __ref: "graft-initiator" }
REF_INSERTION_POINT;  // → { __ref: "insertion-point" }
```

### Detection + accessors

```js
import { isRef, refKind, refId, isAggregateRef, isSentinelRef } from "./seed/materials/ref.js";

isRef(value)            // → true if value is any Ref shape
isAggregateRef(value)   // → true if a being/space/matter Ref (has an id)
isSentinelRef(value)    // → true if a graft-time sentinel (no id)
refKind(value)          // → "being" / "space" / "matter" / "graft-initiator" / "insertion-point"
refId(value)            // → the id, or null for sentinels
```

### Coercion

```js
import { coerceRef } from "./seed/materials/ref.js";

coerceRef(aliceId, "being");  // bare string + hint → ref
coerceRef(aliceRef, "being"); // already a ref → unchanged (kind verified)
```

Use `coerceRef` at substrate boundaries where legacy callers may still pass bare strings. Throws if the kind hint disagrees with an incoming Ref's kind.

### Walking + remapping

```js
import { findRefs, remapRefs } from "./seed/materials/refWalker.js";

// Collect every Ref in a value (deep)
const refs = findRefs(bundle);
// → [{ __ref: "being", id: "..." }, { __ref: "space", id: "..." }, ...]

// Substitute Refs via a callback (deep; structure preserved)
const remapped = remapRefs(bundle, (r) => {
  if (isSentinelRef(r)) return resolveSentinel(r);
  return ref(refKind(r), remapTable[refId(r)] || refId(r));
});
```

The walker handles plain objects, arrays, Maps, nested combinations. Primitives and `null` pass through unchanged. Refs are detected by their `__ref` field, not by path or schema.

## Where Refs go

The substrate's commitment is that **anywhere an aggregate ID would appear, a Ref appears instead**. Concretely:

- **Fact params.** When a fact references another aggregate, the params field carries a Ref. `set-being { value: ref("being", parentId) }` instead of bare string.
- **Qualities namespaces.** Stored values that reference aggregates are Refs. `qualities.connection.inhabitedBy = ref("being", id)`.
- **Schema-field writes.** `homeSpace`, `parentBeingId`, `position`, `rootOwner`, etc. all carry Refs in their stored value.
- **Manifest references inside replicates.** Export bundles use Refs throughout.
- **IBP envelope payloads** that carry IDs use Refs.

What stays a bare string:

- **Branch paths** (`"0"`, `"1a2"`) — these aren't aggregate IDs.
- **Reality domains** (`"treeos.example"`) — these aren't aggregate IDs.
- **Names** (role names, pointer names, world-signal namespaces) — name-keyed, not ID-keyed.
- **Stamp IDs / Act IDs / Session IDs** — substrate metadata, not user-facing aggregates.

## No fallback path

The substrate's identity primitive is typed Refs. There is one way to reference an aggregate. Bare-string IDs are not it.

The legacy refs manifest (REFS_MANIFEST.md) exists as a temporary transition bridge while the seed's existing op handlers and qualities sites migrate to Refs. **It is not the long-term substrate API; it is scheduled for deletion.** Once the migration sweep completes (publishing.md Phase 1.6), the manifest registry is removed and bare-string IDs in ID-bearing positions become a doctrinal violation.

This commitment is intentional. Fallback paths corrode systems:

- Two paths means two correct answers. Bugs proliferate at the seam.
- Builders have to know about both. Mixed conventions persist forever.
- The legacy path never goes away without forcing function.
- Doctrines become "mostly true with exceptions," which is the same as "not doctrines."

The substrate's strength is absolute doctrines (chain is truth, heaven never branches, identity is local, address is actor). Typed Refs joins that set: every aggregate reference is a Ref. Period.

**For builders during the transition:**

- Use `ref()` for all ID-bearing values in new code. Don't add manifest entries for new ops.
- The legacy seed handlers (`set-being`, `create-space`, etc.) still emit bare-string IDs during the transition — they will be swept in Phase 1.6.
- The graft layer ships only after the sweep completes. There is no "graft with fallback to manifest" stage.

The manifest's only permanent successor is the sentinel semantics — `<GRAFT_INITIATOR>` and `<INSERTION_POINT>` — which are graft-behavior markers, not ID kinds. After the sweep, these become explicit Ref sentinels (`REF_GRAFT_INITIATOR`, `REF_INSERTION_POINT`) and the manifest goes away.

## Implementation status

| Piece | Status |
|---|---|
| `Ref` type + helpers (`ref`, `isRef`, `refKind`, `refId`, sentinels) | shipped (2026-06-04) |
| Walker (`findRefs`, `remapRefs`) | pending (Phase 1.5 finish) |
| Legacy refs manifest registry | shipped, scheduled for deletion in Phase 1.6 |
| Migration sweep: seed ops emit Refs | next (Phase 1.6) |
| Migration sweep: qualities namespaces store Refs | next (Phase 1.6) |
| Manifest registry deletion | end of Phase 1.6 |
| Graft layer (Refs only, no fallback) | Phase 5 (after sweep) |

## Design choices

### Why `__ref` and not `__type` or `$kind`

- `__ref` reads as "this is a reference," which matches reader intent.
- Double-underscore prefix is a clear "substrate metadata" convention; nothing in user qualities will accidentally collide.
- The single shape `{ __ref, id }` is simple to detect with one predicate.

### Why a tagged object instead of a string prefix

Tagged objects survive serialization through every transport the substrate uses (JSON, BSON, IBP envelopes) without parsing tricks. String prefixes (`"@being:abc"`) would require every consumer to know the prefix convention; tagged objects are self-describing.

### Why kinds as a closed set

The substrate's three aggregates (being, space, matter) are doctrinal. Other kinds (acts, summons, facts) are substrate metadata, not user-facing references. Restricting Ref kinds to the three aggregates plus two sentinels prevents Refs from becoming a generic "I'm an ID of something" wrapper that loses its semantic punch.

### Why both `isRef` and `isAggregateRef`

`isRef` is the broad predicate — "this is any Ref shape." `isAggregateRef` is narrower — "this is a being/space/matter Ref with a remappable id." The graft walker uses the broad predicate to find candidates and the narrow one to decide whether to consult the remap table.

## Doctrinal pin

> **IDs are typed at the substrate level.** Every reference to a being, space, or matter is a `Ref`, not a bare string. The substrate detects refs by structure; cross-substrate operations (replicate, graft, future mirror, future deep-clone) consume them through the walker without per-action declarations. The legacy manifest (REFS_MANIFEST.md) remains as a fallback bridge for unmigrated ops and as the home for sentinel semantics; it is not the long-term substrate API.

## Migration guidance

When you're writing a new op or a new qualities namespace:

- Use `ref(kind, id)` for any ID-bearing field. Substrate handles the rest.
- Use sentinels (`REF_GRAFT_INITIATOR`, `REF_INSERTION_POINT`) for graft-time behavior.
- Don't touch the legacy refs manifest.

When you're updating an existing op or namespace during Phase 1.6:

- Migrate the field to Refs. Drop its manifest entry. You're done.
- If a migration is harder than expected (e.g., touches many consumers), split it into a separate PR — don't ship a partial migration that leaves some sites bare-string.

When you're reading data:

- Use `refKind` and `refId` to introspect. Don't pattern-match `__ref` directly.
- Use `coerceRef(value, kindHint)` at boundaries that receive incoming protocol payloads (HTTP/WS bodies). These are conversion-at-boundary points; inside the substrate, everything is already a Ref.
