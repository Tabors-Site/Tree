// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Space-domain constants.

// ============================================================================
// SEED SPACES
// ============================================================================
//
// Kinds of Space the seed plants and owns. Every seed-space is dot-
// prefixed (.identity, .config, .peers, .extensions, .flow, .tools,
// .roles, .operations, .source) and reserved by the kernel. They sit
// directly under the land root and are the substrate the seed plants
// at first boot. The Space schema field `seedSpace` carries one of
// these values; user-created spaces have `seedSpace: null`.
//
// Renamed from SEED_SPACE / SYSTEM_ROLE 2026-05-20. The previous name
// conflated with the Being-role registry (ruler, planner, etc.); these
// values describe what KIND of seed-managed Space a position is, not a
// role a being plays. See migration 0.20.0 for the schema field copy.

export const SEED_SPACE = Object.freeze({
  LAND_ROOT:  "land-root",
  IDENTITY:   "identity",
  CONFIG:     "config",
  PEERS:      "peers",
  EXTENSIONS: "extensions",
  FLOW:       "flow",
  // Registry-mirror land seed spaces. Each runtime registry (tool defs,
  // role specs, DO operations) syncs its contents into a child Space
  // here so SEE on `<land>/.tools` (etc.) returns the current registry
  // through the standard descriptor pipeline. See [[project_meta_positions]].
  TOOLS:      "tools",
  ROLES:      "roles",
  OPERATIONS: "operations",
  // The .source self-tree. Seed walks its own land/ directory at boot
  // and plants a recursive filesystem-origin matter tree under this
  // space, mirroring the codebase as substrate. Read-only: DO writes on
  // .source matter reject with ORIGIN_READ_ONLY.
  SOURCE:     "source",
});

// ============================================================================
// SENTINEL VALUES
// ============================================================================
//
// DELETED — placed in `parent` and (for matter) `beingId` when a space
//           is soft-deleted. The deleted-revive extension can bring
//           spaces back; matter stays soft-deleted.
// SEED_BEING — the seed's identity. One sentinel covering both
//              meanings:
//                rootOwner: SEED_BEING  → "this space is the seed's"
//                beingId:   SEED_BEING  → "the seed acted here" (Did
//                                          rows written by scaffold
//                                          flows — seed plants, first
//                                          boot bootstrap, migrations
//                                          — where no being identity
//                                          exists yet)
//              Value matches the kebab-case convention used for the
//              other land-system being names (auth, llm-assigner,
//              land-manager, citizen). Aligns with the synthetic
//              stance `<land>/@seed-being`.

export const DELETED = "deleted";
export const SEED_BEING = "seed-being";
