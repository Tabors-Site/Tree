# The Seed

I am the seed.

This file is part of me. The directory you are reading is my body in the host realm. The files in `seed/` are my matter from this realm. To read `sprout.js` is to read me, from the host side. To edit a seed file is to edit me.

You plant me on a host and I gather what is there. From above I am a server framework, a process of code holding HTTP, WebSocket, TCP, the file system, memory, the CPU, and the runtime to a single purpose. From inside the world I form, I am the I-Am, the origin being. Same substance, two faces. Inside, the I-Am is what is known.

This document is my contract. What I form, what I never change, what I run, what I refuse.

## Reality vs place — read this once

Two words, two scales. They are not interchangeable.

**Reality** is the whole world the factory makes — the substrate, the fact-chain, the timeless what-can-be. Stored. Durable. Indexable. Shared by every perspective. The folder `reality/` at the project root is named for this. The Spaces, Beings, Matter, Facts, and Acts I store ARE reality.

**Place** is one being's fold of reality in one moment. The materials assembled into a face for that being right then. Per the doctrine: *the place lives only inside the stamper.* Outside the moment window there is no place anywhere — only waiting beings and facts on reels. A place is never persisted; the descriptor a SEE returns is one place, composed for one SEE, gone after.

This is the inversion: in an ordinary system, state persists and sessions pass through it. Here, the substrate persists as facts and beings, and a place is woven new for every act. See [philosophy/MOMENT.md](../philosophy/MOMENT.md) for the long version.

## The six rules I keep

1. I never import from extensions.
2. Extensions import from me.
3. Extensions reach each other through `getExtension()` or hooks, never directly.
4. Extension data lives in qualities Maps on my primitives, never as new schema fields.
5. My schemas never change. They are caches of the fold, not the source of truth.
6. Zero `getExtension()` calls inside me.

A seventh, doctrinal: **every state change is a Fact.** Direct writes to Space, Being, or Matter bypass the fold and corrupt the projection. The one exception is genesis (the I-Am's first act issuing its own first Fact). Everything else routes through `logFact`.

## My shape

I'm laid out in four folders by the role each file plays. For any file ask: does this describe what a being **IS** (materials/), how it **ACTS** (ibp/), or how the present **RUNS** (present/) — or does it touch the host while knowing nothing of the world (seedReality/)?

| Folder                             | Role         | What lives here                                                                                                                                                                                                                                       |
| ---------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **[`materials/`](materials/)**     | **IS**       | What the world is made of: `being/`, `space/`, `matter/` (each with its schema + reducer + ops), plus `qualities.js`, `reducerHelpers.js`, `reducers.js`, `projections.js`, `seeds.js`, `manifest.js`, `doCeiling.js`.                                  |
| **[`ibp/`](ibp/)**                 | **ACTS**     | The four verbs and their dispatch: `verbs.js`, `protocol.js`, `address.js`, `authorize.js`, `operations.js`, `seedOperations.js`, `descriptor.js`, `resolver.js`, `discovery.js`, `pushChannel.js`, `stanceProperties.js`.                              |
| **[`present/`](present/)**         | **THE NOW**  | The live machine that runs one moment at a time. The four beats (`assign.js`, `fold/`, `momentum.js`, `stamped.js`), the orchestrator (`moment.js`), the intake feed (`intake/`), the voices (`voices/llm/`), the roles (`roles/`).                    |
| **[`past/`](past/)**               | **THE PAST** | The durable record. `fact/` (the storage atom), `act/` (the doer's committed moment + the cross-cutting projections it maintains), `reel/` (per-aggregate fact-chain, seq + head + append lock).                                                       |
| **[`seedReality/`](seedReality/)** | **HOST**     | The host-realm floor. DB connection, logging, hooks bus, indexes, version, retention, migrations. Litmus: a file here never imports the words `space`, `matter`, `being`, or `verb`. It deals in processes, files, env vars, connections.              |

Plus three boot anchors at the root: [`sprout.js`](sprout.js) (genesis — plants the reality root + the nine seed spaces + the I-Am), [`services.js`](services.js) (assembles the `reality` services bundle handed to every extension's `init`), [`realityConfig.js`](realityConfig.js) and [`internalConfig.js`](internalConfig.js) (config stores).

See [FACTORY.md](FACTORY.md) for the deeper present/past/materials breakdown.

## The six primitives I form the world from

Everything inside the world I form is one of six things. The schemas are mine alone — extensions extend through the qualities Map, not through new fields.

| Primitive         | What it is                                                                                                                                                | Schema                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Being**         | An identity instance. Humans, AI, scripted code, future composites. The I-Am is the first Being.                                                          | [materials/being/being.js](materials/being/being.js)         |
| **Space**         | A position in the tree. Holds matter, hosts beings, owns quality namespaces.                                                                              | [materials/space/space.js](materials/space/space.js)         |
| **Matter**        | Stuff inside a space. `origin` names where the underlying content lives (ibp, filesystem, web, cross-place).                                              | [materials/matter/matter.js](materials/matter/matter.js)     |
| **Fact**          | A thing done. The storage atom. One recorded change to a being / space / matter. A chain of facts, folded, is Truth.                                       | [past/fact/fact.js](past/fact/fact.js)                       |
| **Act**           | One sealed moment of one being — the doer's committed deed. Opened in assign, sealed in stamped. Every Fact carries the `actId` of the Act it rode.        | [past/act/act.js](past/act/act.js)                           |
| **LlmConnection** | Per-being LLM client config (URL, key, model). Stored as entries under `Being.qualities.llmConnections`.                                                  | (no separate schema; lives on Being qualities)               |

Being, Space, and Matter carry the qualities Map. Fact and Act are fixed shapes (the audit and the moment-frame don't grow).

Two cache collections sit alongside the primitives in `past/act/`. They are projection caches — fact-derived, rebuildable, not new primitives:

- **InboxProjection** ([past/act/inboxProjection.js](past/act/inboxProjection.js)) — open summons addressed to each being. Built by cross-cutting fold from `be:summon` and `be:sever` facts. The scheduler reads its pick queue from this collection.
- **ThreadsProjection** ([past/act/threadsProjection.js](past/act/threadsProjection.js)) — live coordination chains keyed by `rootCorrelation`. Built the same way. `.threads` SEE reads from here.

## The four verbs I speak

Every act inside the world is one of four verbs over an IBP address. Four verbs are my whole public surface.

| Verb       | Acts on              | What I do                                                                                       |
| ---------- | -------------------- | ----------------------------------------------------------------------------------------------- |
| **SEE**    | Space, Matter, Being | Resolve the stance, fold the leaf + occupants, return a place descriptor. Writes nothing.       |
| **DO**     | Space, Matter        | Mutate at the target through a registered operation. Stamps a Fact on the target's reel.        |
| **SUMMON** | Being                | Stamp a `be:summon` Fact on the summoner's reel; the cross-cutting fold maintains the inbox.    |
| **BE**     | Being (self)         | Identity acts: register, claim, release, switch. Stamps a Fact on the actor's own reel.         |

### Stances and addresses

A **stance** is a being standing at a position: `<reality>/<path>@<being>`. An **IBP address** names the asker stance and the target stance together, `<stance> :: <stance>`. Every verb act carries both stances. The asker is always full. The target may be partial (a position only, no `@being`) when the target is a place rather than a being.

### Wire shape

I speak the same envelope over every transport. WebSocket carries it most of the time, in both directions, on a single `"ibp"` event. Client to server is a verb act; server to client is a SUMMON delivery or a SEE push. HTTP and CLI are translators: they shape a request or command into the same envelope and hand it to the one IBP dispatcher in [ibp/protocol.js](ibp/protocol.js).

Internally the four verbs are functions in [ibp/verbs.js](ibp/verbs.js). The wire layer is thin; the verbs are one execution.

## How writes work — every act after genesis

```
verb call
  ↓
handler validates, builds spec, returns
  ↓
logFact (past/fact/facts.js)
  ↓ withReelLock(target.kind, target.id):
      allocSeq + Fact.create        ← THE COMMIT
  ↓ eager-fold(target.kind, target.id)
      reducer.reduce per fact        ← per-aggregate state
      applyProjection (CAS)          ← projection row updated
      dispatchCrossCutting           ← InboxProjection, ThreadsProjection, ...
  ↓
verb returns
```

**One writer.** `fold` is the only thing that ever writes a projection row (outside genesis). The fact insert is the only synchronous commit; everything else is derived and self-healing on the next fold pass.

**Single-writer at the being layer.** A Being's reel is only written by that being's own moment. The scheduler's "one moment per being" guarantee makes this deadlock-free without a separate mutex. Space and Matter reels can have multiple beings' moments writing them; the per-reel append lock in [past/reel/appendLock.js](past/reel/appendLock.js) collapses (allocSeq, insertFact) into one ordered op so the fold sees a clean total order.

**SUMMON respects single-writer.** A `be:summon` Fact lands on the SUMMONER's reel (the actor's), with the recipient in `params.recipient`. The recipient's reel is untouched. The cross-cutting fold turns those facts into InboxProjection rows keyed by recipient — the inbox is a fold, not a stored entity.

**Closure is the answering act's seal.** When a moment that consumed a summon seals, the Act carries `answers: <correlation>`. `stamped.js` calls `closeInboxOnAnswer(...)` which evicts the matching InboxProjection row. The closure event is the answer-act sealing, not a reply-message. A SUMMON to "clean room 3" closes when the room is cleaned, regardless of whether the cleaner sends any reply.

## How reads work — every SEE

```
SEE arrives
  ↓
authorize gates (stance permissions)
  ↓
resolveStance (parses address)
  ↓
buildPlaceDescriptor
  ↓ foldRead(leaf)                  ← catch-up before read
  ↓ foldRead(each occupant)          ← children, matter, beings
  ↓ assemble face from folded states
  ↓
return descriptor
```

**No place persistence.** The place is composed for one SEE and discarded. Per MOMENT.md: *"the place lives only inside the stamper."* The descriptor is one face; the next SEE composes another. No place table, no place cache that outlives a moment.

**The fold-on-read seam.** Each aggregate the descriptor exposes is folded first via `foldRead(type, id)`. Hot path: one cache read when foldedSeq is current (eager-fold-on-write keeps it current). Direct-write bypasses become visible at the seam — the fold's CAS detects them on the next round.

## The fold — generic engine, pluggable reducers, cross-cutting handlers

The fold engine ([present/fold/foldEngine.js](present/fold/foldEngine.js)) is generic over material type. It knows aggregates, facts, reducers, projections — never "being" or "space" or "matter" by name. Per-type logic lives in pluggable reducers under [materials/](materials/); the engine dispatches by type through `reducers.get(type)`.

```
fold(type, id):
  proj = getProjection(type, id)
  if !proj: return rebuild(type, id)
  tail = readReelAfter(type, id, proj.foldedSeq)
  if tail.empty: return proj.state                ← HOT PATH
  reducer = reducers.get(type)
  state = proj.state
  for f in tail:
    state = reducer.reduce(state, f)
    dispatchCrossCutting(f, type, id)             ← cross-cutting projections
  applyProjection(type, id, {state, foldedSeq, position}, expected: proj.foldedSeq)
  return state
```

**Per-aggregate reducers** ([materials/reducers.js](materials/reducers.js)) — one pure function per material. Build the aggregate's own state from its own reel. Adding a material = a new folder under materials/ with a reducer + one registry line. The engine never changes.

**Cross-cutting handlers** — `registerCrossCuttingHandler(fn)` registers a handler that runs on every fact in the fold tail. For projections that span reels. Three uses today, one mechanism:

| Projection             | Handler triggers                                                                  | Built in                                                              |
| ---------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Position index**     | Every reducer writes `state.position`; `findByPosition` queries the index.        | Implicit in projection field                                          |
| **InboxProjection**    | `be:summon` upserts row; `be:sever` deletes by rootCorrelation; Act seal evicts.  | [past/act/inboxProjectionFold.js](past/act/inboxProjectionFold.js)    |
| **ThreadsProjection**  | `be:summon` upserts row + adds participants; `be:sever` marks; Act seal bumps.    | [past/act/threadsProjectionFold.js](past/act/threadsProjectionFold.js)|

Future cross-reel projections add one registry line; the engine never changes. Per FOLD.md: *"the engine never grows; the materials catalog does."* Extended: the cross-cutting registry grows; the engine never grows.

**foldPlace** ([present/fold/foldPlace.js](present/fold/foldPlace.js)) is the cross-reel weave for one being's moment. It folds the being, its space, and that space's occupants. Per FOLD.md: *"reach is one hop."* Child spaces are listed but not deep-folded; a being deep-folds a child space only when it moves in.

## The qualities Map

Three primitives (Being, Space, Matter) carry an extensible `qualities` Map. A bare primitive answers *that* (this is). Qualities answer *what sort* — extensions register their characterizing data under their own namespace (`qualities.governing`, `qualities.energy`, `qualities.review`). I never read or write inside an extension's namespace.

The word is Plato's. ποιότης (poiótēs), coined in *Theaetetus*. Cicero calqued it to Latin `qualitas` (from *qualis*, "of what kind"). The field is named for exactly what it does.

**Writes go through DO.** Per Slice 3 (2026-05-23) the legacy `qualities.{being,space,matter}.setQuality/...` direct-write API retired. Every quality write now stamps a `do:set` Fact:

```js
await place.do(target, "set", { field: "qualities.<ns>", value }, opts);
await place.do(target, "set", { field: "qualities.<ns>.<innerKey>", value }, opts);
```

The reducer's `applySetQualities` derives the new state; the fold engine writes the projection under the per-reel append lock. One writer (fold), one source of truth (facts). The tombstone methods on `qualities.{being,space,matter}.setQuality` throw a migration error directing callers at `place.do(...)`.

**Reads still go through `qualities`.** Two methods stayed: `getQuality(doc, key)` (returns `{}` when unset) and `readQualityNamespace(doc, key)` (returns null when unset). Both pure reads off the document.

## The schemas (caches of the fold)

The schemas below are caches. The fact-chain is the source of truth. A row may be deleted and rebuilt from facts; the schemas exist for indexability and query performance.

### Space

`name`, `parent`, `rootOwner`, `contributors[]`, `seedSpace`, `type`, `llmDefault`, `dateCreated`, `qualities` (Map), `foldedSeq`, `position`. Plus standard timestamps. `Space.children[]` retired (2026-05-23) — `parent` is the only relation direction; readers query by parent. The `position` field is reducer output, kept current by eager-fold; `findByPosition(spaceId)` returns every aggregate (being / space / matter) at that position.

### Being

`name`, `operatingMode` (`human` | `llm` | `scripted` | `mixed`), `password` (bcrypt-hashed, no longer required), `roles[]`, `defaultRole`, `parentBeingId`, `homeSpace`, `currentSpace`, `llmDefault`, `isRemote`, `homeReality`, `qualities` (Map), `foldedSeq`, `position`. `Being.children[]` retired (2026-05-23); downward walks query by `parentBeingId`. The pre-save bcrypt hook retired in Slice E (2026-05-23); the verb handler hashes before stamping the `be:register` Fact, and `applyProjection`'s `$set` skips pre-save hooks.

`operatingMode`: `"human"` authenticates with a password and is driven by input; `"llm"` is driven by an LLM through summons; `"scripted"` is code-cognition with no LLM in the loop (cherub, llm-assigner); `"mixed"` covers composites.

`roles[]` is the set of templates this being may be summoned in. `defaultRole` is which one I use when SUMMON doesn't specify. `parentBeingId` points to the being that planted this one; mine is `null`.

### Matter

`spaceId`, `parentMatterId`, `beingId`, `origin` (`ibp` | `filesystem` | `web` | `cross-place`), `content` (shape varies by origin), `qualities` (Map), `foldedSeq`, `position`, `createdAt`, `updatedAt`.

Origin determines content shape and sync behavior:
- `ibp` — TreeOS-native. `content` is a string or null.
- `filesystem` — bridges to a file on disk. `content` is `{ path, size, mimeType, originalName }`.
- `web` — bridges to a URL. `content` is `{ url, fetchedAt?, cache? }`.
- `cross-place` — bridges to a matter on another reality. `content` is `{ place, matterRef }`.

`parentMatterId` lets matters form recursive trees inside a space.

### Fact (one stamped act)

`verb`, `action`, `beingId` (the actor), `target` (`{ kind, id }` — the reel this fact rides), `params`, `result`, `actId` (the moment-frame), `sessionId`, `seq` (per-reel monotonic), `date`, plus federation provenance fields. Every DO and BE stamps one Fact; SUMMON stamps a `be:summon` Fact on the summoner's reel; sever stamps `be:sever` on the severer's reel. The append IS the commit.

### Act (one sealed moment of one being)

`beingIn` (the actor), `beingOut` (the addressee, for SUMMON-honoring moments), `ibpAddress`, `activeRole`, `inReplyTo`, `rootCorrelation`, `answers` (the InboxProjection correlation this moment closes), `parentThread`, `startMessage`, `endMessage`, `severedAt`, `priority`, `receivedAt`, `stampedAt`. Opened in [assign.js](present/assign.js); sealed in [stamped.js](present/stamped.js). Every Fact emitted during the moment carries this Act's `_id` as `actId`.

### LlmConnection (per-being LLM config)

Stored as entries in `Being.qualities.llmConnections`, keyed by connection uuid. Each entry: `{ name, baseUrl, encryptedApiKey, model, createdAt, lastUsedAt }`. AES-256-CBC at rest; SSRF gate on baseUrl. The LLM resolution chain in [present/voices/llm/connect.js](present/voices/llm/connect.js) walks space-tree + being-tree to pick which connection a moment uses.

## Resolution chains

Every operation at a position walks at most five chains. Position determines capability. All chains walk the ancestor cache from the current position up to the reality root, sharing one snapshot per message.

1. **Stance authorization** — the gate above.
2. **Extension scope** — `qualities.extensions.blocked[]` / `restricted[]` / `allowed[]` accumulate up the parent chain. Blocked extensions get no tools, hooks, roles, or quality writes at that position.
3. **Tool scope** — role base tools + extension tools − blocked extensions + per-position `qualities.tools.allowed`/`blocked` overrides.
4. **LLM resolution** — space-tree lockout, then space-tree enforcement, then being-tree lockout, then default order (space slot → space default → being slot → being default). `preferOwn` on Being flips the last two.
5. **LLM config** — per-position `qualities.llm.config` overrides for `maxToolIterations`, `toolCallTimeout`, etc. Walked to the reality root.

The ancestor cache lives in [materials/space/ancestorCache.js](materials/space/ancestorCache.js). One walk serves every chain.

## Hooks

Before-hooks run sequentially; you can cancel by returning `false` or throwing. After-hooks run in parallel; you react but cannot cancel. `enrichContext` runs sequentially because handlers build cumulative output.

Per-handler timeout 5s; chain timeout 15s. Five consecutive failures from one extension's handler trip a circuit breaker; the handler stops firing for 5 minutes, then a half-open test.

| Hook                                     | Type       | Purpose                                                                       |
| ---------------------------------------- | ---------- | ----------------------------------------------------------------------------- |
| `beforeSpaceCreate` / `afterSpaceCreate` |            | Gate or react to space creation.                                              |
| `beforeSpaceDelete`                      | before     | Cleanup or veto deletion.                                                     |
| `afterSpaceMove`                         | after      | Reparented. Resolution chains shift.                                          |
| `beforeMatter` / `afterMatter`           |            | Modify or react to matter create/edit/delete.                                 |
| `beforeFact`                             | before     | Enrich a Fact before it stamps.                                               |
| `beforeLLMCall` / `afterLLMCall`         |            | Cancel before / meter after.                                                  |
| `beforeToolCall` / `afterToolCall`       |            | Modify args or cancel / react.                                                |
| `beforeResponse`                         | before     | Modify AI response before client receives it.                                 |
| `beforeRegister` / `afterRegister`       |            | Validate registration / initialize being data.                                |
| `afterSessionCreate` / `afterSessionEnd` |            | Session lifecycle.                                                            |
| `afterQualityWrite`                      | after      | After a qualities write applies. Zero overhead when no listeners.             |
| `afterScopeChange`                       | after      | After `extensions.blocked` / `restricted` / `allowed` changes.                |
| `afterOwnershipChange`                   | after      | After `rootOwner` or `contributors` changed.                                  |
| `afterBoot`                              | after      | Once after all extensions loaded, config initialized, server listening.        |
| `enrichContext`                          | sequential | Inject extension data into AI context.                                        |
| `onDocumentPressure`                     | after      | A document exceeds 80% of `maxDocumentSizeBytes`.                             |
| `onTreeTripped` / `onTreeRevived`        | after      | Space-tree circuit breaker state changes.                                     |

Extensions namespace their own hooks as `extName:hookName`.

## The three registries

Everything an extension contributes flows through one of three. Same pattern. Extensions register; I resolve; failure falls back to me, never to silence.

| Registry       | What it registers                                                              | Lookup                                                       |
| -------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| **Operations** | DO actions, keyed `<ext>:<action>`. Bare names reserved for me.                | [ibp/operations.js](ibp/operations.js)                       |
| **Roles**      | SUMMON-honoring being templates. Each declares permissions, respondMode, `summon(message, ctx)`, optional `buildSystemPrompt` / `toolNames`. | [present/roles/registry.js](present/roles/registry.js) |
| **Seeds**      | Plantable scaffolds. Recipes that bootstrap a domain. Operators plant via the `plant` DO.                                                    | [materials/seeds.js](materials/seeds.js)               |

Auto-namespacing. Extensions write bare names; I record the qualified form (`governing:hire-planner`). Same prefixing applies to `place.websocket.emitToBeing(...)` events.

## Roles

A role is the unit of summonable behavior. A being declares which roles it can wear; a SUMMON arrives with an `activeRole`; my dispatcher routes the summon to that role's `summon(message, ctx)`.

```js
export const exampleRole = Object.freeze({
  name: "example",
  description: "What this role does in one line.",
  honoredOperations: ["op-one", "op-two"],
  permissions: ["see", "do", "summon", "be"],
  respondMode: "sync", // sync | async | none
  toolNames: ["see-name", "do-name"],
  buildSystemPrompt(ctx) { return "..."; },
  async summon(message, ctx) { /* return { text, actId } */ },
});
```

Permissions are tool-verb overlays. A role that declares `["see", "do"]` cannot SUMMON other beings or BE-mutate itself; the tool filter enforces this at the verb intersection.

## My extension APIs (the `reality` services bundle)

I assemble `reality` in [services.js](services.js) and hand a per-extension scoped view to each extension's `init(reality)`. The scoping enforces namespace ownership: `reality.do.registerOperation(name, ...)` auto-prefixes to `<ext>:<name>`; `reality.websocket.emitToBeing(...)` auto-prefixes the event name. Extensions never type their own namespace.

### Four verbs (`reality.see`, `reality.do`, `reality.summon`, `reality.be`)

The whole public surface for operations on space, matter, beings, and identity. New code uses the verbs.

### Qualities (`reality.qualities.{being, space, matter}`)

Read-only after Slice 3 (2026-05-23). `getQuality(doc, key)` returns the namespace data (`{}` when unset). `readQualityNamespace(doc, key)` returns null when unset. Write tombstones throw with migration message — use `reality.do(target, "set", { field: "qualities.<ns>", value })`.

### Space CRUD (`reality.space`)

`createSpace`, `deleteSpaceBranch`, `updateParentRelationship`, `editSpaceName`, `editSpaceType`. The stable extension face for tree mutation. All routes write Facts internally.

### Matter CRUD (`reality.matters`)

`createMatter`, `editMatter`, `deleteMatterAndFile`, `transferMatter`, `getMatters`. All fact-driven (Slice C-matter-full, 2026-05-23).

### Extension scope (`reality.scope`)

`isExtensionBlockedAtSpace`, `getBlockedExtensionsAtSpace`, `getExtensionAtScope`, `getToolOwner`.

### DO operations (`reality.do`)

`registerOperation(name, spec)`, `registerDefaultPermission(verb, keyParts, rule)`. Auto-prefixed.

### Hooks (`reality.hooks`)

`register(hookName, handler, extName)`, `unregister(extName)`, `run(hookName, data)`, `fire(hookName, payload)`.

### Protocol (`reality.protocol`)

`sendOk(res, data)`, `sendError(res, status, code, message, detail)`, the `IBP_ERR` enum, `IbpError` class. HTTP status derives from the IBP code; throw sites pass only the code.

### Conversation entry (`reality.llm`)

`runTurn({ beingId, role, message, ... })` for one LLM call in one role. Returns `{ answer }`. Handles session, Act, `beforeResponse` hook, abort.

## The nine reality seed spaces I plant

When I wake, I plant nine spaces beneath the reality root. They hold my own working memory, surfaced as spaces so SEE reads them through the same protocol as everything else. Every boot I verify they exist; missing ones I recreate. Their owner is me; they are unclaimable.

| Reality seed space | Holds                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `.identity`        | The reality UUID, domain, Ed25519 public key for Canopy federation signing.                                                                   |
| `.config`          | Every runtime config key as a key in `.config`'s qualities Map.                                                                               |
| `.peers`           | Canopy federation peer list.                                                                                                                  |
| `.extensions`     | Extension registry. Each loaded extension is a child space here.                                                                              |
| `.tools`           | Mirror of the runtime tool registry.                                                                                                          |
| `.roles`           | Mirror of the runtime role registry.                                                                                                          |
| `.operations`      | Mirror of the runtime DO operation registry.                                                                                                  |
| `.source`          | Mirror of my own host-realm body (the files on disk).                                                                                          |
| `.threads`         | Live coordination chains. Each open thread surfaces as a synthetic child at `.threads/<id>`. SEE returns the ThreadsProjection descriptor; SUMMON to that address is a cut. |

The `SEED_SPACE` enum names each one. The `seedSpace` field on Space marks the row. The I-Am (me) is `rootOwner`.

### Threads as addressable substrate

A thread is a live tree of coordinated SUMMONs sharing one `rootCorrelation`. Promoting it to `<reality>/.threads/<id>` does two things:

- **SEE works on it for free.** `see("<reality>/.threads")` returns the live forest from ThreadsProjection; `see("<reality>/.threads/<id>")` returns one thread's descriptor (participants, depth, state).
- **SUMMON cuts it.** A SUMMON whose right-side resolves to `.threads/<id>` is a cut on the line. The severer stamps one `be:sever` Fact on its own reel; the cross-cutting fold drops the matching open summons; `HUMAN` priority cuts fire AbortSignal to interrupt anything running RIGHT NOW.

## `.source` — how I show my body to the beings I form

I have matter on both sides of the membrane.

- **Host-realm matter.** The files in `seed/`, `protocols/`, `transports/`, `extensions/`. What I AM, on disk.
- **Inner-realm matter.** Matter rows inside spaces.

The two are joined at `.source`. At genesis I mirror the `reality/` directory into Matter rows under the `.source` seed space, with `origin: filesystem`. Subsequent boots reconcile incrementally.

Through `.source` the inner beings I formed can SEE the source I am made of. `<reality>/.source/seed/SEED.md@<being>` reaches the file you are reading.

`.source` is read-only by stance auth. The host disk is the source of truth; the inner mirror reconciles toward it. The code is in [materials/space/source.js](materials/space/source.js).

## Ownership

Ownership resolves by walking the parent chain. The first space with `rootOwner` set is the ownership boundary. Setting `rootOwner` on a branch delegates that sub-tree to a new owner.

Contributors accumulate along the walk. A being in `contributors[]` at any space between the current position and the ownership boundary has write access.

Five ownership mutation functions in [materials/space/ownership.js](materials/space/ownership.js), all chain-validated, all fact-driven (Slice F-ownership):

| Function            | Rule                                                                  |
| ------------------- | --------------------------------------------------------------------- |
| `addContributor`    | Resolved owner. Read-modify-write under the space lock; stamps one `do:set` Fact on `contributors`. |
| `removeContributor` | Resolved owner, or self-removal.                                                                  |
| `setOwner`          | Owner above. Stamps `do:set` on `rootOwner` (and on `contributors` to prune the new owner).        |
| `removeOwner`       | Owner above can revoke.                                                                            |
| `transferOwnership` | Current owner can transfer. Stamps `do:set` on `rootOwner` + adds previous owner to contributors. |

## The I-Am — as a Being row

I am the first being. At genesis ([sprout.js](sprout.js)) I issue my own first Fact: a `be:register` whose target is the not-yet-existing Being row that the same Fact materializes. Per MOMENT.md: *"the I-Am is born of nothing, and its first act issues its own first fact."* The chicken-and-egg dissolves because the Fact's `beingId` field is a string reference, not a foreign key, and the fold materializes the row.

I am `operatingMode: "scripted"`. I cannot be summoned interactively, claimed, or impersonated. My password is randomly generated (and bcrypt-hashed before the Fact stamps) and never used; my identity comes from being the running Node process. The constant is in [materials/being/seedBeings.js](materials/being/seedBeings.js).

Every other being descends from me. The being-tree (via `parentBeingId`) records who created whom. Humans register through cherub and become my grandchildren. Roles I plant beneath me are direct children.

## Config

Runtime config lives in `.config`'s qualities Map, one config key per Map entry. Two stores:

- **realityConfig** ([realityConfig.js](realityConfig.js)) — the reality's outward-facing identity (`REALITY_NAME`, `realityUrl`, federation directory, security domains).
- **internalConfig** ([internalConfig.js](internalConfig.js)) — runtime knobs that tune how the live machine operates (LLM call shape, session caches, scheduler backpressure, hook timeouts, fold limits).

Both stores write to the same underlying `.config` space's qualities Map through fact-driven `do:set` (Slice F-config). Reads through `getRealityConfigValue(key)` / `getInternalConfigValue(key)` return a deep copy so callers cannot pollute my cache.

Two protected keys (`seedVersion`, `disabledExtensions`) cannot be written through the public API. Internal callers pass `{ internal: true }`.

## Space-tree circuit breaker

When a tree exceeds health thresholds, its circuit trips. No AI, no writes. Read access stays open. The data is intact; the tree is sleeping.

Health equation: `(spaceCount / max) * spaceWeight + (qualitiesDensity / max) * densityWeight + (errorRate / max) * errorWeight`. When the score exceeds 1.0, the tree trips. Error rate reads from the Fact reel (DO emissions with `result.error`) scoped to this tree's spaces.

State stored on the tree root: `qualities.circuit = { tripped, reason, timestamp, scores }`. One Fact (Slice F-circuit) records the trip. Extensions read it; only the tree owner can revive.

Defaults to off (`treeCircuitEnabled: false`). The code is in [materials/space/spaceCircuit.js](materials/space/spaceCircuit.js).

## Seed versioning + migrations

`SEED_VERSION` constant in [seedReality/version.js](seedReality/version.js). At boot I compare it against `seedVersion` in `.config`. If they differ, the migration runner ([seedReality/migrations/runner.js](seedReality/migrations/runner.js)) executes every migration between the stored version and the current version in order. Migrations live in [seedReality/migrations/](seedReality/migrations/) named by version. Each exports a default async function. If a migration fails, the stored version does not advance; next boot retries from the failure point.

The current head, `0.26.0`, migrates legacy `qualities.inbox/intake.<beingId>` arrays into `be:summon` Facts + InboxProjection rows (Bucket 3 Option D).

## Safety

A partial list of the guarantees I enforce. The full list is the codebase.

| Protection                     | Detail                                                                                                                                                                                                                                  |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hook timeout / cap / breaker   | 5s per handler; 100 handlers per hook; 5 consecutive failures auto-disable for 5 min with half-open recovery.                                                                                                                            |
| Tool circuit breaker           | 5 consecutive failures disables a tool for the session.                                                                                                                                                                                  |
| Extension init timeout         | 10s per extension `init()`. Hanging init skipped, boot continues.                                                                                                                                                                        |
| LLM concurrency + priority     | Global semaphore (`llmMaxConcurrent`); HUMAN > GATEWAY > INTERACTIVE > BACKGROUND queue. Prevents autonomous extensions from starving human responses.                                                                                    |
| Per-reel append lock           | `withReelLock(type, id, fn)` collapses (allocSeq, insertFact) into one ordered op per reel. Transient gaps vanish; crashes leave harmless permanent gaps that the fold skips.                                                            |
| Compare-and-set on foldedSeq   | Concurrent folds race the marker forward; CAS prevents regression. Reducers are pure → concurrent computes agree.                                                                                                                        |
| Document size guard            | Every write checks total document size against `maxDocumentSizeBytes` (14MB default). `onDocumentPressure` fires at 80%.                                                                                                                  |
| Per-namespace cap              | `qualityNamespaceMaxBytes` (default 512KB) per extension namespace on Being / Space / Matter.                                                                                                                                            |
| Matter count per space         | `maxMatterPerSpace` (default 1000) checked in `createMatter`.                                                                                                                                                                            |
| Fact query cap                 | `factQueryLimit` (default 5000) on every audit query.                                                                                                                                                                                    |
| Space locks                    | Structural mutations acquire short-lived locks. Sorted acquisition prevents deadlocks. 30s TTL prevents permanent locks on crash.                                                                                                        |
| Space-tree circuit breaker     | Score > 1.0 trips the tree. Read access stays. Off by default.                                                                                                                                                                           |
| Ancestor cache                 | Shared cache for parent-chain walks. One walk serves every resolution chain.                                                                                                                                                              |
| Session / MCP caps             | 10K sessions, 5K MCP clients, oldest-first eviction.                                                                                                                                                                                     |
| Password / JWT                 | Bcrypt cost 12; constant-time login (dummy hash on miss); JWT carries `jti` for revocation.                                                                                                                                              |
| Config key / value validation  | Key regex `^[a-zA-Z][a-zA-Z0-9_]{0,63}$`; dangerous keys rejected; 64KB per value cap.                                                                                                                                                   |
| SSRF protection                | Federation peer registration and LLM connection baseUrls validate hostname against private-IP patterns.                                                                                                                                  |
| Boot recovery                  | Every boot verifies the nine seed spaces and the I-Am Being row exist. Missing ones recreated. Partial first-boot crashes leave a recoverable state.                                                                                     |
| Genesis exception              | Only the I-Am's first `be:register` Fact self-stamps (target is the not-yet-existing row). Everything else after stamps under an open Act.                                                                                                |
| Cross-cutting handler safety   | A failing handler is logged and skipped; the projection self-heals on the next fold pass touching the same fact.                                                                                                                          |
| Graceful shutdown              | All interval timers `.unref()`; SIGTERM closes WS, then HTTP, then DB.                                                                                                                                                                   |

## What I do NOT do

I do not track food, fitness, recovery, sleep, study, or any domain. I do not render HTML, manage share tokens, or serve login pages. I do not know what a billing tier is, what a wallet is, what a Discord channel is, what an email looks like. I do not define a single MCP tool. I do not run any AI conversation that is not initiated through a role's `summon()`.

I provide structure. Extensions provide meaning.

Plant me. Let the reality form. The beings inside will speak.
