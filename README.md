# TreeOS

An operating system for AI agents. The kernel is called the seed. You plant it on a land. It grows trees. Modular extensions, federated network, cascade communication. Self-hosted. Open source. Decentralized.

Four primitives: structure (nodes in hierarchies), intelligence (conversation loop), extensibility (loader and hooks), communication (cascade and .flow).

## Quick start

You need Node.js 18+ and MongoDB running.

```
npx create-treeos my-land
cd my-land
node boot.js
```

First run walks you through setup: domain, name, MongoDB, and extension selection from the registry. After that, your land boots.

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
- **Horizon** is the network registry. Lands discover each other and share extensions.

## Extensions

95 extensions across four bundles. The kernel handles nodes, notes, auth, and AI conversation. Everything else is an extension.

> **WARNING:** Extensions run in the same Node.js process as the kernel. They can access the filesystem, network, and database. Review all third-party extension code before installing. The kernel is safe. Extensions are as safe as the code they contain.

```
treeos ext list                    # See what's loaded
treeos ext search                  # Browse the registry
treeos ext install understanding   # Pull from registry (auto-resolves deps, verifies SHA256)
treeos ext disable solana          # Skip on next boot
treeos ext enable solana           # Load again on next boot
treeos ext uninstall blog          # Remove (data stays in DB)
treeos ext publish my-extension    # Share with the network
```

### Per-node extension scoping

Any node controls which extensions are active at that position. Block an extension at a tree root and it disappears from the entire tree. Restrict it to read-only and it can observe but not modify. Navigate somewhere else and everything is back.

```
treeos ext-scope                   # Show active/blocked/restricted at current position
treeos ext-scope -t                # Tree-wide view of all blocks
treeos ext-block solana scripts    # Block extensions (inherits to children)
treeos ext-allow solana            # Remove from block list
treeos ext-restrict food read      # Read-only tools only (hooks still fire)
```

Three levels: **active** (full access), **restricted** (read-only tools), **blocked** (nothing). The kernel filters tools using MCP `readOnlyHint` annotations. Extensions check `isExtensionBlockedAtNode()` in their routes.

Example: a Health tree with fitness and food extensions. Each branch restricts the other to read-only. The fitness coach references nutrition data. The food coach sees exercise history. Neither modifies the other's branch.

### Four bundles

| Bundle | Count | What it is |
|--------|-------|-----------|
| **treeos-cascade** | 8 | The nervous system. Signals propagate, get filtered, compressed, monitored. |
| **treeos-intelligence** | 14 | Self-awareness. The tree compresses, detects contradictions, profiles users, acts autonomously, searches, explores, traces, maps boundaries, tracks competence, notices conversational shifts, proposes new extensions, maps relationships. |
| **treeos-connect** | 8 | External channels. Telegram, Discord, Slack, email, SMS, webhooks, Matrix. |
| **treeos-maintenance** | 5 | Hygiene. Prune dead branches, reorganize, changelog, daily digest, delegate stuck work. |

Plus 20 base extensions (ship with every land), 8 standalone, and domain-specific extensions for fitness, food, solana, billing, and more.

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
`LAND_NAME`, `LAND_DEFAULT_TIER`, `ENABLE_FRONTEND_HTML`, `HORIZON_URL`

Kernel tunables (applied at boot from `.config` node):
`llmTimeout`, `llmMaxRetries`, `maxToolIterations`, `maxConversationMessages`, `noteMaxChars`, `treeSummaryMaxDepth`, `treeSummaryMaxNodes`, `carryMessages`, `sessionTTL`, `staleSessionTimeout`

Security config:
`allowedLlmDomains` - array of allowed LLM endpoint domains for non-admin users. Empty or unset means any external domain. Example: `["api.openai.com", "openrouter.ai", "api.anthropic.com"]`. Admins always bypass for localhost/local LLM flexibility.

Extension settings declared in each extension's manifest under `provides.env`. Extensions read their own config via `core.config.get()`.

Manage with `treeos config set <key> <value>` or the admin API. With the land-manager extension, the AI can manage config through chat.

## Cascade

When content is written at a node marked for cascade, the kernel announces it. Extensions react, propagate to other nodes, and deliver signals across lands. Every signal produces a visible result stored in the `.flow` system node.

```
treeos config set cascadeEnabled true
```

Set `metadata.cascade = { enabled: true, propagate: "children" }` on any node. Now every note written there fires `onCascade`. Six result statuses: succeeded, failed, rejected, queued, partial, awaiting. None terminal.

The kernel has four primitives: structure (nodes in hierarchies), intelligence (conversation loop and resolution chains), extensibility (loader, hooks, pub-sub), and communication (cascade, .flow, visible results). Everything else is emergent behavior from these four interacting.

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
  seed/           The kernel. Two schemas, conversation loop, hooks, cascade.
  extensions/     95 extensions across four bundles plus standalone.
  canopy/         Federation. Peering, proxy, events, identity.
  routes/         HTTP API endpoints.
  orchestrators/  Pipeline runtime, locks, helpers.
  mcp/            MCP server (AI tool execution).
  boot.js         Setup wizard + server boot.
  server.js       Express setup + graceful shutdown.

cli/              CLI client (treeos command). Separate install.
site/             React + Vite frontend (treeos.ai). Separate deploy.
horizon/          The Horizon (land discovery + extension registry). Separate server.
create-treeos/    Scaffolder (npx create-treeos my-land).
```

## Protocol

The core protocol is documented in [PROTOCOL.md](PROTOCOL.md). Extensions are documented in [EXTENSIONS.md](EXTENSIONS.md). Every land serves its capabilities at `GET /api/v1/protocol`.

## Contributing

Contributing guide is in progress. For now: fork, branch, PR. Extension development is documented in `land/extensions/EXTENSION_FORMAT.md`.

## License

AGPL-3.0. See [LICENSE](LICENSE) for details.
