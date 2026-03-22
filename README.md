# TreeOS

Self-hosted knowledge system. Grow trees of goals, plans, and reflections. An AI acts as your tree-builder through conversation. Connect multiple lands into a federated network. Install extensions from the registry to add capabilities.

## What it is

- **Land** is the server. It stores your trees, runs the AI, and exposes an API.
- **CLI** (`treeos`) is how you interact with it. Navigate trees, chat with AI, manage your land.
- **Extensions** are modular packages. Understanding, scripts, billing, Solana wallets. Install what you need.
- **Site** (optional) is a web frontend for browser access.
- **Directory** is the registry. Lands discover each other and share extensions.

## Quick start

You need Node.js 18+ and MongoDB running.

```
git clone <repo-url> && cd Tree
npm run install:all
npm land
```

First run walks you through setup: domain, port, MongoDB, directory URL. Then it pulls the extension registry and lets you choose which to install. After that, your land boots.

Every run after that goes straight to boot.

## Connect with the CLI

```
npm install -g treeos
treeos connect http://localhost:3000
treeos register
```

Registration walks you through:
1. Username, password, email
2. Connect your LLM (or skip to use tree owner's models)
3. Plant your first tree (name and type)

Then you're in the shell.

## After setup

```
treeos chat "help me plan my week"     # Talk to the AI
treeos mkdir "Workouts"                # Create a branch
treeos cd Workouts                     # Navigate into it
treeos place "chest press 4x10"        # Place content
treeos query "what's my schedule?"     # Ask the tree
```

## Project layout

```
land/
  core/           Core protocol logic (nodes, notes, values, types, auth)
  db/models/      Core Mongoose models (13 models)
  extensions/     Modular packages (18 built-in)
    blog/           manifest.js, index.js, routes.js, model.js
    understanding/  manifest.js, index.js, routes.js, core.js, models/
    scripts/        manifest.js, index.js, routes.js, core.js
    energy/         manifest.js, index.js, routes.js, core.js
    ...
  routes/
    api/            REST endpoints (core protocol)
    billing/        Stripe integration
    auth.js         Login, register, password reset
    canopy.js       Federation protocol
  ws/             WebSocket system (AI conversation, modes, tools)
  mcp/            MCP server (AI tool execution)
  canopy/         Land identity, peering, proxy
  boot.js         Setup wizard + server boot

cli/            CLI client
  commands/       All CLI commands (nav, auth, ai, ext, llm, etc.)

site/           React + Vite frontend (optional)

directory/      Canopy Directory Service (land discovery + extension registry)
```

## Extensions

TreeOS is modular. The core protocol handles nodes, notes, values, types, and AI modes. Everything else is an extension.

```
treeos ext list                    # See what's loaded
treeos ext search                  # Browse the registry
treeos ext install understanding   # Pull from registry
treeos ext disable solana          # Skip on next boot
treeos ext enable solana           # Load again on next boot
treeos ext uninstall blog          # Remove (data stays in DB)
treeos ext publish my-extension    # Share with the network
```

### Built-in extensions

| Extension | What it does |
|-----------|-------------|
| understanding | Bottom-up tree compression with LLM summarization |
| scripts | Sandboxed JavaScript on nodes with value/goal mutation |
| prestige | Node versioning system |
| schedules | Date scheduling and calendar views |
| energy | Daily energy budget with tier-based limits |
| billing | Stripe subscription tiers |
| raw-ideas | Unstructured capture with auto-placement |
| dreams | Daily background maintenance (cleanup, drain, understand) |
| blog | Land-level blog |
| book | Export tree notes as shareable documents |
| solana | On-chain wallets and token operations |
| api-keys | User API keys for programmatic access |
| user-llm | Custom LLM connections and per-user model routing |
| user-queries | Notes, tags, contributions, chats, notifications |
| deleted-revive | Soft delete with branch recovery |
| visibility | Public/private tree toggle |
| transaction-policy | Per-tree trade approval rules |
| html-rendering | Server-rendered pages via ?html |

### Building an extension

An extension is a directory with a manifest and entry point:

```
my-extension/
  manifest.js    # declares needs, provides, version
  index.js       # exports init(core) function
  routes.js      # optional Express router
  core.js        # optional business logic
  model.js       # optional Mongoose schema
```

Extensions declare what they need and only receive those services:

```js
// manifest.js
export default {
  name: "my-extension",
  version: "1.0.0",
  needs: { models: ["Node"] },
  optional: { services: ["energy"] },
  provides: { routes: "./routes.js" },
};
```

## Node Types

Six core types provide a shared vocabulary:

| Type | Meaning |
|------|---------|
| `goal` | A desired outcome |
| `plan` | A strategy or sequence of steps |
| `task` | A discrete piece of work |
| `knowledge` | Stored information or understanding |
| `resource` | A tool, skill, capability, or reference |
| `identity` | Who or what this tree represents |

Type is a free-form string. Custom types are valid. `null` means untyped. Types carry no hardcoded behavior. The tree programs its own agents through instruction nodes.

## LLM Management

Every user connects their own LLM (or uses tree owner's models):

```
treeos llm add                         # Interactive setup
treeos llms                            # List connections
treeos llm assign main <id>            # Set default model
treeos llm tree-assign respond <id>    # Set model for chat on this tree
treeos llm tree-assign placement <id>  # Set model for tree-building
```

Tree slots: default, placement, respond, notes, understanding, cleanup, drain, notification.

## Configuration

Boot settings live in `.env` (generated by setup wizard):
`LAND_DOMAIN`, `PORT`, `MONGODB_URI`, `JWT_SECRET`

Runtime settings stored in the `.config` system node:
`LAND_NAME`, `LAND_DEFAULT_TIER`, `REQUIRE_EMAIL`, `ENABLE_FRONTEND_HTML`, `DIRECTORY_URL`

Manage with `treeos config` or the admin API.

## Federation (Canopy)

Lands peer with each other. Users on one land can browse public trees on another, receive invites, and contribute remotely.

```
treeos peers add my-friend.com
treeos browse my-friend.com
treeos search "fitness"
```

## Protocol

The core protocol is documented in [PROTOCOL.md](PROTOCOL.md). Extensions are documented in [EXTENSIONS.md](EXTENSIONS.md). Every land serves its capabilities at `GET /api/v1/protocol`.

## License

AGPL-3.0. See [LICENSE](LICENSE) for details.
