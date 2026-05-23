# Extension Format

> **WARNING:** This is a new community and we are developing extensions together. There may be bad actors, and while the seed is safe, extensions can reach into your filesystem and much more. Review all extension code yourself if it's unknown. Extensions have full access to the Node.js process. The blocklist on shell is defense in depth, not a sandbox. The real security boundary is the operator's judgment. Install what you trust. Review what you don't.

## The Grammar

Your extension is a **verb**. It gives the tree a new way to act. Food tracks. Fitness logs. Study teaches.

Your **modes are conjugations**. Each mode is a tense of your verb: `:log` (present tense, recording facts), `:coach` (future, guiding), `:review` (past, analyzing), `:plan` (imperative, building structure).

Your **classifierHints** define your **noun territory**. They are the vocabulary list that tells the routing index which messages belong to your verb. "ate", "eggs", "breakfast" belong to food. "bench", "squat", "reps" belong to fitness.

Your **enrichContext** handler injects **adjectives**. Values, goals, status, today's totals. Data that describes the nouns at this position so the AI can see them.

Your **tools** are the **actions your verb can perform**. `food-log-entry` is food's write action. `fitness-add-exercise` is fitness's creation action. Keep tools specific to your domain. Never give modes generic tree tools that could write outside your territory.

The routing pipeline parses every message: noun (whose territory?) then tense (what conjugation?) then modifiers (instructions, boundaries) then dispatch (your mode runs). Your extension plugs into this grammar by registering modes and declaring hints. The tree does the rest.

## Directory Structure

```
extensions/<name>/
  manifest.js    # Required: declares dependencies, capabilities, metadata
  index.js       # Required: exports init(place) function
  routes.js      # Optional: Express router for HTTP endpoints
  model.js       # Optional: Mongoose model(s)
  ...            # Any other files the extension needs
```

## Manifest (manifest.js)

```js
export default {
  name: "my-extension",          // Unique name (lowercase, hyphens)
  version: "1.0.0",              // Semver
  description: "What it does",   // One line

  needs: {
    services: ["llm", "session"],        // Core services required
    models: ["Space", "User"],            // Core models required
    middleware: ["resolveTreeAccess"],    // Core middleware required
    extensions: ["understanding"],       // Other extensions required
  },

  optional: {
    services: ["energy"],                // Gets no-op stub if missing
    extensions: ["billing"],             // Loaded after if present, ignored if not
  },

  provides: {
    models: {
      MyModel: "./model.js",            // Registered in place.models
    },
    routes: "./routes.js",              // Mounted at /api/v1
    tools: false,                       // Or true if init() returns tools[]
    jobs: false,                        // Or path to job module
    orchestrator: false,                // Or path to orchestrator pipeline
    energyActions: {
      myAction: { cost: 1 },            // Registered if energy is available
    },
    sessionTypes: {
      MY_SESSION: "my-session-type",    // Registered in session registry
    },
    hooks: {
      fires: [                          // Hooks this extension emits (other extensions can listen)
        { name: "my-ext:afterProcess", data: "{ result, userId }", description: "Fired after processing completes" },
      ],
      listens: [                        // Hooks this extension handles
        "afterMatter", "enrichContext", // Core hooks
        "gateway:beforeDispatch",        // Another extension's hook
      ],
    },
    defaultPermissions: {               // Stance-auth Layer 3 contributions.
      // Default permission rules the extension contributes to the
      // authorize walk. The seed checks these AFTER per-position
      // rules (Layer 2) and BEFORE default-deny. Keys are the same
      // shape as metadata.permissions entries.
      "do:my-ext:run":      { requires: { owner: true } },
      "do:my-ext:read-only":{ requires: {} },                 // anyone
      "summon:@my-coach":   { requires: { homeInDomain: true } },
    },
  },
};
```

## CRITICAL: Service and Dependency Declarations

**If your extension uses a core service, you MUST declare it in `needs.services` or `optional.services`.** The loader builds a scoped place object that only contains declared services. Undeclared services are undefined.

**Common failure:** `Cannot read properties of undefined (reading 'runTurn')` means you used `place.llm.runTurn` without declaring `services: ["llm"]` in your manifest.

### Available seed services

The four verbs (`place.see`, `place.do`, `place.summon`, `place.be`) are always callable and are the only public surface for substrate operations. Everything below is a syntactic helper or an infrastructure surface those verbs sit on.

| Service | What it provides | Common functions |
|---------|-----------------|-----------------|
| `see` / `do` / `summon` / `be` | The four verbs. Always available. | `place.do(target, "set-qualities", { namespace, data })`, `place.see(address)`, etc. |
| `facts` | Audit-row stamping. | `logFact` |
| `auth` | Identity primitives. | `resolveSpaceAccess`, `createBeing`, `verifyPassword`, `generateToken`, `findBeingByName`, `registerStrategy` |
| `session` | Per-reach session lifecycle. | `createSession`, `endSession`, `getSession`, `SESSION_TYPES`, `registerSessionType` |
| `summon` | Stamp-row helpers. | `stamp`, `ensureSession` |
| `llm` | LLM voice apparatus. | `runTurn`, `stepTurn`, `getClientForBeing`, `switchRole`, `registerBeingLlmSlot`, `registerFailoverResolver` |
| `websocket` | Push channel (transport-agnostic). | `emitToBeing`, `emitNavigate`, `registerSocketHandler`, `getIO` |
| `models` | Mongoose models. | `Being`, `Space`, `Fact`, `Matter` |
| `hooks` | Lifecycle event bus. | `register`, `run` |
| `seeds` | Plantable scaffolds. | `register`, `plant`, `unplant`, `list`, `listPlantedAt` |
| `space` | Space CRUD + tree infrastructure. | `getAncestorChain`, `snapshotAncestors`, `createSpace`, `deleteSpaceBranch`, `checkTreeHealth`, `isTreeAlive`, `getSpaceRootId` |
| `matters` | Programmatic matter CRUD. | `createMatter`, `editMatter`, `deleteMatterAndFile`, `transferMatter`, `getMatters` |
| `spaceLocks` | Structural mutation locks. | `acquireSpaceLock`, `releaseSpaceLock`, `acquireMultiple` |
| `qualities` | Per-primitive qualities Map. Three sub-namespaces: `place.qualities.being`, `place.qualities.space`, `place.qualities.matter`. Each carries the same nine atomic primitives. Namespace ownership is enforced for space and matter writes. | `getQuality`, `setQuality`, `mergeQuality`, `incQuality`, `pushQuality`, `addToQualitySet`, `batchSetQuality`, `unsetQuality`, `readQualityNamespace` |
| `scope` | Extension-scope checks. | `isExtensionBlockedAtSpace`, `getBlockedExtensionsAtSpace`, `getExtensionAtScope`, `getToolOwner` |
| `declare` | Setup voice — what extensions declare so the verbs have something to act on. | `registerRole`, `unregisterRole`, `subscribe`, `unsubscribe`, `schedule`, `unschedule`, `aggregate`, `setScheduleEmitter` |
| `protocol` | Response shapes + error codes. | `ok`, `error`, `sendOk`, `sendError`, `IBP_ERR` |

### Dependency chains

Extensions load in topological order. If extension A depends on extension B (`needs.extensions: ["b"]`), B loads first. If B fails to load, A is skipped.

**Chain failures cascade.** If `propagation` fails, then any extension that depends on it skips, then any extension that depends on those skips. Fix the root cause and the whole chain recovers.

**Always check the boot log for the FIRST error.** Later "missing required deps" warnings are consequences, not causes.

### Always-available services

The four verbs (`place.see`, `place.do`, `place.summon`, `place.be`), `place.hooks`, and `place.qualities` are injected into every scoped place regardless of declaration. You never need to declare them.

The three sub-namespaces of `place.qualities` mirror each other. Every namespaced operation that works on a space also works on a being and on a matter, with the same nine atomic primitives on each (`place.qualities.space.setQuality` / `place.qualities.being.setQuality` / `place.qualities.matter.setQuality`, and so on). Pick the sub-namespace that matches the primitive you are tagging.

### Extension-provided services

Extensions can register services on the core object during init: `place.energy = { useEnergy, ... }`. Later extensions that declare `needs.services: ["energy"]` or `optional.services: ["energy"]` receive it. If the providing extension hasn't loaded yet, optional services get a no-op stub. Required services cause the dependent extension to skip.

## npm Dependencies

Extensions can declare npm packages they depend on. The loader handles installation automatically.

```js
export default {
  name: "gateway-discord",
  version: "1.0.0",
  npm: ["discord.js@^14.0.0"],
  // ...
};
```

**How it works:**

- The `npm` field is an array of strings in `"package@constraint"` format (e.g., `"discord.js@^14.0.0"`, `"@scope/pkg@^2.0.0"`, or just `"chalk"` for latest).
- On install (registry, git, or file), the loader generates a `package.json` in the extension directory and runs `npm install --production`.
- `node_modules` is scoped to the extension directory. Does not pollute the place's root `node_modules`.
- On boot, if `node_modules` is missing (fresh clone, deleted), the loader detects this and runs `npm install` before calling `init()`.
- If the manifest's `npm` array changes (dep added, version changed), the loader regenerates `package.json` and reinstalls on next boot.
- npm install is capped at `npmInstallTimeout` (default 60 seconds, configurable in place .config).
- If npm install fails during installation, the entire extension is rolled back. No partial installs.
- If npm install fails at boot, the extension is skipped. Other extensions continue loading.

**Publishing:** `package.json` is included in the published bundle. `node_modules` is not. Each installing place resolves its own npm dependencies.

**Usage in code:** Import packages normally. Node.js resolves from the local `node_modules`.

```js
import { Client, GatewayIntentBits } from "discord.js";
```

## Init Function (index.js)

```js
import { z } from "zod";

export async function init(place) {
  // Register hooks
  place.hooks.register("enrichContext", async ({ context, meta }) => {
    if (meta.myData) context.myData = meta.myData;
  }, "my-extension");

  // Register modes
  place.modes.registerMode("tree:my-mode", myModeConfig, "my-extension");

  // Register LLM slot mapping (optional)
  if (place.llm?.registerModeAssignment) {
    place.llm.registerModeAssignment("tree:my-mode", "my-slot");
  }

  // Register energy service (optional, no-ops if energy not loaded)
  if (place.energy) setEnergyService(place.energy);

  return {
    // Express router (mounted at /api/v1)
    router: myRouter,

    // Page router (mounted at /, for HTML pages)
    pageRouter: myPageRouter,

    // MCP tools (registered on the MCP server, available to AI)
    tools: [
      {
        name: "my-tool",
        description: "What it does",
        schema: {
          spaceId: z.string().describe("Target space ID"),
          userId: z.string().describe("Injected by server. Ignore."),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
        handler: async ({ spaceId, userId }) => {
          return { content: [{ type: "text", text: "Done" }] };
        },
      },
    ],

    // Inject tools into existing modes (so AI can use them in those modes)
    modeTools: [
      { modeKey: "tree:librarian", toolNames: ["my-tool"] },
    ],

    // Background jobs
    jobs: [
      {
        name: "my-job",
        start: () => { /* start interval/cron */ },
        stop: () => { /* clear interval */ },
      },
    ],

    // Exports (accessible by other extensions via getExtension("my-extension").exports)
    exports: {
      myFunction: someExportedFunction,
    },

    // Custom orchestrator (replaces the conversation flow for a bigMode)
    orchestrator: {
      bigMode: "tree",
      async handle({ visitorId, message, socket, userId, sessionId, rootId, ...ctx }) {
        // Full control over conversation flow
      },
    },
  };
}
```

**Note on manifest `provides` fields:** The manifest's `provides.tools`, `provides.jobs`, `provides.orchestrator`, and `provides.modes` are metadata only. The loader uses them for display and route collision detection. What actually loads is determined by the init() return value.

## Running AI Conversations (runTurn)

Use `place.llm.runTurn()` to run AI conversations from your extension. One call. No boilerplate.

```js
const { answer } = await place.llm.runTurn({
  userId,
  username,
  message: "analyze this data",
  mode: "tree:structure",
  rootId: "...",            // optional, for tree modes
  res,                      // optional, Express response for auto-abort on disconnect
  llmPriority: place.llm.LLM_PRIORITY.BACKGROUND, // optional, default HUMAN
});
```

Handles automatically: MCP connection, mode switching, Chat tracking, abort on client disconnect, session persistence, error finalization. Pass `res` for HTTP routes.

### LLM priority

When multiple sessions compete for LLM slots, priority determines who goes first. The semaphore queue is sorted by priority (lowest number first), then by arrival time.

| Priority | Value | Use case |
|----------|-------|----------|
| `HUMAN` | 1 | CLI and web sessions. Default for all `runTurn` calls. |
| `GATEWAY` | 2 | External channel responses (Telegram, Discord, email, SMS). |
| `INTERACTIVE` | 3 | Human-initiated async (scout, explore, reroot analysis). |
| `BACKGROUND` | 4 | Autonomous jobs (intent, dreams, codebook, compression). |

Access via `place.llm.LLM_PRIORITY`. Background jobs should always set `llmPriority: place.llm.LLM_PRIORITY.BACKGROUND` so human interactions never wait behind autonomous work.

## Session identity (runTurn and OrchestratorRuntime)

Both `runTurn` and `OrchestratorRuntime` route every turn through a single **ai-chat session key**. Three ways to declare intent:

1. **Pass-through** (`aiSessionKey`) — you received a key from an upstream caller and want this sub-call to join that session.
2. **Declared lane** (`scope` + `purpose` + optional `extra`) — you want a persistent, named internal chain under `tree-internal:${rootId}:${purpose}`, `home-internal:${userId}:${purpose}`, or `place-internal:${purpose}`. Fork parallel sub-chains with `extra`.
3. **Default** — nothing declared → ephemeral one-shot. No cross-call memory. Safest default for parsers, classifiers, one-shot scorers.

Never mint your own session-key string. The seed builds the key.

## Running Multi-Step Pipelines (OrchestratorRuntime)

For background jobs and multi-step AI pipelines (dreams, understanding, cleanup), use `OrchestratorRuntime`:

```js
import { OrchestratorRuntime } from "../../orchestrators/runtime.js";

const rt = new OrchestratorRuntime({
  rootId, userId, username,
  scope: "tree", purpose: "my-pipeline",  // seed mints the session key
  sessionType: "my-pipeline",
  description: "Processing tree",
  modeKeyForLlm: "tree:my-mode",
  lockNamespace: "my-pipeline",  // optional, prevents concurrent runs
  llmPriority: LLM_PRIORITY.BACKGROUND, // optional, default HUMAN
});

const ok = await rt.init("Starting pipeline");
if (!ok) return; // lock held by another run

try {
  // Each step: switches mode, calls LLM, tracks the chain
  const { parsed } = await rt.runStep("tree:analyze", {
    prompt: "Find issues in this tree",
  });

  await rt.runStep("tree:structure", {
    prompt: `Fix these issues: ${JSON.stringify(parsed)}`,
  });

  rt.setResult("Pipeline complete", "my-pipeline:done");
} catch (err) {
  rt.setError(err.message, "my-pipeline:error");
} finally {
  await rt.cleanup(); // finalize Chat, close MCP, release lock
}
```

### OrchestratorRuntime API

| Method | Purpose |
|--------|---------|
| `init(startMessage)` | Create session, resolve LLM, connect MCP. Returns false if lock held. |
| `attach({ sessionId, mainChatId, llmProvider, signal, connectMcp })` | Reuse existing session (for real-time orchestrators or chain steps). |
| `runStep(modeKey, { prompt, modeCtx, input, treeContext })` | Switch mode, call LLM, track chain step. Returns `{ parsed, raw, llmProvider }`. |
| `trackStep(modeKey, { input, output, startTime, endTime })` | Track a chain step without calling the LLM (for orchestrators that call stepTurn themselves). |
| `setResult(content, modeKey)` | Mark pipeline as successful. |
| `setError(message, modeKey)` | Mark pipeline as failed/stopped. |
| `cleanup()` | Finalize Chat, close MCP, end session, release lock. |
| `.aborted` | Boolean, true if abort signal fired. |
| `.signal` | The AbortSignal for passing to stepTurn. |
| `.chainIndex` | Current chain step index (auto-increments). |

### When to use what

| Need | Use |
|------|-----|
| Single message, user-facing | `place.llm.runTurn()` |
| Multi-step background pipeline | `OrchestratorRuntime` with `init()` + `runStep()` + `cleanup()` |
| Real-time interactive orchestrator | `OrchestratorRuntime` with `attach()` + `trackStep()` |

Never use `stepTurn` directly unless building a custom real-time orchestrator.

## Custom Orchestrator

Extensions can replace the entire conversation orchestrator for a bigMode (tree, home, place). The orchestrator controls how messages are classified, planned, and executed. This is the most powerful customization point in TreeOS. Replace it and you have a completely different AI product on the same seed.

**Discovery:** `GET /api/v1/place/orchestrators` returns which extension owns each bigMode.

### Minimal Example

```js
// manifest.js
export default {
  name: "my-orchestrator",
  version: "1.0.0",
  description: "Custom tree conversation flow",
  needs: { models: ["Space", "User"] },
  provides: { orchestrator: { bigMode: "tree" } },
};

// index.js
export async function init(place) {
  return {
    orchestrator: {
      bigMode: "tree",
      async handle({ visitorId, message, socket, userId, sessionId, rootId, spaceId, mode, ...ctx }) {
        // You have full control. Run LLM calls, use tools, navigate the tree.
        const { content } = await place.conversation.stepTurn({
          userId,
          username: ctx.username,
          message,
          mode,         // resolved mode key (e.g. "tree:respond")
          rootId,
          spaceId,
          sessionId,
          socket,       // for streaming to client
        });
        return { response: content };
      },
      // Optional: classify intent before handle() is called
      async classify({ message, treeContext, userId }) {
        return { intent: "chat", confidence: 1.0 };
      },
    },
  };
}
```

### Handler Interface

The `handle` function receives:

| Param | Type | Description |
|-------|------|-------------|
| `visitorId` | string | Socket visitor ID |
| `message` | string | User's message |
| `socket` | Socket | Socket.IO connection for streaming |
| `userId` | string | Authenticated user ID |
| `username` | string | Username |
| `sessionId` | string | Session ID (zone:rootId:userId) |
| `rootId` | string | Tree root space ID |
| `spaceId` | string | Current space ID |
| `mode` | string | Resolved mode key |

Return value: `{ response, navigatedTo, ... }`. The response is sent to the client.

### Core Utilities Available

| Utility | Access | Purpose |
|---------|--------|---------|
| `stepTurn()` | `place.conversation.stepTurn(opts)` | Run one LLM call with MCP tools |
| `runTurn()` | `place.llm.runTurn(opts)` | Higher-level: handles session, abort, tracking |
| `OrchestratorRuntime` | `place.orchestrator.OrchestratorRuntime` | Session lifecycle for multi-step flows |
| `acquireLock/releaseLock` | `place.orchestrator.acquireLock(key)` | Concurrency control |
| `parseJsonSafe` | `place.orchestrator.parseJsonSafe(str)` | Parse LLM JSON output (handles fences, trailing commas) |

### When to Build One

- You want a different conversation flow (e.g., always plan before acting, or never auto-navigate)
- You want to integrate external systems into the conversation loop
- You want to replace the chat/place/query classification entirely
- You want to add pre/post processing around every message

### Rules

- Only one orchestrator per bigMode. First registered wins.
- If no orchestrator is registered for a bigMode, the built-in flow runs.
- The built-in `tree-orchestrator` is itself an extension. Disable it and register your own.
- `GET /api/v1/place/orchestrators` shows what is active.

## Available Core Services

| Service | Key | Always Available |
|---------|-----|-----------------|
| Models | `place.models.{Being,Space,Fact,Matter}` | Yes |
| Auth | `place.auth.resolveTreeAccess` | Yes |
| Contributions | `place.contributions.logContribution` | Yes |
| Sessions | `place.session.*` | Yes |
| Chat | `place.chat.*` | Yes |
| LLM | `place.llm.*` (includes `LLM_PRIORITY`) | Yes |
| MCP | `place.mcp.*` | Yes |
| WebSocket | `place.websocket.*` | Yes (no-op if headless) |
| Orchestrator | `place.orchestrator.*` | Yes |
| Hooks | `place.hooks.*` | Yes (always injected) |
| Modes | `place.modes.*` | Yes (always injected) |
| Orchestrators | `place.orchestrators.*` | Yes |
| Ownership | `place.ownership.*` | Yes |
| Space | `place.space.*` | Yes |
| Space Locks | `place.spaceLocks.*` | Yes |
| Metadata | `place.qualities.*` (namespace-enforced, 7 functions) | Yes (always injected) |
| User Metadata | `place.beingMetadata.*` (6 functions) | Yes (always injected) |
| Scope | `place.scope.*` | Yes |
| Protocol | `place.protocol.*` | Yes |
| Energy | `place.energy.*` | No-op stub if extension not loaded |

## Logging

Use the core log module instead of `console.log`. This is the standard for all extensions.

```js
import log from "../../seed/log.js";

log.info("MyExt", "Job started");           // Level 1: always shown. Jobs, lifecycle.
log.verbose("MyExt", "Processing tree X");   // Level 2: normal operations. Pipeline steps.
log.debug("MyExt", "Placed item Y on space"); // Level 3: internal details. Individual operations.
log.warn("MyExt", "Retry failed, skipping"); // Always shown. Recoverable issues.
log.error("MyExt", "Fatal:", err.message);   // Always shown. Broken operations.
```

The first argument is the tag (your extension name). The console extension formats output with timestamps and colors. Without it, plain `[Tag] message` goes to stdout.

Severity levels:
- **info (1)**: Job start/stop, extension lifecycle. Operators always see these.
- **verbose (2)**: Pipeline progress, session events, mode switches. Default level.
- **debug (3)**: Individual LLM calls, tool arguments, item-level operations. Only when investigating.
- **warn/error**: Always shown regardless of level.

Set `LOG_LEVEL=1` in .env for quiet, `LOG_LEVEL=3` for everything. Change at runtime via CLI: `treeos log-level 3`.

## CLI Declarations

Extensions can declare CLI commands as metadata in the manifest.
The CLI auto-registers thin API callers from these declarations.

```js
provides: {
  cli: [
    { command: "blogs", description: "List posts", method: "GET", endpoint: "/blog/posts" },
    { command: "blog <slug>", description: "Read post", method: "GET", endpoint: "/blog/posts/:slug" },
  ],
}
```

Endpoint placeholders are resolved automatically by the CLI:
- `:spaceId` resolves from the current position in the tree
- `:rootId` resolves from the active tree
- `:userId` resolves from the logged in user
- `:version` resolves to "latest"
- Remaining `:param` placeholders are filled by positional `<args>` in order

## Hooks

The hook system is an open pub/sub bus. Core fires seed hooks. Extensions can fire their own hooks and listen to each other's. Any hook name is valid. No whitelist.

```js
export async function init(place) {
  // Listen to a core hook
  place.hooks.register("enrichContext", async ({ context, space, meta }) => {
    const myData = meta["my-extension"] || {};
    if (Object.keys(myData).length > 0) context.myData = myData;
  }, "my-extension");

  // Listen to another extension's hook
  place.hooks.register("gateway:beforeDispatch", async (data) => {
    // modify or react to gateway dispatches
  }, "my-extension");

  // Fire your own hook for other extensions to listen to
  await place.hooks.run("my-extension:afterProcess", { result, userId });
}
```

### Core hooks (fired by seed)

| Hook | Data shape | Type | Purpose |
|------|-----------|------|---------|
| `beforeMatter` | `{ spaceId, content, beingId, origin, metadata }` | before | Modify matter data before save. Origin is one of "ibp", "filesystem", "web", "cross-place". |
| `afterMatter` | `{ matter, spaceId, beingId, origin, sizeKB, deltaKB, action, chatId, sessionId }` | after | React after matter create/edit/delete. |
| `beforeContribution` | `{ spaceId, spaceVersion, action, userId }` | before | Modify contribution metadata. Prestige uses this to tag spaceVersion. |
| `afterSpaceCreate` | `{ space, userId }` | after | Initialize extension data on new spaces. |
| `beforeSpaceDelete` | `{ space, userId }` | before | Clean up extension data before deletion. |
| `enrichContext` | `{ context, space, meta }` | enrich | Inject extension data into AI context. |
| `beforeRegister` | `{ username, password }` | before | Validate or modify registration. |
| `afterRegister` | `{ user }` | after | Initialize user data after registration. |

### Extension hooks (examples)

Extensions define their own hooks using the `extName:hookName` naming convention:

| Hook | Extension | Purpose |
|------|-----------|---------|
| `gateway:beforeDispatch` | gateway | Before sending notifications to channels |
| `understanding:afterRun` | understanding | After understanding run completes |
| `dreams:afterDream` | dreams | After dream cycle finishes for a tree |

### Hook types

- **before**: Runs sequentially. Can modify the data object. Return `false` to cancel the operation. If a handler throws, the operation is also cancelled. The caller receives `{ cancelled: true, reason: "..." }`.
- **after**: Runs in parallel, fire-and-forget. Errors are logged but never block the operation.
- **enrich**: Runs sequentially (extensions may read each other's additions). Mutate `context` directly.
- **Custom hooks**: Follow the same rules based on prefix. `before*` hooks are sequential and cancellable. Everything else runs in parallel.

### Constraints

- One handler per extension per hook. A second `register()` call replaces the previous handler.
- All handlers have a 5 second timeout. Hanging handlers are killed and logged.
- Max 100 handlers per hook.
- Hooks auto-unregister when an extension is disabled via `hooks.unregister(extName)`.

### Structural mutations in hooks

If your hook handler creates, moves, or deletes spaces, acquire a space lock via `place.spaceLocks.acquireSpaceLock`. Release in a `finally` block. The seed does not know which hooks do structural work. Extensions that do take responsibility.

```js
place.hooks.register("afterMatter", async ({ spaceId }) => {
  const lock = await place.spaceLocks.acquireSpaceLock(parentId, sessionId);
  try {
    await createSpace({ name: "Child", parentId, beingId });
  } finally {
    place.spaceLocks.releaseSpaceLock(parentId, sessionId);
  }
}, "my-ext");
```

Space locks are short-lived, in-memory, sorted-acquisition (prevents deadlocks), and TTL-expiring (prevents permanent locks on crash). The integrity check repairs on boot if a crash left orphaned state.

## Data Migrations

Extensions store data in `space.qualities` and `user.qualities`. This data is freeform. No schema validation at the DB layer. This is intentional: it keeps the system flexible.

But over time, extensions change. A v1 extension stores `qualities.myExt = { count: 5 }`. Version 2 restructures to `qualities.myExt = { stats: { count: 5, total: 100 } }`. Existing spaces in the database still have the v1 shape. Without migrations, the extension breaks on old data.

**Every extension that writes to metadata should declare a schema version and provide migrations.** This is not optional for production extensions. It is what protects user data over years of updates.

### Declaring migrations

In `manifest.js`:

```js
provides: {
  schemaVersion: 2,          // Current version of your data shape
  migrations: "./migrations.js",  // Migration functions
}
```

In `migrations.js`:

```js
import Space from "../../db/models/space.js";

export default [
  {
    version: 1,
    async up() {
      // v0 -> v1: move flat values into nested structure
      const spaces = await Space.find({ "qualities.myExt": { $exists: true } }).select("metadata");
      for (const space of spaces) {
        const old = space.qualities.get("myExt");
        if (old && !old.stats) {
          space.qualities.set("myExt", { stats: { count: old.count || 0 } });
          space.markModified("metadata");
          await space.save();
        }
      }
    },
  },
  {
    version: 2,
    async up() {
      // v1 -> v2: add total field with default
      const spaces = await Space.find({ "qualities.myExt.stats": { $exists: true } }).select("metadata");
      for (const space of spaces) {
        const data = space.qualities.get("myExt");
        if (data?.stats && data.stats.total === undefined) {
          data.stats.total = 0;
          space.qualities.set("myExt", data);
          space.markModified("metadata");
          await space.save();
        }
      }
    },
  },
];
```

### How it works

1. The loader reads `schemaVersion` from your manifest (e.g. `2`)
2. It checks the `.extensions` place seed space for your extension's stored version (e.g. `1`)
3. If stored < declared, it loads your `migrations.js` and runs pending migrations in order
4. After all migrations succeed, it updates the stored version to match
5. If a migration fails, it stops and logs the error. Your extension still loads but data may be inconsistent.

### Rules

- **Migrations run once.** The stored version tracks what has run. Re-running boot does not re-run old migrations.
- **Migrations run at boot, before your extension's `init()`.** Your code can assume the data is at the current version.
- **Never delete migrations.** Someone upgrading from v1 to v5 needs all intermediate migrations.
- **Test migrations on real data.** A migration that works on 10 spaces might fail on 10,000.
- **Version 0 is implicit.** If you never declared schemaVersion before, existing data is version 0.
- **User metadata follows the same pattern.** Use `User.find()` in migrations to update user data.

### When to add a migration

- You renamed a metadata key
- You restructured nested data
- You changed value types (string to number, flat to array)
- You split one key into multiple keys
- You need to backfill a new required field with defaults

### When you don't need a migration

- You added a new optional key (code handles `undefined` gracefully)
- You read but don't write to a key
- Your data shape hasn't changed, just your code logic

This is the most important thing you can do for long-term data integrity. Extensions that don't migrate will break on existing data when they update. Extensions that do migrate will work for decades.

## Environment Variables

Extensions can declare environment variables they need. The loader checks these before calling `init()`. Missing required vars cause the extension to be skipped with a clear message.

```js
provides: {
  env: [
    // Required, user must provide. Extension won't load without it.
    { key: "STRIPE_SECRET_KEY", required: true, secret: true,
      description: "Stripe secret key for payment processing" },

    // Required but auto-generated if missing. Appended to .env on first boot.
    { key: "MY_ENCRYPTION_KEY", required: true, secret: true, autoGenerate: true,
      description: "Internal encryption key" },

    // Optional with a default value. Set in process.env if missing.
    { key: "MY_API_URL", required: false,
      description: "API endpoint", default: "https://api.example.com" },

    // Optional, no default. Extension handles the missing value itself.
    { key: "MY_OPTIONAL_KEY", required: false,
      description: "Extra feature key" },
  ],
}
```

### Fields

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `key` | string | (required) | The env var name |
| `required` | boolean | `true` | If true and missing, extension is skipped |
| `secret` | boolean | `false` | Marks the value as sensitive (for documentation) |
| `autoGenerate` | boolean | `false` | If true, a 32-byte hex key is generated and appended to .env |
| `default` | string | none | Default value if env var is not set |
| `description` | string | none | Shown in skip messages and .env comments |

### Behavior

- Checked before `init()` is called. If a required var is missing, the extension is skipped entirely.
- `autoGenerate` keys are written to `.env` so they persist across restarts.
- `default` values are set in `process.env` at load time but not written to `.env`.
- Extensions that need external credentials (Stripe keys, wallet master keys) should use `required: true` without `autoGenerate`. The user must provide these.
- Internal cryptographic keys (encryption, signing) should use `autoGenerate: true`.

## Schema Migrations

Extensions can declare schema versions and provide migration scripts:

```js
// manifest.js
provides: {
  schemaVersion: 2,
  migrations: "./migrations.js",
}

// migrations.js
export default [
  { version: 1, up: async () => { /* create indexes, transform docs */ } },
  { version: 2, up: async () => { /* add new fields */ } },
];
```

On boot, the loader checks each extension's stored schema version (in the .extensions place seed space) against the declared version, and runs pending migrations in order.

## .extensions Place Seed Space

Each loaded extension is mirrored as a child space under the `.extensions` place seed space:

```
Place Root
  .extensions (system)
    blog (type: resource, values: { loaded: 1, version: "1.0.0", routes: 1 })
    solana (type: resource, values: { loaded: 1, version: "1.0.0" })
    scripts (type: resource, values: { loaded: 0 })  // disabled = trimmed
```

Browse via CLI: `treeos cd .extensions && treeos ls`

## Disable Extensions

Set `DISABLED_EXTENSIONS` env var (comma-separated):

```
DISABLED_EXTENSIONS=solana,billing,scripts
```

Or use the CLI: `treeos ext disable solana`

Both sources are merged. Disabled extensions are skipped during loading.

## Background Jobs

Extensions return `jobs` from `init()` with start/stop functions:

```js
export async function init(place) {
  return {
    jobs: [
      {
        name: "my-scheduled-task",
        start: () => { timer = setInterval(doWork, 60000); },
        stop: () => { clearInterval(timer); },
      },
    ],
  };
}
```

Jobs are auto-started after DB connect via `startExtensionJobs()`.

## Per-Space Data Storage (metadata)

Extensions MUST store per-space data in `space.qualities` under their extension name.
Do NOT add fields to the core Space schema. Use `place.qualities` from the services bundle:

```js
// In init(place) or any function with core in scope:

// Read
const data = place.qualities.qualities.space.getQuality(space, "my-extension");  // returns {} if empty

// Write (full replace, needs document)
await place.qualities.qualities.space.setQuality(space, "my-extension", { wallets: {}, config: {} });

// Partial update (shallow merge, needs document)
await place.qualities.qualities.space.mergeQuality(space, "my-extension", { lastSync: new Date() });

// Atomic increment (by ID or document, no read-modify-write)
await place.qualities.qualities.space.incQuality(spaceId, "my-extension", "counter", 1);

// Atomic capped array push (by ID or document)
await place.qualities.qualities.space.pushQuality(spaceId, "my-extension", "history", { ts: Date.now() }, 50);

// Atomic multi-field set (by ID or document)
await place.qualities.qualities.space.batchSetQuality(spaceId, "my-extension", { a: 1, b: 2, c: 3 });

// Remove namespace entirely (on uninstall or cleanup)
await place.qualities.qualities.space.unsetQuality(spaceId, "my-extension");
```

For files outside `init()` (place.js, tools.js, routes.js), receive metadata through a configure pattern:

```js
// In place.js:
let _metadata = null;
export function configure({ metadata }) { _metadata = metadata; }
// Then use _metadata.qualities.space.getQuality, _metadata.qualities.space.setQuality, etc.

// In index.js init(place):
import { configure } from "./place.js";
configure({ metadata: place.qualities });
```

User metadata follows the same pattern via `place.beingMetadata`:

```js
const prefs = place.beingMetadata.qualities.being.getQuality(user, "my-extension");
await place.beingMetadata.incBeingMeta(userId, "my-extension", "visits", 1);
await place.beingMetadata.batchSetBeingMeta(userId, "my-extension", { theme: "dark" });
```

Both paths are valid. The scoped place path prevents accidental cross-namespace writes. The direct import path is for seed code, migrations, and utilities that need to write to arbitrary namespaces.

Four core namespaces (`tools`, `roles`, `extensions`, `llm`) are always writable regardless of caller. These are seed-owned shared configuration.

Convention:
- Namespace key MUST match your manifest `name`
- Data is `Mixed` type, so use plain objects and arrays (no Mongoose subdocument features)
- The helpers handle `markModified("metadata")` automatically
- Reading metadata from core code (e.g. treeData) should use:
  `(space.qualities instanceof Map ? space.qualities.get("name") : space.qualities?.name)`

### Scaffolding Spaces (the `role` convention)

Extensions that create a tree structure on install (food, fitness, recovery, kb, etc.) MUST set a `role` field in their metadata namespace on every scaffolded space:

```js
await place.qualities.qualities.space.setQuality(logSpace, "food", { role: "log" });
await place.qualities.qualities.space.setQuality(mealsSpace, "food", { role: "meals" });
await place.qualities.qualities.space.setQuality(profileSpace, "food", { role: "profile" });
```

The `role` field is the structural marker. It means "this space is load-bearing for my extension." TreeOS base registers a generic `beforeSpaceDelete` hook that checks every space being deleted. If any extension namespace in the space's metadata contains a `role` field, the delete is cancelled with a message naming the extension and role.

The handler does not know what food is. It does not know what fitness is. It sees `qualities.food.role = "log"` and knows that space is structural to something. Any extension that scaffolds spaces and sets `role` on them gets delete protection automatically.

When looking up scaffolded spaces at runtime, query by role, not by name or stored ID:

```js
const children = await Space.find({ parent: rootId }).select("_id name metadata").lean();
const spaces = {};
for (const child of children) {
  const meta = child.qualities?.get?.("food") || child.qualities?.food;
  if (meta?.role) spaces[meta.role] = { id: String(child._id), name: child.name };
}
// spaces.log, spaces.meals, spaces.profile — found by role, not name
```

This makes scaffolded trees resilient to renames (users can rename spaces freely) while protecting against accidental deletion. Users who truly want to delete a structural space can use `--force` to bypass the hook.

### Reaching other extensions

Use `getExtension()` to access another extension's exports. Never import extension files directly:

```js
import { getExtension } from "../loader.js";

const gateway = getExtension("gateway");
if (gateway?.exports?.dispatchNotifications) {
  await gateway.exports.dispatchNotifications(rootId, notifications);
}
```

This returns null if the extension isn't installed. Safe. Decoupled.

## Custom AI Modes

Extensions can register entirely new AI conversation modes. Each mode has its own system prompt, tool set, and LLM assignment slot.

```js
// manifest.js
provides: {
  modes: [
    {
      key: "tree:research",
      handler: "./modes/research.js",
      assignmentSlot: "research",
    }
  ],
}
```

The handler file exports the same shape as core modes:

```js
// modes/research.js
export default {
  emoji: "🔬",
  label: "Research",
  bigMode: "tree",
  toolNames: ["web-search", "summarize", "create-new-space-branch"],
  buildSystemPrompt({ username, rootId, currentNodeId }) {
    return `You are a research agent for ${username}. Search the web and place findings into the tree.`;
  },
};
```

Or register during init():

```js
export async function init(place) {
  place.modes.registerMode("tree:research", {
    emoji: "🔬",
    label: "Research",
    bigMode: "tree",
    toolNames: ["web-search", "summarize"],
    buildSystemPrompt(ctx) { return "..."; },
  }, "my-extension");
}
```

Modes cannot override core modes. The conversation system routes to custom modes the same way it routes to built-in modes.

## Mode Naming Convention

Extensions that register AI modes should follow suffix conventions. The tree-orchestrator uses these suffixes for automatic routing when a user is at an extension's space. No per-extension routing code needed.

**Standard suffixes:**

| Suffix | Purpose | Activated by |
|--------|---------|-------------|
| `:log` | Default receiver. Parses input, routes data. | All unmatched messages |
| `:coach` | Guided mode. AI leads. | `be` command |
| `:review` | Backward-looking. Patterns, progress, analysis. | Questions about history or status |
| `:plan` | Forward-looking. Creates structure, sets goals. | Requests to build or organize |
| `:ask` | Read-only query against stored knowledge. | Falls back from `:review` |
| `:tell` | Write new knowledge to the tree. | Default for KB-style extensions |

Not every extension uses all six. Use what fits your domain.

**How it works:** When the orchestrator detects an extension at the current space (Level 1), it calls `getModesOwnedBy(extName)` to get all registered modes. It matches the user's message against standard intent patterns and picks the mode with the matching suffix. If no suffix matches, it falls to the space's `modes.respond` default (usually `:log` or `:tell`).

**Examples:**
```
food:log, food:coach, food:review
fitness:log, fitness:coach, fitness:review, fitness:plan
study:log, study:coach, study:review, study:plan
recovery:log, recovery:coach, recovery:review
kb:tell, kb:ask, kb:review
```

**Custom routing:** Extensions with complex internal routing (food's macro parsing, KB's tell/ask detection) can export `handleMessage(message, ctx)` from their init return. The orchestrator calls `handleMessage` first. Suffix matching is the fallback for extensions without it. Convention with override.

## Per-Space Tool Customization

Any space can allow or block specific MCP tools. This lets you create branches with different AI capabilities without writing code.

**How it works:** Tools are resolved in three layers:
1. Mode base tools (what the active mode defines)
2. Extension tools (what extensions inject via the loader)
3. Space config (`qualities.tools.allowed[]` / `qualities.tools.blocked[]`)

Space config inherits from parent to child. A tool blocked at a parent stays blocked for all descendants unless explicitly re-allowed.

**API:**
```
GET  /api/v1/space/:spaceId/tools          Shows effective tools, base, added, blocked, inheritance chain
POST /api/v1/space/:spaceId/tools          Set { allowed: [...], blocked: [...] }
```

**CLI:**
```
tools                            Show effective tools at current space
tools-allow execute-shell        Add a tool to this space
tools-block delete-space-branch   Block a tool at this space
tools-clear                      Remove all local config (inherit from parent)
```

**Examples:**
- DevOps branch: `tools-allow execute-shell` gives AI shell access on one branch only
- Archive branch: `tools-block delete-space-branch` prevents deletion
- Read-only branch: `tools-block create-new-space-branch delete-space-branch edit-space-status`

**From extension code:**
```js
// Allow a tool programmatically (use place.qualities, never import directly)
const tools = place.qualities.qualities.space.getQuality(space, "tools") || {};
tools.allowed = [...(tools.allowed || []), "my-custom-tool"];
await place.qualities.qualities.space.setQuality(space, "tools", tools);
```

## Per-Space Mode Overrides

Any space can override which AI mode handles a specific intent. This lets different branches think differently.

**How it works:** Mode resolution has three layers:
1. Per-space override in `qualities.modes[intent]`
2. Default mapping for the zone (e.g., `tree:respond`)
3. Big mode fallback

**API:**
```
GET  /api/v1/space/:spaceId/modes          Shows overrides and available modes
POST /api/v1/space/:spaceId/modes          Set { intent: "respond", modeKey: "custom:formal" }
POST /api/v1/space/:spaceId/modes          Clear: { intent: "respond", clear: true }
```

**CLI:**
```
modes                                Show current overrides and available modes
mode-set respond custom:formal       Override respond intent at this space
mode-clear respond                   Clear one override
mode-clear                           Clear all overrides
```

**Examples:**
- Research branch: `mode-set respond tree:research` uses a research-focused mode
- Journal branch: `mode-set respond custom:reflective` for introspective responses
- Training branch: `mode-set navigate custom:guided` for step-by-step navigation

## Per-Space Extension Scoping

Any space can block or restrict entire extensions. This is the broadest capability control. When an extension is blocked at a space, all its tools, hooks, modes, and metadata writes are suppressed at that position and all descendants.

**Three access levels:**

| Level | Tools | Hooks | Modes | Metadata writes |
|-------|-------|-------|-------|-----------------|
| **active** (default) | all | all fire | all resolve | allowed |
| **restricted "read"** | read-only tools only | all fire | all resolve | allowed |
| **blocked** | none | skipped | skipped | rejected |

**Storage:** `space.qualities.extensions = { blocked: ["solana"], restricted: { "food": "read" } }`

**Inheritance:** walks parent chain, accumulates. A child never unblocks what a parent blocked.

**API:**
```
GET  /api/v1/space/:spaceId/extensions          Show blocked/restricted with inheritance chain
POST /api/v1/space/:spaceId/extensions          Set { blocked: [...], restricted: { "ext": "read" } }
GET  /api/v1/root/:rootId/extensions?tree=1   Tree-wide block map
POST /api/v1/root/:rootId/extensions          Set at tree root
```

**CLI:**
```
ext-scope                         Show what's active/blocked/restricted at current space
ext-scope -t                      Tree-wide view of all blocks across branches
ext-block solana scripts          Block extensions at current space
ext-allow solana                  Remove from block list
ext-restrict food read            Restrict to read-only tools
```

**From extension routes:**

Extensions should check spatial scope before running AI conversations:

```js
// In your route handler (place.scope is always available):
if (await place.scope.isExtensionBlockedAtSpace("my-extension", rootId)) {
  return res.status(403).json({ error: "This extension is blocked on this branch." });
}
```

**How restricted "read" works:**

Every MCP tool declares `readOnlyHint` in its annotations. When an extension is restricted to "read" at a space, the seed filters its tools to only those with `readOnlyHint: true`. The extension's hooks still fire (it can observe) but it can only read, not write. This lets two extensions coexist on a tree where each can see the other's data but not modify it.

**Example: Health tree with fitness and food:**

```
treeos cd Health/Fitness
treeos ext-restrict food read      # food can see fitness data but not write here

treeos cd Health/Food
treeos ext-restrict fitness read   # fitness can see food data but not write here
```

The fitness coach can reference nutrition data while planning workouts. The food coach can see exercise history when recommending meals. Neither can modify the other's branch.

### Confined extensions

Extensions can declare `scope: "confined"` in their manifest. Confined extensions are inactive everywhere by default. They must be explicitly allowed at a position via `qualities.extensions.allowed[]`. Use `ext-allow solana` to activate a confined extension at the current space and below. Use `ext-unallow solana` to remove access. Confined scope is for dangerous extensions (shell, solana, scripts) that should only exist where explicitly permitted.

```js
export default {
  name: "solana",
  scope: "confined",   // "global" (default) or "confined"
  // ...
};
```

The resolution chain handles confined extensions in one walk. If a confined extension is not in the `allowed[]` set at any ancestor, it resolves as blocked. Same blocked infrastructure. Same filtering for tools, hooks, modes, and metadata writes.

**CLI:**
```
ext-allow solana              Allow confined extension at this space
ext-unallow solana            Remove confined extension access
```

The `ext-allow` command is dual-purpose. It unblocks a globally blocked extension and it allows a confined extension. The user doesn't need to know the internal model. They say "I want this extension here" and the system figures out the right operation.

When a confined extension is installed at runtime (via `treeos ext install`), the confined set refreshes automatically. No restart needed.

## CLI Subcommands

For extensions with multiple related commands, use the subcommands pattern:

```js
provides: {
  cli: [
    {
      command: "wallet [action] [args...]",
      description: "Solana wallet. Actions: create, send, swap.",
      method: "GET",
      endpoint: "/space/:spaceId/values/solana",
      subcommands: {
        "create": { method: "POST", endpoint: "/space/:spaceId/values/solana", description: "Create wallet" },
        "send": { method: "POST", endpoint: "/space/:spaceId/0/values/solana/send", args: ["amount", "destination"], description: "Send SOL" },
        "swap": { method: "POST", endpoint: "/space/:spaceId/0/values/solana/transaction", args: ["inputMint", "outputMint", "amountUi"], description: "Swap tokens" },
      },
    },
  ],
}
```

No action = default GET. Unknown action shows available subcommands. Missing required args show usage hints.

## Per-User Data Storage (metadata)

Same pattern as per-space metadata. Use `place.beingMetadata` (always available, no declaration needed):

```js
// Read
const energy = place.beingMetadata.qualities.being.getQuality(user, "energy");  // returns {} if empty

// Write (sync, caller must save)
place.beingMetadata.qualities.being.setQuality(user, "energy", { available: { amount: 100 } });
await user.save();

// Atomic operations (by ID or document, no need to save)
await place.beingMetadata.incBeingMeta(userId, "energy", "used", 5);
await place.beingMetadata.pushBeingMeta(userId, "energy", "history", { ts: Date.now() }, 50);
await place.beingMetadata.batchSetBeingMeta(userId, "energy", { available: 95, lastUsed: Date.now() });
await place.beingMetadata.unsetBeingMeta(userId, "old-extension");
```

Convention: namespace key matches your manifest name. Same rules as space metadata.

## Inter-Extension Communication

Extensions never import each other's files directly. They communicate through declared exports and the `getExtension()` API. This keeps extensions fully decoupled. If the other extension isn't installed, the call safely returns null.

### Exposing functions

Return an `exports` object from `init()`:

```js
export async function init(place) {
  return {
    router,
    exports: {
      myFunction,
      myOtherFunction,
    },
  };
}
```

### Consuming another extension

```js
import { getExtension } from "../loader.js";

// Get another extension's exports (null if not installed)
const gateway = getExtension("gateway");
if (gateway?.exports?.dispatchNotifications) {
  await gateway.exports.dispatchNotifications(rootId, notifications);
}
```

### Using the orchestrator registry

For the tree orchestrator (or any custom orchestrator), use the core registry:

```js
import { getOrchestrator } from "../../seed/orchestrators/registry.js";

const treeOrch = getOrchestrator("tree");
if (treeOrch) {
  const result = await treeOrch.handle({ visitorId, message, socket, ... });
}
```

### Wiring optional services

For services like energy that may or may not be installed, use a setter pattern:

```js
// place.js
let useEnergy = async () => ({ energyUsed: 0 });
export function setEnergyService(energy) { useEnergy = energy.useEnergy; }

// index.js
import { setEnergyService } from "./place.js";
export async function init(place) {
  if (place.energy) setEnergyService(place.energy);
  // ...
}
```

### HTML page registration

If html-rendering is installed, extensions can register their own server-rendered pages:

```js
const htmlExt = getExtension("html-rendering");
if (htmlExt?.exports?.registerPage) {
  htmlExt.exports.registerPage("get", "/my-dashboard", authenticate, (req, res) => {
    res.send("<h1>Dashboard</h1>");
  });
}
```

### Manifest declarations

Declare your dependencies so the registry and loader know about them:

```js
needs: {
  extensions: ["values@^1.0.0"],     // required, with semver constraint
},
optional: {
  extensions: ["html-rendering"],     // used if available, skipped if not
},
```

## Common Mistakes

**Calling runTurn without checking LLM availability.** If no LLM is configured (no user connection, no place default), `runTurn` fails and leaves an empty chat record in the database. Always check before calling:

```js
// In your index.js setRunChat wrapper:
setRunChat(async (opts) => {
  if (opts.userId && opts.userId !== "SYSTEM" && !await place.llm.userHasLlm(opts.userId)) {
    return { answer: null };
  }
  return place.llm.runTurn({ ...opts, llmPriority: BG });
});
```

`userHasLlm` checks the full resolution chain: user connections, user assignments, and place default. Returns false only when there is truly no LLM anywhere. The check does not bypass the place fallback.

**Injecting into enrichContext without guarding.** Every enrichContext handler should check if relevant data exists before injecting. If your extension has no data for this space, return early. Do not inject empty objects. Do not run database queries on every context build unless you have data to contribute.

**Writing to metadata without the seed API.** Direct `space.qualities.set()` or `Space.updateOne({ $set: ... })` bypasses namespace ownership, document size guards, and the afterQualityWrite hook. Always use `place.qualities.*` functions. The seed provides atomic operations for every pattern: `qualities.space.incQuality` for counters, `qualities.space.pushQuality` for capped arrays, `qualities.space.batchSetQuality` for multi-field writes, `qualities.space.unsetQuality` for cleanup. There is no reason to use direct MongoDB for metadata.

**Missing LLM_PRIORITY on background calls.** Every LLM call needs a priority. BACKGROUND for hooks and jobs. INTERACTIVE for user-triggered tools. GATEWAY for external channels. Without priority, background extensions compete with human chat.

## Stance Authorization Defaults (Layer 3)

The seed gates every verb (`see` / `do` / `summon` / `be`) through stance
authorization. The walk has three layers:

| Layer | Source | When it matches |
|---|---|---|
| **Layer 2** | `qualities.permissions.<verb>.<keyParts>` on the target or any ancestor | First match on the parent walk wins |
| **Layer 3** | `provides.defaultPermissions` on installed extensions | When no Layer 2 rule matches |
| **Layer 5** | default deny | When nothing else matched |

**Why Layer 3 matters.** Per-position rules (Layer 2) require operators
to write a `set-qualities` on every space that needs the rule. Layer 3 lets
an extension ship sensible defaults that apply everywhere the extension
is installed, with no per-position write. The place operator can still
override at any specific position via Layer 2.

### How to contribute defaults

Declare them in your manifest:

```js
provides: {
  defaultPermissions: {
    // DO actions. Key shape matches metadata.permissions.do.<action>
    // (or .<action>:<namespace> for set-qualities/clear-qualities).
    "do:my-ext:run":          { requires: { owner: true } },
    "do:my-ext:read-only":    { requires: {} },          // anyone
    "do:set-qualities:my-ext":     { requires: { contributor: true } },

    // SUMMON. Key shape matches metadata.permissions.summon.@<role>.
    // Use prefix wildcards for role families.
    "summon:@my-coach":       { requires: { homeInDomain: true } },
    "summon:@my-worker*":     { requires: { contributor: true } },
  },
},
```

The loader picks these up at boot and feeds them into the seed's
default-permission registry. Uninstalling the extension removes its
defaults automatically; reinstalling re-registers them.

### `requires` shape

Each rule has a `requires` object whose entries are checked against
the caller's stance properties (derived from their Being + relation
to the target):

| Property | Meaning |
|---|---|
| `owner: true` | Caller is the target tree's rootOwner |
| `contributor: true` | Caller is in target tree's `contributors[]` |
| `arrival: false` | Caller has identity (not anonymous arrival) |
| `homeAtPosition: true` | Caller's `homeSpace` is the target |
| `homeInDomain: "<spaceId>"` | The named space is in the caller's home ancestry |
| `positionInHomeDomain: true` | The target is inside the caller's home subtree |
| `role: "<role-name>"` | Caller's active role matches |
| `homeOnThisPlace: true` | Caller is not federated from another place |

`requires: {}` admits every stance (used for "anyone can do this"
rules). All entries must pass for the rule to allow.

### Picking specificity

If multiple extensions ship a rule for the same key, the first installed
wins (seed doesn't merge). Use namespaced action prefixes
(`do:my-ext:*`) so your rules don't collide with another extension's
defaults.

## Security Model

Extensions run in the same Node.js process as place. There is no sandbox or import restriction.

- Manifests declare dependencies for documentation and scoped injection via `buildScopedCore`, but **do not enforce access boundaries**. Any extension can `import` any file on disk.
- The `needs` and `optional` fields determine what is injected into `place` during `init()`, not what the extension can access.
- Extensions have full read/write access to the database via Mongoose models.
- Extensions can register routes, tools, hooks, and jobs that run with full system privileges.

**For place operators:** Review all third party extension code before installing. Use `DISABLED_EXTENSIONS` to disable problematic extensions without removing their files. Disabling an extension prevents it from loading, unregisters its hooks, and removes its routes, tools, and jobs.

## Package Types: Extensions, Bundles, and OS

The Horizon directory organizes publishable packages into three types. All use the same publishing pipeline, versioning, ownership, and tombstone system. A `type` field in the manifest distinguishes them.

### Extension (default)

One folder. One manifest. One init. Does one thing. This is the standard format documented above.

```js
export default {
  name: "crop-tracker",
  type: "extension",             // default if omitted
  version: "1.0.0",
  builtFor: "FarmOS",            // "seed" (universal), bundle name, or OS name
  description: "Track crop yields per space",
  needs: { extensions: ["farm-core@>=1.0.0"] },
  provides: { routes: true, tools: true },
};
```

**`builtFor`** declares where this extension is designed to work:
- `"seed"` (default): works on any place with no special extensions. Universal.
- `"treeos-base"`: needs that bundle's extensions to be present.
- `"FarmOS"`: built specifically for that OS distribution.

The Horizon directory groups extensions by `builtFor` automatically. Publish with `builtFor: "FarmOS"` and it appears under FarmOS in the directory. No manual curation.

### Bundle

A curated set of extensions that form a coherent stack. Dependency group. No code of its own.

```js
export default {
  name: "treeos-base",
  type: "bundle",
  version: "1.0.0",
  builtFor: "seed",
  description: "Baseline TreeOS stack",
  includes: [
    "propagation@^1.0.0",
    "perspective-filter@^1.0.0",
    "codebook@^1.0.0",
    "long-memory@^1.0.0",
  ],
};
```

**Key fields:**
- `type: "bundle"` is required.
- `includes` lists the extensions in this bundle with version constraints. Must have at least 2.
- Bundles do not need `index.js`. Only `manifest.js` is required.
- All listed extensions must exist in the Horizon directory at publish time.
- Installing a bundle (`treeos bundle install <name>`) installs all member extensions.

### OS

A full TreeOS distribution. Bundles + standalone extensions + default config + orchestrators.

```js
export default {
  name: "TreeOS",
  type: "os",
  version: "1.0.0",
  builtFor: "seed",
  description: "The first operating system built on the seed",
  bundles: [
    "treeos-base@^1.0.0",
    "treeos-connect@^1.0.0",
    "treeos-intelligence@^1.0.0",
    "treeos-maintenance@^1.0.0",
  ],
  standalone: [
    "tree-orchestrator@^1.0.0",
    "fitness@^1.0.0",
    "food@^1.0.0",
  ],
  config: {
    treeCircuitEnabled: true,
  },
  orchestrators: {
    tree: "tree-orchestrator",
    place: "place-manager",
    home: "treeos-base",
  },
};
```

**Key fields:**
- `type: "os"` is required.
- `bundles`: bundles this OS includes. Each bundle's member extensions are installed.
- `standalone`: extensions not part of any bundle that should still be installed.
- `config`: default place config overrides. Applied during `treeos os install`, merged (not overwriting existing user values).
- `orchestrators`: default orchestrator assignments by zone.
- Must have at least one of `bundles` or `standalone`.
- OS manifests do not need `index.js`. Only `manifest.js` is required.
- Installing an OS (`treeos os install <name>`) installs all bundles (which install their members), all standalone extensions, applies config, and reports a summary.

### CLI for Bundles and OS

```
treeos os list                  List available OS distributions
treeos os info <name>           Look before you plant. Full details.
treeos os install <name>        Install everything.

treeos bundle list              List available bundles
treeos bundle info <name>       Bundle details and member list.
treeos bundle install <name>    Install all member extensions.
```

`os info` shows: bundles, extension count, config defaults, orchestrator assignments, estimated disk footprint, npm dependencies across all members. The operator makes an informed decision before committing.

## Collaboration

Code lives on your place. You build extensions in `extensions/my-extension/`, test them locally, and publish to Horizon when ready. If you want others to contribute, push the code to GitHub (or any git host) and link it with `repoUrl`. If you don't need collaboration, skip the repo. The extension works either way.

### Workflow

1. **Build** locally. Create your extension in `extensions/`. Test it on your place.
2. **Publish** to Horizon. `treeos ext publish my-extension --notes "what changed"`. Horizon stores the package.
3. **Others install** from Horizon. `treeos ext install my-extension`. They get the published version.
4. **Collaborate** (optional). Push to GitHub. Others fork, PR, contribute. You publish the next version.

### Linking code and packages

If your code is on a public repo, include `repoUrl` when publishing so Horizon can link to the source:

```js
// In your manifest or publish command
repoUrl: "https://github.com/yourname/my-extension"
```

Horizon displays this on the extension detail page as a "Source Code" button. Browse cards show a "source" indicator when repoUrl is present.

### If the author is inactive

Fork the repo. Publish under a new name. Horizon tracks name ownership (first publisher owns the name), not code ownership. The ecosystem grows through open contribution. If you improve an abandoned extension, publish your version and let operators choose.
