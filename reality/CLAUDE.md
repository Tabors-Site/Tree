# TreeOS Place Server

This is a TreeOS reality. An operating system for AI agents. You are inside a running server that hosts trees, runs AI conversations, and connects to a federated network.

## What you are looking at

Three concerns live at the top level: **what TreeOS is** (seed/), **what conversation over the wire looks like** (protocols/), and **how it gets carried** (transports/). Plus extensions.

```
seed/              The seed. Four folders, four roles. NEVER modify.

  materials/     IS    — what the world is made of. space/, matter/, being/,
                       qualities.js, facts.js, seeds.js, doCeiling.js,
                       manifest.js, MATERIALS.md. Materials define the
                       possible (what kinds of fact can be stamped); facts
                       define the actual (what occurred).
  ibp/          ACTS  — the world as acted-upon. SEE/DO/SUMMON/BE, address,
                       authorize, operations, descriptor, discovery,
                       pushChannel, resolver, stanceProperties.
  factory/      THINKS — the world as thought, for LLM beings. The thinking
                       apparatus LLM beings use. Humans cognize on their own
                       (out-of-band, in their own heads) and route through
                       portals; scripted beings ARE their code, no apparatus
                       needed. This folder only matters when an LLM is in
                       the loop: runTurn, buildPrompt, llmClient, mcpClient,
                       scheduler, inbox, wakeSchedule, session, subscriptions,
                       replyAggregator, defaultSummon, assignments,
                       connections, tools.js, roles/.
  system/       HOST  — the host-realm floor. dbConfig, log, hooks,
                       indexes, version, retention, migrations/, utils.
                       Knows nothing of space/matter/being/verb by name.

  models/            Mongoose schemas for all 6 primitives:
                     being, space, matter, did, summon, llmConnection.
  services.js        Assembles `reality` from the four folders above.
  spaceRoot.js        This reality's space root + the nine seed spaces.
  realityConfig.js      This reality's config.
  SEED.md            Seed internals doc (first-person, from the I-Am).
  LICENSE            AGPL-3.0 with a preamble naming the seed.
```

**Placement rule.** For any seed file, ask: does this describe what a being **IS**, how it **ACTS**, or how it **THINKS**? → `materials/` / `ibp/` / `factory/`. Does it touch the host while knowing nothing of the world? → `system/`. Schemas live in `models/` (shape vs behavior is a separate axis).

protocols/ What conversation over the wire looks like. Never owns transport.
ibp/ Four-verb protocol (SEE/DO/SUMMON/BE) on stances/positions
canopy/ Federation protocol between places
mcp/ MCP adapter for AI tool execution

transports/ Thin carriers. Translate transport-shape into protocol envelopes.
http/ Express handlers; canonical /ibp/<verb>/<addr> adapter
handler.js Main router; wires middleware + extension routes
api/ibp.js The single IBP HTTP adapter (every op derivable)
api/config.js Horizon proxies + /reality/root (deferred surface)
auth.js users.js Auth shims into IBP BE verb
canopy.js Federation transport routes
middleware/ authenticate, dbHealth, securityHeaders, ...
ws/ Socket.io server; same dispatchIbp the HTTP adapter uses
cli/ (reserved for the eventual CLI adapter)

extensions/ Extensions. This is where you build.
plant.js Operator's act. Plants the seed (writes .env, picks extensions). Once only.
begin.js t=0. Opens HTTP/WebSocket senses; fires genesis().
genesis.js The unfolding. Indexes, config, migrations, beings, extensions, jobs.

````

**The dependency direction.** transports → protocols → seed. Extensions sit beside the three and consume them. seed never imports from protocols or transports; protocols never import from transports.

## The six rules (never violated)

1. **Seed never imports from extensions.** The seed does not know extensions exist.
2. **Extensions import from seed.** One-way dependency.
3. **Extensions reach each other through `getExtension()` or hooks.** No direct imports between extensions.
4. **Extension data lives in the `qualities` Map.** Never in seed schemas. See [seed/philosophy/MATERIALS.md](seed/philosophy/MATERIALS.md) "Qualities" for why the field is named that way and the constitutive-vs-characterizing test for where any new property belongs.
5. **Seed schemas never change.** Space has 12 fields. User has 7. The Map grows anything.
6. **Zero `getExtension()` calls in seed.** The seed can't be tricked into loading extension code.

## Architectural patterns (read before building anything)

**The four verbs are the public surface.** SEE / DO / SUMMON / BE over IBP addresses (`<reality>/<path>@<being>`). Every operation in the system maps to one of these. Small protocol; expressiveness lives in role templates, registered operations, and the substrate the seed materializes.

**Resolution chains walk the ancestor cache.** Stance authorization, extension scope, tool scope, LLM connection, LLM config, perspective filter, descriptor derivers. All walk the parent chain from the current space to the space root. All use the same cached snapshot per message. One walk serves every chain.

**Position determines behavior.** No "zones" — that framing retired. A being at the space root sees one capability surface; the same being inside a tree sees another. Differences come from per-position stance rules, ownership, the role the summoned being carries, and the operations the loader has registered. Navigation IS attention shift; the substrate at each position is what changes the mind.

**before hooks intercept. after hooks react.** Before hooks run sequentially because they can cancel. After hooks run in parallel because they react independently. `enrichContext` is the sequential override because its handlers build cumulative output. Don't make a hook sequential without articulating why handlers depend on each other's output.

**The `qualities` Map is the real invention.** The schema fields are the bones — seed-defined, closed, constitutive. The Map is the flesh — extension-defined, open, characterizing. Every extension writes to its own namespace: `qualities.values`, `qualities.prestige`, `qualities.permissions`. The schemas never change. The Map grows anything. Two concurrent writes to different namespaces on the same primitive do not clobber each other because `qualities.{being,space,matter}.setQuality` uses atomic `$set` on the specific namespace key. Full rationale (why "qualities" not "metadata", the test for where new properties belong) lives in [seed/philosophy/MATERIALS.md](seed/philosophy/MATERIALS.md) "Qualities".

**The tree is not a filesystem.** Spaces aren't files. They're concepts. Parent-child isn't a directory structure. It's how meaning relates to other meaning. When you navigate, you don't change directories. You change what the mind is attending to. The AI at each position thinks from that position's perspective, with that position's tools, roles, and context.

**The operator always decides.** Extensions suggest. Intent proposes actions. Delegate matches work to humans. Evolve writes specs. Governance shows compatibility. Nothing forces. Nothing auto-installs. Nothing pushes code onto the reality. The seed is sovereign. The directory coordinates through exclusion, not injection.

## Building an extension

```bash
cp -r extensions/_template extensions/my-extension
````

Edit `manifest.js` to declare what you need and what you provide. Edit `index.js` to register hooks, tools, roles, operations, and seeds. The loader handles the rest.

Full reference: `extensions/EXTENSION_FORMAT.md`

### What an extension can provide

- **Tools** (declared in `init()` return; registered via `registerToolBundle`. Verb-tagged: see/do/summon/be)
- **Roles** (summonable being templates; declare `canSee/canDo/canSummon/canBe` and a prompt body)
- **Operations** (DO actions registered through `reality.do.registerOperation`; auto-namespaced `<ext>:<action>`)
- **Seeds** (plantable scaffolds; recipes that fan a structure into existence when an operator plants them)
- **Hooks** (lifecycle handlers: beforeMatter, afterMatter, enrichContext, afterMetadataWrite, beforeFact, ...)
- **DO-trigger subscriptions** (wake a being when matching substrate writes happen)
- **Scheduled wakes** (fire a SUMMON on a being's inbox at a cadence)
- **Descriptor derivers** (contribute derived fields to the Position Description clients render)
- **Default permissions** (stance-auth Layer 3 contributions; rules the seed walks during authorize)
- **Routes** (HTTP endpoints, mostly for legacy callers; the protocol is IBP first)
- **Jobs** (background workers with start/stop)
- **Models** (Mongoose schemas registered into `place.models`)
- **CLI commands** (auto-generated from manifest declarations)

### Key patterns

**enrichContext** is how you speak to the AI. The seed builds the prompt. Your extension injects context through this hook. Always guard: check if relevant data exists before injecting. Never run expensive queries unconditionally.

**`qualities.{being,space,matter}.setQuality`** is how you write data. Each extension gets its own namespace in the `qualities` Map. `reality.qualities.space.setQuality(space, "my-extension", data)` writes atomically. You can only write to your own namespace. Same nine atomic primitives (`setQuality`, `mergeQuality`, `incQuality`, `pushQuality`, `addToQualitySet`, `batchSetQuality`, `unsetQuality`, `getQuality`, `readQualityNamespace`) on each sub-namespace.

**registerSlot** is how you add UI to pages. Extensions register HTML fragments for named slots (e.g. `apps-grid`, `user-quick-links`, `user-profile-sections`, `space-detail-sections`). Pages resolve slots by name. Whatever's installed appears. Whatever's not doesn't. Same pattern as hooks, roles, tools. Spatial scoping filters slots per position. Get it from treeos-base exports:

```js
const treeos = getExtension("treeos-base");
treeos?.exports?.registerSlot?.(
  "apps-grid",
  "my-ext",
  (ctx) => {
    return `<div class="app-card">...</div>`;
  },
  { priority: 50 },
);
```

**emitSlotUpdate** pushes live UI updates via WebSocket. After data changes (afterMatter, afterMetadataWrite hooks), call `emitSlotUpdate(core, userId, slotName, extName, context)` to re-render a slot fragment and push it to the client without a page refresh.

**inApp query param** is set when pages load inside the app shell iframe. Dashboard pages should skip their own chatbar when `inApp` is truthy because the app shell provides the chat panel. Pass `inApp: !!req.query.inApp` to your renderer and conditionally exclude chatbar HTML/CSS/JS.

**OrchestratorRuntime** is how you run multi-step AI pipelines. Single LLM call: use `place.llm.runTurn()`. Multi-step background pipeline: use `new OrchestratorRuntime()` with init, runStep, trackStep, cleanup.

**LLM_PRIORITY** on every LLM call. BACKGROUND for jobs. INTERACTIVE for user-triggered tools. GATEWAY for external channels. Without priority, background work starves human responses.

**scope: "confined"** for dangerous extensions. Inactive everywhere by default. Operators allow at specific positions with `ext-allow`.

## The six primitives

Everything in the seed serves one of six primitives (one per Mongoose schema):

| Primitive         | What it is                                                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Being**         | An identity instance. Carries roles, parents under another being, homes at a space. Humans, AI, scripted-cognition, future composites. The I-am — the Node process itself — is a Being too; the seed is the first being, not a faceless layer beneath them. |
| **Space**         | A position in the tree. Holds matter, hosts beings, owns quality namespaces.                                                                                                                                                                                  |
| **Matter**        | Stuff inside a space. `origin` field names where it actually lives (ibp, filesystem, web, cross-place).                                                                                                                                                        |
| **Fact**          | A thing a being stamps in the Factory. One recorded change to matter, space, or being. `factum`, a thing done. A single fact is small but settled; a chain of facts, folded, is Truth.                                                                          |
| **Summon**        | One being-to-being call. The record of one wake-and-act, whatever cognition the receiving being has — LLM, scripted code, human reply, future composite. The seed doesn't care which; the protocol is the same.                                             |
| **LlmConnection** | Per-being LLM client config (URL, key, model).                                                                                                                                                                                                                |

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

- `seed/SEED.md` for seed internals
- `extensions/EXTENSION_FORMAT.md` for the full extension contract
- `extensions/_template/` for a scaffold to copy
- https://treeos.ai for documentation
- https://horizon.treeos.ai for the extension registry
