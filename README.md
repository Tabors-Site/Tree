# TreeOS

A personal operating system for your mind. Grow trees of goals, plans, knowledge, and reflections. An AI builds the tree with you through conversation. Self-hosted, extensible, federated.

## Quick start

You need Node.js 18+ and MongoDB running.

```
git clone <repo-url> && cd Tree
npm install
npm start
```

First run walks you through setup: domain, port, MongoDB. After that, your land boots.

## Connect with the CLI

```
npm install -g treeos
treeos connect http://localhost:3000
treeos register
treeos start
```

Registration creates your account. The setup wizard walks you through connecting your LLM (any OpenAI-compatible endpoint: Ollama, OpenRouter, Together, etc.) and planting your first tree.

## Using it

```
treeos chat "help me plan my week"     # Talk to the AI
treeos mkdir "Workouts"                # Create a branch
treeos cd Workouts                     # Navigate into it
treeos place "chest press 4x10"        # Place content into the tree
treeos query "what's my schedule?"     # Ask the tree a question
treeos note "learned something new"    # Add a text note
treeos note ./workout-log.csv          # Upload a file as a note
```

Notes are the base content unit. A note can be plain text or any file type (images, PDFs, CSVs, audio). Text notes are searchable and visible to the AI. File notes are stored and served.

## What it is

- **Land** is your server. It stores your trees, runs the AI, and exposes a JSON API.
- **CLI** (`treeos`) is how you interact with it. Navigate trees, chat with AI, manage extensions.
- **Extensions** are modular packages. Install what you need, disable what you don't.
- **Site** (optional) is a React web frontend.
- **Directory** is the network registry. Lands discover each other and share extensions.

## Extensions

The core handles nodes, notes, auth, and AI conversation. Everything else is an extension.

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
| understanding | Bottom up tree compression. Summarizes node layers with LLM for navigational context. |
| scripts | Sandboxed JavaScript execution on nodes with safe functions for values, goals, and status |
| prestige | Node versioning. Complete a version and start a new generation. |
| schedules | Date scheduling and calendar views for nodes |
| energy | Daily energy budget with tier based limits and per action costs |
| billing | Stripe subscription tiers and energy purchases |
| raw-ideas | Quick capture of unstructured ideas with automatic tree placement |
| dreams | Background tree maintenance. Runs cleanup, short term drain, and understanding on a schedule. |
| blog | Publish blog posts on your land |
| book | Compile notes into shareable documents per node |
| solana | Solana wallets, token holdings, and Jupiter swaps per node |
| api-keys | User API keys for programmatic access to the tree API |
| email | Email verification for registration and password reset |
| user-llm | Custom LLM connections with per user and per tree model assignment |
| gateway | External channel integration for Telegram, Discord, and web widgets |
| html-rendering | Server rendered HTML pages with share token authentication |
| console | Formatted log output with three severity levels for clean server monitoring |
| tree-orchestrator | Core conversation orchestrator for chat, place, and query |
| land-manager | Autonomous land management agent for health monitoring |
| shell | Execute shell commands from AI conversation |
| transactions | Value transactions between nodes with approval policies |
| deleted-revive | Soft delete branches and revive them later |
| values | Numeric values and goals on nodes with tree wide accumulation |
| user-queries | User level data access for notes, tags, contributions, and notifications |

### Building an extension

Copy the template and start building:

```
cp -r land/extensions/_template land/extensions/my-extension
```

An extension declares what it needs and registers hooks, routes, tools, and AI modes:

```js
// manifest.js
export default {
  name: "my-extension",
  version: "1.0.0",
  needs: { models: ["Node"] },
  provides: { routes: "./routes.js" },
};
```

Full reference: `land/extensions/EXTENSION_FORMAT.md`

## Node types

Six core types provide a shared vocabulary:

| Type | Meaning |
|------|---------|
| `goal` | A desired outcome |
| `plan` | A strategy or sequence of steps |
| `task` | A discrete piece of work |
| `knowledge` | Stored information or understanding |
| `resource` | A tool, skill, capability, or reference |
| `identity` | Who or what this tree represents |

Type is a free-form string. Custom types are valid. `null` means untyped.

## LLM management

Every user connects their own LLM (or uses tree owner's models):

```
treeos llm add                         # Interactive setup
treeos llms                            # List connections
treeos llm assign main <id>            # Set default model
treeos llm tree-assign respond <id>    # Set model for chat on this tree
treeos llm tree-assign placement <id>  # Set model for tree-building
```

Any OpenAI-compatible endpoint works. Core tree slots: default, placement, respond, notes. Extensions register additional slots (understanding, cleanup, drain, notification) via `core.llm.registerModeAssignment()`.

## Configuration

Boot settings live in `.env` (generated by setup wizard):
`LAND_DOMAIN`, `PORT`, `MONGODB_URI`, `JWT_SECRET`

Runtime settings stored in the `.config` system node:
`LAND_NAME`, `LAND_DEFAULT_TIER`, `ENABLE_FRONTEND_HTML`, `DIRECTORY_URL`

Kernel tunables (applied at boot from `.config` node):
`llmTimeout`, `llmMaxRetries`, `maxToolIterations`, `maxConversationMessages`, `noteMaxChars`, `treeSummaryMaxDepth`, `treeSummaryMaxNodes`, `carryMessages`, `sessionTTL`, `staleSessionTimeout`

Extension settings declared in each extension's manifest under `provides.env`. Extensions read their own config via `core.config.get()`.

Manage with `treeos config set <key> <value>` or the admin API. With the land-manager extension, the AI can manage config through chat.

## Federation (Canopy)

Lands peer with each other. Users on one land can browse public trees on another, receive invites, and contribute remotely.

```
treeos peers add my-friend.com
treeos browse my-friend.com
treeos search "fitness"
```

## Project layout

```
land/
  core/           Protocol logic (nodes, notes, auth, hooks, log)
  db/models/      Mongoose models (node, user, contribution, note, etc.)
  extensions/     Modular packages (20+ built-in)
  ws/             WebSocket system (AI conversation, modes, tools)
  mcp/            MCP server (AI tool execution)
  canopy/         Land identity, peering, proxy
  boot.js         Setup wizard + server boot

cli/              CLI client (treeos command)
site/             React + Vite frontend (optional)
directory/        Canopy Directory Service (land discovery + extension registry)
```

## Protocol

The core protocol is documented in [PROTOCOL.md](PROTOCOL.md). Extensions are documented in [EXTENSIONS.md](EXTENSIONS.md). Every land serves its capabilities at `GET /api/v1/protocol`.

## Contributing

Contributing guide is in progress. For now: fork, branch, PR. Extension development is documented in `land/extensions/EXTENSION_FORMAT.md`.

## License

AGPL-3.0. See [LICENSE](LICENSE) for details.
