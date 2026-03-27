# TreeOS Land Server

This is a TreeOS land. An operating system for AI agents. You are inside a running server that hosts trees, runs AI conversations, and connects to a federated network.

## What you are looking at

```
seed/              The kernel. NEVER modify.
extensions/        90 extensions. This is where you build.
canopy/            Federation. How lands find and talk to each other.
routes/            HTTP API. Core endpoints. Extensions add their own routes.
orchestrators/     Pipeline runtime for multi-step AI operations.
mcp/               MCP server. AI tool execution bridge.
boot.js            Entry point. First-run setup wizard.
server.js          Express server, CORS, WebSocket, graceful shutdown.
startup.js         Boot sequence. Indexes, config, migrations, extensions, jobs.
```

## The six rules (never violated)

1. **Seed never imports from extensions.** The kernel does not know extensions exist.
2. **Extensions import from seed.** One-way dependency.
3. **Extensions reach each other through `getExtension()` or hooks.** No direct imports between extensions.
4. **Extension data lives in metadata Maps.** Never in seed schemas.
5. **Seed schemas never change.** Node has 12 fields. User has 7. The Map grows anything.
6. **Zero `getExtension()` calls in seed.** The kernel can't be tricked into loading extension code.

## Architectural patterns (read before building anything)

**Resolution chains walk the ancestor cache.** Extension scope, tool scope, mode resolution, LLM resolution, persona resolution, perspective filter resolution. All walk the parent chain from the current node to the root. All use the same cached snapshot per message. One walk serves all chains. The ancestor cache is the performance backbone.

**Three zones. Position determines behavior.** `/` (land root) is the land zone: system management, config, users, peers. `~` (user home) is the home zone: personal space, raw ideas, settings. Inside a tree is the tree zone: chat/place/query, full orchestration. Navigate somewhere and the capability surface changes. The AI at each position has different tools, different modes, different context. `cd` is the most important command.

**before hooks intercept. after hooks react.** Before hooks run sequentially because they can cancel. After hooks run in parallel because they react independently. Two overrides: enrichContext and onCascade are sequential because their handlers build cumulative output. Don't make a hook sequential without articulating why handlers depend on each other's output.

**The metadata Map is the real invention.** Twelve schema fields are the bones. The Map is the flesh. Every extension writes to its own namespace. `metadata.values`, `metadata.prestige`, `metadata.cascade`. The schemas never change. The Map grows anything. Two concurrent writes to different namespaces on the same node do not clobber each other because setExtMeta uses atomic `$set` on the specific namespace key.

**Cascade is awareness propagation.** A note written at one node creates awareness at other nodes. The receiving node's AI doesn't just get data. It gets context that changes how it thinks. The perspective filter isn't a data router. It's an attention filter. The codebook isn't compression. It's shared understanding. Cascade is how ideas spread through the tree.

**The tree is not a filesystem.** Nodes aren't files. They're concepts. Parent-child isn't a directory structure. It's how meaning relates to other meaning. When you navigate, you don't change directories. You change what the mind is attending to. The AI at each position thinks from that position's perspective, with that position's tools, modes, and context.

**The operator always decides.** Extensions suggest. Intent proposes actions. Delegate matches work to humans. Evolve writes specs. Governance shows compatibility. Nothing forces. Nothing auto-installs. Nothing pushes code onto the land. The seed is sovereign. The directory coordinates through exclusion, not injection.

## Building an extension

```bash
cp -r extensions/_template extensions/my-extension
```

Edit `manifest.js` to declare what you need and what you provide. Edit `index.js` to register hooks, modes, and tools. The loader handles the rest.

Full reference: `extensions/EXTENSION_FORMAT.md`

### What an extension can provide

- **Routes** (HTTP endpoints at /api/v1)
- **Tools** (MCP tools the AI can call)
- **Modes** (custom AI conversation modes with system prompts)
- **Hooks** (lifecycle event handlers: beforeNote, afterNote, enrichContext, etc.)
- **Jobs** (background tasks with start/stop)
- **Orchestrator** (replace the entire conversation flow)
- **CLI commands** (auto-generated from manifest declarations)

### Key patterns

**enrichContext** is how you speak to the AI. The kernel builds the prompt. Your extension injects context through this hook. Always guard: check if relevant data exists before injecting. Never run expensive queries unconditionally.

**setExtMeta** is how you write data. Each extension gets its own namespace in the metadata Map. `setExtMeta(node, "my-extension", data)` writes atomically. You can only write to your own namespace.

**OrchestratorRuntime** is how you run multi-step AI pipelines. Single LLM call: use `core.llm.runChat()`. Multi-step background pipeline: use `new OrchestratorRuntime()` with init, runStep, trackStep, cleanup.

**LLM_PRIORITY** on every LLM call. BACKGROUND for jobs. INTERACTIVE for user-triggered tools. GATEWAY for external channels. Without priority, background work starves human responses.

**scope: "confined"** for dangerous extensions. Inactive everywhere by default. Operators allow at specific positions with `ext-allow`.

## The four primitives

Everything in the kernel serves one of four primitives:

| Primitive | What it is |
|-----------|-----------|
| **Structure** | Two schemas (Node, User). Nodes in hierarchies. Metadata Maps hold everything else. |
| **Intelligence** | Conversation loop. LLM, tool, mode, position resolution. The AI thinks at every position. |
| **Extensibility** | Loader, 27 hooks, five registries. Spatial scoping. Extensions add all capabilities. |
| **Communication** | Cascade signals, .flow system node, visible results. Signals propagate and get recorded. |

## Extension ecosystem (90 extensions, 4 bundles)

**Base TreeOS (18):** treeos, tree-orchestrator, land-manager, navigation, starter-types, console, dashboard, notifications, monitor, llm-response-formatting, team, user-tiers, html-rendering, water, heartbeat, purpose, phase, remember.

**treeos-cascade (8):** The nervous system. Signals propagate, get filtered, compressed, monitored.

**treeos-intelligence (13):** Self-awareness. Compression, contradiction detection, user profiling, autonomous intent, semantic search, exploration, tracing, boundary mapping, competence tracking, conversational awareness, extension proposal.

**treeos-connect (8):** External channels. Telegram, Discord, Slack, email, SMS, webhooks, Matrix.

**treeos-maintenance (5):** Hygiene. Prune, reroot, changelog, daily digest, delegation.

**Standalone (8):** persona, mycelium, peer-review, seed-export, channels, governance, teach, split.

## Security

Extensions run in the same Node.js process as the kernel. They can access the filesystem, network, and database. Review all third-party extension code before installing. Three extensions declare `scope: "confined"` (shell, solana, scripts) and are inactive until explicitly allowed at a position.

## CLI

Install separately: `npm install -g treeos`

```bash
treeos connect http://localhost:3000
treeos register
treeos start                    # interactive shell
treeos chat "hello"             # talk to the AI
treeos ext search               # browse the registry
treeos ext install <name>       # install from registry
```

## Learn more

- `seed/SEED.md` for kernel internals
- `extensions/EXTENSION_FORMAT.md` for the full extension contract
- `extensions/_template/` for a scaffold to copy
- https://treeos.ai for documentation
- https://horizon.treeos.ai for the extension registry
