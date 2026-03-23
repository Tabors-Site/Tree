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

Handles automatically: MCP connection, mode switching, AIChat tracking, abort on client disconnect, session persistence, error finalization. Pass `res` for HTTP routes.

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
  await rt.cleanup(); // finalize AIChat, close MCP, release lock
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
| `cleanup()` | Finalize AIChat, close MCP, end session, release lock. |
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

Extensions can replace the entire conversation orchestrator for a bigMode (tree, home, rawIdea). The orchestrator controls how chat/place/query messages are classified, planned, and executed.

```js
export async function init(core) {
  return {
    orchestrator: {
      bigMode: "tree",
      async handle({ visitorId, message, socket, userId, sessionId, rootId, ...ctx }) {
        // Full control over the conversation flow
        // Use core utilities:
        //   core.conversation.processMessage() - run LLM with tools
        //   core.conversation.switchMode() - change active mode
        //   core.orchestrator.OrchestratorRuntime - session lifecycle for background work
        //   core.orchestrator.acquireLock/releaseLock - concurrency
        // Return { response, navigatedTo, ... }
      },
      // Optional: custom classifier
      async classify({ message, treeContext, userId }) {
        return { intent: "place", confidence: 0.95, responseHint: "..." };
      },
    },
  };
}
```

If no extension registers an orchestrator, the built-in one runs. Only one orchestrator per bigMode. First registered wins.

## Available Core Services

| Service | Key | Always Available |
|---------|-----|-----------------|
| Models | `core.models.{User,Node,Contribution,Note}` | Yes |
| Auth | `core.auth.resolveTreeAccess` | Yes |
| Contributions | `core.contributions.logContribution` | Yes |
| Sessions | `core.session.*` | Yes |
| AI Chat | `core.aiChat.*` | Yes |
| LLM | `core.llm.*` | Yes |
| MCP | `core.mcp.*` | Yes |
| WebSocket | `core.websocket.*` | Yes (no-op if headless) |
| Orchestrator | `core.orchestrator.*` | Yes |
| Energy | `core.energy.*` | No-op stub if extension not loaded |

## Logging

Use the core log module instead of `console.log`. This is the standard for all extensions.

```js
import log from "../../core/log.js";

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
import { getExtMeta, setExtMeta, mergeExtMeta } from "../../core/tree/extensionMetadata.js";

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
- Reading metadata from core code (e.g. treeDataFetching) should use:
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
import { getUserMeta, setUserMeta } from "../../core/tree/userMetadata.js";

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
import { getOrchestrator } from "../../core/orchestratorRegistry.js";

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
