# Intro

We do things fully and properly. never taking lazy route. We are working hard and organized to build the Kernel and foundational extensions so people can use them around the world for maybe decades to come. We have to be vigilant and never say "eh thats too complex. we willdo this for now." that is a painful attitude and will not serve here.

# TreeOS

Open source operating system for AI agents. Minimal kernel + modular extensions on a federated network.

## CRITICAL: Three Layers

### Kernel (cannot change without forking)
The data contract. Node schema, User schema, Note model, Contribution model. The API protocol (chat/place/query behavioral contracts). The hook system. The mode registry. The orchestrator registry. The extension loader. Federation (Canopy). These define what TreeOS IS. Do not add fields to Node or User schemas. Do not import from extensions/ into kernel files.

### Core (ships with every land, replaceable)
The reference implementation. The AI conversation loop (`processMessage`, `runChat`, `runPipeline`). The WebSocket server. The MCP bridge. Session management. `OrchestratorRuntime`. `parseJsonSafe`. The built-in tree modes (navigate, structure, edit, respond, librarian, notes). These ship by default but can be overridden by extensions. A custom orchestrator can replace the entire conversation flow. Custom modes can replace how the AI thinks at any node.

### Extensions (optional, installable, removable)
Everything else. Values, schedules, prestige, scripts, dreams, understanding, energy, billing, solana, blog, gateway, shell, land-manager, tree-orchestrator. Each is a folder with a manifest. Install what you need. Remove what you don't. Build your own. The kernel boots without any of them.

**The rule: kernel NEVER imports from extensions. Core NEVER imports from extensions. Extensions import from kernel and core. Extensions reach each other through dynamic imports with try/catch.**

## Tech Stack

- **Backend**: Node.js + Express 4, MongoDB (Mongoose 8), Socket.IO 4, OpenAI SDK (any compatible endpoint)
- **Frontend**: React 18 + Vite 6 (landing/docs site), server-rendered HTML (extension: html-rendering)
- **Auth**: JWT + bcrypt
- **Federation**: Canopy protocol, Horizon at horizon.treeos.ai

## Project Structure

```
land/
├── seed/              # Kernel: business logic, hooks, registries. ZERO extension imports.
│   ├── protocol.js    # Response shapes, ERR codes, WS event types, CASCADE statuses
│   ├── hooks.js       # 23 lifecycle hooks (see SEED.md for full list)
│   ├── orchestratorRegistry.js  # Extensions register conversation orchestrators
│   ├── services.js    # Core services bundle passed to extensions via init(core)
│   ├── auth.js        # User creation, verification, JWT generation
│   ├── landRoot.js    # Land boot, system nodes
│   ├── landConfig.js
│   ├── version.js     # SEED_VERSION constant, checked at boot for migrations
│   ├── middleware/     # authenticate, authenticateMCP, securityHeaders, preUploadCheck
│   └── tree/          # Node CRUD, notes, statuses, contributions, invites, public access
│       ├── treeManagement.js    # createNode, deleteNode
│       ├── treeFetch.js         # getContextForAi, navigation, path building
│       ├── treeData.js           # getTree, getNodeForAi, getTreeStructure
│       ├── notes.js             # Note CRUD (fires beforeNote/afterNote hooks)
│       ├── statuses.js          # Status changes (fires beforeStatusChange/afterStatusChange hooks)
│       ├── contributions.js     # Audit trail queries
│       ├── extensionMetadata.js # getExtMeta/setExtMeta for node.metadata
│       └── userMetadata.js      # getUserMeta/setUserMeta for user.metadata
├── seed/models/       # Kernel models (6 files, zero extension models)
│   ├── node.js        # _id, name, type, status, dateCreated, llmDefault, visibility, children, parent, rootOwner, contributors, systemRole, metadata
│   ├── user.js        # _id, username, password, roots, llmDefault, isAdmin, isRemote, homeLand, metadata
│   ├── note.js        # Text or file content attached to nodes
│   ├── contribution.js # Audit trail
│   ├── chat.js        # AI conversation sessions
│   └── llmConnection.js # LLM endpoint storage
├── extensions/        # ALL optional functionality lives here
│   ├── _template/     # Scaffold for new extensions
│   ├── tree-orchestrator/  # Built-in chat/place/query orchestrator (REPLACEABLE)
│   ├── values/        # Numeric values and goals on nodes
│   ├── understanding/ # Bottom-up tree compression
│   ├── dreams/        # Background maintenance pipelines
│   ├── energy/        # Usage metering
│   ├── billing/       # Stripe subscriptions
│   ├── prestige/      # Node versioning
│   ├── schedules/     # Date scheduling
│   ├── scripts/       # Sandboxed JS on nodes
│   ├── solana/        # On-chain wallets
│   ├── gateway/       # External channel integration (Telegram, Discord)
│   ├── raw-ideas/     # Capture and auto-placement
│   ├── blog/          # Land-level blog
│   ├── book/          # Note compilation and sharing
│   ├── api-keys/      # User API key management
│   ├── user-llm/      # Custom LLM connection management
│   ├── user-queries/  # User-level data access
│   ├── deleted-revive/ # Soft delete and recovery
│   ├── shell/         # Execute shell commands from AI (god-tier)
│   ├── land-manager/  # Autonomous land management agent
│   ├── transactions/  # Value trading between nodes
│   ├── email/         # Email, forgot password
│   ├── html-rendering/ # Server-rendered HTML pages
│   ├── loader.js      # Scans manifests, validates deps, wires routes/tools/modes/hooks/jobs
│   └── EXTENSION_FORMAT.md  # Full extension developer documentation
├── orchestrators/     # Core: orchestrator utilities (ships with land, used by extensions)
│   ├── runtime.js     # OrchestratorRuntime (init/attach/runStep/trackStep/cleanup)
│   ├── locks.js       # Concurrency locks
│   └── helpers.js     # parseJsonSafe (handles fences, think tags, trailing commas, single quotes)
├── ws/                # Core: WebSocket + AI conversation system
│   ├── conversation.js    # processMessage(), runChat(), runPipeline(), LLM resolution
│   ├── websocket.js       # Socket.IO server, message handler, orchestrator dispatch, auto-abort
│   ├── sessionRegistry.js # Session lifecycle
│   ├── chatTracker.js     # LLM call logging
│   ├── mcp.js             # MCP connection management
│   ├── tools.js           # Core MCP tool definitions
│   └── modes/             # Kernel: mode registry. Core: built-in tree modes
│       └── registry.js    # registerMode(), resolveMode(), getToolsForMode(), getAllToolNamesForBigMode()
├── mcp/               # MCP server
├── routes/            # Core HTTP routes
├── canopy/            # Federation protocol
│   └── models/        # Federation models (canopyEvent, landPeer, remoteUser)
├── middleware/        # Auth middleware
└── startup.js         # Boot sequence

site/src/              # React frontend (landing page, docs, about pages)
horizon/             # The Horizon (separate standalone)
cli/                   # CLI package
```

## Kernel Schemas

### Node
```
_id, name, type, status, dateCreated, llmDefault, visibility,
children, parent, rootOwner, contributors, systemRole, metadata (Map)
```

### User
```
_id, username, password, roots,
llmDefault, isAdmin, isRemote, homeLand, metadata (Map)
```

Extension data lives in `metadata`. Use `getExtMeta`/`setExtMeta` for nodes, `getUserMeta`/`setUserMeta` for users.

## Extension System

Every extension has `manifest.js` (declares deps and capabilities) and `index.js` (exports `init(core)`).

An extension can provide:
- **Routes** (HTTP endpoints at /api/v1)
- **Models** (Mongoose schemas)
- **Tools** (MCP tools for AI)
- **Modes** (custom AI conversation modes)
- **Orchestrator** (replace the chat/place/query flow)
- **Jobs** (background tasks)
- **Hooks** (lifecycle event handlers)
- **CLI commands** (with subcommands and body mapping)
- **Energy actions** (metering costs)
- **Session types** (tracking)
- **LLM slots** (per-tree/per-user model assignment in metadata)
- **Env vars** (with auto-generation)

See `extensions/EXTENSION_FORMAT.md` for full documentation.

## Three Zones (Position-Based AI)

Navigation determines what the AI can do. No mode switching. Just `cd`.

| Position | Zone | AI Behavior | Orchestrator |
|----------|------|------------|-------------|
| `/` (land root) | Land | System management: extensions, config, users, peers. God-tier only. | land-manager extension |
| `~` (user home) | Home | Personal: raw ideas, notes, chat history, contributions. | home:default mode |
| `/MyTree` (inside tree) | Tree | Chat/place/query on the branch. Full orchestration. | tree-orchestrator extension |

The tree-orchestrator and land-manager are both extensions. They register orchestrators and modes. Replace either with your own implementation.

## runChat (core conversation utility)

Extensions and routes use `runChat()` for AI conversations. One call handles everything:

```js
const { answer } = await core.llm.runChat({
  userId, username,
  message: "install the blog extension",
  mode: "land:manager",
  rootId: null,     // for tree modes
  res,              // Express response object: auto-abort on client disconnect
});
```

Handles automatically: MCP connection, mode switching, chat tracking, abort on client disconnect, session persistence, error finalization. Pass `res` for HTTP routes. Pass `signal` for programmatic abort.

Session identity: `land:{userId}`, `home:{userId}`, `tree:{rootId}:{userId}`. Same zone = same conversation. Different tree = new session. Zone switch = new session.

`processMessage` returns `{ success, content, _internal }`. Internal fields never reach the client.

## Per-Node Customization (3 layers)

### Tools (what the AI CAN do)
```
1. Mode base tools (what the mode defines)
2. Extension tools (what extensions inject via loader)
3. Node config (metadata.tools.allowed[] / blocked[] on any node)
```

Per-node, inherits parent to child:
- `metadata.tools.allowed = ["execute-shell"]` adds shell to a DevOps branch
- `metadata.tools.blocked = ["delete-node-branch"]` makes a branch read-heavy
- CLI: `tools`, `tools-allow`, `tools-block`, `tools-clear`

### Modes (how the AI THINKS)
```
Node metadata.modes.{intent} -> default tree:{intent} -> fallback
```

Per-node mode overrides via `metadata.modes`:
- `metadata.modes.respond = "custom:formal"` uses formal response at that node
- `metadata.modes.navigate = "custom:waypoint"` uses custom navigation
- Kernel `resolveMode(intent, bigMode, nodeMetadata)` handles resolution
- CLI: `modes`, `mode-set <intent> <modeKey>`, `mode-clear`

### Extensions (what CAPABILITIES exist)
```
Global:   metadata.extensions.blocked[] -> inherits parent to child (opt-out)
Confined: metadata.extensions.allowed[] -> inherits parent to child (opt-in)
```

Two modes per extension. Global (default): active everywhere, block to remove. Confined (`scope: "confined"` in manifest): active nowhere, allow to add.

- **Global**: `ext-block solana scripts shell` blocks at current node, inherits down
- **Confined**: `ext-allow solana` activates at current node, inherits down. Without allow, invisible.
- Blocked extensions lose their hooks, tools, modes, and metadata writes
- The kernel filters at three points: hook firing, tool resolution, mode resolution
- An allowed confined extension can still be blocked further down (allow at /Finance, block at /Finance/ReadOnly)
- CLI: `ext-scope`, `ext-scope -t`, `ext-block <name>`, `ext-allow <name>`, `ext-unallow <name>`
- Navigate somewhere and the capability surface changes

### Orchestrators (the entire FLOW)
Extensions register custom orchestrators via `core.orchestrators.register()`. Replaces the entire chat/place/query conversation flow. The built-in tree-orchestrator is itself an extension.

## LLM Resolution Chain

```
Extension slot on tree (metadata.llm.slots.X)
  -> Tree default (node.llmDefault)
    -> Extension slot on user (metadata.userLlm.slots.X)
      -> User default (user.llmDefault)
```

## Hooks (lifecycle events + cascade)

Two rules, no exceptions. Before hooks run sequential because they can cancel. After hooks run parallel because they react independently. Two hooks override this: enrichContext and onCascade are sequential because their handlers build cumulative output. Don't make a hook sequential without articulating why handlers depend on each other's output. If you can't, it's parallel.

| Hook | Type | Purpose |
|------|------|---------|
| beforeNodeCreate | before | Gate node creation. Enforce naming, child limits, compliance. |
| beforeNote | before | Modify note data, tag version |
| afterNote | after | React to note create/edit/delete |
| beforeContribution | before | Modify contribution data. Extensions add to extensionData via hook. |
| afterNodeCreate | after | Initialize extension data |
| beforeStatusChange | before | Validate, intercept |
| afterStatusChange | after | React to status changes |
| beforeNodeDelete | before | Cleanup extension data |
| enrichContext | sequential | Inject extension data into AI context |
| beforeLLMCall | before | Before LLM API call. Cancel if quota exhausted. |
| afterLLMCall | after | After LLM API call. Token metering, billing, analytics. |
| beforeToolCall | before | Before MCP tool executes. Modify args, cancel. |
| afterToolCall | after | After MCP tool executes. React to result or error. |
| beforeResponse | before | Modify AI response before client receives it |
| beforeRegister | before | Validate registration. Extensions own email, verification. |
| afterRegister | after | Initialize user data (share tokens, etc.) |
| afterSessionCreate | after | Session registered. React to { sessionId, userId, type }. |
| afterSessionEnd | after | Session ended. React to { sessionId, userId, type }. |
| afterNavigate | after | Fires when user navigates to a tree root. Extensions track recency. |
| afterMetadataWrite | after | After setExtMeta succeeds. { nodeId, extName, data }. Zero overhead if no listeners. |
| afterScopeChange | after | After extension blocking/restriction changes. { nodeId, blocked, restricted, userId } |
| afterOwnershipChange | after | After rootOwner or contributors changed. { nodeId, action, targetUserId, previousOwnerId? } |
| afterBoot | after | Once after all extensions loaded, config initialized, server listening. |
| onCascade | sequential | Fires on content write at cascade-enabled node. Results written to .flow. |
| onDocumentPressure | after | Any document exceeds 80% of maxDocumentSizeBytes. { documentType, documentId, currentSize, projectedSize, maxSize, percent } |
| onTreeTripped | after | Tree circuit breaker tripped. { rootId, reason, scores, timestamp } |
| onTreeRevived | after | Tripped tree revived. { rootId, timestamp } |

## Cascade

When content is written at a node with `metadata.cascade.enabled = true` and `cascadeEnabled = true` in .config, the kernel fires `onCascade`. Two entry points: `checkCascade` (kernel-internal, called on note/status writes) and `deliverCascade` (extension-external, called for propagation). Results stored in `.flow` system node. Six statuses: succeeded, failed, rejected, queued, partial, awaiting. Config: cascadeEnabled (false), resultTTL (7 days), awaitingTimeout (5 min), cascadeMaxDepth (50). Files: `seed/tree/cascade.js`, `routes/api/cascade.js`.

## Response Protocol

Single file `seed/protocol.js` defines how the kernel talks to everything outside itself. Extensions access via `core.protocol`.

**HTTP response shape:** `{ status: "ok", data }` or `{ status: "error", error: { code, message, detail? } }`. Constructors: `sendOk(res, data, httpStatus)`, `sendError(res, httpStatus, code, message, detail)`.

**HTTP status -> ERR code mapping:**

| HTTP | Category | ERR codes |
|------|----------|-----------|
| 200/201 | Success/Created | (sendOk) |
| 400 | Bad request | INVALID_INPUT, INVALID_STATUS, INVALID_TYPE, INVALID_TREE |
| 401 | Unauthorized | UNAUTHORIZED |
| 403 | Forbidden | FORBIDDEN, EXTENSION_BLOCKED, SESSION_EXPIRED, CASCADE_DISABLED, UPLOAD_DISABLED |
| 404 | Not found | NODE_NOT_FOUND, USER_NOT_FOUND, NOTE_NOT_FOUND, TREE_NOT_FOUND, PEER_NOT_FOUND, EXTENSION_NOT_FOUND, ORCHESTRATOR_NOT_FOUND |
| 409 | Conflict | ORCHESTRATOR_LOCKED, RESOURCE_CONFLICT |
| 413 | Payload too large | DOCUMENT_SIZE_EXCEEDED, CASCADE_DEPTH_EXCEEDED, UPLOAD_TOO_LARGE |
| 415 | Unsupported media | UPLOAD_MIME_REJECTED |
| 429 | Rate limited | RATE_LIMITED, CASCADE_REJECTED |
| 500 | Internal | INTERNAL, TIMEOUT, HOOK_TIMEOUT, HOOK_CANCELLED |
| 502 | Bad gateway | PEER_UNREACHABLE |
| 503 | Service unavailable | LLM_TIMEOUT, LLM_FAILED, LLM_NOT_CONFIGURED, TREE_DORMANT |

INVALID_INPUT means garbage the kernel can't parse. Not "I understood your request but the thing doesn't exist." RESOURCE_CONFLICT means the request is valid but the current state of the resource prevents it.

**WebSocket event types:** Named constants in `WS` object. Kernel events only: chatResponse, chatError, chatCancelled, toolResult, placeResult, modeSwitched, treeChanged, registered, navigatorSession, recentRoots, availableModes, conversationCleared, navigate, reload. Dashboard and extension events own their own constants.

**Cascade statuses:** Named constants in `CASCADE` object: succeeded, failed, rejected, queued, partial, awaiting.

## Conventions

- UUIDs for all primary keys
- Model-agnostic: any OpenAI-compatible LLM endpoint
- Never use em dashes in user-facing text outputs
- Extension data namespaced by extension name in metadata
- Core NEVER imports from extensions/. Extensions import from seed.
- Dynamic imports with try/catch for optional cross-extension deps
