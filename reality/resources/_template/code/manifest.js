// _template/code — the code piece manifest template.
//
// A code piece runs init(story) at boot. The typical surface it
// registers is DO ops, SEE ops, hooks, and cognition handlers for
// role pieces. Anything more substantial (mongoose models, express
// routes, mcp tools, background jobs) is rare and lives behind
// optional fields the substrate still supports for legacy reasons,
// not the standard shape — keep this manifest tight.

export default {
  kind:    "code",
  // The code piece carries the PACK's name so scopedStory's
  // auto-prefix rule writes "my-pack:<thing>" when this code registers
  // ops/sees/etc. The pack ALSO has name: "my-pack" — different kinds,
  // distinct registries, no collision.
  name:    "my-pack",
  pack:    "my-pack",
  version: "1.0.0",
  description:
    "Substrate code for my-pack: <one-line summary of what the ops + sees do>.",

  // Inter-piece deps (this code needs the pack's roles) live in the
  // pack manifest's requires; the code piece's own requires only
  // names EXTERNAL resources it draws from other packs.
  requires: [],

  // Substrate services this code reaches for. The scoped story only
  // exposes what's declared here; reaching for an undeclared service
  // returns undefined. Common services: see, do, summon, be, qualities,
  // declare, hooks, models.
  needs: {
    services: [],
  },

  // Best-effort. The loader stubs missing optional services with a
  // no-op so init() can still run.
  optional: {
    services: [],
  },

  // Auto-installed by the loader into a local node_modules at first
  // load. Pinned semver ranges so this pack's deps don't leak.
  // npm: ["zod@^3.0.0"],

  provides: {
    // DO operations this piece registers. Listed here for visibility;
    // the actual registration happens in init() via
    // story.do.registerOperation(name, op). The loader auto-namespaces
    // each name to <pack>:<name>.
    do: [
      // { name: "example-op", target: "space", description: "What it does." },
    ],

    // SEE operations this piece registers. Same shape as `do`.
    see: [
      // { name: "example-see", description: "What it returns." },
    ],

    // Required env vars. Loader validates on boot; can auto-generate
    // secrets.
    env: [
      // { key: "MY_API_KEY", required: true, secret: true, description: "User-provided API key" },
    ],

    // Hooks this code fires / listens to. The `fires` list lets other
    // resources discover hook names declaratively; `listens` documents
    // the contract (actual registration happens in init() via
    // story.hooks.register).
    hooks: {
      fires: [
        // { name: "my-pack:something", data: "{ field }", description: "What it means" },
      ],
      listens: [
        // "afterMatter", "afterQualityWrite", "enrichContext",
      ],
    },
  },
};
