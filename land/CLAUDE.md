# TreeOS Land Server

This is a TreeOS land. An operating system for AI agents. You are inside a running server that hosts trees, runs AI conversations, and connects to a federated network.

## What you are looking at

Three concerns live at the top level: **what TreeOS is** (seed/), **what conversation over the wire looks like** (protocols/), and **how it gets carried** (transports/). Plus extensions.

```
seed/              The kernel. Data shape + registries + hooks. NEVER modify.
  models/            Mongoose schemas: Space, Being, Matter, Did, Summon, LlmConnection
  ibp/               Core IBP grammar: verbs, operations, authorize, address,
                     resolver, descriptor, discovery, errors, protocol/ERR,
                     pushChannel. Seed-internal; protocols/ibp/ is the wire adapter.
  being/             Identity: beRegistry, identity, position, landBeings,
                     beingMetadata, plus roles/ (registry + built-ins: auth, echo,
                     landManager, llmAssigner).
  space/             Tree ops: ancestorCache, ownership, spaceManagement, dids,
                     cascade, spaceCircuit, extensionMetadata, extensionScope,
                     documentGuard, seeds, seedRoles.
  matter/            matters, matterMetadata, origins, uploadCleanup.
  cognition/         Runtime: runChat, buildPrompt, llmClient, mcpClient,
                     scheduler, inbox, wakeSchedule, session, subscriptions,
                     replyAggregator, replyEmission, defaultSummon, assignments,
                     connections.
  system/            hooks, log, migrations/, indexes, dbConfig, integrityCheck,
                     dataRetention, registryMirror, source, tools, utils, version.
  services.js        Assembles `core` from the domain folders above.
  landRoot.js        This land's root + system spaces.
  landConfig.js      This land's config.
  (Hook registry lives at seed/system/hooks.js; codebase-mirroring source
   lives at seed/space/source.js — re-exposed through services.js as
   core.hooks etc.)

protocols/         What conversation over the wire looks like. Never owns transport.
  ibp/               Four-verb protocol (SEE/DO/SUMMON/BE) on stances/positions
  canopy/            Federation protocol between lands
  mcp/               MCP adapter for AI tool execution

transports/        Thin carriers. Translate transport-shape into protocol envelopes.
  http/              Express handlers; canonical /ibp/<verb>/<addr> adapter
    handler.js         Main router; wires middleware + extension routes
    api/ibp.js         The single IBP HTTP adapter (every op derivable)
    api/config.js      Horizon proxies + /land/root (deferred surface)
    auth.js users.js   Auth shims into IBP BE verb
    canopy.js          Federation transport routes
    middleware/        authenticate, dbHealth, securityHeaders, ...
  ws/                Socket.io server; same dispatchIbp the HTTP adapter uses
  cli/               (reserved for the eventual CLI adapter)

extensions/        Extensions. This is where you build.
boot.js            Entry point. First-run setup wizard.
server.js          Express + WebSocket bring-up, graceful shutdown.
genesis.js         Boot sequence: indexes, config, migrations, extensions, jobs.
```

**The dependency direction.** transports → protocols → seed. Extensions sit beside the three and consume them. seed never imports from protocols or transports; protocols never import from transports.

## The six rules (never violated)

1. **Seed never imports from extensions.** The kernel does not know extensions exist.
2. **Extensions import from seed.** One-way dependency.
3. **Extensions reach each other through `getExtension()` or hooks.** No direct imports between extensions.
4. **Extension data lives in metadata Maps.** Never in seed schemas.
5. **Seed schemas never change.** Space has 12 fields. User has 7. The Map grows anything.
6. **Zero `getExtension()` calls in seed.** The kernel can't be tricked into loading extension code.

## Architectural patterns (read before building anything)

**The four verbs are the public surface.** SEE / DO / SUMMON / BE over IBP addresses (`<land>/<path>@<being>`). Every operation in the system maps to one of these. Small protocol; expressiveness lives in role templates, registered operations, and the substrate the seed materializes.

**Resolution chains walk the ancestor cache.** Stance authorization, extension scope, tool scope, LLM connection, LLM config, perspective filter, descriptor derivers. All walk the parent chain from the current space to the land root. All use the same cached snapshot per message. One walk serves every chain.

**Position determines behavior.** No "zones" — that framing retired. A being at the land root sees one capability surface; the same being inside a tree sees another. Differences come from per-position stance rules, ownership, the role the summoned being carries, and the operations the loader has registered. Navigation IS attention shift; the substrate at each position is what changes the mind.

**before hooks intercept. after hooks react.** Before hooks run sequentially because they can cancel. After hooks run in parallel because they react independently. Two overrides: enrichContext and onCascade are sequential because their handlers build cumulative output. Don't make a hook sequential without articulating why handlers depend on each other's output.

**The metadata Map is the real invention.** Twelve schema fields are the bones. The Map is the flesh. Every extension writes to its own namespace. `metadata.values`, `metadata.prestige`, `metadata.cascade`. The schemas never change. The Map grows anything. Two concurrent writes to different namespaces on the same space do not clobber each other because setExtMeta uses atomic `$set` on the specific namespace key.

**Cascade is awareness propagation.** A note written at one space creates awareness at other spaces. The receiving space's AI doesn't just get data. It gets context that changes how it thinks. The perspective filter isn't a data router. It's an attention filter. The codebook isn't compression. It's shared understanding. Cascade is how ideas spread through the tree.

**The tree is not a filesystem.** Spaces aren't files. They're concepts. Parent-child isn't a directory structure. It's how meaning relates to other meaning. When you navigate, you don't change directories. You change what the mind is attending to. The AI at each position thinks from that position's perspective, with that position's tools, modes, and context.

**The operator always decides.** Extensions suggest. Intent proposes actions. Delegate matches work to humans. Evolve writes specs. Governance shows compatibility. Nothing forces. Nothing auto-installs. Nothing pushes code onto the land. The seed is sovereign. The directory coordinates through exclusion, not injection.

## Building an extension

```bash
cp -r extensions/_template extensions/my-extension
```

Edit `manifest.js` to declare what you need and what you provide. Edit `index.js` to register hooks, tools, roles, operations, and seeds. The loader handles the rest.

Full reference: `extensions/EXTENSION_FORMAT.md`

### What an extension can provide

- **Tools** (declared in `init()` return; registered via `registerToolBundle`. Verb-tagged: see/do/summon/be)
- **Roles** (summonable being templates; declare `canSee/canDo/canSummon/canBe` and a prompt body)
- **Operations** (DO actions registered through `core.do.registerOperation`; auto-namespaced `<ext>:<action>`)
- **Seeds** (plantable scaffolds; recipes that fan a structure into existence when an operator plants them)
- **Hooks** (lifecycle handlers: beforeMatter, afterMatter, enrichContext, afterMetadataWrite, beforeDid, ...)
- **DO-trigger subscriptions** (wake a being when matching substrate writes happen)
- **Scheduled wakes** (fire a SUMMON on a being's inbox at a cadence)
- **Descriptor derivers** (contribute derived fields to the Position Description clients render)
- **Default permissions** (stance-auth Layer 3 contributions; rules the kernel walks during authorize)
- **Routes** (HTTP endpoints, mostly for legacy callers; the protocol is IBP first)
- **Jobs** (background workers with start/stop)
- **Models** (Mongoose schemas registered into `core.models`)
- **CLI commands** (auto-generated from manifest declarations)

### Key patterns

**enrichContext** is how you speak to the AI. The kernel builds the prompt. Your extension injects context through this hook. Always guard: check if relevant data exists before injecting. Never run expensive queries unconditionally.

**setExtMeta** is how you write data. Each extension gets its own namespace in the metadata Map. `setExtMeta(space, "my-extension", data)` writes atomically. You can only write to your own namespace.

**registerSlot** is how you add UI to pages. Extensions register HTML fragments for named slots (e.g. `apps-grid`, `user-quick-links`, `user-profile-sections`, `space-detail-sections`). Pages resolve slots by name. Whatever's installed appears. Whatever's not doesn't. Same pattern as hooks, modes, tools. Spatial scoping filters slots per position. Get it from treeos-base exports:
```js
const treeos = getExtension("treeos-base");
treeos?.exports?.registerSlot?.("apps-grid", "my-ext", (ctx) => {
  return `<div class="app-card">...</div>`;
}, { priority: 50 });
```

**emitSlotUpdate** pushes live UI updates via WebSocket. After data changes (afterMatter, afterMetadataWrite hooks), call `emitSlotUpdate(core, userId, slotName, extName, context)` to re-render a slot fragment and push it to the client without a page refresh.

**inApp query param** is set when pages load inside the app shell iframe. Dashboard pages should skip their own chatbar when `inApp` is truthy because the app shell provides the chat panel. Pass `inApp: !!req.query.inApp` to your renderer and conditionally exclude chatbar HTML/CSS/JS.

**OrchestratorRuntime** is how you run multi-step AI pipelines. Single LLM call: use `core.llm.runChat()`. Multi-step background pipeline: use `new OrchestratorRuntime()` with init, runStep, trackStep, cleanup.

**LLM_PRIORITY** on every LLM call. BACKGROUND for jobs. INTERACTIVE for user-triggered tools. GATEWAY for external channels. Without priority, background work starves human responses.

**scope: "confined"** for dangerous extensions. Inactive everywhere by default. Operators allow at specific positions with `ext-allow`.

## The six primitives

Everything in the kernel serves one of six primitives (one per Mongoose schema):

| Primitive | What it is |
|-----------|-----------|
| **Being** | An identity instance. Carries roles, parents under another being, homes at a space. Humans, AI, scripted-cognition, future composites. The I-am — the Node process itself — is a Being too; the kernel is the first being, not a faceless layer beneath them. |
| **Space** | A position in the tree. Holds matter, hosts beings, owns metadata namespaces. |
| **Matter** | Stuff inside a space. `origin` field names where it actually lives (ibp, filesystem, web, cross-land). |
| **Did** | One DO emission. The audit trail. Past tense — "a did is a thing that was done." |
| **Summon** | One being-to-being call. The record of one wake-and-act, whatever cognition the receiving being has — LLM, scripted code, human reply, future composite. The kernel doesn't care which; the protocol is the same. |
| **LlmConnection** | Per-being LLM client config (URL, key, model). |

## Security

Extensions run in the same Node process as the seed. They can access the filesystem, network, and database. Review third-party extension code before installing. Extensions declaring `scope: "confined"` are inactive until explicitly allowed at a position.

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
