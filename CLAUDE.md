# Intro

We do things fully and properly, never the lazy route. The kernel and its foundational extensions will be used around the world for decades. Be vigilant; never say "that's too complex, we'll do it right later." That attitude doesn't serve here.

# TreeOS

Open source operating system for AI agents. Minimal kernel plus modular extensions on a federated network.

## Architecture (three layers + extensions)

```
seed/         What TreeOS IS. Data shape, registries, hooks, four verbs.
protocols/    What conversation over the wire looks like. IBP, canopy, mcp.
transports/   Thin carriers. WebSocket today; CLI / HTTP shims sit beside it.
extensions/   Everything else. Optional, installable, removable.
```

**Dependency direction.** `transports/` → `protocols/` → `seed/`. Extensions sit beside the three and consume them. `seed/` never imports from `protocols/` or `transports/`; `protocols/` never imports from `transports/`. The push channel ([seed/ibp/pushChannel.js](land/seed/ibp/pushChannel.js)) is the inversion seam — transports register an implementation at boot; seed callers reach it through proxies that no-op when nothing has registered.

`core.X` is the services bundle the loader hands to each extension; it's assembled in [seed/services.js](land/seed/services.js) by pulling exports from across seed's domain folders. There is no `seed/core/` folder and no separate "Core" architectural layer — just one assembler at the root of seed.

## The six primitives

Everything in seed serves one of six:

| Primitive | What it is | Schema |
|---|---|---|
| **Being** | An identity instance. Humans + AI + future composites. | `seed/models/being.js` |
| **Space** | The substrate primitive. Structure that holds possibility; a position in the tree. | `seed/models/space.js` |
| **Matter** | Stuff that sits in a space. `origin` tags where the content lives (`ibp`, `filesystem`, `web`, cross-land). | `seed/models/matter.js` |
| **Did** | One DO emission, audit log. Past tense — "a did is a thing that was done." | `seed/models/did.js` |
| **Summon** | One being's wake-and-act through one LLM call. | `seed/models/summon.js` |
| **LlmConnection** | Per-being LLM client config (URL, key, model). | `seed/models/llmConnection.js` |

Schemas never change. Extensions never add fields. Everything new lives in metadata.

## The four verbs

The wire protocol. One event in both directions: `"ibp"`. Envelope-discriminated.

```
SEE     observe a position or stance. Returns a descriptor.
DO      mutate at a target through a registered operation. Audited via Did.
SUMMON  deliver to a being's inbox, wake them, run their role's summoning.
BE      identity. register / claim / release / switch.
```

**Wire shape** ([seed/ibp/pushChannel.js](land/seed/ibp/pushChannel.js), [protocols/ibp/events.js](land/protocols/ibp/events.js)):

```
Client → server:  socket.emit("ibp", { id, verb, address, payload }, ack)
Server → client:  socket.emit("ibp", { verb, payload })
                  verb=summon  → payload = inbox entry
                  verb=see     → payload = { kind, spaceId, data }
```

No `ibp:update`, no `descriptor:patch`. One event, both directions. Direction is implicit.

**The verbs are the ONLY public surface for substrate operations** ([project_seed_four_verbs_only](memory/project_seed_four_verbs_only.md), [project_ibp_universal_grammar](memory/project_ibp_universal_grammar.md)). Every internal helper that survives in seed is one syntactic surface of these four; new code uses the verbs.

## Vocabulary (post-rename)

Several primitives were renamed in 2026-05. Code, comments, and git history mix old and new; use the new names.

| New | Old | Notes |
|---|---|---|
| **Being** (identity) + **Role** (template) | "Embodiment" conflated both | terminology shift 2026-05-18 |
| **Artifact** + `origin` field | "Note" | 0.4.0 |
| **Did** | "Contribution" | 0.8.0 |
| **Summon** | "Chat" | 0.9.0 |
| **IBP Address** (`<stance> :: <stance>`) | "Portal Address" | 0.10.0 |
| **Being.roles[]** + **defaultRole** | `Being.role` (one fixed role) | 0.11.0 |
| **Space** (substrate primitive) | "Node" | 0.12.0 |
| **Matter** (stuff in a space) | "Artifact" | 0.13.0 |
| **SUMMON** | "TALK" | code rename 2026-05-17 |
| **land/protocols/ibp/** (server) | "land/portal/" | folder rename 2026-05-17 |
| **land/seed/being/roles/** | "land/portal/embodiments/" | 2026-05-18 |

**Three metadata buckets, peer not nested:**

- **Space.metadata.\<ns\>** — extension data at a space. `metadata.beings.<roleName>` records which beings of which roles live at this space.
- **Being.metadata.\<ns\>** — identity-bearing data per Being (auth email, energy balance, etc.). Persists across role changes. Write via `setBeingMeta`.
- **Matter.metadata.\<ns\>** — data about specific matter. Write via `setMatterMeta`.

**The `@` qualifier in a Stance always names a Being, not a Role.** `@king-bob` is a specific being; `@auth` is the auth-being's name (which happens to match its role).

## Project Structure

```
land/
├── seed/                       The kernel. No imports from protocols/ or transports/.
│   ├── models/                   Mongoose schemas: being, space, matter, did, summon, llmConnection
│   ├── ibp/                      Core IBP grammar (verbs, operations, authorize, address, resolver,
│   │                             descriptor, discovery, errors, protocol/ERR). Seed-internal — the
│   │                             wire layer in protocols/ibp/ is a thin envelope adapter.
│   ├── being/                    Identity. beRegistry, identity, position, systemBeings,
│   │                             beingMetadata, and roles/ (registry + built-ins: auth, echo,
│   │                             landManager, llmAssigner)
│   ├── space/                    Tree operations. ancestorCache, ownership, spaceManagement,
│   │                             spaceFetch, spaceLocks, spaceCircuit, dids, cascade,
│   │                             extensionMetadata, extensionScope, documentGuard,
│   │                             source, seeds, seedSpaces (SEED_SPACE/SEED_BEING/DELETED)
│   ├── matter/                   matters, matterMetadata, origins (MATTER_ORIGIN),
│   │                             uploadCleanup
│   ├── cognition/                Runtime. runChat, buildPrompt, llmClient, mcpClient,
│   │                             scheduler, inbox, wakeSchedule, session, subscriptions,
│   │                             replyAggregator, replyEmission, defaultSummon, assignments,
│   │                             connections
│   ├── system/                   hooks, log, migrations/, indexes, dbConfig, integrityCheck,
│   │                             dataRetention, registryMirror, tools, utils, version
│   ├── services.js               Assembles the `core` services bundle handed to every extension.
│   ├── landRoot.js               This land's root + system spaces.
│   ├── landConfig.js             This land's config.
│   ├── philosophy/               Diagrams of the IBP grammar (jpgs).
│   ├── SEED.md                   Kernel internals doc.
│   └── LICENSE
│
│   Notable kernel surfaces inside the subfolders:
│   - [seed/system/hooks.js](land/seed/system/hooks.js): hook registry, circuit breaker,
│     typo detection. Re-exported through [seed/services.js](land/seed/services.js) as `core.hooks`.
│   - [seed/space/source.js](land/seed/space/source.js): mirrors land/ into substrate as
│     matter under `.source` so beings can SEE and reason about the codebase.
│
├── protocols/                  Wire shapes. Never own transport.
│   ├── ibp/                      Four-verb protocol (SEE/DO/SUMMON/BE)
│   │   ├── protocol.js             dispatchIbp — single router used by every transport
│   │   ├── envelope.js             Envelope shape + helpers
│   │   ├── events.js               IBP_EVENT + SEE_PUSH kinds
│   │   ├── verbs/                  see.js, do.js, summon.js, be.js (wire adapters)
│   │   ├── live.js                 SEE-push fanout
│   │   ├── index.js                Boot entry: initIBPHttp, initIBPWS, live-hook wiring
│   │   └── bootstrap-route.js      /.well-known/treeos-portal HTTP discovery (public name; kept
│   │                               for client compatibility)
│   ├── canopy/                   Federation between lands (dispatch, identity, peers, models)
│   └── mcp/                      MCP adapter (AI tool execution)
│
├── transports/                 Carriers. transports → protocols → seed.
│   ├── ws/                       Socket.io. Registers push channel at boot.
│   └── http/                     Express handlers; canonical /ibp/<verb>/<addr> + auth shims
│
├── extensions/                 ALL optional functionality lives here.
│   ├── loader.js                 Scans manifests, builds scoped core per extension
│   ├── EXTENSION_FORMAT.md
│   └── ... (manifest + index.js per extension)
│
├── boot.js                     First-run wizard
├── server.js                   Express + WebSocket bring-up
└── genesis.js                  Boot sequence: indexes, config, migrations, extensions, jobs

site/                           React landing/docs site
horizon/                        Public registry (standalone)
cli/                            CLI package
portal/3d-app/                  3D IBP client (Three.js + Vite)
```

## Three registries

Every extension capability flows through one of three:

1. **Operations** ([seed/ibp/operations.js](land/seed/ibp/operations.js)) — DO actions. Extensions register under `<ext>:<action>`; bare names reserved for the kernel. Schema validation declared but not enforced yet (roadmap).

2. **Roles** ([seed/being/roles/registry.js](land/seed/being/roles/registry.js)) — SUMMON-honoring beings. Each role declares `permissions` (subset of see/do/summon/be), `respondMode` (sync/async/none), `summon(message, ctx)`, and optionally `buildSystemPrompt` / `toolNames` for LLM cognition.

3. **Seeds** ([seed/space/seeds.js](land/seed/space/seeds.js)) — plantable scaffolds. Recipes that bootstrap a domain (Ruler/Planner/Contractor + workers, etc.). Operators plant via the `plant-seed` DO op.

The loader auto-namespaces everything. Extensions write bare names (`"hire-planner"`); the kernel records the qualified form (`"governing:hire-planner"`). The same prefixing applies to push-channel events emitted via `core.websocket.emitToBeing(...)`.

## Tech Stack

- **Backend**: Space.js + Express 4, MongoDB (Mongoose 8), Socket.IO 4, OpenAI SDK (any compatible endpoint)
- **3D portal**: Three.js + Vite (speaks IBP via WebSocket)
- **Frontend**: React 18 + Vite 6 (landing/docs site); server-rendered HTML for dashboards (html-rendering extension)
- **Auth**: JWT + bcrypt
- **Federation**: Canopy protocol; Horizon directory at horizon.treeos.ai

## Extension System

Every extension has `manifest.js` (declares deps and capabilities) and `index.js` (exports `init(core)`).

An extension can provide:
- **Operations** (DO actions; auto-namespaced)
- **Roles** (SUMMON-honoring beings; auto-namespaced)
- **Seeds** (plantable scaffolds; auto-namespaced)
- **Routes** (HTTP endpoints; thin shims that dispatch into IBP verbs)
- **Models** (Mongoose schemas)
- **Tools** (MCP tools)
- **Hooks** (lifecycle event handlers)
- **Jobs** (background tasks with start/stop)
- **CLI commands** (with subcommands and body mapping)
- **Session types**
- **LLM slots** (per-being / per-space assignments)
- **UI Slots** (HTML fragments injected into pages: app cards, quick links, profile sections, dashboard panels)
- **HTML Pages** (server-rendered, via the html-rendering extension)
- **Env vars** (with auto-generation)

See [extensions/EXTENSION_FORMAT.md](land/extensions/EXTENSION_FORMAT.md) for the full contract.

**Scoped core.** The loader builds a per-extension view of the core services bundle:
- `core.do.registerOperation(name, spec)` — auto-prefixes to `<ext>:<name>`; rejects mismatched prefixes.
- `core.metadata.setExtMeta(space, ns, data)` — namespace-locked to the extension.
- `core.websocket.emitToBeing(beingId, event, payload)` — auto-prefixes the event name.

Extensions never type their own namespace. The framing makes namespace-impersonation a structural impossibility.

## Stance Authorization

One gate on every verb ([seed/ibp/authorize.js](land/seed/ibp/authorize.js)). Layers:

1. **Layer 1: facts.** Stance properties derived from Being and Space (owner / contributor / role / home relation / operating mode / federation status).
2. **Layer 2: per-position rules.** Walk the ancestor chain looking for `metadata.permissions.<verb>.<keyParts>` rules that match.
3. **Layer 3: extension defaults.** Registry of default permission rules contributed by installed extensions.
4. **Layer 4: legacy fallback + default deny.** No match → reject with `FORBIDDEN` (or `UNAUTHORIZED` when there's no identity).

BE register/claim from arrival is the bootstrap exception, gated by land-level `register_enabled` / `claim_enabled` flags on `metadata.auth`.

## LLM Resolution Chain

Four layers, walked from each call site ([seed/cognition/llmClient.js](land/seed/cognition/llmClient.js)):

```
Space-tree lockout      (space.llmDefault === "none" anywhere in ancestor chain)
  Space-tree enforcement (metadata.llm.enforced on any ancestor)
    Being-tree lockout  (being or any ancestor in being-tree has locked=true)
      Default order (being's preferOwn flag flips it):
        Space slot → Space default → Being slot → Being default
```

Slots are role names. `"main"` maps to `Being.llmDefault` / `Space.llmDefault`; others live under `metadata.userLlm.slots.<slot>` (being) or `metadata.llm.slots.<slot>` (space).

## Hooks

Two rules, no exceptions. **Before** hooks run sequentially because they can cancel. **After** hooks run in parallel because they react independently. Two overrides: `enrichContext` and `onCascade` are sequential because handlers build cumulative output. Don't add a sequential hook without articulating why handlers depend on each other's output.

| Hook | Type | Purpose |
|------|------|---------|
| beforeSpaceCreate | before | Gate space creation. Naming, child limits, compliance. |
| afterSpaceCreate | after | Initialize extension data. |
| beforeSpaceDelete | before | Cleanup extension data; veto deletes. |
| afterSpaceMove | after | Space reparented. Five resolution chains shift. |
| beforeMatter | before | Modify matter data before save. |
| afterMatter | after | React to matter create/edit/delete. |
| beforeDid | before | Enrich audit-log entry. |
| beforeStatusChange | before | Validate, intercept. |
| afterStatusChange | after | React to status changes. |
| enrichContext | sequential | Inject extension data into AI context. |
| beforeLLMCall | before | Before LLM API call. Cancel if quota exhausted. |
| afterLLMCall | after | Token metering, billing, analytics. |
| beforeToolCall | before | Before MCP tool executes. Modify args, cancel. |
| afterToolCall | after | React to tool result or error. |
| beforeResponse | before | Modify AI response before client receives it. |
| beforeRegister | before | Validate registration (email verification, invite codes). |
| afterRegister | after | Initialize being data. |
| afterSessionCreate | after | React to new session. |
| afterSessionEnd | after | React to session end. |
| afterMetadataWrite | after | After setExtMeta succeeds. |
| afterScopeChange | after | After extension blocking/restriction changes. |
| afterOwnershipChange | after | After rootOwner or contributors changed. |
| afterBoot | after | Once after all extensions + config + server are ready. |
| onCascade | sequential | Fires on content write at cascade-enabled space. |
| onDocumentPressure | after | Document at 80%+ of `maxDocumentSizeBytes`. |
| onTreeTripped / onTreeRevived | after | Tree circuit breaker state changes. |

## Cascade

A note at one space creates awareness at related spaces. Fires `onCascade` when content is written at a space with `metadata.cascade.enabled = true`. Results land in the `.flow` system space. Six statuses: `succeeded`, `failed`, `rejected`, `queued`, `partial`, `awaiting`. Config: `cascadeEnabled`, `resultTTL`, `awaitingTimeout`, `cascadeMaxDepth`. See [seed/space/cascade.js](land/seed/space/cascade.js).

## Response Protocol

[seed/ibp/protocol.js](land/seed/ibp/protocol.js) defines how the kernel talks to the outside world (response/error constructors + the `ERR` enum). Extensions access via `core.protocol`. Domain enums live in named files alongside it: [seed/space/seedSpaces.js](land/seed/space/seedSpaces.js) (`SEED_SPACE`, `SEED_BEING`, `DELETED`) and [seed/matter/origins.js](land/seed/matter/origins.js) (`MATTER_ORIGIN`).

**HTTP/wire shape:** `{ status: "ok", data }` or `{ status: "error", error: { code, message, detail? } }`. Constructors: `sendOk(res, data, httpStatus)`, `sendError(res, httpStatus, code, message, detail)`.

**HTTP → ERR mapping:**

| HTTP | Category | ERR codes |
|---|---|---|
| 200/201 | Success | — |
| 400 | Bad request | INVALID_INPUT, INVALID_TYPE, INVALID_TREE |
| 401 | Unauthorized | UNAUTHORIZED |
| 403 | Forbidden | FORBIDDEN, EXTENSION_BLOCKED, SESSION_EXPIRED, CASCADE_DISABLED, UPLOAD_DISABLED, ORIGIN_READ_ONLY |
| 404 | Not found | NODE_NOT_FOUND, USER_NOT_FOUND, ARTIFACT_NOT_FOUND, TREE_NOT_FOUND, PEER_NOT_FOUND, EXTENSION_NOT_FOUND |
| 409 | Conflict | RESOURCE_CONFLICT |
| 413 | Payload too large | DOCUMENT_SIZE_EXCEEDED, CASCADE_DEPTH_EXCEEDED, UPLOAD_TOO_LARGE |
| 415 | Unsupported media | UPLOAD_MIME_REJECTED |
| 429 | Rate limited | RATE_LIMITED, CASCADE_REJECTED |
| 500 | Internal | INTERNAL, TIMEOUT, HOOK_TIMEOUT, HOOK_CANCELLED |
| 502 | Bad gateway | PEER_UNREACHABLE |
| 503 | Service unavailable | LLM_TIMEOUT, LLM_FAILED, LLM_NOT_CONFIGURED, TREE_DORMANT |

Plus five IBP-specific codes: `ADDRESS_PARSE_ERROR`, `ROLE_UNAVAILABLE`, `VERB_NOT_SUPPORTED`, `ACTION_NOT_SUPPORTED`, `INVALID_INTENT`.

`INVALID_INPUT` means garbage the kernel can't parse, not "I understood your request but the thing doesn't exist." `RESOURCE_CONFLICT` means the request is valid but current state prevents it.

## The rules (never violated)

1. **Seed never imports from extensions.** The kernel doesn't know extensions exist.
2. **Seed never imports from protocols/ or transports/.** Dependency direction is downward.
3. **Extensions reach each other through `getExtension()` or hooks.** No direct imports between extensions.
4. **Extension data lives in metadata Maps.** Never in seed schemas.
5. **Seed schemas never change.** The Map grows anything new.
6. **Zero `getExtension()` calls in seed.** The kernel can't be tricked into loading extension code.

## Patterns that repeat (read this before building anything)

**Resolution chains walk the ancestor cache.** Stance authorization, extension scope, tool scope, LLM connection, LLM config, perspective filter. All walk the parent chain from current space to root. All share a cached snapshot per message. One walk serves every chain.

**enrichContext is how extensions speak to the AI.** Sequential hook; handlers build cumulative output. Guard every handler — check if relevant data exists before injecting. Never run expensive queries unconditionally.

**setExtMeta for all metadata writes.** Extensions can only write to their own namespace; the loader enforces this on the scoped core. Direct Map manipulation is reserved for atomic MongoDB operations that can't go through read-modify-write.

**`role` field marks structural spaces.** Extensions that scaffold a tree shape MUST set `metadata.<extName>.role` on every scaffolded space. The base `beforeSpaceDelete` guard cancels deletion of any space with a role in any namespace. `--force` bypasses.

**LLM_PRIORITY on every LLM call.** `HUMAN` for direct user actions, `GATEWAY` for external channels, `INTERACTIVE` for tool-loop steps, `BACKGROUND` for compression / dreams / cron. Without priority tags, background extensions starve human responses.

**Confined scope for dangerous extensions.** Declare `scope: "confined"` in the manifest. Inactive everywhere by default; operators run `ext-allow` at specific positions to activate.

**Substrate as memory.** Beings are stateless across summons. Everything persistent lives in public substrate — matter and metadata at positions, observable to any being with permission. Don't invent a `metadata.<role>.workingState` namespace.

## Conventions

- UUIDs for all primary keys
- Model-agnostic: any OpenAI-compatible LLM endpoint
- Never use em dashes or en dashes in user-facing text. Periods and commas only.
- Extension data namespaced by extension name in metadata
- Dynamic imports with try/catch for optional cross-extension deps
- Comments explain WHY, not WHAT. Identifiers carry the WHAT.

For server internals (boot sequence, the inbox + scheduler, role templates, how to build an extension), see [land/CLAUDE.md](land/CLAUDE.md).
