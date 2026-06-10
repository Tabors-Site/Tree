# Refs — TreeOS's content-walking primitive

> _Refs exist for ONE job: walking arbitrary content to find aggregate references where the schema isn't accessible. That happens at three seams — replicate, clone, federation. Everywhere else, the schema knows what's an ID. Don't reach for Refs._

## What this is

A Ref is a tagged object that says "this field is a reference to an aggregate of kind K":

```js
ref("being", aliceId); // → { __ref: "being", id: "abc-123-def" }
ref("space", libraryId); // → { __ref: "space", id: "456-789-ghi" }
```

Refs are **NOT** the substrate's identity primitive. They are NOT the wire contract. They are NOT what handlers receive. They are NOT how rows store IDs.

Refs exist for the cases where code traverses content **without access to the originating schema**. That walker needs _some_ way to detect "this is an ID, this is just a string." The Ref tag is that signal. Outside those traversal seams, schemas are right there — handler logic, reducer code, projection field names. Use them. Pass bare IDs.

## When Refs earn their place

Three seams in the substrate, and only these:

1. **Replicate** — `seed/done/Chain-Rebuild.md`. Snapshot a tree of content, hand it to a new substrate, recreate it with a fresh ID namespace. The replicator walks the content tree, finds every aggregate reference, remaps to the new substrate's IDs. Without Refs the walker can't tell "is this string an ID or just a name?"

2. **Clone / mitosis** (future) — exact-copy a tree of content into another substrate, preserving full fact/act history. Same walker, different remap policy (identity vs new-namespace).

3. **Federation** (future, see `protocols/ibp/FEDERATION.md` Diff B) — when content from another reality enters our substrate via grafted facts, the walker remaps the foreign IDs into local namespace. Federation propagates facts (not beings or live state); the foreign IDs in those facts get remapped at the boundary.

That's the entire load. The walker is the keeper. Refs exist to serve the walker.

## What the substrate does NOT do with Refs

- **Storage** doesn't store IDs as Refs (with rare transitional exceptions during the lazy cleanup of Phase 1.6's over-reach; see history).
- **Handlers** don't refuse bare IDs. `set-being { field: "position", value: "abc-123" }` is the normal shape.
- **Reducers** don't write Refs to projection state.
- **Wire / portal** doesn't wrap IDs in `ref()` before sending. Portal sends bare IDs and names; the wire resolves names to IDs.
- **Mongo queries** don't filter on `.id` subpaths.
- **Indexes** are on the bare field, not `field.id`.

If you find yourself writing code that wraps a bare ID in `ref()` because "the substrate expects Refs," stop. The substrate doesn't. Pass the bare ID.

## The walker — public API

```js
import { findRefs, remapRefs } from "./seed/materials/refWalker.js";

// Collect every Ref in a value (deep)
const refs = findRefs(bundle);

// Substitute Refs via a callback (deep; structure preserved)
const remapped = remapRefs(bundle, (r) => {
  if (isSentinelRef(r)) return resolveSentinel(r);
  return ref(refKind(r), remapTable[refId(r)] || refId(r));
});
```

`findRefs` and `remapRefs` operate on plain objects, arrays, Maps, nested combinations. Refs are detected by the `__ref` shape.

Helpers for content that doesn't yet carry Refs (an export from a bare-ID substrate): the walker accepts a **manifest** — a configuration that says "in this content shape, the field at path X is a being-Ref" — and applies the Ref interpretation during walk. The manifest is walker configuration, not a runtime validator. Define the manifest only when you're building a content-export or content-import pipeline.

## Ref shape

```js
{
  __ref: "being" | "space" | "matter" | "graft-initiator" | "insertion-point",
  id:    string  // omitted for sentinel kinds
}
```

Five kinds. Three name aggregates (being / space / matter). Two are graft sentinels.

| Kind                | Meaning                                                 | id required? |
| ------------------- | ------------------------------------------------------- | ------------ |
| `"being"`           | A being identity                                        | yes          |
| `"space"`           | A space (position)                                      | yes          |
| `"matter"`          | A matter (in-space content)                             | yes          |
| `"graft-initiator"` | Sentinel: resolves to the operator running the graft    | no           |
| `"insertion-point"` | Sentinel: resolves to the operator-chosen target parent | no           |

Sentinels serialize as Refs and the graft walker resolves them via context, not the remap table.

## Helper API (for walker authors)

```js
import {
  ref,
  isRef,
  refKind,
  refId,
  isAggregateRef,
  isSentinelRef,
} from "./seed/materials/ref.js";

ref("being", id); // construct
isRef(value); // any Ref shape
isAggregateRef(value); // being/space/matter (has id)
isSentinelRef(value); // graft-time (no id)
refKind(value); // "being" / "space" / ...
refId(value); // the id, or null for sentinels or non-Refs
```

`refId` is tolerant — it accepts bare strings and passes them through. This is intentional: callers that read possibly-mixed data (during the lazy storage cleanup) don't need to branch.

## Why this scope

A type tag earns its place when the **consumer** of the data lacks access to a schema. Storage rows have schemas. Handlers have schemas (they know which field they're writing). Reducers have schemas (they know what they write to). Wire dispatchers have op contracts. None of them need a tag — they already know.

The walker is the only consumer that genuinely lacks schema knowledge. The content it walks could come from any substrate version, any extension's qualities namespace, any future ID-bearing field. The tag is what makes that walk possible without a per-substrate-version dispatch.

Tagging IDs everywhere else was over-engineering: scaffolding around the walker that didn't need to be there. The substrate's actual identity model is — and always was — schema-derived. Refs are the federation primitive that lets cross-substrate operations work; they are not the substrate's identity primitive.

## History

Phase 1.6 (2026-06-04) initially migrated every ID-bearing field in the substrate to typed Refs, including handler-side strict validation that refused bare strings. This was over-scoped: the substrate's handlers already knew what kind each field was via their own logic and didn't need the tags. The strictness was rolled back the same day; the walker primitive and Ref helpers stayed. The doctrine was sharpened to its current scope: Refs are content-walking, not substrate-internal.

The completed schema-field migrations (handlers, queries, indexes flipped to `.id` subpaths) get rolled back over time — handlers accept bare IDs again, queries use bare paths, Mongoose schemas drift back to `String` as files are touched for other reasons. Storage may contain stale Refs from the migration period; `refId()` is tolerant of both shapes so consumers read either way.

## Doctrinal pin

> **Refs are a content-walking primitive, not a type system.** They appear at three seams — replicate, clone, federation — where code traverses content without access to the originating schema. The walker (`findRefs` / `remapRefs`) is the substrate's federation primitive; the Ref type exists to serve that walker. Everywhere else in the substrate, schemas know types and bare IDs flow through.

## See also

- `seed/materials/ref.js` — Ref type + helpers
- `seed/materials/refWalker.js` — `findRefs`, `remapRefs`
- `seed/done/Chain-Rebuild.md` — replicate/graft semantics where Refs are used
- `protocols/ibp/FEDERATION.md` — federation Diff B, where Refs cross substrates
