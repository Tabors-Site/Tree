# treecas — the CAS content-byte store (Rust port)

Matter's content bytes, addressed by what they ARE: the SHA-256 of their bytes.
The chain holds facts ABOUT bytes (a content ref `{ kind:"cas", hash, size,
mimeType, name, encoding }`); the bytes themselves live HERE. This is the single
biggest genuine materials gap the rest of the port deferred — `treestore` is the
chain floor (reels + the stamp) but explicitly leaves the CAS content store to a
later phase. This crate is that phase.

Dependencies: `treehash` (SHA-256 + the JS-faithful JSON serializer) + std. No
other crates.

## On-disk layout (byte-compatible with the JS — JS + Rust share ONE CAS)

```
<root>/cas/<hash[0..2]>/<hash>            the bytes
<root>/cas/<hash[0..2]>/<hash>.meta.json  { mimeType, size, name }
```

- `<root>` is the localStore folder (the JS `localStoreFolder`); the crate joins
  `cas` onto it (the JS `CAS_ROOT`). The same `<root>` a `treestore` runtime uses
  for `reels/`, `past/`, etc. — one folder, all data + CAS together.
- `hash` = SHA-256 hex of the bytes, lowercase, 64 chars (via
  `treehash::sha256_hex`, the same primitive the JS `hashOf` uses). The two-hex
  shard keeps directory fan-out sane.
- The sidecar bytes are `JSON.stringify({ mimeType, size, name })` —
  **insertion order**, via `treehash::stringify` (the JS-faithful serializer). A
  null name serializes as `"name":null`, exactly as the JS writes. Verified
  byte-identical against Node `JSON.stringify` for both the text case
  (`{"mimeType":"text/plain; charset=utf-8","size":11,"name":null}`) and the
  binary/named case (`{"mimeType":"application/octet-stream","size":3,"name":"x.bin"}`).
- Hash strings are validated EVERYWHERE (`is_hash`: `/^[0-9a-f]{64}$/`). That is
  also the path-traversal guard: a hash can never name a path outside its shard.

### Writes (atomic)

Bytes land in a unique tmp file in the shard dir, then `rename` onto the final
name, then the shard dir is fsync'd. This mirrors `treestore`'s durable-write
discipline (fsync the file AND its directory) — one step further than the JS
(which is tmp + `fs.rename`, no dir fsync), but **RESULT-identical**: a
fully-written file at the final path, or nothing. The fsyncs change durability,
not bytes. The sidecar is first-put-wins (`create_new`): the first writer's
mimeType/name stick, and a sidecar-write failure is non-fatal (the JS
`.catch(() => {})`).

A crash between a put and the fact that references it leaves an unreferenced
blob; the retention sweep's grace period owns those — the write path never
deletes.

## API

### Content store (ports `contentStore.js`)

| fn | JS twin | notes |
| --- | --- | --- |
| `put_content(root, bytes, &Meta) -> ContentRef` | `putContent` | SHA-256 the bytes, atomic tmp+rename+fsync write + sidecar; idempotent (dedup hit returns the same ref, no second write). |
| `get_content(root, hash) -> Option<Vec<u8>>` | `getContent` | reads + **VALIDATES** the bytes still hash to the address (corrupt/tamper -> `CasError::BadHash`); `None` when absent (the JS null). See "Read-validation" below. |
| `has_content(root, hash) -> bool` | `hasContent` | cheap presence probe (no integrity read). |
| `stat_content(root, hash) -> Option<Stat>` | `statContent` | `{ size, mime_type, name }` from sidecar + fs size; `None` when absent. No `mtimeMs` field — the store API is clock-free (see "Clock"). |
| `delete_content(root, hash) -> bool` | `deleteContent` | removes blob (+ sidecar best-effort); idempotent; returns whether the blob was present. |
| `list_hashes(root) -> Vec<HashEntry>` | `listHashes` | `{ hash, size, mtime_ms }` per blob; tmp + `.meta.json` skipped. Materialized Vec (the JS is an async generator). |
| `read_content(root, hash, chunk_size, sink) -> bool` | `streamContent` | chunked reader (std-only stand-in for the Node read stream); `false` when absent. No re-hash (a stream is for serving bytes). |
| `hash_of(bytes) -> String` | `hashOf` | SHA-256 hex of the bytes. |

`Meta { mime_type, name, encoding }` plus `Meta::for_bytes(mime, name, encoding)`
applies the JS putContent defaults (utf8 -> `text/plain; charset=utf-8`, else
`application/octet-stream`).

`ContentRef { hash, size, mime_type, name, encoding }` is the structural ref the
chain needs. (The JS ref also carries an inline `preview` — the first slice of
utf8-decodable text, a descriptor convenience computed at put time, NOT part of
the on-disk layout. Preview generation stays in JS for now; readers re-derive it
off the bytes.)

### Retention sweep (ports the MECHANICS of `casSweep.js`)

```
sweep(root, referenced: &HashSet<String>, now_ms, grace_ms, max_deletions) -> SweepResult
sweep_entries(root, &[HashEntry], referenced, now_ms, grace_ms, max_deletions) -> SweepResult
```

The reference set is an **INPUT**, not re-derived. `casSweep.js` computes it two
ways — policy `"all"` (every fact's cas ref) and policy `"latest"` (every live
projection's current content) — by scanning the chain/projections. **That scan
is the JS runtime's job and stays in JS.** `treecas` takes the resulting
`referenced` set as a parameter and does only the disk side: walk the store,
delete every blob NOT in the set, respecting the safety furniture carried over
from the JS:

- **Grace**: blobs younger than `grace_ms` are spared (age = `now_ms -
  mtime_ms`) — a fresh blob may belong to a put whose fact hasn't sealed (the
  write path puts BEFORE the fact).
- **TOCTOU guard**: re-stat right before delete; skip if the blob vanished or its
  mtime moved since the walk (a concurrent re-put made it live again). Mirrors
  the JS `if (!recheck || recheck.mtimeMs !== mtimeMs) continue`.
- **Per-cycle cap** (`max_deletions`): at most N removals per call; the rest
  reclaim next cycle (`SweepResult.capped` flags the limit was hit).

`SweepResult { scanned, deleted, freed_bytes, capped, deleted_hashes }` mirrors
the JS `{ scanned, deleted, freedKB, capped }` (the JS `policy` field is dropped
— policy lives in the caller that built `referenced`; `deleted_hashes` is added
so the caller can audit which bytes went).

The JS armCasSweep / stopCasSweep (the fact-count trigger + commit observer that
DECIDE WHEN to sweep) stay in JS: that wiring is part of the JS runtime's commit
loop, not the disk mechanics. `treecas` provides the cycle; the runtime decides
the cadence.

### Anchor (ports `anchor.js`)

```
anchor(root, src_path) -> hash
anchor_ref(root, src_path) -> ContentRef
mime_from_name(name) -> String     // MIME_BY_EXT table
is_text_mime(mime) -> bool
```

Disk -> CAS ingestion: read the bytes on disk, derive mime + encoding from the
filename (the same `MIME_BY_EXT` table + `isTextMime` rules), put into the CAS,
return the hash (or full ref). The original filename is recorded as the ref /
sidecar `name`. (The JS `anchorFile` takes `putContent` as an injected dep so it
is usable before boot; the Rust crate calls `put_content` directly — same effect.
`anchorFolder` / `buildTreeBlob` — the walk + the merkle-over-sorted-pairs tree
manifest — are runtime/publish-flow concerns layered on top of `anchorFile`; they
stay in JS for now and can land here later as a thin layer over `anchor` +
`treehash`.)

### Errors

`CasError { BadHash(String), Io(std::io::Error) }` — a CAS op fails for exactly
two reasons: a malformed hash (the path-traversal guard, or a read-validation
mismatch) or a std::fs fault. Plain enum (std only, no error crate).

## Two intentional differences from the JS (both strict supersets)

1. **Read-validation.** The JS `getContent` trusts the path = the hash and does
   NOT re-hash on read. The port spec requires `get` to VALIDATE, so
   `get_content` re-hashes the bytes and rejects a mismatch (`CasError::BadHash`).
   This is a strict superset: a store the JS wrote correctly always passes; a
   tampered or corrupted blob now fails loudly instead of being returned. (The
   chunked `read_content` / stream path does NOT re-hash — it is for serving
   bytes, like the JS stream.)

2. **Directory fsync on write.** The JS write is tmp + `fs.rename`. The Rust
   write adds a shard-dir fsync after the rename (the same durability upgrade
   `treestore` made over `fileStore.js`). RESULT-identical bytes; stronger crash
   durability.

## Clock

The store is **clock-free for ordering**: no fact, no chain link, no sweep
DECISION depends on a world clock. The only time anywhere is:

- the tmp filename's uniqueness seed (a name that gets renamed away immediately —
  never observed, never ordered), and
- the grace freshness check, which is a relative `now_ms - mtime_ms` comparison
  against an OS file mtime (an OS file property, not a world clock). The JS reads
  `Date.now()` inside `sweepCas`; the port lifts that read to the CALLER
  (`sweep(..., now_ms, grace_ms, ...)`) so it is explicit and tests are
  deterministic. This mirrors what the JS actually does (a mtime-vs-cutoff
  comparison); the cutoff is a passed-in input, not a value the store invents.

The public `Stat` deliberately carries no mtime field (clock-free API); the
sweep's TOCTOU re-check uses an internal `restat_mtime` probe.

## What JS this replaces, and WHEN those files delete

These three JS modules are the source of truth this crate ports. **They are LIVE
in JS now — do NOT delete them.** They delete only at the JS-runtime cutover (the
point where the Rust runtime owns the CAS read/write path instead of Node), the
same staged cutover the rest of the port follows:

- `seed/materials/matter/contentStore.js` -> `src/store.rs`
- `seed/materials/matter/casSweep.js` -> `src/sweep.rs` (the sweep mechanics; the
  chain-scan that derives the reference set stays in JS even after cutover until
  the projection/fact enumeration also ports — `treecas` only ever takes the
  ref-set as input)
- `seed/materials/matter/anchor.js` -> `src/anchor.rs` (the `anchorFile` core;
  `anchorFolder` / `buildTreeBlob` stay in JS until their layer ports)

Until cutover, the JS modules and `treecas` write the **same bytes to the same
paths** (verified: same SHA-256 hash value, same sharded path, same sidecar
bytes), so a Rust process and the JS process can read and write one shared CAS
directory interchangeably.

## Tests

`tests/cas.rs` (7 tests, all green, std-only scratch dirs):

- `put_get_roundtrips_exact_bytes_and_dedups` — put -> get returns the exact
  bytes; the hash is the pinned SHA-256 literal; a re-put dedups.
- `stored_path_is_cas_shard_hash_with_sidecar` — bytes at `cas/<shard>/<hash>`;
  sidecar bytes == the JS `JSON.stringify` literal.
- `get_validates_hash_and_rejects_corruption` — corrupt the blob -> `get` errors;
  malformed hash strings rejected up front.
- `has_stat_list_delete` — has/stat (size+mime+name)/list (hashes only,
  sidecars+tmp skipped)/`read_content` chunked reassembly/delete (idempotent,
  sidecar removed, purged get -> None).
- `anchor_ingests_a_disk_file` — anchor a temp file -> hash, round-trips, mime +
  name from the filename.
- `sweep_deletes_unreferenced_keeps_referenced_and_respects_grace` — grace spares
  a fresh orphan; past grace the unreferenced blob is reclaimed and the
  referenced one is kept; idempotent re-sweep.
- `sweep_per_cycle_cap_limits_deletions` — the cap limits a cycle and flags
  `capped`; the next cycle reclaims the rest.
