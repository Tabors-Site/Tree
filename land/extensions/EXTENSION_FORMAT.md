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

Endpoints can use `:nodeId` (resolved from current position), `:version` (resolved to latest), and positional args.

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

## Inter-Extension Communication

Use `getExtension(name)` from the loader:

```js
import { getExtension } from "../loader.js";

const understanding = getExtension("understanding");
if (understanding) {
  await understanding.someExportedFunction();
}
```
