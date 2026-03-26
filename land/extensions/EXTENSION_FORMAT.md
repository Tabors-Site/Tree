# Extension Format

## Directory Structure

```
extensions/<name>/
  manifest.js    # Required: declares dependencies, capabilities, metadata
  index.js       # Required: exports init(core) function
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
    models: ["Node", "User"],            // Core models required
    middleware: ["resolveTreeAccess"],    // Core middleware required
    extensions: ["understanding"],       // Other extensions required
  },

  optional: {
    services: ["energy"],                // Gets no-op stub if missing
    extensions: ["billing"],             // Loaded after if present, ignored if not
  },

  provides: {
    models: {
      MyModel: "./model.js",            // Registered in core.models
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
        "afterNote", "enrichContext",    // Core hooks
        "gateway:beforeDispatch",       // Another extension's hook
      ],
    },
  },
};
```

## CRITICAL: Service and Dependency Declarations

**If your extension uses a core service, you MUST declare it in `needs.services` or `optional.services`.** The loader builds a scoped core object that only contains declared services. Undeclared services are undefined.

**Common failure:** `Cannot read properties of undefined (reading 'runChat')` means you used `core.llm.runChat` without declaring `services: ["llm"]` in your manifest.

### Available kernel services

| Service | What it provides | Common functions |
|---------|-----------------|-----------------|
| `llm` | AI conversation | `runChat`, `processMessage`, `getClientForUser`, `switchMode` |
| `hooks` | Lifecycle events | `register`, `run` (always available, but declare for clarity) |
| `session` | Session management | `createSession`, `endSession`, `getSession` |
| `chat` | Chat tracking | `startChat`, `finalizeChat`, `setChatContext` |
| `orchestrator` | Pipeline runtime | `OrchestratorRuntime`, `acquireLock`, `releaseLock` |
| `contributions` | Audit trail | `logContribution` |
| `ownership` | Tree ownership | `addContributor`, `removeContributor`, `transferOwnership` |
| `tree` | Tree infrastructure | `getAncestorChain`, `checkIntegrity`, `isTreeAlive` |
| `cascade` | Signal propagation | `deliverCascade` |
| `metadata` | Node metadata | `getExtMeta`, `setExtMeta`, `mergeExtMeta` |
| `protocol` | Error codes, constants | `sendOk`, `sendError`, `ERR`, `WS`, `CASCADE` |
| `websocket` | Real-time events | `emitToUser`, `registerSocketHandler` |
| `mcp` | MCP connections | `connectToMCP`, `closeMCPClient` |
| `auth` | Authentication | `resolveTreeAccess`, `createUser` |
| `modes` | AI mode registry | `registerMode`, `setDefaultMode` |
| `orchestrators` | Orchestrator registry | `register`, `get` |
| `nodeLocks` | Per-node locking | `acquireNodeLock`, `releaseNodeLock` |

### Dependency chains

Extensions load in topological order. If extension A depends on extension B (`needs.extensions: ["b"]`), B loads first. If B fails to load, A is skipped.

**Chain failures cascade.** If `propagation` fails, then `perspective-filter` (depends on propagation) skips, then `treeos-cascade` (depends on perspective-filter) skips. Fix the root cause (propagation) and the whole chain recovers.

**Always check the boot log for the FIRST error.** Later "missing required deps" warnings are consequences, not causes.

### hooks and modes are always available

`core.hooks` and `core.modes` are injected into every scoped core regardless of declaration. You don't need to declare them. But declaring `services: ["hooks"]` documents intent and triggers the init diagnostic if something else is wrong.

### Extension-provided services

Extensions can register services on the core object during init: `core.energy = { useEnergy, ... }`. Later extensions that declare `needs.services: ["energy"]` or `optional.services: ["energy"]` receive it. If the providing extension hasn't loaded yet, optional services get a no-op stub. Required services cause the dependent extension to skip.

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
- `node_modules` is scoped to the extension directory. Does not pollute the land's root `node_modules`.
- On boot, if `node_modules` is missing (fresh clone, deleted), the loader detects this and runs `npm install` before calling `init()`.
- If the manifest's `npm` array changes (dep added, version changed), the loader regenerates `package.json` and reinstalls on next boot.
- npm install is capped at `npmInstallTimeout` (default 60 seconds, configurable in land .config).
- If npm install fails during installation, the entire extension is rolled back. No partial installs.
- If npm install fails at boot, the extension is skipped. Other extensions continue loading.

**Publishing:** `package.json` is included in the published bundle. `node_modules` is not. Each installing land resolves its own npm dependencies.

**Usage in code:** Import packages normally. Node.js resolves from the local `node_modules`.

```js
import { Client, GatewayIntentBits } from "discord.js";
```

## Init Function (index.js)

```js
import { z } from "zod";

export async function init(core) {
  // Register hooks
  core.hooks.register("enrichContext", async ({ context, meta }) => {
    if (meta.myData) context.myData = meta.myData;
  }, "my-extension");

  // Register modes
  core.modes.registerMode("tree:my-mode", myModeConfig, "my-extension");

  // Register LLM slot mapping (optional)
  if (core.llm?.registerModeAssignment) {
    core.llm.registerModeAssignment("tree:my-mode", "my-slot");
  }

  // Register energy service (optional, no-ops if energy not loaded)
  if (core.energy) setEnergyService(core.energy);

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
          nodeId: z.string().describe("Target node ID"),
          userId: z.string().describe("Injected by server. Ignore."),
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
        handler: async ({ nodeId, userId }) => {
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

## Running AI Conversations (runChat)

Use `core.llm.runChat()` to run AI conversations from your extension. One call. No boilerplate.

```js
const { answer } = await core.llm.runChat({
  userId,
  username,
  message: "analyze this data",
  mode: "tree:structure",
  rootId: "...",            // optional, for tree modes
  res,                      // optional, Express response for auto-abort on disconnect
});
```

Handles automatically: MCP connection, mode switching, Chat tracking, abort on client disconnect, session persistence, error finalization. Pass `res` for HTTP routes.

Sessions persist within the same zone. `tree:{rootId}:{userId}` gives each tree its own conversation. Switching trees starts fresh.

## Running Multi-Step Pipelines (OrchestratorRuntime)

For background jobs and multi-step AI pipelines (dreams, understanding, cleanup), use `OrchestratorRuntime`:

```js
import { OrchestratorRuntime } from "../../orchestrators/runtime.js";

const rt = new OrchestratorRuntime({
  rootId, userId, username,
  visitorId: `my-pipeline:${userId}:${Date.now()}`,
  sessionType: "my-pipeline",
  description: "Processing tree",
  modeKeyForLlm: "tree:my-mode",
  lockNamespace: "my-pipeline",  // optional, prevents concurrent runs
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
| `trackStep(modeKey, { input, output, startTime, endTime })` | Track a chain step without calling the LLM (for orchestrators that call processMessage themselves). |
| `setResult(content, modeKey)` | Mark pipeline as successful. |
| `setError(message, modeKey)` | Mark pipeline as failed/stopped. |
| `cleanup()` | Finalize Chat, close MCP, end session, release lock. |
| `.aborted` | Boolean, true if abort signal fired. |
| `.signal` | The AbortSignal for passing to processMessage. |
| `.chainIndex` | Current chain step index (auto-increments). |

### When to use what

| Need | Use |
|------|-----|
| Single message, user-facing | `core.llm.runChat()` |
| Multi-step background pipeline | `OrchestratorRuntime` with `init()` + `runStep()` + `cleanup()` |
| Real-time interactive orchestrator | `OrchestratorRuntime` with `attach()` + `trackStep()` |

Never use `processMessage` directly unless building a custom real-time orchestrator.

## Custom Orchestrator

Extensions can replace the entire conversation orchestrator for a bigMode (tree, home, land). The orchestrator controls how messages are classified, planned, and executed. This is the most powerful customization point in TreeOS. Replace it and you have a completely different AI product on the same kernel.

**Discovery:** `GET /api/v1/land/orchestrators` returns which extension owns each bigMode.

### Minimal Example

```js
// manifest.js
export default {
  name: "my-orchestrator",
  version: "1.0.0",
  description: "Custom tree conversation flow",
  needs: { models: ["Node", "User"] },
  provides: { orchestrator: { bigMode: "tree" } },
};

// index.js
export async function init(core) {
  return {
    orchestrator: {
      bigMode: "tree",
      async handle({ visitorId, message, socket, userId, sessionId, rootId, nodeId, mode, ...ctx }) {
        // You have full control. Run LLM calls, use tools, navigate the tree.
        const { content } = await core.conversation.processMessage({
          userId,
          username: ctx.username,
          message,
          mode,         // resolved mode key (e.g. "tree:respond")
          rootId,
          nodeId,
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
| `rootId` | string | Tree root node ID |
| `nodeId` | string | Current node ID |
| `mode` | string | Resolved mode key |

Return value: `{ response, navigatedTo, ... }`. The response is sent to the client.

### Core Utilities Available

| Utility | Access | Purpose |
|---------|--------|---------|
| `processMessage()` | `core.conversation.processMessage(opts)` | Run one LLM call with MCP tools |
| `runChat()` | `core.llm.runChat(opts)` | Higher-level: handles session, abort, tracking |
| `OrchestratorRuntime` | `core.orchestrator.OrchestratorRuntime` | Session lifecycle for multi-step flows |
| `acquireLock/releaseLock` | `core.orchestrator.acquireLock(key)` | Concurrency control |
| `parseJsonSafe` | `core.orchestrator.parseJsonSafe(str)` | Parse LLM JSON output (handles fences, trailing commas) |

### When to Build One

- You want a different conversation flow (e.g., always plan before acting, or never auto-navigate)
- You want to integrate external systems into the conversation loop
- You want to replace the chat/place/query classification entirely
- You want to add pre/post processing around every message

### Rules

- Only one orchestrator per bigMode. First registered wins.
- If no orchestrator is registered for a bigMode, the built-in flow runs.
- The built-in `tree-orchestrator` is itself an extension. Disable it and register your own.
- `GET /api/v1/land/orchestrators` shows what is active.

## Available Core Services

| Service | Key | Always Available |
|---------|-----|-----------------|
| Models | `core.models.{User,Node,Contribution,Note}` | Yes |
| Auth | `core.auth.resolveTreeAccess` | Yes |
| Contributions | `core.contributions.logContribution` | Yes |
| Sessions | `core.session.*` | Yes |
| Chat | `core.chat.*` | Yes |
| LLM | `core.llm.*` | Yes |
| MCP | `core.mcp.*` | Yes |
| WebSocket | `core.websocket.*` | Yes (no-op if headless) |
| Orchestrator | `core.orchestrator.*` | Yes |
| Energy | `core.energy.*` | No-op stub if extension not loaded |

## Logging

Use the core log module instead of `console.log`. This is the standard for all extensions.

```js
import log from "../../seed/log.js";

log.info("MyExt", "Job started");           // Level 1: always shown. Jobs, lifecycle.
log.verbose("MyExt", "Processing tree X");   // Level 2: normal operations. Pipeline steps.
log.debug("MyExt", "Placed item Y on node"); // Level 3: internal details. Individual operations.
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
- `:nodeId` resolves from the current position in the tree
- `:rootId` resolves from the active tree
- `:userId` resolves from the logged in user
- `:version` resolves to "latest"
- Remaining `:param` placeholders are filled by positional `<args>` in order

## Hooks

The hook system is an open pub/sub bus. Core fires kernel hooks. Extensions can fire their own hooks and listen to each other's. Any hook name is valid. No whitelist.

```js
export async function init(core) {
  // Listen to a core hook
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const myData = meta["my-extension"] || {};
    if (Object.keys(myData).length > 0) context.myData = myData;
  }, "my-extension");

  // Listen to another extension's hook
  core.hooks.register("gateway:beforeDispatch", async (data) => {
    // modify or react to gateway dispatches
  }, "my-extension");

  // Fire your own hook for other extensions to listen to
  await core.hooks.run("my-extension:afterProcess", { result, userId });
}
```

### Core hooks (fired by kernel)

| Hook | Data shape | Type | Purpose |
|------|-----------|------|---------|
| `beforeNote` | `{ nodeId, version, content, userId, contentType }` | before | Modify note data before save. Prestige uses this to tag version. |
| `afterNote` | `{ note, nodeId, userId, sizeKB, deltaKB, action }` | after | React after note create/edit/delete. Understanding flags dirty nodes. Energy meters storage. |
| `beforeContribution` | `{ nodeId, nodeVersion, action, userId }` | before | Modify contribution metadata. Prestige uses this to tag nodeVersion. |
| `afterNodeCreate` | `{ node, userId }` | after | Initialize extension data on new nodes. |
| `beforeStatusChange` | `{ node, status, userId }` | before | Validate or intercept status changes. |
| `afterStatusChange` | `{ node, status, userId }` | after | React after status saved. |
| `beforeNodeDelete` | `{ node, userId }` | before | Clean up extension data before deletion. |
| `enrichContext` | `{ context, node, meta }` | enrich | Inject extension data into AI context. |
| `beforeRegister` | `{ username, password }` | before | Validate or modify registration. |
| `afterRegister` | `{ user }` | after | Initialize user data after registration. |
| `onCascade` | `{ node, nodeId, signalId, writeContext, source, depth, cascadeConfig }` | cascade | Fires when content is written at a cascade-enabled node or when a signal is delivered externally. Handler results are written to .flow. |

### Cascade hooks

`onCascade` is different from other hooks. It fires through the same hook system but handler return values become visible results stored in the `.flow` system node. This is the communication primitive. Extensions use it to react to signals, propagate to children, or deliver across lands.

```js
core.hooks.register("onCascade", async ({ node, nodeId, signalId, writeContext, source, depth }) => {
  // React to the signal
  // Optionally propagate to children via deliverCascade
  // Return value is written as result to .flow
}, "my-extension");
```

Two entry points trigger onCascade:
- **checkCascade** (kernel-internal): called on note writes and status changes. The kernel originates.
- **deliverCascade** (extension-external): called by extensions to deliver to other nodes. Never blocked.

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

## Data Migrations

Extensions store data in `node.metadata` and `user.metadata`. This data is freeform. No schema validation at the DB layer. This is intentional: it keeps the system flexible.

But over time, extensions change. A v1 extension stores `metadata.myExt = { count: 5 }`. Version 2 restructures to `metadata.myExt = { stats: { count: 5, total: 100 } }`. Existing nodes in the database still have the v1 shape. Without migrations, the extension breaks on old data.

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
import Node from "../../db/models/node.js";

export default [
  {
    version: 1,
    async up() {
      // v0 -> v1: move flat values into nested structure
      const nodes = await Node.find({ "metadata.myExt": { $exists: true } }).select("metadata");
      for (const node of nodes) {
        const old = node.metadata.get("myExt");
        if (old && !old.stats) {
          node.metadata.set("myExt", { stats: { count: old.count || 0 } });
          node.markModified("metadata");
          await node.save();
        }
      }
    },
  },
  {
    version: 2,
    async up() {
      // v1 -> v2: add total field with default
      const nodes = await Node.find({ "metadata.myExt.stats": { $exists: true } }).select("metadata");
      for (const node of nodes) {
        const data = node.metadata.get("myExt");
        if (data?.stats && data.stats.total === undefined) {
          data.stats.total = 0;
          node.metadata.set("myExt", data);
          node.markModified("metadata");
          await node.save();
        }
      }
    },
  },
];
```

### How it works

1. The loader reads `schemaVersion` from your manifest (e.g. `2`)
2. It checks the `.extensions` system node for your extension's stored version (e.g. `1`)
3. If stored < declared, it loads your `migrations.js` and runs pending migrations in order
4. After all migrations succeed, it updates the stored version to match
5. If a migration fails, it stops and logs the error. Your extension still loads but data may be inconsistent.

### Rules

- **Migrations run once.** The stored version tracks what has run. Re-running boot does not re-run old migrations.
- **Migrations run at boot, before your extension's `init()`.** Your code can assume the data is at the current version.
- **Never delete migrations.** Someone upgrading from v1 to v5 needs all intermediate migrations.
- **Test migrations on real data.** A migration that works on 10 nodes might fail on 10,000.
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

On boot, the loader checks each extension's stored schema version (in the .extensions system node) against the declared version, and runs pending migrations in order.

## .extensions System Node

Each loaded extension is mirrored as a child node under the `.extensions` system node:

```
Land Root
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

Or use the CLI (god tier): `treeos ext disable solana`

Both sources are merged. Disabled extensions are skipped during loading.

## Background Jobs

Extensions return `jobs` from `init()` with start/stop functions:

```js
export async function init(core) {
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

## Per-Node Data Storage (metadata)

Extensions MUST store per-node data in `node.metadata` under their extension name.
Do NOT add fields to the core Node schema. Use the metadata helpers:

```js
import { getExtMeta, setExtMeta, mergeExtMeta } from "../../seed/tree/extensionMetadata.js";

// Read
const data = getExtMeta(node, "my-extension");  // returns {} if empty

// Write (full replace)
setExtMeta(node, "my-extension", { wallets: {}, config: {} });

// Partial update (shallow merge)
mergeExtMeta(node, "my-extension", { lastSync: new Date() });

// Always save after writing
await node.save();
```

Convention:
- Namespace key MUST match your manifest `name`
- Data is `Mixed` type, so use plain objects and arrays (no Mongoose subdocument features)
- The helpers handle `markModified("metadata")` automatically
- Reading metadata from core code (e.g. treeData) should use:
  `(node.metadata instanceof Map ? node.metadata.get("name") : node.metadata?.name)`

### Core code fallback pattern

If core code optionally calls extension functionality, use a try/catch import with stubs:

```js
let mod;
try { mod = await import("../../extensions/my-ext/core.js"); }
catch { mod = { myFn: async () => { throw new Error("Extension not installed"); } }; }
export const { myFn } = mod;
```

This lets core gracefully degrade when an extension is disabled.

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
  toolNames: ["web-search", "summarize", "create-new-node-branch"],
  buildSystemPrompt({ username, rootId, currentNodeId }) {
    return `You are a research agent for ${username}. Search the web and place findings into the tree.`;
  },
};
```

Or register during init():

```js
export async function init(core) {
  core.modes.registerMode("tree:research", {
    emoji: "🔬",
    label: "Research",
    bigMode: "tree",
    toolNames: ["web-search", "summarize"],
    buildSystemPrompt(ctx) { return "..."; },
  }, "my-extension");
}
```

Modes cannot override core modes. The conversation system routes to custom modes the same way it routes to built-in modes.

## Per-Node Tool Customization

Any node can allow or block specific MCP tools. This lets you create branches with different AI capabilities without writing code.

**How it works:** Tools are resolved in three layers:
1. Mode base tools (what the active mode defines)
2. Extension tools (what extensions inject via the loader)
3. Node config (`metadata.tools.allowed[]` / `metadata.tools.blocked[]`)

Node config inherits from parent to child. A tool blocked at a parent stays blocked for all descendants unless explicitly re-allowed.

**API:**
```
GET  /api/v1/node/:nodeId/tools          Shows effective tools, base, added, blocked, inheritance chain
POST /api/v1/node/:nodeId/tools          Set { allowed: [...], blocked: [...] }
```

**CLI:**
```
tools                            Show effective tools at current node
tools-allow execute-shell        Add a tool to this node
tools-block delete-node-branch   Block a tool at this node
tools-clear                      Remove all local config (inherit from parent)
```

**Examples:**
- DevOps branch: `tools-allow execute-shell` gives AI shell access on one branch only
- Archive branch: `tools-block delete-node-branch` prevents deletion
- Read-only branch: `tools-block create-new-node-branch delete-node-branch edit-node-status`

**From extension code:**
```js
import { getExtMeta, setExtMeta } from "../../seed/tree/extensionMetadata.js";

// Allow a tool programmatically
const tools = getExtMeta(node, "tools") || {};
tools.allowed = [...(tools.allowed || []), "my-custom-tool"];
setExtMeta(node, "tools", tools);
await node.save();
```

## Per-Node Mode Overrides

Any node can override which AI mode handles a specific intent. This lets different branches think differently.

**How it works:** Mode resolution has three layers:
1. Per-node override in `metadata.modes[intent]`
2. Default mapping for the zone (e.g., `tree:respond`)
3. Big mode fallback

**API:**
```
GET  /api/v1/node/:nodeId/modes          Shows overrides and available modes
POST /api/v1/node/:nodeId/modes          Set { intent: "respond", modeKey: "custom:formal" }
POST /api/v1/node/:nodeId/modes          Clear: { intent: "respond", clear: true }
```

**CLI:**
```
modes                                Show current overrides and available modes
mode-set respond custom:formal       Override respond intent at this node
mode-clear respond                   Clear one override
mode-clear                           Clear all overrides
```

**Examples:**
- Research branch: `mode-set respond tree:research` uses a research-focused mode
- Journal branch: `mode-set respond custom:reflective` for introspective responses
- Training branch: `mode-set navigate custom:guided` for step-by-step navigation

## Per-Node Extension Scoping

Any node can block or restrict entire extensions. This is the broadest capability control. When an extension is blocked at a node, all its tools, hooks, modes, and metadata writes are suppressed at that position and all descendants.

**Three access levels:**

| Level | Tools | Hooks | Modes | Metadata writes |
|-------|-------|-------|-------|-----------------|
| **active** (default) | all | all fire | all resolve | allowed |
| **restricted "read"** | read-only tools only | all fire | all resolve | allowed |
| **blocked** | none | skipped | skipped | rejected |

**Storage:** `node.metadata.extensions = { blocked: ["solana"], restricted: { "food": "read" } }`

**Inheritance:** walks parent chain, accumulates. A child never unblocks what a parent blocked.

**API:**
```
GET  /api/v1/node/:nodeId/extensions          Show blocked/restricted with inheritance chain
POST /api/v1/node/:nodeId/extensions          Set { blocked: [...], restricted: { "ext": "read" } }
GET  /api/v1/root/:rootId/extensions?tree=1   Tree-wide block map
POST /api/v1/root/:rootId/extensions          Set at tree root
```

**CLI:**
```
ext-scope                         Show what's active/blocked/restricted at current node
ext-scope -t                      Tree-wide view of all blocks across branches
ext-block solana scripts          Block extensions at current node
ext-allow solana                  Remove from block list
ext-restrict food read            Restrict to read-only tools
```

**From extension routes:**

Extensions should check spatial scope before running AI conversations:

```js
import { isExtensionBlockedAtNode } from "../../seed/tree/extensionScope.js";

// In your route handler:
if (await isExtensionBlockedAtNode("my-extension", rootId)) {
  return res.status(403).json({ error: "This extension is blocked on this branch." });
}
```

**How restricted "read" works:**

Every MCP tool declares `readOnlyHint` in its annotations. When an extension is restricted to "read" at a node, the kernel filters its tools to only those with `readOnlyHint: true`. The extension's hooks still fire (it can observe) but it can only read, not write. This lets two extensions coexist on a tree where each can see the other's data but not modify it.

**Example: Health tree with fitness and food:**

```
treeos cd Health/Fitness
treeos ext-restrict food read      # food can see fitness data but not write here

treeos cd Health/Food
treeos ext-restrict fitness read   # fitness can see food data but not write here
```

The fitness coach can reference nutrition data while planning workouts. The food coach can see exercise history when recommending meals. Neither can modify the other's branch.

## CLI Subcommands

For extensions with multiple related commands, use the subcommands pattern:

```js
provides: {
  cli: [
    {
      command: "wallet [action] [args...]",
      description: "Solana wallet. Actions: create, send, swap.",
      method: "GET",
      endpoint: "/node/:nodeId/values/solana",
      subcommands: {
        "create": { method: "POST", endpoint: "/node/:nodeId/values/solana", description: "Create wallet" },
        "send": { method: "POST", endpoint: "/node/:nodeId/0/values/solana/send", args: ["amount", "destination"], description: "Send SOL" },
        "swap": { method: "POST", endpoint: "/node/:nodeId/0/values/solana/transaction", args: ["inputMint", "outputMint", "amountUi"], description: "Swap tokens" },
      },
    },
  ],
}
```

No action = default GET. Unknown action shows available subcommands. Missing required args show usage hints.

## Per-User Data Storage (metadata)

Same pattern as per-node metadata. Extensions store user-scoped data in `user.metadata`:

```js
import { getUserMeta, setUserMeta } from "../../seed/tree/userMetadata.js";

// Read
const energy = getUserMeta(user, "energy");  // returns {} if empty

// Write
setUserMeta(user, "energy", { available: { amount: 100 } });
await user.save();
```

Convention: namespace key matches your manifest name. Same rules as node metadata.

## Inter-Extension Communication

Extensions never import each other's files directly. They communicate through declared exports and the `getExtension()` API. This keeps extensions fully decoupled. If the other extension isn't installed, the call safely returns null.

### Exposing functions

Return an `exports` object from `init()`:

```js
export async function init(core) {
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
import { getOrchestrator } from "../../seed/orchestratorRegistry.js";

const treeOrch = getOrchestrator("tree");
if (treeOrch) {
  const result = await treeOrch.handle({ visitorId, message, socket, ... });
}
```

### Wiring optional services

For services like energy that may or may not be installed, use a setter pattern:

```js
// core.js
let useEnergy = async () => ({ energyUsed: 0 });
export function setEnergyService(energy) { useEnergy = energy.useEnergy; }

// index.js
import { setEnergyService } from "./core.js";
export async function init(core) {
  if (core.energy) setEnergyService(core.energy);
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

## Security Model

Extensions run in the same Node.js process as core. There is no sandbox or import restriction.

- Manifests declare dependencies for documentation and scoped injection via `buildScopedCore`, but **do not enforce access boundaries**. Any extension can `import` any file on disk.
- The `needs` and `optional` fields determine what is injected into `core` during `init()`, not what the extension can access.
- Extensions have full read/write access to the database via Mongoose models.
- Extensions can register routes, tools, hooks, and jobs that run with full system privileges.

**For land operators:** Review all third party extension code before installing. Use `DISABLED_EXTENSIONS` to disable problematic extensions without removing their files. Disabling an extension prevents it from loading, unregisters its hooks, and removes its routes, tools, and jobs.
