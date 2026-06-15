# MIRROR: the filesystem as projection of matter

> _"The path is a window. The bytes are matter."_

The mirror is the OS layer that exposes a slice of matter as a real
filesystem path. Code editors open it, Node imports from it,
compilers read from it, but no copy lives at the path. Every read
streams from localStore CAS through the matter row that owns the
hash; every write enters the verb system as an op on that matter and
the new bytes land in CAS before the write call returns. The path is
a live window onto the matter chain, not a copy of it.

Read alongside [ROOTS.md](ROOTS.md) (the network umbrella),
[RESOURCES.md](../../resources/RESOURCES.md) (the auto-anchor at
boot that made bytes canonically CAS), and the "place is folded from
facts" doctrine in [FACTORY.md](../FACTORY.md) (matter is the truth
of place; the mirror extends the same rule to disk).

## The inversion

Today the relationship runs disk → matter. Files on disk are the
source of truth; `./source` walks the checkout and writes matter
rows that mirror it; resource files exist on disk and are imported
from disk; any byte a being wants to operate on must already live as
a file. Matter is, in this direction, a cache of disk.

The mirror flips it. Matter is the source of truth; localStore CAS
holds the bytes; the path on disk is a FUSE mount (Linux),
[Dokany](https://dokan-dev.github.io/) mount (Windows), or
[macFUSE](https://osxfuse.github.io/) mount (Mac) whose `open` reads
stream bytes from CAS keyed by the matter row's content hash. The
file IS the matter, projected. No copy step. No "save back."

```
today              the mirror
-----              ----------
disk → matter      matter → disk
copy + sync        live projection
two truths         one truth
```

## What it unifies

Three patterns collapse into one.

1. **The source-mirror.** `./source` is a one-way disk → matter walk
   with a sanctioned doctrine exception (matter projected from disk
   instead of from facts, the only such aggregate). Under the mirror,
   `./source` retires. The repo files become matter at first boot
   (auto-anchor already puts the bytes in localStore); a mounted
   path renders them back to disk for editors and tools. The
   exception goes away because the direction goes away.

2. **The resource loader.** Today the loader walks
   `reality/resources/` and `import`s from filesystem paths. Under
   the mirror, resources live as matter and the loader points Node
   at the mounted path; Node's resolver sees a real path and works
   unchanged. Auto-anchor at boot remains the same act, just
   renamed: "first plant" instead of "first lockfile."

3. **Working files.** Any future "I want to operate on a file"
   pattern (a being editing a document, a build tool reading
   sources, a downloaded asset opened by a viewer) reuses the same
   mount. Beings do their ops on matter; tools see real paths. No
   separate working-copy machinery; no drift.

## The mechanic

A mount is a slice of matter (a root space, a single folder of
matter, anything addressable in matter) exposed at an OS path. The
FUSE layer answers four calls:

- `readdir` lists the children of the chosen matter folder.
- `getattr` returns size, mtime, and the cached mode from the matter
  row (the row knows it; no disk stat).
- `read` streams bytes by hash from localStore. The bytes are
  already there; the mount opens the CAS file and pipes the slice.
- `write` enters the verb system: `do:write-matter` (or its successor
  named for the matter type), which produces a fact, lands the new
  bytes in CAS through `contentStore.putContent`, and updates the
  matter row's content hash on fold. The write call returns when the
  fact is sealed.

Reads are free of the chain; writes go through it. The chain is
where authority lives; reads only need the byte that's already
addressable.

## Invalidation

When matter changes through a being op (not through the mount), the
mirror tells the kernel "the bytes at this path are stale." Editors
re-read; tools see the new content on next open. Standard FUSE
invalidate. The mount subscribes to matter facts the same way any
projection does; the moment a write-matter fact seals, the affected
path's inode is invalidated.

Two editors with the same path open see the matter chain's order.
Whichever fact seals first wins; the other sees the new bytes on
its next read and the user's editor offers a merge the way it
already does for external changes.

## The doctrine exception retires

`source.js` opens with a "SANCTIONED DOCTRINE EXCEPTION": source
matter is projected from disk instead of from facts, the one
aggregate family whose cache is disk-folded. The mirror removes
the cause. Source matter joins everything else: bytes in CAS,
facts in the chain, projection on read. The disk path is rendered
from matter the way every other projection is rendered. One rule
again.

## Sibling doctrine

The deepest invariant of the place is that the place is not stored,
it is folded from facts (`project_place_is_folded_from_facts` in
memory; see [FACTORY.md](../FACTORY.md)). The mirror extends the
same shape outward: the filesystem path is not stored, it is folded
from matter. Two rules in one shape: an observer asks for a view
(a place, a path), the system folds it from the canonical chain.
What looks like state at the boundary is a projection at the core.

## Status

Doctrine, not built. The pieces this rests on are already in:
localStore is the canonical byte home, auto-anchor at boot puts
every resource file there, contentStore serves bytes by hash. The
remaining work is the mount itself plus the retirement of
`./source` once the mount can render a checkout.

A staged path that keeps the reality bootable at every step:

1. **Read-only single-folder mount.** Mount one matter folder
   (a test space) at a path; prove `cat`, `readdir`, `import` all
   work against bytes that live only in CAS.
2. **Write-back through ops.** Add `write` and `truncate` so the
   path is editable; verify writes produce facts and the next read
   sees the new bytes.
3. **Invalidate-on-fact.** Wire the FS invalidation to matter
   fact seals so editors notice external edits.
4. **Anchor source into CAS, then mount it.** Same shape as
   resources: a boot pass `putContent`s every file the source walk
   discovers, source matter rows carry hash refs into localStore,
   then the mount renders source from matter the same way it
   renders resources. No "source reads straight from disk forever"
   exception; source rejoins the rule. `source.js` retires once
   the mount covers the surface it provided.
5. **Mount resources.** Point the loader at the mounted resource
   tree; remove the on-disk `reality/resources/` requirement.
6. **Mount localStore on demand.** Any matter folder can be
   mounted as a working path; the substrate for future
   filesystem-shaped flows.

## Open seams

- **Per-OS glue.** FUSE on Linux is mature; Windows wants Dokany;
  Mac wants macFUSE or a userspace alternative. The bytes path and
  matter API stay the same across all three; the mount layer is a
  thin OS adapter.
- **Hot-path latency.** A FUSE read adds a kernel round-trip vs a
  raw disk read. Acceptable for editors and import; worth measuring
  before pointing a build hot loop at the mount. A small in-process
  cache of recently-read hashes is the obvious lever if needed.
- **Write batching.** A series of small writes from an editor should
  not produce one fact per keystroke. Either the mount batches a
  window (debounce on close or N ms idle) or the verb accepts a
  "draft" mode that seals on flush. Decide when the second pattern
  appears.
- **Handle lifecycle.** A long-lived open file descriptor that
  outlives a matter delete: the mount can keep serving the cached
  hash until close, since CAS is content-addressed and the bytes are
  still there until retention reclaims them. Free correctness from
  the immutability of hashes.

## See also

- [RESOURCES.md](../../resources/RESOURCES.md) on the auto-anchor
  that already moved bytes into localStore.
- [FACTORY.md](../FACTORY.md) on "the place is folded from facts,"
  the sibling rule this extends.
- [contentStore.js](../../seed/materials/matter/contentStore.js) on
  the byte store the mount reads from.
- [source.js](../../seed/materials/space/source.js) on the
  doctrine exception this retires.
