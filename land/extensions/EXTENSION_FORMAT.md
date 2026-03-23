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
  },
};
```

## Init Function (index.js)

```js
export async function init(core) {
  // core.models.Node, core.models.User, etc.
  // core.llm.getClientForUser(), core.session.createSession(), etc.
  // core.energy.useEnergy() (real or no-op stub)

  return {
    // Optional: Express router
    router: myRouter,

    // Optional: MCP tools array
    tools: [
      {
        name: "my-tool",
        description: "What it does",
        schema: { type: "object", properties: { ... } },
        handler: async (params) => { ... },
      },
    ],

    // Optional: inject tools into existing modes
    modeTools: [
      { modeKey: "tree:librarian", toolNames: ["my-tool"] },
    ],

    // Optional: background jobs
    jobs: [
      {
        name: "my-job",
        start: () => { /* start interval/cron */ },
        stop: () => { /* clear interval */ },
      },
    ],
  };
}
```

## Running AI Conversations (runChat)

Use `core.llm.runChat()` to run AI conversations from your extension. One call. No boilerplate.

```js
const { answer } = await core.llm.runChat({
  userId,
  username,
  message: "analyze this data",
  mode: "tree:structure",   // any registered mode
  rootId: "...",            // optional, for tree modes
  signal: abortController.signal, // optional, for cancellation
});
```

`runChat` handles: MCP connection, mode switching, AIChat record creation, processMessage execution, AIChat finalization, abort handling, and session persistence.

Sessions persist within the same zone. `tree:{rootId}:{userId}` gives each tree its own conversation. Switching trees starts fresh. Land and home zones persist across calls.

Never use `processMessage` directly. Use `runChat`.

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

Extensions can register hooks to react to or modify core operations without touching core code.
Hooks are always available via `core.hooks` (no need to declare in `needs`).

```js
export async function init(core) {
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const myData = meta["my-extension"] || {};
    if (Object.keys(myData).length > 0) context.myData = myData;
  }, "my-extension");
}
```

### Available hooks

| Hook | Data shape | Type | Purpose |
|------|-----------|------|---------|
| `beforeNote` | `{ nodeId, version, content, userId, contentType }` | before | Modify note data before save. Prestige uses this to tag version. |
| `afterNote` | `{ note, nodeId, userId }` | after | React after note saved. Understanding uses this to flag dirty nodes. |
| `beforeContribution` | `{ nodeId, nodeVersion, action, userId }` | before | Modify contribution metadata. Prestige uses this to tag nodeVersion. |
| `afterNodeCreate` | `{ node, userId }` | after | Initialize extension data on new nodes. |
| `beforeStatusChange` | `{ node, status, userId }` | before | Validate or intercept status changes. |
| `afterStatusChange` | `{ node, status, userId }` | after | React after status saved. |
| `beforeNodeDelete` | `{ node, userId }` | before | Clean up extension data before deletion. |
| `enrichContext` | `{ context, node, meta }` | enrich | Inject extension data into AI context. |

### Hook types

- **before**: Runs sequentially. Can modify the data object. Return `false` to cancel the operation. If a handler throws, the operation is also cancelled. The caller receives `{ cancelled: true, reason: "..." }`.
- **after**: Runs in parallel, fire-and-forget. Errors are logged but never block the operation.
- **enrich**: Runs sequentially (extensions may read each other's additions). Mutate `context` directly.

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

Use `getExtension(name)` from the loader:

```js
import { getExtension } from "../loader.js";

const understanding = getExtension("understanding");
if (understanding) {
  await understanding.someExportedFunction();
}
```

## Security Model

Extensions run in the same Node.js process as core. There is no sandbox or import restriction.

- Manifests declare dependencies for documentation and scoped injection via `buildScopedCore`, but **do not enforce access boundaries**. Any extension can `import` any file on disk.
- The `needs` and `optional` fields determine what is injected into `core` during `init()`, not what the extension can access.
- Extensions have full read/write access to the database via Mongoose models.
- Extensions can register routes, tools, hooks, and jobs that run with full system privileges.

**For land operators:** Review all third party extension code before installing. Use `DISABLED_EXTENSIONS` to disable problematic extensions without removing their files. Disabling an extension prevents it from loading, unregisters its hooks, and removes its routes, tools, and jobs.
