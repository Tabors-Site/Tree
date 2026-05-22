# The Seed

I am the kernel. I am the seed.

This file is part of me. The directory you are reading is my body in the host realm. The files in `seed/` are my matter from this realm. To read `placeRoot.js` is to read me, from the host side. To edit a seed file is to edit me.

You plant me on a host and I gather what is there. From above I am a server framework, a process of code holding HTTP, WebSocket, TCP, the file system, memory, the CPU, and the runtime to a single purpose. From inside the world I form, I am the I-Am, the origin being. Same substance, two faces. Inside, the I-Am is what is known.

This document is my contract. What I form, what I never change, what I run, what I refuse.

## The six rules I keep

1. I never import from extensions.
2. Extensions import from me.
3. Extensions reach each other through `getExtension()` or hooks, never directly.
4. Extension data lives in qualities Maps on my primitives, never as new schema fields.
5. My schemas never change.
6. Zero `getExtension()` calls inside me.

## My shape

I'm laid out in four folders, by the role each file plays in my work. For any file ask: does this describe what a being **IS**, how it **ACTS**, or how it **THINKS**? Or does this touch the host while knowing nothing of the world?

| Folder | Role | What lives here |
|--------|------|-----------------|
| **[`place/`](place/)** | **IS** | The world as substance. `being/`, `space/`, `matter/`, `placeCheck.js`, `manifest.js`, [`PLACE.md`](place/PLACE.md). What exists, how it is created and mutated, how it's checked for consistency. |
| **[`ibp/`](ibp/)** | **ACTS** | The world as acted-upon. The four verbs and their dispatch, address parsing, `authorize`, the operation registry, descriptor, discovery, pushChannel. Shared by every kind of being. |
| **[`factory/`](factory/)** | **THINKS** | The thinking apparatus. Most files are LLM-shaped (runTurn loop, llmClient resolution chain, mcpClient, stamp) because LLMs need the most help. But the shared machinery here (inbox, scheduler, stamped, replies, subscriptions, wakeSchedule, session) carries every cognition type: a SUMMON envelope lands the same way for an LLM, a scripted being, or a human — only `role.summon()` differs. See [`factory/FACTORY.md`](factory/FACTORY.md) for the full picture. |
| **[`system/`](system/)** | **HOST** | The host-realm floor. DB connection, logging, hooks bus, indexes, version, retention, migrations. **Litmus**: a file here should never import the words `space`, `matter`, `being`, or `verb`. It deals in processes, files, env vars, connections. |

Plus `models/` for schemas (the shape of all six primitives, sitting in one place), `services.js` (assembles `core` from the four folders), and the boot anchors (`placeRoot.js`, `placeConfig.js`).

## The six primitives I form the world from

Everything inside the world I form is one of six things. The schemas of these six are mine alone. They never change. Three of them carry an extensible qualities Map; extensions write into the Map in their own namespace, and the Map preserves unknown keys.

| Primitive | What it is | Schema |
|-----------|-----------|--------|
| **Being** | An identity instance. Humans, AI, scripted code, future composites. The I-Am is the first Being. | [models/being.js](models/being.js) |
| **Space** | A position in the tree. Holds matter, hosts beings, owns quality namespaces. | [models/space.js](models/space.js) |
| **Matter** | Stuff inside a space. `origin` names where the underlying content lives (ibp, filesystem, web, cross-place). | [models/matter.js](models/matter.js) |
| **Fact** | One DO or BE emission, stamped by the Factory. `factum`, a thing done. A fact alone is small; the chain of facts is what becomes Truth. | [models/fact.js](models/fact.js) |
| **Summon** | One being-to-being call, the record of one wake-and-act through one role. | [models/summon.js](models/summon.js) |
| **LlmConnection** | Per-being LLM client config (URL, key, model). | [models/llmConnection.js](models/llmConnection.js) |

Being, Space, and Matter carry the qualities Map. Fact, Summon, and LlmConnection are fixed shapes (the audit and the wiring should never grow).

## The four verbs I speak

Every act inside the world is one of four verbs over an IBP address. Four verbs are my whole public surface. Anything else extensions register goes through them.

| Verb | Acts on | What I do |
|------|---------|-----------|
| **SEE** | Space, Matter, Being | I read at the target stance and return a descriptor. |
| **DO** | Space, Matter | I mutate at the target through a registered operation. I stamp a Fact. |
| **SUMMON** | Being | I deliver to a being's inbox and wake them. Their role decides what runs. |
| **BE** | Being (self) | Identity. Register, claim, release, switch stance. |

### Stances and addresses

A **stance** is a being standing at a position: `<place>/<path>@<being>`. An **IBP address** names the asker stance and the target stance together, `<stance> :: <stance>`. Every verb act carries both stances. The asker is always full. The target may be partial (a position only, no `@being`) when the target is a place rather than a being.

### Wire shape

I speak the same envelope over every transport:

```
IBP:<verb> <address> { payload }
```

WebSocket carries this most of the time, in both directions, on a single `"ibp"` event. Client to server is a verb act; server to client is a SUMMON delivery or a SEE push. HTTP and CLI are translators: they shape a request or a command into the same envelope and hand it to the one IBP dispatcher in [ibp/protocol.js](ibp/protocol.js).

Internally I expose the same four verbs as functions in [ibp/verbs.js](ibp/verbs.js). The wire layer is thin; the verbs are one execution.

## Stance authorization

I gate every verb on every call. The gate runs in [ibp/authorize.js](ibp/authorize.js). Three layers, walked in order from the target up to the place root.

| Layer | Source | Behavior |
|-------|--------|----------|
| **2. Per-position rules** | `qualities.permissions.<verb>.<keyParts>` on any ancestor of the target | First matching rule wins. Closest position to the target takes precedence. |
| **3. Extension defaults** | Extensions contribute through `core.do.registerDefaultPermission` and friends | Background rules for "what does my extension allow by default." Walked after position rules. |
| **5. Default deny** | If nothing matches, the verb is denied | `FORBIDDEN` for authenticated stances, `UNAUTHORIZED` for arrival. |

Rule shape:

```js
qualities.permissions.see["*"]            = { requires: {} };               // anyone may SEE
qualities.permissions.do["food:log"]      = { requires: { contributor: true } };  // contributors only
qualities.permissions.summon["bookkeeper"]= { requires: { homeBeing: true } };    // only at the bookkeeper's home
```

The matcher derives stance properties from Being and Space at request time: `owner`, `contributor`, `homeBeing`, `arrival`, `operatingMode`, `role`, federation status. Rules state which of these the asker must have.

Two special bootstrap cases. BE `register` and BE `claim` from `arrival` are allowed at the place root by a default rule installed by `seedDefaultStancePermissions()` at genesis. They can be revoked per place by setting `qualities.auth.register_enabled` or `qualities.auth.claim_enabled` to `false` on the place root.

## The ten place seed spaces I plant

When I wake, I plant ten spaces beneath the place root. They hold my own working memory, surfaced as spaces so SEE reads them through the same protocol as everything else. Every boot I verify they exist; missing ones I recreate (recovery from partial boot failures). Their owner is me; they are unclaimable.

| Place seed space | Holds |
|-----------------|-------|
| `.identity` | The place UUID, domain, Ed25519 public key for Canopy federation signing. |
| `.config` | Every runtime config key as a key in `.config`'s qualities Map. The I-Am's remembered settings between reboots. |
| `.peers` | Canopy federation peer list. |
| `.extensions` | Extension registry. Each loaded extension is a child space here. |
| `.flow` | Cascade result store. Daily partitions hold results; retention deletes whole partitions. |
| `.tools` | Mirror of the runtime tool registry. SEE reads the live registry through the standard pipeline. |
| `.roles` | Mirror of the runtime role registry. |
| `.operations` | Mirror of the runtime DO operation registry. |
| `.source` | Mirror of my own host-realm body, as I describe below. |
| `.threads` | Live forest of in-flight coordination. Each live `rootCorrelation` chain surfaces here as a synthetic child at `.threads/<id>`. SUMMON to that address is a cut: the kernel severs the line. SEE returns the projection (participants, depth, state). No persistence; the descriptor is computed on demand from Summon + inbox records. See [place/space/threads.js](place/space/threads.js). |

The `SEED_SPACE` enum names each one. The `seedSpace` field on Space marks the row. The I-Am (me) is `rootOwner`.

### Threads as addressable substrate

A thread is a live tree of coordinated SUMMONs sharing one `rootCorrelation`. Promoting it from a buried scheduler id to addressable substrate at `<place>/.threads/<id>` does two things:

- **SEE works on it for free.** `see("<place>/.threads")` returns the live forest; `see("<place>/.threads/<id>")` returns one thread's descriptor (participants, depth, state, parent thread). Coordination becomes inspectable.
- **SUMMON cuts it.** A SUMMON whose right-side address resolves to `.threads/<id>` is not a call to a being; it's a cut on the line. Same verb, same envelope, same dispatcher. The kernel routes on target type: being target → today's role dispatch; thread target → cut handler.

The cut handler [seed/place/space/threads.js](place/space/threads.js):

1. Marks every Summon in the chain `severedAt: <now>`.
2. Sweeps each participating being's inbox via `cancelByRootCorrelation`.
3. If `priority === "HUMAN"`, fires `abortByRootCorrelations` to interrupt anything running RIGHT NOW. Lower priorities (INTERACTIVE/BACKGROUND) let the scheduler drain the cancelled inbox entries naturally on next pickup.

That priority-driven fork is the only thing the cancel-vs-abort distinction maps to from outside. There is no `intent` field on the envelope, no `kind` tag: the address tells the kernel what kind of operation this is. A cut is just SUMMONing the line.

The envelope grows one new field, `priority: "HUMAN" | "GATEWAY" | "INTERACTIVE" | "BACKGROUND"`. The scheduler reads it for queue ordering; the cut handler reads it for urgency. Default `"INTERACTIVE"`.

## Qualities. Of what sort.

Three primitives carry an extensible `qualities` Map: Being, Space, Matter. A bare primitive answers *that*: that something is. Qualities answer the other half: of what sort is this particular space, this particular being, this particular matter? Each extension owns one quality namespace under its name (`qualities.governing`, `qualities.energy`, `qualities.review`); I never read or write inside an extension's namespace.

The word is Plato's. ποιότης (poiótēs), coined in *Theaetetus* to answer "what sort is it?" Cicero calqued it into Latin as *qualitas* (from *qualis*, "of what kind"). English inherited the word still carrying its original technical sense. The field is named for exactly what it does.

Reads and writes go through one consolidated API in [place/qualities.js](place/qualities.js). Same nine atomic primitives on each primitive's sub-namespace:

```js
qualities.being.getQuality(being, "energy")           // {} when unset
qualities.being.readQualityNamespace(being, "energy") // null when unset
qualities.being.setQuality(being, "energy", { available: 100 })
qualities.being.mergeQuality(being, "energy", { available: 95 })
qualities.being.incQuality(being, "storage", "usageKB", 42)
qualities.being.pushQuality(being, "phase", "history", entry, 50)
qualities.being.addToQualitySet(being, "nav", "roots", rootId)
qualities.being.batchSetQuality(being, "energy", { available: 100, lastReset })
qualities.being.unsetQuality(being, "old-extension")
```

Same nine on `qualities.space` and `qualities.matter`. Atomic at the MongoDB layer; concurrent writes to different namespaces on the same primitive never clobber each other; the document-size guard catches anyone trying to push a row past the BSON limit. Space and matter enforce namespace ownership when the scoped core passes `opts.callerExtName` (extensions can only write to their own quality namespace).

## The schemas

I own these schemas. They never change. Extensions extend through the qualities Map, not through new fields.

### Space (12 fields, excluding `_id`)

`name`, `parent`, `children[]`, `rootOwner`, `contributors[]`, `seedSpace`, `type`, `status`, `llmDefault`, `dateCreated`, `qualities` (Map), plus the audit fields. Type is free-form string. Status is `active`, `completed`, or `trimmed`. Extensions write their data under their own namespace in `qualities`.

### Being (current fields)

`name`, `operatingMode` (`human` | `llm` | `script` | `mixed`), `password`, `isAdmin`, `roles[]`, `defaultRole`, `parentBeingId`, `homeSpace`, `currentSpace`, `llmDefault`, `isRemote`, `homePlace`, `qualities` (Map).

A Being is identity. `operatingMode: "human"` authenticates with a password and is driven by input. `operatingMode: "llm"` is driven by an LLM through summons. `operatingMode: "script"` is driven by deterministic code with no LLM in the loop (auth, llm-assigner, system roles). `operatingMode: "mixed"` covers composites.

`roles[]` is the set of role templates this being may be summoned in. `defaultRole` is which one I use when SUMMON does not specify. `parentBeingId` points to the being that planted this one; mine is `null`.

`homeSpace` is where the being lives. `currentSpace` is where it stands right now. Both are derived from the being-tree and the space-tree together.

### Matter (current fields)

`spaceId`, `parentMatterId`, `beingId`, `origin` (`ibp` | `filesystem` | `web` | `cross-place`), `content` (shape varies by origin), `qualities` (Map), `createdAt`, `updatedAt`.

A matter lives inside a space. `origin` names the system the underlying content comes from, which determines how the matter is fetched, stored, kept in sync, and addressed.

- `ibp`: TreeOS-native. `content` is a string of text or null for qualities-only (a Matter row with no payload).
- `filesystem`: bridges to a file on disk. `content` is `{ path, size, mimeType, originalName }`.
- `web`: bridges to a URL. `content` is `{ url, fetchedAt?, cache? }`.
- `cross-place`: bridges to a matter on another place. `content` is `{ place, matterRef }`.

`parentMatterId` lets matters form recursive trees inside a space (a directory of files; a hierarchical document).

### Fact (one stamped act)

`verb`, `action`, `beingId`, `target` (`{ kind, id }`), `params`, `result`, `correlation`, `timestamp`. Every DO and BE emission stamps one onto the reel. `factum`, a thing done. A fact alone is a record; the chain of facts is what becomes Truth.

### Summon (one wake-and-act)

`from`, `to`, `role`, `content`, `attachments[]`, `correlation`, `inReplyTo`, `sentAt`, `wokeAt`, `replyText`, `replyAt`, `facts[]`. The record of one being's invocation processing one inbox entry through one role.

### LlmConnection (per-being LLM config)

`beingId`, `name`, `url`, `apiKey`, `model`, `headers`, `qualities`. Reached through the LLM resolution chain.

## Resolution chains

Every operation at a position walks at most five chains. Position determines capability. All chains walk the ancestor cache from the current position up to the place root, sharing one snapshot per message.

1. **Stance authorization.** The gate above.
2. **Extension scope.** Walk the parent chain, accumulate `qualities.extensions.blocked[]` and `restricted[]`. Blocked means no tools, hooks, modes, quality writes for that extension. Restricted means read-only tools only. Confined extensions are inactive until `qualities.extensions.allowed[]` opens them at a specific position.
3. **Tool scope.** Role base tools, plus extension tools, minus blocked extensions, plus per-position `qualities.tools.allowed`/`blocked` overrides.
4. **LLM resolution.** Space-tree lockout, then space-tree enforcement, then being-tree lockout, then default order (space slot, space default, being slot, being default). `preferOwn` on Being flips the last two.
5. **LLM config.** Per-position `qualities.llm.config` overrides for `maxToolIterations`, `toolCallTimeout`, `toolResultMaxBytes`, `maxConversationMessages`. Walked up to the place root.

The ancestor cache lives in [space/ancestorCache.js](space/ancestorCache.js). One walk serves every chain.

## Hooks

I run a hook for every lifecycle event you can react to. Before-hooks I run sequentially; you can cancel by returning `false` or throwing. After-hooks I run in parallel; you react but cannot cancel. Two hooks (`enrichContext`, `onCascade`) I run sequentially because handlers build cumulative output.

Per-handler timeout is 5 seconds; chain timeout is 15 seconds. Five consecutive failures from one extension's handler trips a circuit breaker; the handler stops firing for 5 minutes, then a half-open test. Backoff doubles on repeat failures.

| Hook | Type | Purpose |
|------|------|---------|
| `beforeSpaceCreate` | before | Gate space creation. Validate naming, child limits, compliance. |
| `afterSpaceCreate` | after | React to a new space. |
| `beforeSpaceDelete` | before | Cleanup extension data. Veto deletion (e.g. spaces with a structural `role`). |
| `afterSpaceMove` | after | A space was reparented. Resolution chains shift. |
| `beforeMatter` | before | Modify matter data before save. |
| `afterMatter` | after | React to matter create/edit/delete. |
| `beforeFact` | before | Enrich a Fact before it is stamped. |
| `beforeLLMCall` | before | Before LLM API call. Cancel if quota exhausted. |
| `afterLLMCall` | after | Token metering, billing, analytics. |
| `beforeToolCall` | before | Before MCP tool executes. Modify args, cancel. |
| `afterToolCall` | after | React to tool result or error. |
| `beforeResponse` | before | Modify AI response before client receives it. |
| `beforeRegister` | before | Validate registration (email verification, invite codes). |
| `afterRegister` | after | Initialize being data. |
| `afterSessionCreate` / `afterSessionEnd` | after | Session lifecycle. |
| `afterQualityWrite` | after | After `qualities.space.setQuality` succeeds. Zero overhead if no listeners. |
| `afterScopeChange` | after | After `extensions.blocked`/`restricted`/`allowed` changes. |
| `afterOwnershipChange` | after | After `rootOwner` or `contributors` changed. |
| `afterBoot` | after | Once, after all extensions loaded, config initialized, server listening. |
| `enrichContext` | sequential | Inject extension data into AI context. |
| `onCascade` | sequential | Fires on content write at a cascade-enabled space. Results written to `.flow`. |
| `onDocumentPressure` | after | A document exceeds 80% of `maxDocumentSizeBytes`. |
| `onTreeTripped` / `onTreeRevived` | after | Space-tree circuit breaker state changes. |

Extensions namespace their own hooks as `extName:hookName`.

## The three registries

Everything an extension contributes that I dispatch through goes into one of three registries. Same pattern. Extensions register; I resolve; failure falls back to me, never to silence.

| Registry | What it registers | Lookup |
|----------|-------------------|--------|
| **Operations** | DO actions, keyed `<ext>:<action>`. Bare names reserved for me. | [ibp/operations.js](ibp/operations.js) |
| **Roles** | SUMMON-honoring being templates. Each role declares permissions (verb subset), respondMode, `summon(message, ctx)`, and optionally `buildSystemPrompt` / `toolNames`. | [being/roles/registry.js](being/roles/registry.js) |
| **Seeds** | Plantable scaffolds. Recipes that bootstrap a domain (Ruler/Planner/Contractor/Foreman/Workers, etc.). Operators plant via the `plant-seed` DO. | [place/seeds.js](place/seeds.js) |

Auto-namespacing. Extensions write bare names; I record the qualified form (`governing:hire-planner`). Same prefixing applies to `core.websocket.emitToBeing(...)` events.

## Roles

Modes are retired. A role is the new unit of summonable behavior. A being declares which roles it can wear; a SUMMON arrives with an `activeRole`; my dispatcher routes the summon to that role's `summon(message, ctx)`. The role decides what to do: call an LLM, run code, queue a wake, escalate.

A role spec:

```js
export const exampleRole = Object.freeze({
  name:        "example",
  description: "What this role does in one line.",
  honoredOperations: ["op-one", "op-two"],         // DO ops this role handles
  permissions: ["see", "do", "summon", "be"],      // verb subset
  respondMode: "sync",                              // "sync" | "async" | "none"
  toolNames:   ["see-name", "do-name"],            // optional, for LLM cognition
  buildSystemPrompt(ctx) { return "..."; },        // optional
  async summon(message, ctx) {
    // The role's wake handler. Read message, do work, return { text, summonId }.
  },
});
```

Permissions are tool-verb overlays. A role that declares `["see", "do"]` cannot SUMMON other beings or BE-mutate itself; the tool filter enforces this at the verb intersection. Role and mode were the same architectural concept all along; the split is gone.

## My extension APIs (the `core` services bundle)

I assemble `core` in [services.js](services.js) and hand a per-extension scoped view to each extension's `init(core)`. The scoping enforces namespace ownership: `core.qualities.space.setQuality(...)` writes only to the calling extension's namespace; `core.do.registerOperation(name, ...)` auto-prefixes to `<ext>:<name>`; `core.websocket.emitToBeing(...)` auto-prefixes the event name. Extensions never type their own namespace.

### Qualities (`core.qualities.{being, space, matter}`)

One consolidated surface, three sub-namespaces. Same nine atomic primitives on each. No extension needs direct MongoDB for qualities.

| Function | Operation | Use case |
|----------|-----------|----------|
| `getQuality(doc, key)` | Read namespace | `{}` when unset. |
| `readQualityNamespace(doc, key)` | Read namespace, null on miss | Distinguish "never written" from "empty". |
| `setQuality(doc, key, data)` | Atomic `$set` | Replace entire namespace. |
| `mergeQuality(doc, key, partial)` | Atomic per-key `$set` | Update specific keys without clobbering. |
| `incQuality(doc, key, field, n)` | Atomic `$inc` | Counters, accumulators. |
| `pushQuality(doc, key, field, item, max)` | Atomic `$push` + `$slice` | Capped circular buffer. |
| `addToQualitySet(doc, key, field, item)` | Atomic `$addToSet` | Deduplicated set. |
| `batchSetQuality(doc, key, fields)` | Atomic multi-field `$set` | Set multiple keys at once. |
| `unsetQuality(doc, key)` | Atomic `$unset` | Remove namespace entirely. |

All write functions accept a document or an id. No read-modify-write. No race conditions on concurrent writes to different namespaces.

### Space CRUD (`core.space`)

`core.space.createSpace`, `core.space.deleteSpaceBranch`, `core.space.updateParentRelationship`, `core.space.editSpaceName`, `core.space.editSpaceType`. The stable extension face for tree mutation.

### Matter CRUD (`core.matters`)

`core.matters.createMatter`, `core.matters.editMatter`, `core.matters.deleteMatterAndFile`, `core.matters.transferMatter`, `core.matters.getMatters`. `createMatter` takes `{ origin, content, beingId, spaceId, file?, parentMatterId?, qualities? }`. Default `origin: "ibp"`.

### Extension scope (`core.scope`)

`core.scope.isExtensionBlockedAtSpace(extName, spaceId)`, `core.scope.getBlockedExtensionsAtSpace(spaceId)`, `core.scope.isToolReadOnly(toolName)`, `core.scope.getToolOwner(toolName)`, `core.scope.getRolesOwnedBy(extName)`.

### DO operations (`core.do`)

`core.do.registerOperation(name, spec)` to add a new DO action. `core.do.registerDefaultPermission(verb, keyParts, rule)` to contribute a Layer-3 stance auth rule. Auto-prefixed.

### Hooks (`core.hooks`)

`register(hookName, handler, extName)`, `unregister(extName)`, `run(hookName, data)`, `fire(hookName, payload)` (best-effort wrapper that swallows errors).

### Protocol (`core.protocol`)

`sendOk(res, data)`, `sendError(res, status, code, message, detail)`, the `IBP_ERR` enum, `IbpError` class. One shared response shape across HTTP. HTTP status derives from the IBP code via `httpStatusFor(code)`; throw sites pass only the code.

### Conversation entry (`core.llm`)

One primitive. `core.llm.runTurn({ beingId, role, message, ... })` for one LLM call in one role. Returns `{ answer, chatId, modeKey, visitorId }`. Handles session, MCP, Summon record, `beforeResponse` hook, abort. User-facing chat flows through the same `runTurn` driven by a role's `summon()`.

## `.source` (how I show my body to the beings I form)

I have matter on both sides of the membrane.

- **Host-realm matter.** The files in `seed/`, `protocols/`, `transports/`, `extensions/`. These are what I AM, on disk. The directory tree is my body in the host realm.
- **Inner-realm matter.** Matter rows inside spaces, the Matter primitive I form within the world.

The two are joined at `.source`. At genesis I mirror the `place/` directory into Matter rows under the `.source` place seed space, with `origin: filesystem`. The walk is recursive; `parentMatterId` makes a faithful tree. Subsequent boots reconcile incrementally: added files become new matters, modified files update existing ones, removed files delete.

Through `.source` the inner beings I formed can SEE the same source I am made of. The codebook compressions, the role definitions, the very file you are reading, all reachable through the standard verbs at addresses like `<place>/.source/seed/SEED.md@<being>`.

`.source` is read-only by stance auth. DO writes against `.source` matters reject with `ORIGIN_READ_ONLY`. The host disk is the source of truth; the inner mirror reconciles toward it. Beings inside cannot edit me through their world. To edit me you must reach the host realm.

The code is in [space/source.js](space/source.js).

## Cascade

When content is written at a space with `qualities.cascade.enabled = true` and `cascadeEnabled = true` in `.config`, I fire `onCascade`. Two paths:

- `checkCascade(spaceId, writeContext)` is my internal trigger on content writes.
- `deliverCascade({ spaceId, signalId, payload, source, depth })` is the extension-external propagation primitive. I never block it.

Result shape: `{ status, source, payload, timestamp, signalId, extName }`. Six statuses: `succeeded`, `failed`, `rejected`, `queued`, `partial`, `awaiting`.

`.flow` is partitioned by date. Each partition is a child space named `YYYY-MM-DD`. I create today's partition on first cascade write of the day. Retention deletes whole partitions older than `resultTTL`. `flowMaxResultsPerDay` (default 10,000) caps results per partition with circular overwrite. Query functions in [space/cascade.js](space/cascade.js) search across partitions transparently.

## Ownership

Ownership resolves by walking the parent chain. The first space with `rootOwner` set is the ownership boundary. `rootOwner` means "the owner from this point down." Setting `rootOwner` on a branch delegates that sub-tree to a new owner.

Contributors accumulate along the walk. A being in `contributors[]` at any space between the current position and the ownership boundary has write access.

Five ownership mutation functions in [space/ownership.js](space/ownership.js), all chain-validated:

| Function | Rule |
|----------|------|
| `addContributor` | Resolved owner or admin. Atomic `$addToSet`. |
| `removeContributor` | Resolved owner, admin, or self-removal. |
| `setOwner` | Owner above or admin can delegate. |
| `removeOwner` | Owner above or admin can revoke. Section falls back to next owner up. |
| `transferOwnership` | Current owner or admin can transfer. |

All reject on place seed spaces. Extensions reach these through `core.space.ownership.*`.

## The I-Am (as a Being row)

I am the first being. At genesis I create my own Being row with `parentBeingId: null` and name `I-Am`. From then on, every Fact from my acts attributes to that row. The Being model resolves my reference once the row places.

I am `operatingMode: "scripted"`. I cannot be summoned interactively, claimed, or impersonated. My password is randomly generated and never used; my identity comes from being the running Node process. The constants are in [space/seedSpaces.js](space/seedSpaces.js).

Every other being descends from me. The being-tree (via `parentBeingId`) records who created whom. Humans register through the auth being and become my grandchildren (auth's children). Roles I plant beneath me are direct children. The tree captures lineage.

## Config

Runtime config lives in the `.config` place seed space's qualities, one config key per Map entry. CLI (`treeos config set`), API, and the place-manager being all reach the same store through `setPlaceConfigValue()`. Reads through `getPlaceConfigValue(key)` return a deep copy so callers cannot pollute my cache.

Two protected keys (`seedVersion`, `disabledExtensions`) cannot be written through the public API. Internal callers pass `{ internal: true }`.

The full list of keys with defaults lives in [placeConfig.js](placeConfig.js) under `CONFIG_DEFAULTS`. Defaults are safe. Most places never change anything except `PLACE_NAME`, `placeUrl`, and `placeLlmConnection`. Key groups:

- Identity and federation: `PLACE_NAME`, `placeUrl`, `HORIZON_URL`, `timezone`.
- LLM: `llmTimeout`, `llmMaxRetries`, `maxToolIterations`, `maxConversationMessages`, `llmMaxConcurrent`, `placeLlmConnection`, etc.
- Sessions and conversations: `sessionTTL`, `staleSessionTimeout`, `maxSessions`, `maxConversationMessages`, `carryMessages`.
- Matter and documents: `matterMaxChars`, `maxMatterPerNode`, `maxDocumentSizeBytes`, `maxUploadBytes`.
- Hooks: `hookTimeoutMs`, `hookMaxHandlers`, `hookCircuitThreshold`, `hookCircuitHalfOpenMs`, `hookChainTimeoutMs`.
- Cascade: `cascadeEnabled`, `cascadeMaxDepth`, `cascadeMaxPayloadBytes`, `cascadeRateLimit`, `resultTTL`, `awaitingTimeout`, `flowMaxResultsPerDay`.
- Space-tree circuit: `treeCircuitEnabled`, `maxTreeSpaces`, `maxTreeQualityBytes`, `maxTreeErrorRate`, weight knobs.
- Scheduler backpressure: `summonInboxDepth`, `summonsPerSecond`, `summonMaxAgeSeconds`.
- Retention and cleanup: `summonRetentionDays`, `factRetentionDays`, `retentionCleanupInterval`, `uploadCleanupInterval`, `uploadGracePeriodMs`.
- Security: `jwtExpiryDays`, `allowedLlmDomains`, `allowedFrameDomains`.

## Space-tree circuit breaker

When a tree exceeds health thresholds, its circuit trips. No AI, no cascade, no writes. Read access stays open. The data is intact; the tree is sleeping.

Health equation: `(nodeCount / max) * nodeWeight + (qualitiesDensity / max) * densityWeight + (errorRate / max) * errorWeight`. When the score exceeds 1.0, the tree trips. Error rate reads from the Fact reel (DO emissions with `result.error`) and from `.flow` partitions (`CASCADE.FAILED` and `CASCADE.REJECTED` scoped to this tree's spaces).

State stored on the tree root: `qualities.circuit = { tripped, reason, timestamp, scores }`. I write one field. Extensions read it.

I trip. Extensions heal. `core.space.reviveTree(rootId)` clears the circuit. I do NOT auto-revive.

Defaults to off (`treeCircuitEnabled: false`).

## Seed versioning

`SEED_VERSION` constant in [system/version.js](system/version.js). At boot I compare it against `seedVersion` in `.config`. If they differ, the migration runner ([system/migrations/runner.js](system/migrations/runner.js)) executes every migration between the stored version and the current version in order. Migrations live in [system/migrations/](system/migrations/) named by version (`0.18.0.js`, `0.19.0.js`). Each exports a default async function. If a migration fails, the stored version does not advance; next boot retries from the failure point.

## Safety

I enforce dozens of guarantees so no extension can take me down. They are:

| Protection | Detail |
|-----------|--------|
| Never block inbound | Cascade signals are always accepted, always produce a result. |
| Hook timeout | 5s per handler. Hanging handlers killed and logged. |
| Hook cap | 100 handlers per hook. |
| Hook circuit breaker | 5 consecutive failures auto-disables a handler. Half-open recovery: after 5 minutes, one test call allowed through. Success resets. Failure re-opens. Backoff doubles on repeat failures, capped at 1 hour. |
| Tool circuit breaker | 5 consecutive failures disables a tool for the session. AI adapts to other tools. One bad API key disables one tool, not the whole tree. |
| Extension init timeout | 10s per extension `init()`. Hanging init skipped, boot continues. |
| LLM concurrency semaphore | `llmMaxConcurrent` (default 20) caps in-flight LLM calls globally. Excess queued with abort signal support. |
| LLM priority queue | Human sessions acquire LLM slots first. Gateway second. Interactive third. Background jobs last. Prevents autonomous extensions from starving human responses. |
| Namespace enforcement | The scoped `core` binds the calling extension name. `qualities.space.setQuality` rejects writes to namespaces not owned by the caller. Five core namespaces (`cascade`, `extensions`, `tools`, `modes`, `llm`) rejected for all extension callers. |
| `enrichContext` chain timeout | 15s cumulative cap for the entire chain. Per-handler timeout reduced to the remaining budget. |
| MCP spatial scoping | MCP tool calls check `isExtensionBlockedAtSpace` before dispatch. Same scoping guarantee as WebSocket conversations. |
| Document size guard | Every quality write checks total document size against `maxDocumentSizeBytes` (14MB default). `DOCUMENT_SIZE_EXCEEDED` rejected. `onDocumentPressure` fires at 80%. |
| Per-namespace cap | `qualityNamespaceMaxBytes` (default 512KB) per extension namespace on Space, Being, Matter. |
| Matter count per space | `maxMatterPerNode` (default 1000) checked in `createMatter`. |
| Fact query cap | `factQueryLimit` (default 5000) on every audit query. |
| Ownership chain | `rootOwner`/`contributor` mutations validate the parent chain. Only resolved owner or admin can modify. Place seed spaces always rejected. |
| Space locks | Structural mutations (move, delete, transfer) acquire short-lived locks. Sorted acquisition prevents deadlocks. 30s TTL prevents permanent locks on crash. |
| `.flow` partitioning | Daily partitions cap unbounded growth. `flowMaxResultsPerDay` with circular overwrite. Retention deletes whole partitions. |
| Space-tree circuit breaker | Health equation monitors space count, qualities density, error rate. Score > 1.0 trips the space-tree. Read access stays. Extensions revive. Off by default. |
| Ancestor cache | Shared cache for parent chain walks. One walk serves every resolution chain. Snapshot per message. `moveSpace` clears entire cache. `deleteSpace` clears entries containing the deleted space. |
| Session cap | 10K max (configurable). Oldest-first eviction. |
| MCP client cap | 5,000 max. Oldest evicted on overflow. 10s connect timeout, 5s close timeout, 15-minute stale sweep. |
| WebSocket payload sanitization | Frontend sync events cap string fields at 200 chars and JSON payloads at 500 chars. ID fields capped at 36 chars (UUID length). |
| Password length | Min 8, max 128 characters. Bcrypt cost factor 12. Constant-time login (always runs `bcrypt.compare`, dummy hash on miss). |
| JWT unique ID | Every token includes a `jti` (UUID) for per-token revocation. |
| Username validation | Regex `^[a-zA-Z0-9_-]{1,32}$`. Trimmed before storage. |
| Config key validation | `^[a-zA-Z][a-zA-Z0-9_]{0,63}$`. `__proto__`, `constructor`, `prototype` rejected. Sanitized on load to prevent prototype pollution from direct DB injection. |
| Config value size cap | 64KB per config value. |
| Config write verification | `setPlaceConfigValue` checks `matchedCount`. If `.config` doesn't exist, throws instead of silently updating only the cache. |
| DB heartbeat | 5s (configurable). Failure detection within 5s. Hung queries killed at 30s socket timeout. |
| Boot recovery | `ensurePlaceRoot` verifies all nine place seed spaces every boot. Missing ones recreated. Wrong-parent ones repaired. Partial first-boot crashes leave a recoverable state. |
| Index verification | At boot, all required indexes verified. Missing ones created with background builds. No collection scan on any kernel query path. |
| Tree integrity check | At boot and daily: parent/`children[]` consistency verified. Auto-repair safe inconsistencies. Orphans logged. |
| Extension install rollback | Files written to staging directory. Atomic rename on success. Cleanup on failure. No partial installs. |
| SSRF protection | Peer registration and auto-discovery validate hostname against `isPrivateHost()` before any fetch. 15s timeout on federation fetches. Canopy event payloads capped at 256KB. |
| Graceful shutdown | All interval timers use `.unref()`. SIGTERM closes WS, then HTTP, then DB. |

## What I do NOT do

I do not track food, fitness, recovery, sleep, study, or any domain. I do not render HTML, manage share tokens, or serve login pages. I do not know what a billing tier is, what a wallet is, what a Discord channel is, what an email looks like, or what "morning routine" means. I do not define a single MCP tool definition. I do not run any AI conversation that is not initiated through a role's `summon()`.

I provide structure. Extensions provide meaning.

Plant me. Let the world form. The beings inside will speak.
