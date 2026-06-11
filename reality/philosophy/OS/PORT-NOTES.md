# OS PORT NOTES — major open questions

_The side list from the 2026-06-11 top-level doctrine audit. The JS reality is the reference implementation the OS (Rust) port will largely copy. Everything below is either UNDECIDED or a JS-specific crutch the port must replace deliberately. None of these block the JS build; all of them need an answer before or during the port. Items are ordered by how structural the answer is._

---

## 1. Fact dates are wall-clock — ANSWERED (Tabor 2026-06-11), BUILT

The date was only ever a Mongo-era helper so humans can filter timelines; it is not structural AT ALL. Decision: the field stays on the row as a display witness, the identity does NOT commit to it — `contentOf` excludes `date` (hash.js). On the OS, display time comes off the kernel-set clock (like a Linux boot's timezone prompt); it never tracks truth. Consequence, by design: mutating a date is mutating a display helper, the chain stays intact (covered in the e2e).

## 2. Bytes over the wire (the HTTP carrier crutch) — ANSWERED (Tabor 2026-06-11)

On the OS, EVERYTHING is IBP: all cross-computer and local reality bytes/CAS traffic rides IBP natively. IBP sits at the SAME LAYER as HTTP — its peer protocol, not something carried inside it. HTTP/WS survive as edge TRANSLATORS: people who need to reach a website (or push IBP through an HTTP-only middlebox) wrap and unwrap at the boundary, but the inner protocol is always IBP. Expect most IBP machines to talk IBP directly; the Node server eventually becomes a partial reality that still talks to full-OS realities. Port work: native IBP content frames (chunked, hash-addressed); keep the two-step shape (bytes first, ref in the verb); the wire pipeline already passes binary untouched (verified), and ingestion stays at the wire boundary so bytes never land on the chain.

## 3. Summon intake stamps the whole entry — ANSWERED (Tabor 2026-06-11), unbuilt

Clarified reading: summon content doesn't ride a separate channel CAS misses — the delivery IS a fact (the inbox is a projection of summon facts), which is exactly where the content lands inline and where truncation bites. Decision: nothing should be truncated semantically. Oversized summon content ref-boxes into the content store (the fact carries the cas ref, like matter bytes); small messages stay inline for chat ergonomics. capPayload remains only as an absolute backstop until ref-boxing lands. Build item: threshold + ref-resolution in the read paths (scheduler pick, assemble, inbox panels).

## 4. Per-reel append locks are in-process — ANSWERED (Tabor 2026-06-11)

Decision: **one present per WORLD, where a world = a branch; one reality per computer, many branches.** This falls out of invariants already built, not a new mechanism:

- The branch point FREEZES the shared prefix: a child reads ancestors only below its branchPoint, ancestors append only above it (one seq space) — cross-branch reads can never race cross-branch writes, by construction. Per-branch presents need zero read coordination.
- Writes are already branch-local: reel chains, seq counters, and act-chains are all keyed per (branch, …). Today's per-reel lock is COARSER than the model requires (it serializes across branches unnecessarily); the OS can be more parallel than the JS, not less.
- Cross-branch acting (act seals on #0, fact lands on #2) becomes a MESSAGE to the target world's present — exactly the cross-reality shape already built (crossOrigin, attempted→landed, idempotent delivery dedup). Branch-present and reality-present unify: acting into another world is always a message to that world's present, whether it's a sibling branch or another computer. The JS's single cross-branch transaction is the implementation shortcut; the port adopts the message shape.
- "Process" is an implementation dial, not doctrine: one writer TASK per branch inside one OS process gives identical semantics; real processes buy crash isolation. The invariant is single-writer-per-world + per-(being, world)-serial moments.
- Shared across branches, safely: the content store (race-free by hash — same bytes, same address), and the branch registry/pointers, which are acts on the reality itself and belong to main's present.
- Seal atomicity within one world: the port's storage should make one WAL append BE the seal (replaces both the in-process lock and the Mongo replica-set transaction).

## 5. Acts are not content-addressed — ANSWERED (Tabor 2026-06-11), BUILT

"Acts should also be CAS — they are also chains." Built: an Act's `_id` is the hash of its OPENING (past/act/actHash.js), chained per (branch, being) via `p` and ActHead (advanced only where the row lands — sealAct and crossWorld's documented direct open — so crashed moments never enter the chain). Identity is minted at assign so the moment's facts can carry actId; the closure fields (status, endMessage, facadeSnapshot, answers) stay OUTSIDE the digest as mutable bookkeeping — the truth of what happened is the hash-chained facts. rootCorrelation is excluded (a parentless act is its own root — circular); wall-clock fields excluded per #1.

## 6. The reality root does not cover acts — ANSWERED (Tabor 2026-06-11), BUILT for acts

With acts content-addressed, "the reality root would literally cover everything": branch roll-ups now include act-chain heads alongside reel heads (chainRoots.js branchRollup carries `reels` AND `acts`), seeds capture/plant actHeads as core genome, and plant verification covers both chain families. Remaining luggage: extensionData collections (planted verbatim, unverified) — extensions own arbitrary collections, so either extensions declare hashable state or doctrine pins extension data as outside identity. Projections never need covering (caches of the fold by definition).

## 7. Source mirror is disk-folded, not chain-folded — ANSWERED (Tabor 2026-06-11), direction set

The mirror is acknowledged jank from copying the NodeJS checkout at boot. Direction: on NodeJS it should really be matter FACTS as files; on the OS the "source mirror" disappears as a special case entirely — it becomes the matter/beings that make USER SPACE boot, embedded in heaven, everything actually real. After the TreeOS shape lands, the full kernel converts: all files become matter, processes become beings. The JS disk-fold stays as a documented stopgap until then; the port should NOT copy it as a pattern.

## 8. Cross-world Act.create bypasses assign

Second sanctioned exception (documented in crossWorld.js): the local "I attempted this cross-reality call" Act is opened directly because the framed moment runs on the foreign substrate. Port choice: keep the exception or give cross-world dispatch a synthetic assign path so the presentism invariant has literally one opener.

## 9. BE is cherub-shaped and asymmetric — ANSWERED (see beFix.md)

The corrected model lives in [beFix.md](beFix.md); the earlier elaboration here was wrong in two ways. BE is the verb that acts on the LEFT stance (the actor mutates their own identity slot; every other verb operates on the right). Arrival is a REAL being — there is no "no-actor" case; single-stance addresses are sugar for `pos@arrival :: pos`, so authorize always has someone to evaluate. be:birth has no direct wire surface AT ALL: identity creation is `summon:mate` to a delegate (cherub for arrival, birther for authenticated callers) whose handler emits BE:birth via birthBeing — "skips the verb-level stamp" was a misread; birth never enters that seam. The remaining true asymmetry is centralization: the four wire BE ops enqueue on cherub (one identity-gate being) instead of the actor's own intake. The port unifies consciously or copies knowingly — beFix.md lays out both moves and their costs.

## 10. Branch-resolution precedence is duplicated

authorize() and the verb layer each resolve target branch with their own precedence chains. They agree today; nothing forces them to. Port: ONE shared branch-resolution primitive both call.

## 11. Roots are recomputed on demand with a TTL memo

branchRoot/realityRoot scan reelHeads per call (3s memo). Fine at dev scale; the port should maintain roots incrementally (update on append, the same place headHash is written) and treat the scan as the verifier, not the source.

## 12. Federation fetch-by-hash does not exist yet

Bundles carry blobs inline (capped, with an honest omission ledger). The pull-what's-missing protocol (compare roots → walk down → request hashes → verify on arrival) is designed but unbuilt. It is the natural sibling of casBlobs and the answer to omitted blobs and foreign-model rendering through ibpa portals. The negotiation surface (federation-manager's six intents) is where it slots.

## 13. Capability-URL content serving

`GET /content/:hash` is public-by-unguessable-URL. Fine for dev; the port needs SEE-gated serving (the role-walk deciding byte access) once realities hold private content. Tied to #2.

## 14. Branch deletion is a flag; purge is undefined

Deleted branches stay forensically intact and still count in the reality root. Physical purge of a branch (and its facts' blobs) is an explicit op that does not exist. Decide whether it ever should — purging facts contradicts PAST FIXED; the likely answer is "never; archive realities whole," but say it in doctrine.

## 15. Scope-branch reads vs writes asymmetry

Subtree-scoped branches refuse out-of-scope WRITES at the stamp boundary but reads inherit the parent transparently. The fold's per-branch caches and the scope rules interact in ways only lightly exercised. Port should treat branchScope as a first-class fact-emission gate with tests.

## 16. The word "substrate"

Standing style rule (Tabor): TreeOS prose should say spaces/matter/beings (the primitives) or name the storage backend, not "substrate." The codebase's comments use "substrate" pervasively from earlier eras. A mass rewrite is churn without behavior; the port is the natural place to write the prose clean. Flagging so the rule isn't lost.

## 17. JS-isms the port must not copy

- Mongo 16MB doc cap shapes capPayload's limits; pick caps from doctrine, not the engine.
- Mongoose Map/Object duality for qualities (serializeQualities everywhere) disappears with a real type system.
- `canon` (canonicalize) is a VERSIONED WIRE FORMAT — the Rust implementation must reproduce it byte-for-byte or all identities change at the border. Freeze it with a test-vector file before porting.
- The socket buffer (socketMaxBufferSize) and the 90s DO timeout are transport tuning, not protocol.
- Eager-fold is an optimization; the fold must stay correct without it (self-healing is the contract).

---

_Everything not listed here passed audit: four verbs one execution each, wire as thin adapter, SEE never stamps, only SUMMONs make SUMMONs, one fact stamper, reducers pure, no decision-bearing wall-clock outside the host furniture, append-only with compensating rollback, registry symmetry (after the loader unload fix), beings stateless across summons, roles as the single auth gate._
