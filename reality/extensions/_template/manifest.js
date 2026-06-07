// TreeOS extension manifest.
//
// Declares dependencies, capabilities, and metadata. The loader reads
// this before init() runs to (a) validate that needed services and
// extensions are present, (b) install npm deps into an extension-local
// node_modules, and (c) build a scoped `place` bundle that only
// exposes the services this extension declared.
//
// Reach a service you didn't declare and it's undefined. Common bug:
// `reality.llm.runTurn is not a function` means `llm` is missing from
// `needs.services`.

export default {
  name: "my-extension",            // lowercase, hyphens only; namespace for tools / ops / metadata
  version: "1.0.0",                // semver
  description: "What this extension does, one sentence.",

  // What this extension needs to function. The loader skips load on
  // any missing entry and logs the gap.
  needs: {
    services:   [],                // see EXTENSION_FORMAT.md for the service list
    models:     ["Space"],         // Mongoose models the init() body uses
    extensions: [],                // other extensions; topological load order
  },

  // Best-effort. The loader stubs missing optional services with a
  // no-op so init() can still run.
  optional: {
    services:   [],                // e.g. ["energy"]
    extensions: [],                // e.g. ["billing"]
  },

  // Auto-installed by the loader into a local node_modules at first
  // load. Pinned to semver ranges so an extension's deps don't
  // leak into other extensions' code.
  // npm: ["zod@^3.0.0"],

  provides: {
    // Mongoose models the extension contributes. Each places in
    // reality.models for cross-extension access.
    models: {
      // MyModel: "./model.js",
    },

    // Express router file. Mounted at /api/v1 by the loader.
    // Prefer routes-via-IBP-verbs over /api/v1 paths; HTTP routes
    // are mostly for legacy or third-party callers that can't speak
    // IBP yet.
    routes: false,                  // or "./routes.js"

    // `true` means init() returns a tools[] array. The loader passes
    // it through registerToolBundle (MCP register + tool-def registry
    // + ownership). Each tool needs { name, description, schema,
    // handler, verb }. Description is required; the seed refuses
    // to register tools without one.
    tools: false,

    // Background jobs with start/stop hooks. Loader calls start()
    // after init() and stop() on shutdown.
    jobs: false,                    // or "./jobs.js"

    // Shippable structure — clone bundles the operator can graft at
    // a position. Replaces the retired scaffold(ctx) seed pattern.
    // Each bundle is a static JSON file under ./clones/ with the
    // shape documented in seed/Chain-Rebuild.md.
    // clones: {
    //   "example-setup": "./clones/example.clone.json",
    // },

    // Required env vars. Loader validates on boot and can auto-
    // generate secrets.
    env: [
      // { key: "MY_API_KEY",    required: true,  secret: true,        description: "User-provided API key" },
      // { key: "MY_SIGNING",    autoGenerate: true,                    description: "Generated on first boot" },
      // { key: "MY_BASE_URL",   required: false, default: "https://...", description: "Override default endpoint" },
    ],

    // CLI subcommands (auto-wired by the cli package).
    cli: [],

    // Hooks this extension fires / listens to. The `fires` list lets
    // other extensions discover hook names declaratively; the
    // `listens` list documents the contract (the actual registration
    // happens in init() via reality.hooks.register).
    hooks: {
      fires: [
        // { name: "my-ext:something", data: "{ field }", description: "What it means" },
      ],
      listens: [
        // "afterMatter", "afterQualityWrite", "enrichContext",
      ],
    },

    // Stance-auth Layer 3 contributions. Default permission rules
    // the extension adds to the authorize() walk. Keys are
    // `<verb>:<action-or-stance>`; values mirror metadata.permissions
    // shape. The four resolution layers fire in order: facts → per
    // position rules (Layer 2, metadata.permissions on the position)
    // → these extension defaults (Layer 3) → default deny. Loader
    // wires registration; authorize.js walks the registry every
    // verb call.
    defaultPermissions: {
      // "do:my-ext:run":    { requires: { owner: true } },
      // "summon:@my-being": { requires: { homeInPlace: true } },
    },
  },
};
