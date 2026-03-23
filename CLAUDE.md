# Intro

We do things fully and properly. never taking lazy route. We are working hard and organized to build the Kernel and foundational extensions so people can use them around the world for maybe decades to come. We have to be vigilant and never say "eh thats too complex. we willdo this for now." that is a painful attitude and will not serve here.

# TreeOS

Open source operating system for AI agents. Minimal kernel + modular extensions on a federated network.

## CRITICAL: Kernel vs Extensions

**The kernel is locked down. Do not add fields to Node or User schemas. Do not add imports from extensions/ into core/. Do not hardcode extension logic in core files. If you notice anything in core that references extension-specific data or behavior, flag it immediately.**

Extensions own their data (in `metadata` Map), their routes, their tools, their modes, their orchestrator. Core provides the registries, hooks, and conversation loop. That is all.

## Tech Stack

- **Backend**: Node.js + Express 4, MongoDB (Mongoose 8), Socket.IO 4, OpenAI SDK (any compatible endpoint)
- **Frontend**: React 18 + Vite 6 (landing/docs site), server-rendered HTML (extension: html-rendering)
- **Auth**: JWT + bcrypt
- **Federation**: Canopy protocol, directory service at dir.treeos.ai

## Project Structure

```
land/
├── core/              # Kernel business logic. ZERO extension imports.
│   ├── hooks.js       # 8 lifecycle hooks (beforeNote, afterNote, etc.)
│   ├── orchestratorRegistry.js  # Extensions register conversation orchestrators
│   ├── services.js    # Core services bundle passed to extensions via init(core)
│   ├── authenticate.js
│   ├── landRoot.js    # Land boot, system nodes
│   ├── landConfig.js
│   ├── login.js
│   ├── llms/          # LLM connection framework, client resolution
│   └── tree/          # Node CRUD, notes, statuses, contributions, invites, public access
│       ├── treeManagement.js    # createNode, deleteNode
│       ├── treeFetch.js         # getContextForAi, navigation, path building
│       ├── treeDataFetching.js  # getTree, getNodeForAi, getTreeStructure
│       ├── notes.js             # Note CRUD (fires beforeNote/afterNote hooks)
│       ├── statuses.js          # Status changes (fires beforeStatusChange/afterStatusChange hooks)
│       ├── contributions.js     # Audit trail queries
│       ├── extensionMetadata.js # getExtMeta/setExtMeta for node.metadata
│       └── userMetadata.js      # getUserMeta/setUserMeta for user.metadata
├── db/models/         # Core models ONLY (9 files, zero extension models)
│   ├── node.js        # _id, name, type, status, dateCreated, llmDefault, visibility, children, parent, rootOwner, contributors, isSystem, systemRole, metadata
│   ├── user.js        # _id, username, password, roots, recentRoots, remoteRoots, llmDefault, profileType, isRemote, homeLand, metadata
│   ├── notes.js       # Text or file content attached to nodes
│   ├── contribution.js
│   └── (invite, landPeer, remoteUser, customLlmConnection, canopyEvent)
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
├── orchestrators/     # Core orchestrator utilities (used by extensions)
│   ├── runtime.js     # OrchestratorRuntime class for background pipelines
│   ├── locks.js       # Concurrency locks
│   └── helpers.js     # parseJsonSafe, nullSocket
├── ws/                # WebSocket system (kernel)
│   ├── conversation.js    # processMessage() tool-calling loop, LLM resolution
│   ├── websocket.js       # Socket.IO server, message handler, orchestrator dispatch
│   ├── sessionRegistry.js # Session lifecycle
│   ├── aiChatTracker.js   # LLM call logging
│   ├── mcp.js             # MCP connection management
│   ├── tools.js           # Core MCP tool definitions
│   └── modes/             # Mode registry + built-in modes (will move to extensions)
│       └── registry.js    # registerMode(), getMode(), getToolsForMode()
├── mcp/               # MCP server
├── routes/            # Core HTTP routes
├── canopy/            # Federation protocol
├── middleware/        # Auth middleware
└── startup.js         # Boot sequence

site/src/              # React frontend (landing page, docs, about pages)
directory/             # Canopy Directory Service (separate standalone)
cli/                   # CLI package
```

## Kernel Schemas

### Node
```
_id, name, type, status, dateCreated, llmDefault, visibility,
children, parent, rootOwner, contributors, isSystem, systemRole, metadata (Map)
```

### User
```
_id, username, password, roots, recentRoots, remoteRoots,
llmDefault, profileType, isRemote, homeLand, metadata (Map)
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

## LLM Resolution Chain

```
Extension slot on tree (metadata.llm.slots.X)
  -> Tree default (node.llmDefault)
    -> Extension slot on user (metadata.userLlm.slots.X)
      -> User default (user.llmDefault)
```

## Hooks (8 lifecycle events)

| Hook | Type | Purpose |
|------|------|---------|
| beforeNote | before | Modify note data, tag version |
| afterNote | after | Flag dirty nodes |
| beforeContribution | before | Tag nodeVersion in audit log |
| afterNodeCreate | after | Initialize extension data |
| beforeStatusChange | before | Validate, intercept |
| afterStatusChange | after | React (clear schedule, etc.) |
| beforeNodeDelete | before | Cleanup extension data |
| enrichContext | enrich | Inject extension data into AI context |

## Conventions

- UUIDs for all primary keys
- Model-agnostic: any OpenAI-compatible LLM endpoint
- Never use em dashes in user-facing text outputs
- Extension data namespaced by extension name in metadata
- Core NEVER imports from extensions/. Extensions import from core.
- Dynamic imports with try/catch for optional cross-extension deps
