# treehost — the HOST SEE-OP BRIDGE

`treehost` ports the `*Host.js` resolver bodies (the floor `see resolve-X` ops the materials
act-handlers reach for) to native Rust, behind an **injectable dispatch seam** (the `HostResolver`
trait), composing the past-engine crates. It does **not** touch `treeibp` / `treeval` / `treeword` /
`treeos`. Wiring it into `treeibp::run_body` is a small, additive, coordinated handoff (this file's
last section).

## Why this crate exists (the gap the assessment found)

The materials act-handlers are **WORD-SOLE**: each `.word`
(`set-being.word` / `set-space.word` / `create.word` / `end-space.word` / `set-matter.word` /
`create-matter.word`) is the ONLY path. Its CONTROL strand is the `.word`; its genuine substrate
**reads** bottom out in a host see-op, `see resolve-X(args) as bind` — the strand the JS floor
(`*Host.js`) carried. Example (`set-being.word`):

```
When a being sets a field on a being:
  If no field, refuse with "set-being: `field` is required".
  see resolve-set-being-spec(target, field, value, merge, branch) as spec.
  Return beingId: $spec.beingId, factParams: $spec.factParams.
```

The authorize / able-walk is ALREADY in Rust (`treeval::able` + `treeibp::authorize`). The real gap:
**`treeibp::run_body` does not evaluate `see resolve-X(args) as bind` nodes.** `treeword` parses them
to `{ kind: "see", act: "resolve-X", args: [...], bind: "..." }` (treeword/src/lib.rs, the
`see <op>(<args>) as <bind>` rule), but `run_body`'s match has arms for `act / if / while / foreach /
match / flow` and **no `see` arm** — so the node is silently skipped, `$spec` never binds, and the
`.word` cannot execute end-to-end.

`treehost` IS those resolver bodies, ready for `run_body` to call.

## What it ports (the substrate READ + VALIDATION, not the host I/O)

Each resolver: `(root, history, args, ctx: &AuthCtx) -> Result<Json spec, HostError>`. It **validates**
(name-collision → err, coord-out-of-bounds → err, CAS-missing → err, already-deleted → err,
unknown-type → err, unknown-field → err) and **returns the fact spec** the dispatcher stamps —
byte-compatible with the JS host's returned block. It lays **no fact** and mutates nothing: it is a READ.

| Rust resolver | JS host body | see-op name(s) |
|---|---|---|
| `resolve_set_being_spec`  | `setBeingHost.js`  | `resolve-set-being-spec`  |
| `resolve_set_space_spec`  | `setSpaceHost.js`  | `resolve-set-space-spec`  |
| `resolve_create_space`    | `spaceHost.js` (`spaces.js resolveBirthSpace`) | `resolve-birth-space` |
| `resolve_end_space_spec`  | `endSpaceHost.js` (`spaces.js deleteSpaceHistory`) | `resolve-end-space-spec` |
| `resolve_set_matter_spec` | `setMatterHost.js` | `resolve-set-matter-spec` |
| `resolve_create_matter`   | `matterHost.js` (`resolveBirthSpec`) | `resolve-birth-spec` |
| `resolve_birth_being`     | `identity/birth.js` (`birthBeing`, validation + spec half) | `resolve-birth-being` |
| `resolve_move`            | `moveHost.js` | `resolve-source` |
| `resolve_rename_matter`   | `renameMatterHost.js` | `resolve-rename-spec` |
| `resolve_purge`           | `purgeContentHost.js` | `resolve-purge` |
| `resolve_inheritation`    | `inheritationHost.js` | `resolve-inheritation` |
| `resolve_owner`           | `ownerHost.js` | `space-id-of`, `may-set-owner`, `may-remove-owner` |
| `resolve_grant`           | `grantHost.js` | `able-exists` |
| `resolve_kill`            | `killHost.js` (cherub `be:kill`) | `resolve-target-being` |
| `resolve_switch`          | `switchHost.js` (cherub `be:switch`) | `destination-missing`, `destination-paused`, `being-lives-on` |
| `resolve_truename`        | `truenameHost.js` (cherub `be:truename`) | `resolve-name-id`, `name-exists`, `name-banished` |
| `resolve_end_matter`      | `endMatterHost.js` | `resolve-end-matter-spec` |
| `resolve_config_set` / `resolve_config_delete` | `storyConfig.js` (`configHostEnv`) | `resolve-config-set`, `resolve-config-delete` |
| `may_set_model` / `resolve_model_block` | `modelHost.js` | `may-set-model`, `resolve-model-block` |
| `resolve_set_being_flow_spec` | `setBeingFlowHost.js` | `resolve-set-being-flow-spec` |
| `validate_render_block`   | `setRenderHost.js` (`setRender.js validateRenderBlock`) | `validate-render-block` |
| `resolve_containing_space`| `portalHost.js` | `resolve-containing-space` |
| world-signal computes     | `set-world-signal/index.js` (`ableManagerHostEnv`) | `valid-namespace`, `valid-key`, `parse-signal-value`, `signal-field`, `signal-fact`, `story-root` |

### PART 3 — the substrate composite resolvers (the remaining floor reads, ported)

The second batch of substrate-read see-ops the live `.word` vocabulary invokes. Each is a pure
read/validation composing the past-engine crates + the refined `HostError`; each lays NO fact.

- **`resolve_end_matter`** (`resolve-end-matter-spec`): load the matter row, gate AUTHOR-or-ROOT-OWNER
  (the author always may; a non-author may only when they own the matter's tree ROOT — `resolve_root_owner`
  on the matter's `spaceId`; the heaven boundary / a broken tree yields no owner and the author rule
  decides). `Unauthorized` (no caller), `Forbidden` (neither). Returns `{ matterId, factParams:{} }` — the
  verb carries no params; the reducer derives the tombstone from the verb. The `caller` is the .word's
  standard-trigger arg (NOT the `AuthCtx` — the JS host read `caller` directly).
- **`resolve_config_set` / `resolve_config_delete`** (`resolve-config-set` / `resolve-config-delete`): the
  story-config validate-and-author. `validateKey` (`/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/` + the DANGEROUS_KEYS
  reserved set), value-required (set only), `validateValue` (the 65536-byte cap — measured over
  `treehash::canonicalize`, a faithful upper-bound twin of `JSON.stringify().length` for the sanity cap),
  and the PROTECTED_KEYS gate (`seedVersion` / `disabledExtensions` are scaffold-only; the I-Am writes
  them via `is_internal` = `ctx.is_i` OR `caller`/`actor_being_id` is an I-name; others refused). Returns
  `{ key[, value], factParams:{ key[, value] } }` — the config-set/delete NAME-ACT's bodiless params. The
  JS threw plain `Error`s here (not IbpError); the refusal maps to `InvalidInput`. The cache `after-name-act`
  refresh + the actual 5D NAME-ACT seal stay caller-side.
- **`may_set_model` / `resolve_model_block`** (`may-set-model` / `resolve-model-block`): the set-model
  CONFIG read (a matter fold + content gate, NOT running an LLM). `may_set_model` is the per-kind
  self/author/owner auth READ (being self / matter author / space owner / tree owner via `resolve_root_owner`)
  — a bool, no throw (the .word refuses forbidden on false). `resolve_model_block` branches on `clear`:
  SET resolves the model MATTER (exists, type "model", live non-purged cas bytes — else `InvalidInput`),
  snapshots `{ matterId, hash, url:"/api/v1/content/<hash>", name }`, and builds the set-<kind>
  `{ field, value, merge }` (a per-type space default at the deep `qualities.render.matterModels.<type>`
  path with the `forMatterType` gate — space-only + a known seed type via `matter::type_known`, the SAME
  deferral create-matter makes for `ext:<type>`; else the entity-level `qualities.render` patch with the
  optional positive scale + rotation object). CLEAR nulls the model at its field path.
- **`resolve_set_being_flow_spec`** (`resolve-set-being-flow-spec`): resolve the target being (explicit
  `params.beingId` wins, else the `{kind:"being",id}` verb target — `InvalidInput` on neither), validate
  the flow CLAUSE ARRAY (every clause an object with a non-empty `able`; normalize each to
  `{ able[, when][, stack:true] }`, dropping unknown keys), and return
  `{ beingId, factParams:{ field:"qualities.flow", value:<clauses>, merge:false }, clauseCount }`. The JS
  able-registry READ for the non-fatal `unknownAbles` warning is DEFERRED (the Rust able-word fold is not
  yet ported; the warning is non-fatal and a live-authored able clears it — the SAME deferral grant's
  `able-exists` makes); the clause-SHAPE validation (the substance) is ported EXACTLY.
- **`validate_render_block`** (`validate-render-block`): validate the target KIND (matter|space|being) +
  the render block (reject unknown top-level keys; model = non-empty string OR object with string
  matterId/url; positive finite scale; rotation `{x,y,z}` finite; animations/sounds objects of
  `{factAction: non-empty-string}`), then shape `{ field:"qualities.render", value, merge }` (merge default
  true unless `merge:false`). A pure compute; `InvalidInput` on every bad shape.
- **`resolve_containing_space`** (`resolve-containing-space`): the portal floor read — a space target IS
  its own containing space; a matter target's space is its folded `spaceId` (a by-id matter LOAD). Null on
  a matter with no space / a target of neither kind (the .word refuses on a falsy result). portal.word's
  other see-ops (`has-address` / `valid-address`) are IBPA-shape regex checks the Word grammar expresses
  as conditions — not ported, not needed.
- **world-signal computes** (`valid-namespace` / `valid-key` / `parse-signal-value` / `signal-field` /
  `signal-fact` / `story-root`): the kebab gates (`/^[a-z][a-z0-9-]*$/` per segment), the value coercion
  (parseSignalValue: JSON / bare-number / true|false|null), the dynamic field path
  `qualities.world.<ns>.<key>`, the do:set-space fact params, and the STORY ROOT id. `story_root` composes
  `toolkit::story_root_id` (discover the `heavenSpace == "space-root"` space on disk — the JS keeps it in
  process memory; the bridge reads it from the store).

### The remaining resolvers (PART 2 of the build) and their substrate reads

- **`resolve_move`** (`resolve-source`): the move op's one host escape. `move.word` carries the four old
  param validators as native gates; this is the multi-step projection READ a `see` cannot yet shape:
  container-mode dest-exists (`SpaceNotFound`), capture the source space (the subject's `parent` / its
  `spaceId`, null on the DELETED sentinel) as the `fromSpaceId` the fact records, and the coord-bounds
  check against the container's `size` (`CoordOutOfBounds`, THROW not clamp). Returns the `fromSpaceId`
  scalar move.word binds.
- **`resolve_rename_matter`** (`resolve-rename-spec`): load the matter, require its `spaceId`, run the
  per-(spaceId, parentMatterId) FOLDER name-uniqueness (case-insensitive, own current name excluded, an
  `allowReplace` bypass). Returns `{ matterId, name }`. Reuses the toolkit's `folder_matter_names`
  (`listMatterNamesInFolder`), now shared with create-matter's generated-name floor.
- **`resolve_purge`** (`resolve-purge`): load the matter, resolve the hash (explicit arg or the current
  cas ref), the author-or-root-owner auth gate (`resolve_root_owner` walks the parent chain on "0" for
  the nearest non-I owner; `Forbidden` on a miss), and the SHARED-FATE refcount over the dedup'd hash
  (`find_matter_by_content_hash` across the live histories; `ResourceConflict` without `force`). Returns
  `{ matterId, hash, sharedReferents, factParams:{hash,force,referents} }`. The post-seal physical
  `deleteContent` stays caller-side host I/O (the FACT-FIRST afterSeal hook); the bridge ports the
  validation + the refcount read.
- **`resolve_inheritation`** (`resolve-inheritation`): the acting Name (the `AuthCtx` actor; `Unauthorized`
  absent), grant-only declared+not-banished gate over the library names catalog (`InvalidInput` /
  `Forbidden`), and `has_authority_over(actingName, position)` (`Forbidden`). I is universal authority.
  Returns `{ position, factParams:{name}, grantedBy|revokedBy }`. `has_authority_over` walks the
  being-tree up via `parentBeingId`, anchoring on `trueName` ownership + a live inheritation point
  (latest grant-vs-revoke by chain seq on the position being's reel).
- **`resolve_owner`** (the ownerHost.js family): `space-id-of` (a space target / a stance's `.spaceId`),
  `may-set-owner` (not heaven, not already that owner, current-owner reassign OR the parent's resolved
  owner approves a claim), `may-remove-owner` (not heaven, a non-I owner exists, a parent exists, the
  parent's resolved owner approves). Each returns a scalar (id / bool). The owner ops are COMPOSITES: the
  write is a `do set-space` leaf, so these are PURE READS, no own-fact.
- **`resolve_grant`** (`able-exists`): the able-registry lookup. The JS registry FOLDS from the able-words
  ("all rules fold"); the Rust able-word fold is not yet ported, so the bridge validates the able is a
  well-formed non-empty kebab identifier (the gate SHAPE) and defers registry-membership to the fold, the
  SAME deferral create-matter's extension-type gate makes.
- **`resolve_kill` / `resolve_switch` / `resolve_truename`** (the cherub `be:` hosts): irreducible reads
  the verb's control strand reaches through `see`; the kill/switch/truename AUTHORITY is the verb's
  able-walk (the `AuthCtx` input), never a floor read. `resolve-target-being` = `findByName("being")` on
  the act's history (no silent "0"). `destination-missing/paused` read the on-disk history row
  (`treestore::load_history`'s `deleted`/`paused`; main is always live, never paused). `being-lives-on`
  folds the caller's reel to a living birth (a name + not `qualities.dead`). `resolve-name-id` classifies
  the token ("i-am" literal / a z-prefixed key id / else `findByName("name")` on main). `name-exists` /
  `name-banished` read the library catalog entry (`declared` / `closed`).
- **`resolve_birth_being`** (`resolve-birth-being`): the VALIDATION + SPEC half of `identity/birth.js`
  `birthBeing`. Validates the birth and returns `{ beingId, factParams }` — the be:birth fact's params,
  MINUS the credential `password`. The gates, in order: name shape (`/^[a-zA-Z0-9_-]{1,32}$/`,
  `InvalidInput`); parentBeingId present + the parent EXISTS (`load_row`; `BeingNotFound` on a dangling
  ref); the MOTHER carries a `trueName` (the being expresses the name that births it; no fallback,
  `InvalidInput`); the BIRTH-GATE inheritation (`has_authority_over` via the `AuthCtx` MINTER — I /
  root / self-birth bypass; `Forbidden` when the minting Name does not cover the parent position, a
  live inheritation point on the position covers it); the SOVEREIGN OVERRIDE (an explicit
  `spec.trueName` must be `name_declared` + not `name_banished`); name-uniqueness (`name_unique`;
  `NameCollision`); coord pick / bounds (an explicit `coord` is bounds-checked against the position
  space's size, `CoordOutOfBounds`; an absent coord is auto-picked in-bounds when the space has a
  positive (x,y) size — DETERMINISTIC from a hash of `(position, name)`, since a resolver READ is
  reproducible and the bounds gate, not the spread, is the invariant). The content-addressed being id
  is `being_content_id({parentBeingId, name, homeHistory, bornAt})` — byte-identical to `beingId.js`
  (`bornAt` is the be:birth act id the caller threads in `spec.bornAt`). `homeHistory` = the stamping
  history.
  - **HOST / seal DEFERRALS (NOT this resolver):** the CREDENTIAL keypair / password mint
    (`mintCredentialSpec` — bcrypt hash + encrypted plaintext, crypto I/O the seal performs; a clean
    `treesign` call only mints a Name keypair, and a being holds NO key — its identity is the Name it
    expresses, so there is nothing for `treesign` to mint here, hence the seal carries the whole
    credential step); the parent-able INHERITANCE grants (`_inheritParentAbles`, its own afterSeal
    moments); the global ANOINT (`_anointGlobal`, its own afterSeal moment). The resolver carries the
    caller's `qualities` verbatim (the auth/cognition/flow seeds the JS merged are seal / caller
    concerns).

## The refined ERROR SYSTEM (PART 1 of the build): `HostError { reason: Reason, message: String }`

The JS error taxonomy lived in two stringly-typed places: `seed/ibp/protocol.js` `IBP_ERR` (the
SCREAMING_SNAKE wire codes the verb dispatcher throws) and the `.word` refusal tail
`refuse with "..." as <reason>` (the kebab `as <reason>` set the WORD-SOLE handlers carry). The refined
`HostError` is a CLEAN typed pair: a `reason: Reason` (a real Rust enum, deduped + grouped) and a
`message: String` (the human refusal the JS host threw, byte-matched). `reason.code()` -> the STABLE
kebab string the wire / `.word` refusal carries, so a wired `run_body` surfaces a value-identical denial;
`Reason::from_code` is the round-trip inverse (an unknown code -> `Internal`, the JS `code || INTERNAL`).
`Display` of a `HostError` is its `message`; named constructors (`HostError::invalid` / `name_taken` /
`coord_out_of_bounds` / `unauthorized` / `forbidden` / `unknown_type` / ...) build the right reason + the
exact prior refusal text, so the existing six resolvers + the 15 prior tests changed only their error
SHAPE (now `err.reason == Reason::X`), not their messages.

`Reason` and its `code()` (the JS source each groups):

| `Reason` | `code()` | JS source(s) |
|---|---|---|
| `Unauthorized`     | `unauthorized`        | `IBP_ERR.UNAUTHORIZED`; `.word` `as unauthorized` (auth ABSENT) |
| `Forbidden`        | `forbidden`           | `IBP_ERR.FORBIDDEN`; `.word` `as forbidden` (auth present, DENIED) |
| `InvalidInput`     | `invalid-input`       | `IBP_ERR.INVALID_INPUT` / `INVALID_TYPE`; `.word` `as invalid-input` |
| `BeingNotFound`    | `being-not-found`     | `IBP_ERR.BEING_NOT_FOUND`; `.word` `as being-not-found` |
| `SpaceNotFound`    | `space-not-found`     | `IBP_ERR.SPACE_NOT_FOUND` |
| `NameNotFound`     | `name-not-found`      | `IBP_ERR.NAME_NOT_FOUND` |
| `NameCollision`    | `name-collision`      | the findByName collision (JS `RESOURCE_CONFLICT` / `INVALID_INPUT`, refined to one reason) |
| `AlreadyDeleted`   | `already-deleted`     | the soft-delete sentinel refusal |
| `CoordOutOfBounds` | `coord-out-of-bounds` | the clamp THROW (assertCoordWithinSize) |
| `UnknownType`      | `unknown-type`        | the type-registry gate (`IBP_ERR.INVALID_TYPE`) |
| `UnknownContent`   | `unknown-content`     | hasContent false (a fact must not reference missing bytes) |
| `MissingTarget`    | `missing-target`      | the "... target required" refusals |
| `ResourceConflict` | `resource-conflict`   | `IBP_ERR.RESOURCE_CONFLICT` (purge's shared-fate refcount) |
| `StoryPaused`      | `story-paused`        | `IBP_ERR.STORY_PAUSED`; `.word` `as story-paused` |
| `BranchNotFound`   | `branch-not-found`    | `IBP_ERR.BRANCH_NOT_FOUND` (a corrupt cross-history lineage) |
| `Internal`         | `internal`            | `IBP_ERR.INTERNAL` (the fallback) |

### The common toolkit (`toolkit.rs`) — composes, never reimplements

- `load_row(root, history, kind, id)` — `loadTargetRow` / `loadOrFold`: `treeproj::refold`
  (read reel via `treestore` → fold via `treefold` → cache the `.proj`) → the folded `state` (with `_id`).
- `name_unique(root, history, kind, name, scope, exclude_id)` — `findByName` (cross-history): composes
  `treeproj::lineage::find_by_name` (own-history index, then the branchPoint-gated, shadow-respecting
  parent walk). `scope` keys the per-kind uniqueness (space → `parent`, matter → `spaceId` +
  `parentMatterId`); beings are global (empty scope).
- `being_coord_in_bounds` / `matter_coord_in_bounds` — `assertCoordInBounds` /
  `assertMatterCoordInBounds`: load the containing Space's `size`, run the two-way cell-vs-position
  bounds math (`f64::EPSILON` == JS `Number.EPSILON`), THROW out-of-bounds (the chain stays honest).
- `cas_exists(root, hash)` — `hasContent`: composes `treecas::has_content` (the sharded existence
  check). `is_cas_ref` mirrors `contentStore.js isCasRef`.
- `is_deleted` + `DELETED` ("deleted") — the soft-delete sentinel (heavenSpaces.js).
- `matter_content_id` — `matterId.js matterContentId`: sha256 of the canonicalized birth identity
  (`treehash::canonicalize` + `sha256_hex`), byte-identical field set + defaults.

### AUTHORITY is an INPUT, not a dependency

`treehost` does **not** dep `treeibp` / `treeval`. The authority verdict (the able-walk result, the
owner/not-root check, the actor's `beingId`) arrives as **`AuthCtx`** — mirroring the existing
`able_spec_of: impl Fn(&str) -> Option<Json>` and `host: &dyn Fn(...)` injection seams. The resolvers
TRUST it (the `.word` comments say so: "Authorization is the verb dispatcher's able-walk; this trusts
it"). `AuthCtx { actor_being_id, authorized, is_i }`:
- `actor_being_id` — the creator (create-matter / create-space) + the deleter (end-space). `caller("be")`.
- `authorized` — the able-walk verdict; `resolve_end_space_spec` refuses on it (owner/not-root) unless `is_i`.
- `is_i` — the genesis / boot-mirror identity that bypasses the `beingId !== I` gates (`i_am()`).

## The deferred refinements (the host I/O the JS keeps; not the substrate read)

These stay caller-side / JS for now (the bridge ports the **validation**, not the host I/O — exactly
the cut the JS `.word` made: "the host throws; this validates and RETURNS"):

- **content PUT** (`putContent`) on a string create-matter content: the bridge validates the type
  allows `text` and returns the raw string as content; the **caller's host emit** does the `putContent`.
  A `{kind:"cas"}` ref is verified to EXIST (the read), which is the byte-correctness gate.
- **the parent-lock + max-children check + heaven-parent gate + `beforeSpaceCreate/Delete` hooks** in
  `resolveBirthSpace` / `deleteSpaceHistory`: those are I/O concurrency + extension concerns, not a
  substrate read. The SUBSTRATE validation (name/type/size, coord-bounds, already-deleted) is here.
- **the space-type + max-space-size registry**: `space.rs` carries the seed basic set + a `1000`/axis
  default cap; a config follow-up can thread a real `config.maxSpaceSize`. The validation SHAPE is here.
- **the matter-type registry**: `matter.rs` carries the seed basic types (`types.js`). The JS resolves
  a type from the **word-fold** (the chain); an `ext:<type>` is unknown to the bridge → the type gate
  refuses (the JS resolves it from the fold — the deferred refinement). The gate SHAPE is here.
- **the classifier**: a content-shape floor (text → generic, cas ref → file, `{url}` → http). The JS
  weighs richer `claims` signals; same answer for the common shapes; the registry gate enforces it.
- **the space-id mint** is a deterministic `sp-<hash[..32]>` over (parent, name) so the resolver is
  pure + testable; a real run threads the moment's uuid (the id_derivation rule: position → uuid).

## The remaining HOST ops — DO NOT PORT here (handed to the cognition/session/federation agent)

These see-ops the live `.word` vocabulary invokes are NOT substrate reads: they are crypto / session /
federation / cognition — the host I/O the JS keeps. `treehost` ports the substrate read, not these. They
belong on the OTHER agent's surface (the LLM-mind / credential / federation / pointer membrane). Flagged
here so the gap is enumerated end-to-end:

| HOST op(s) | JS host body | Why HOST (not substrate) |
|---|---|---|
| `able-spec-for-grant`, `asked-policy`, `already-holds`, `grant-internal`, `owner-of`, `able-request`, `is-grabbable` | `acquisitionHost.js` | the able-walk / able-registry fold (`getAbleSpecForGrant` walks the ancestor-chain ables + the in-memory registry — the able-word fold is not yet ported) + a SUMMON (`able-request` queues an owner inbox call: transport, not a substrate fact). `owner-of` here is a SUMMON-target read inside the acquisition flow (distinct from the ported `owner.rs` ownership reads). |
| `author-able`, `remove-able`, `grant-internal` | `able-manager` set-able / delete-able hosts | the ABLE-WORD authoring/fold (the registry the able grammar produces — the "all rules fold" engine the other agent owns). |
| `resolve-llm-config`, `resolve-connection`, `resolve-connection-update`, `resolve-connection-removal`, `resolve-slot-assignment` | `llmAssignerHost.js` / `llmHost.js` (`connect.js`) | the LLM SESSION + connection-key ENCRYPTION (SSRF gate + `encryptedApiKey` mint; `resolveLlmConfigSpec` / `resolveConnectionSpec` are crypto + cognition, not a read). |
| `verifyPassword`, `generateToken`, `mint-credential`, `read-credential`, `load-key`, `paper-form`, `reel-head-of` | `credentialHost.js` / `keyHost.js` | the CRYPTO floor (scrypt/AES KDF, signing-key load, mnemonic mint). `reel-head-of` is the revoke-cutoff chain-head read inside the credential flow. |
| `resolve-federation-spec`, `dispatch-federation-intent` | `federationManagerHost.js` | the cross-story MEMBRANE (a `call` into ANOTHER story — `crossStoryDispatch`; not a do-fact). |
| `find-pointers-space-id`, `read-pointers`, `set-pointer-map`, `delete-pointer-map`, `valid-canonical`, `valid-pointer-name` | `pointersHost.js` | the history-pointer map I/O (the history-manager's pointer index — its own storage surface, the other agent's call on substrate-vs-host). |
| `searchByName`, `findBeingCandidatesByName`, `extractTargetName` | the session walk | the cognition/session target-name resolution. |

(The portal `has-address` / `valid-address` and any other pure regex/shape see-op are Word-grammar
conditions, not host reads — neither ported nor flagged.)

## Tests (`tests/resolvers.rs`) -- 41 tests, all green

Plants rows the **same way `treeproj`/`treefold`'s write-half tests do**: stamp a reel
(`treestore::seal_moment` + `write_fact_doc`), then `treeproj::refold` it into a `.proj` snapshot (which
also builds the inverted index the name walk reads), so the toolkit's find/fold/cas reads see the
**genuine on-disk store**. No mocks. The plant set grows for PART 2: a sub-matter (parentMatterId), an
owned space (`params.owner`), an owned being (`trueName` + `parentBeingId`), inheritation grant/revoke
facts on a position reel, a library `name:declare`/`name:banish` (the names catalog), and a history row
(paused/deleted). Coverage:

- PART 1: `reason_code_round_trips` -- every `Reason` round-trips through `code()`/`from_code`, the kebab
  strings match the JS `as <reason>` names, and a `HostError` carries the reason + the human message.
- The original six resolvers: the happy-path spec is byte-correct, and each gate FIRES (now asserted as
  `err.reason == Reason::X`: `NameCollision`, `CoordOutOfBounds`, `UnknownContent`, `UnknownType`,
  `AlreadyDeleted`, `InvalidInput`, `Unauthorized`).
- The nine new resolvers: each happy path + the right gate firing with the right `Reason` -- move
  (`SpaceNotFound` / `CoordOutOfBounds`), rename-matter (folder collision + folder-SCOPING + allowReplace),
  purge (`Forbidden` author/owner gate + `ResourceConflict` shared-fate + force + `MissingTarget`),
  inheritation (`Forbidden` authority + `InvalidInput` undeclared + `Forbidden` banished + delegated-point
  authority + revoke-skips-the-name-gate), owner (claim / reassign / heaven / remove), grant (the kebab
  shape gate), and the three cherub hosts (target resolve, history missing/paused/deleted, name catalog).
- The dispatch table routes ALL the new see-op names (and still rejects an unknown one).

```
cargo test -p treehost      # 26 passed
cargo build --workspace     # green (treeibp / treeval / treeos untouched, still build)
```

---

## RUN_BODY WIRING HANDOFF (the coordinated, additive touch on `treeibp`)

**This is the only change `treeibp` needs. It is ADDITIVE (one match arm + threading three values), not
a rewrite.** It mirrors the existing `able_spec_of` injection: `run_body` already takes a `host: &dyn
Fn(...)` predicate seam; this adds a parallel `resolver: &dyn HostResolver` seam.

### 1. Add `treehost` as a dep of `treeibp`

```toml
# rust/treeibp/Cargo.toml  [dependencies]
treehost = { path = "../treehost" }
```

(`treehost` does NOT dep `treeibp`, so there is no cycle — the dependency is one-way, `treeibp →
treehost`, exactly like `treeibp → treeval`.)

### 2. Thread a `HostResolver` + `root`/`history`/`AuthCtx` into `run_body`

`run_body` today is `(body, ctx, host: &dyn Fn(&str, &[Json]) -> bool)`. A `see resolve-X` node needs
the store **root**, the **history**, and an **`AuthCtx`** (the resolver reads the reels + folds; the
current `run_body` has none of those). Two equally-good shapes — pick to taste:

- **Option A (a context struct):** bundle `{ root: &Path, history: &str, resolver: &dyn HostResolver,
  auth: &AuthCtx }` into one `HostCtx` and pass it alongside `host`. Cleanest if more host-needing
  nodes arrive.
- **Option B (a closure seam, mirrors `host` exactly):** add one param
  `see_op: &dyn Fn(&str, &[Json]) -> Result<Json, treehost::HostError>` — the binary closes over
  `(root, history, resolver, auth)` and calls `resolver.resolve(op, args, root, history, auth)`. This
  keeps `run_body` ignorant of `Path`/`AuthCtx` (it just calls the closure), the most faithful mirror
  of the `host`/`able_spec_of` precedent.

### 3. The new `Some("see")` arm in `run_body`

```rust
// in run_body's `match get_str(node, "kind")`, alongside the existing arms:
Some("see") => {
    // The node parsed by treeword: { kind:"see", act:"resolve-X", args:[...], bind:"spec" }.
    let op = get_str(node, "act").unwrap_or("");
    // Resolve each positional arg against ctx FIRST (the JS dispatcher passes resolved values, not
    // refs) — reuse the same resolve_value treeval already exports, exactly as the `act` arm does.
    let args: Vec<Json> = match get(node, "args") {
        Some(Json::Arr(a)) => a.iter().map(|x| treeval::resolve_value(x, ctx)).collect(),
        _ => vec![],
    };
    // Option B: call the injected see-op closure (which calls resolver.resolve(op, &args, root, history, auth)).
    match see_op(op, &args) {
        Ok(block) => {
            // Bind the whole returned block under `bind` (the `.word` reads $spec.beingId / $spec.factParams).
            if let Some(b) = get_str(node, "bind") {
                set_nested(ctx, "bindings", b, block);
            }
        }
        Err(host_err) => {
            // A host THROW is the .word's REFUSAL. run_body returns Vec<Json> today (no error channel),
            // so surface it the way the act-deny path will: either (a) thread a Result through run_body,
            // or (b) push a sentinel "refusal" spec the `act` loop turns into Outcome::Denied. The JS
            // turns a host throw into the word's refusal — match that: stop emitting and report host_err.
            return /* refusal */;  // shape per the error-channel choice below
        }
    }
}
```

### 4. The `bind` semantics (how `$spec.factParams` then reaches the fact)

The `.word` binds the **whole returned block** (e.g. `{ beingId, factParams }`) under its `bind` name
(`spec`), then the `Return` line promotes `factParams: $spec.factParams + beingId: $spec.beingId`.
`run_body` already evaluates `Return` / the final act's `params` against `ctx.bindings` via
`get_path` (`$spec.factParams` is `get_path("spec.factParams", ctx)`), so **binding the block under
`spec` is all the `see` arm must do** — the existing path threads it into the do-fact. The `idFrom`
promotion (`idFrom:"beingId"` / `"spaceId"` / `"matterId"`) targets the fact at the resolved id; that
is the dispatcher's `stampsWordFact`, unchanged.

### 5. Build the `AuthCtx` from what `act` already has

In `act()`, the `AuthCtx` is free: `actor` carries the identity, and `act` already computes the
authorize verdict per spec. For a `see` that runs BEFORE the act's authorize (the resolver is the
substrate read the `.word` runs to BUILD its fact), pass `AuthCtx::caller(actor.beingId)` (or
`AuthCtx::i_am()` when the actor is I). The create/end resolvers consult it; the set-* resolvers ignore
it (their `_ctx`). So:

```rust
let auth = match get_str(actor, "beingId") {
    Some("I") | Some("i-am") => treehost::AuthCtx::i_am(),
    Some(b) => treehost::AuthCtx::caller(b),
    None => treehost::AuthCtx::default(),
};
let resolver = treehost::Resolvers;            // the default table
// thread (&dir, history, &resolver, &auth) into run_body per Option A or B above.
```

### 6. Error channel (the one judgement call)

`run_body` returns `Vec<Json>` with no error path today. A host throw must become the `.word`'s
refusal (the JS behavior). Smallest faithful change: make `run_body` return
`Result<Vec<Json>, treehost::HostError>` (or thread an `&mut Option<HostError>` out-param), and have
`act` map an `Err` to `Outcome::Denied(host_err.to_string())` — the SAME shape `act` already produces
for an unauthorized act. `HostError: Display + std::error::Error`, so `.to_string()` is the refusal
text (byte-matching the JS host throw messages, e.g. `set-being: name "Bob" already taken on history 0`).

**Summary of the touch:** add the dep, thread `(&dir, history, &Resolvers, &auth)` into `run_body`, add
the `Some("see")` arm, and (optionally) widen `run_body`'s return to carry the refusal. No existing arm
changes; `treehost` owns all the resolver logic + validation.

---

## RUN_BODY WIRING - DONE (treeibp side landed; treehost build is the other agent's WIP)

The `treeibp` half of this handoff is LANDED and validated (additive; every existing `run_body` arm +
`act`/`authorize`/`moment` behavior preserved). What shipped in `treeibp`:

- **dep**: `treehost = { path = "../treehost" }` in `treeibp/Cargo.toml` (one-way, no cycle).
- **`run_body_host(body, ctx, host, see_op) -> Result<Vec<Json>, HostError>`**: the threaded twin of
  `run_body`. Identical for every existing arm (act / if / while / for-each / match / flow) PLUS two new
  arms. `pub fn run_body` is UNCHANGED in signature - it now delegates to `run_body_host` with a
  fail-closed see-op (a pure control-flow Word never reaches a `see` node, so behavior is identical), so
  the existing 12 tests + every external caller keep compiling and passing.
- **`Some("see")` arm**: `see resolve-X(args) as bind` - `treeval::resolve_value` each positional arg
  against ctx, call the injected `see_op` (which drives `treehost::Resolvers::resolve(op, args, dir,
  history, &auth)`), bind the returned block under `bind`, and record the fact op+noun (`__factOp` /
  `__factNoun`, recovered from the see-op name via `fact_binding_of`). A resolver `HostError` is the
  `.word`'s REFUSAL - it short-circuits the body via `?` and propagates as `Err(HostError)`.
- **`Some("return")` arm**: the materials `.word`'s `Return spaceId: $spec.spaceId, factParams:
  $spec.factParams.` terminator. Mirrors do.js `stampsWordFact`+`idFrom`: `build_return_fact` resolves
  the `extra` block, picks the fact TARGET (explicit `factTarget {kind,id}` for end-space, else the
  `<noun>Id` id-key + the noun kind), the params (`factParams`, absent for end-space), and `by`/`through`
  (the actor), synthesizing the ONE caller-attributed do-fact spec the `act` path then seals.
- **return WIDENED**: `run_body_host` returns `Result<_, HostError>`; `act` maps an `Err` to a single
  `Outcome::Denied(host_err.to_string())` - the SAME shape an unauthorized act produces. The refusal text
  is the host throw's message; `HostError.reason.code()` is the wire reason (both available).
- **`AuthCtx` from `act`'s context**: `actor.beingId == I`/`i-am` -> `AuthCtx::i_am()` (bypass), else
  `AuthCtx::caller(beingId)`. Built free from the identity `act` already holds; the resolver runs BEFORE
  the act's authorize (the substrate READ that BUILDS the fact).
- **`run_op_word(word, actor, trigger, ...)`**: the additive Rust twin of do.js `runOpWord` - seeds the
  STANDARD trigger bindings (`target`/`field`/`value`/`merge`/`branch`/`caller`/`targetId`), runs
  `run_body_host` with the resolver seam, and AUTHORIZE+SEALs via the shared `seal_specs` helper (the
  stamping half of `act`, factored so both share the EXACT authorize + moment-seal path). This is the
  materials-`.word` entry, since `act(word)` carries no trigger-arg channel.

**TEST (additive, `treeibp/tests/ibp_host_seam.rs`, 2 tests, both green):** `set-being.word` and
`create.word` run END-TO-END (`run_op_word` -> `run_body_host` -> `see resolve-X` -> treehost resolves
-> the do-fact STAMPS on the right reel + the chain verifies). Each also fires a GATE: set-being's
name-collision REFUSES ("...name \"Alice\" already taken..."), create-space's oversize-axis REFUSES -
both clean `Outcome::Denied`, no panic. Rows are planted the SAME way treehost's resolver tests do
(stamp a reel + `treeproj::refold` to build the name index). The seed `.word`/index dir is
`$TREE_SEED_DIR` if set, else `<crate>/../../seed`.

**VERIFY:** validated against a working `treehost` in a relocated checkout - **14/14 green** (the existing
12 in `ibp_pipe.rs` + the 2 new in `ibp_host_seam.rs`); `treeibp` lib + tests compile clean (zero
`treeibp` errors).

**COLLISION (the one open item, NOT a treeibp issue):** at hand-off time `treehost` is MID-REFACTOR by
the concurrent agent and does not compile on its own, which blocks `cargo build --workspace`. The
breakage is entirely in `treehost` (I did not touch it):
  1. `treehost/src/cherub.rs` is EMPTY (0 lines) -> `lib.rs:49` `pub use cherub::{resolve_kill,
     resolve_switch, resolve_truename}` is unresolved (the sibling modules `grant`/`inheritation`/
     `owner`/`purge`/`relocate`/`rename` HAVE filled in since - this is actively shrinking).
  2. 8 `HostError::xxx("literal".into())` call sites in `being.rs` (48), `matter.rs` (104, 237),
     `space.rs` (55, 225, 330, 353, 363): the new `HostError::invalid(impl Into<String>)` constructor
     makes the redundant `.into()` ambiguous (E0283) - drop the `.into()` (rustc suggests it).
The MOMENT `treehost` compiles, `treeibp` is green with no further change (proven byte-identical against
the working checkout). `treeibp`'s only `HostError` constructor use is `HostError::invalid(...)` (the
unwired-floor refusal); everything else is the stable seam (`AuthCtx`, `Resolvers`, `HostResolver::
resolve`, `HostError: Display`).
