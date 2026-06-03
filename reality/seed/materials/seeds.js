// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Seeds.
//

// Space, matter, and beings a reality can plant through
// the I AM as "packages". Used to form your reality beyond
// the default codebase.

//
// Plant seeds to grow a reality
//

// ── What a seed is ──────────────────────────────────────────────
//
// An extension is a capability surface. What that capability needs
// to stand on — beings at their roles, child spaces around them,
// initial matter, qualities stamped at the right positions — is a
// scaffold. A seed is that scaffold declared: a recipe that says
// "if you plant me at a space, I will create this structure to
// bootstrap what I do."
//
// A reality grows only the populations its operator plants. Nothing
// auto-installs; installing an extension is not the same as planting
// it. The seed is potential; planting is the act that turns potential
// into world.
//
//
// ── Seeds are how the I_AM extends ──────────────────────────────
//
// Every act in the world has a being behind it; genesis is no
// exception. At boot the I_AM acts alone: it plants the space root,
// the nine place seed spaces, its own Being row, and the first place
// beings. That sequence is the I_AM turning seed-as-potential into
// world-as-fact for the first time.
//
// A planted seed is the same act, later in time, with the operator
// as the trigger. The scaffold function runs through `reality` —
// seed-trusted; the writes flow through verbs with the I_AM's
// authority; the planted structure stamps an audit trail naming
// the operator who triggered it and the I_AM that performed it.
// Genesis at boot and seed-plant at runtime are not different in
// kind; they are the same operation at different times. The place's
// shape grows the way the reality was first formed: a being scaffolds
// substrate from a recipe.
//
// This is why the registry sits in the seed and not in any one
// extension. Seeds are the I_AM's own mechanism for extending the
// world, offered as a surface extensions can declare against. The
// extension supplies the recipe; the I_AM does the planting.
//
// ── Shape of a seed recipe ──────────────────────────────────────
//
//   {
//     name: "<ext>:<seed-action>",      // e.g. "governing:rulership"
//     description: "what planting this does",
//     ownerExtension: "<ext>",          // set by the loader
//     scaffold: async (ctx) => {
//       // free-form: the recipe calls reality verbs to create structure
//       // returns a `plantedThings` descriptor used by unplantSeed
//     },
//   }
//
// ── Plant lifecycle ─────────────────────────────────────────────
//
//   plant   → recipe.scaffold runs; creates structure; stamps
//             qualities.seeds.<plantedSeedId> on the target space with
//             { name, plantedAt, plantedBy, plantedThings }
//   listed  → listPlantedAt(spaceId) returns the namespace blob
//   unplant → walks plantedThings (in reverse) and deletes them; clears
//             the qualities entry
//
// Two registry maps live in this module: SEEDS (recipes by name)
// and a per-extension owner lookup so unregisterFromExtension at
// unload time stays clean.

import { v4 as uuidv4 } from "uuid";
import log from "../seedReality/log.js";
import Space from "./space/space.js";
import { registerOperation } from "../ibp/operations.js";
import { targetIdOf } from "./_targetShape.js";

const SEEDS = new Map(); // name → recipe
const SEED_OWNER = new Map(); // name → owning extension

const SEED_NAME_RE = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;
const MAX_SEEDS = 200;

/**
 * Register a seed recipe. Extensions call this via reality.seeds.register
 * (or declare seeds in their init() return value and the loader registers).
 *
 * @param {string} name - "<ext>:<seed-action>" — seed namespace convention
 * @param {object} recipe
 * @param {string} recipe.description - one-line explanation of what planting creates
 * @param {Function} recipe.scaffold - async ({ rootSpaceId, plantedSeedId, identity, reality }) => plantedThings
 * @param {string} [ownerExtension] - the registering extension; "seed" if omitted
 * @returns {boolean} true on success
 */
export function registerSeed(name, recipe, ownerExtension = "seed") {
  if (typeof name !== "string" || !SEED_NAME_RE.test(name)) {
    log.error(
      "Seeds",
      `Invalid seed name "${String(name).slice(0, 30)}". Use "<ext>:<seed-action>" (lowercase, hyphens).`,
    );
    return false;
  }
  if (!recipe || typeof recipe !== "object") {
    log.error("Seeds", `Seed "${name}" rejected: recipe object required`);
    return false;
  }
  if (typeof recipe.scaffold !== "function") {
    log.error(
      "Seeds",
      `Seed "${name}" rejected: recipe.scaffold must be a function`,
    );
    return false;
  }
  if (typeof recipe.description !== "string" || !recipe.description.length) {
    log.error(
      "Seeds",
      `Seed "${name}" rejected: recipe.description is required`,
    );
    return false;
  }
  const declaredPrefix = name.split(":")[0];
  if (ownerExtension !== "seed" && declaredPrefix !== ownerExtension) {
    log.error(
      "Seeds",
      `Seed "${name}" rejected: prefix "${declaredPrefix}" does not match owner "${ownerExtension}".`,
    );
    return false;
  }
  if (SEEDS.size >= MAX_SEEDS) {
    log.error(
      "Seeds",
      `Seed registry full (${MAX_SEEDS}). "${name}" rejected.`,
    );
    return false;
  }
  if (SEEDS.has(name)) {
    log.warn(
      "Seeds",
      `Seed "${name}" already registered by "${SEED_OWNER.get(name)}". Re-registration from "${ownerExtension}" rejected.`,
    );
    return false;
  }
  // Spread the recipe FIRST, then write `name` and `ownerExtension`
  // last so they can't be silently overridden by a recipe that
  // carries its own `name` (the loader passes the namespaced
  // "<ext>:<local>" form here; the recipe usually carries just the
  // local "<local>" form because extensions don't know their own
  // namespaced name). Without this, the SEEDS map is keyed by the
  // namespaced name but `listSeeds()` returned the local name,
  // breaking the round-trip from discovery → hotbar → plant lookup.
  SEEDS.set(name, Object.freeze({ ...recipe, name, ownerExtension }));
  SEED_OWNER.set(name, ownerExtension);
  log.verbose("Seeds", `Registered: ${name} (${ownerExtension})`);
  return true;
}

/**
 * Remove a seed by name.
 */
export function unregisterSeed(name) {
  SEEDS.delete(name);
  SEED_OWNER.delete(name);
}

/**
 * Drop every seed an extension registered. Called by the loader during
 * extension unload.
 */
export function unregisterSeedsFromExtension(extName) {
  let count = 0;
  for (const [name, owner] of SEED_OWNER) {
    if (owner === extName) {
      SEEDS.delete(name);
      SEED_OWNER.delete(name);
      count++;
    }
  }
  if (count > 0)
    log.verbose("Seeds", `Unregistered ${count} seed(s) from "${extName}"`);
  return count;
}

/**
 * Look up a seed recipe by name. Returns null when unknown.
 */
export function getSeed(name) {
  return SEEDS.get(name) || null;
}

/**
 * List every registered seed with light descriptor info for catalog UIs.
 */
export function listSeeds() {
  return Array.from(SEEDS.values()).map((s) => ({
    name: s.name,
    description: s.description,
    ownerExtension: s.ownerExtension,
  }));
}

// ─────────────────────────────────────────────────────────────────────
// PLANT / UNPLANT
// ─────────────────────────────────────────────────────────────────────

/**
 * Plant a seed at a space. Runs the recipe's `scaffold` function with
 * the seed's place services and stamps the result on the target
 * space's qualities.seeds namespace.
 *
 * @param {object} args
 * @param {string} args.name - registered seed name
 * @param {string} args.atSpaceId - target space id (the seed's plant point)
 * @param {object} args.identity - { beingId, username } of the planter
 * @param {object} args.reality - reality services bundle (passed to recipe)
 * @param {object} [args.params] - plant-time configuration the operator
 *   passes through to the seed (e.g. projectPath for a code workspace,
 *   theme for a UI extension). Free-shape object; the seed defines its
 *   schema in prose. Persisted on the planted-seed quality record so
 *   unplant + re-plant can audit what was configured.
 * @returns {Promise<{ plantedSeedId, plantedThings }>} on success
 * @throws when the seed isn't registered or the target space doesn't exist
 */
export async function plantSeed({
  name,
  atSpaceId,
  identity,
  reality,
  params = {},
  summonCtx = null,
}) {
  const recipe = SEEDS.get(name);
  if (!recipe) throw new Error(`Seed "${name}" not registered`);
  if (!atSpaceId) throw new Error("plantSeed requires atSpaceId");
  if (!identity?.beingId)
    throw new Error("plantSeed requires identity.beingId");

  const { loadOrFold } = await import("./projections.js");
  const targetSlot = await loadOrFold("space", atSpaceId, summonCtx?.branch || "0");
  if (!targetSlot)
    throw new Error(`Target space ${String(atSpaceId).slice(0, 8)} not found`);
  const target = { _id: targetSlot.id, name: targetSlot.state?.name };

  // Defensive copy so the recipe cannot mutate the caller's params.
  // Reject obviously dangerous shapes (non-object, null, array).
  const safeParams =
    params && typeof params === "object" && !Array.isArray(params)
      ? { ...params }
      : {};

  const plantedSeedId = uuidv4();
  const plantedAt = new Date().toISOString();

  // Thread the plant's summonCtx into the scaffold's ctx so every
  // DO the recipe runs (create-space, set-space, create-matter, ...)
  // pushes its Fact onto the SAME deltaF and rides the SAME actId.
  // sealAct commits them all together when the plant moment seals,
  // or rolls them all back together when any one fails. Without
  // this, scaffold DOs would each commit independently — and a
  // mid-scaffold failure would leave partial state on the row
  // (the user-observed case: the dance-floor space materialized
  // but the subsequent set-space size write was denied, leaving
  // an orphan grid with no bounds).
  const ctx = {
    rootSpaceId: String(atSpaceId),
    plantedSeedId,
    identity,
    reality,
    params: safeParams,
    summonCtx,
  };

  let plantedThings;
  try {
    plantedThings = await recipe.scaffold(ctx);
  } catch (err) {
    log.error(
      "Seeds",
      `Plant "${name}" at ${String(atSpaceId).slice(0, 8)} failed: ${err.message}`,
    );
    throw err;
  }

  // Stamp the planted-seed record on the target space. The "seeds"
  // quality namespace is a blob keyed by plantedSeedId. Params live
  // here too so an audit / re-plant can see what the operator
  // configured. Fact-driven: do.set on qualities.seeds. The do.plant
  // op caller threads summonCtx so the inner set Fact rides the
  // plant moment's actId.
  const spaceSlot = await loadOrFold("space", atSpaceId, summonCtx?.branch || "0");
  const space = spaceSlot ? { _id: spaceSlot.id, ...spaceSlot.state } : null;
  if (space) {
    const currentSeeds = space.qualities instanceof Map
      ? space.qualities.get("seeds")
      : space.qualities?.seeds;
    const existing = currentSeeds && typeof currentSeeds === "object"
      ? { ...currentSeeds }
      : {};
    existing[plantedSeedId] = {
      name,
      plantedAt,
      plantedBy: String(identity.beingId),
      params: safeParams,
      plantedThings: plantedThings || null,
    };
    const { doVerb } = await import("../ibp/verbs/do.js");
    await doVerb(
      { kind: "space", id: String(space._id) },
      "set-space",
      { field: "qualities.seeds", value: existing, merge: false },
      { identity, summonCtx },
    );
  }

  log.info(
    "Seeds",
    `🌱 planted "${name}" at ${String(atSpaceId).slice(0, 8)} ` +
      `(plantedSeedId=${plantedSeedId.slice(0, 8)})`,
  );

  return { plantedSeedId, plantedThings };
}

/**
 * Read the planted-seed entries on a space. Returns an array of
 * { plantedSeedId, name, plantedAt, plantedBy, plantedThings } records.
 */
export async function listPlantedAt(spaceId, { branch = "0" } = {}) {
  if (!spaceId) return [];
  const { loadProjection } = await import("./projections.js");
  const slot = await loadProjection("space", spaceId, branch);
  if (!slot) return [];
  const quals = slot.state?.qualities;
  const planted = quals instanceof Map ? quals.get("seeds") : quals?.seeds;
  if (!planted || typeof planted !== "object") return [];
  return Object.entries(planted).map(([plantedSeedId, entry]) => ({
    plantedSeedId,
    ...entry,
  }));
}

/**
 * Unplant a previously-planted seed. Walks `plantedThings` and asks the
 * recipe's optional `unscaffold` to undo the structure, then clears the
 * qualities entry. Recipes without `unscaffold` are best-effort —
 * plantedThings stays as the audit trail.
 */
export async function unplantSeed({
  atSpaceId,
  plantedSeedId,
  identity,
  reality,
  summonCtx = null,
}) {
  if (!atSpaceId || !plantedSeedId) {
    throw new Error("unplantSeed requires atSpaceId and plantedSeedId");
  }
  const { loadProjection: _lP } = await import("./projections.js");
  const _spaceSlot = await _lP("space", atSpaceId, summonCtx?.branch || "0");
  if (!_spaceSlot)
    throw new Error(`Target space ${String(atSpaceId).slice(0, 8)} not found`);
  const space = { _id: _spaceSlot.id, ...(_spaceSlot.state || {}) };

  const currentSeeds = space.qualities instanceof Map
    ? space.qualities.get("seeds")
    : space.qualities?.seeds;
  const seeds = currentSeeds && typeof currentSeeds === "object"
    ? { ...currentSeeds }
    : {};
  const entry = seeds[plantedSeedId];
  if (!entry)
    throw new Error(
      `Planted seed ${plantedSeedId.slice(0, 8)} not found at ${String(atSpaceId).slice(0, 8)}`,
    );

  const recipe = SEEDS.get(entry.name);
  if (recipe && typeof recipe.unscaffold === "function") {
    try {
      await recipe.unscaffold({
        rootSpaceId: String(atSpaceId),
        plantedSeedId,
        identity,
        place: reality,
        plantedThings: entry.plantedThings,
      });
    } catch (err) {
      log.error(
        "Seeds",
        `Unplant "${entry.name}" recipe.unscaffold failed: ${err.message}`,
      );
      throw err;
    }
  } else {
    log.warn(
      "Seeds",
      `Seed "${entry.name}" has no unscaffold(); plantedThings record kept as audit trail`,
    );
  }

  delete seeds[plantedSeedId];
  const { doVerb } = await import("../ibp/verbs/do.js");
  await doVerb(
    { kind: "space", id: String(atSpaceId) },
    "set-space",
    { field: "qualities.seeds", value: seeds, merge: false },
    identity ? { identity, summonCtx } : { scaffold: true },
  );

  log.info(
    "Seeds",
    `🪦 unplanted ${plantedSeedId.slice(0, 8)} ("${entry.name}") from ${String(atSpaceId).slice(0, 8)}`,
  );
}

// ─────────────────────────────────────────────────────────────────────
// plant — DO operation registration
// ─────────────────────────────────────────────────────────────────────
//
// `plant` is the seed's scaffold-install verb. One act, many writes:
// the seed recipe materializes a whole structure under target. The op
// belongs here next to plantSeed itself; `seed/services.js` imports
// this file for the side-effect registration.
//
// params: { seed, spec }

registerOperation("plant", {
  targets: ["space"],
  ownerExtension: "seed",
  factAction: "plant",
  handler: async ({ target, params, identity, summonCtx }) => {
    const { seed, spec } = params || {};
    if (!seed || typeof seed !== "string") {
      throw new Error(
        "plant: `seed` is required (the seed's registered name)",
      );
    }
    const spaceId = targetIdOf(target);
    if (!spaceId) throw new Error("plant: target must resolve to a space id");
    const { getRealityServices } = await import("../services.js");
    const reality = getRealityServices();
    const seedParams =
      spec && typeof spec === "object" && !Array.isArray(spec) ? spec : {};
    const { plantedSeedId, plantedThings } = await plantSeed({
      name: seed,
      atSpaceId: spaceId,
      identity,
      reality,
      params: seedParams,
      summonCtx,
    });
    return {
      planted: true,
      plantedSeedId,
      name: seed,
      spaceId,
      plantedThings,
    };
  },
});
