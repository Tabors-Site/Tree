// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Extension Seeds — scaffolded shapes a land can plant.
//
// A `seed` is a declared recipe an extension provides: "if you plant me
// at a node, I will create this structure (nodes, beings, artifacts,
// metadata) to bootstrap whatever the extension does." A land grows
// only the populations its operators plant.
//
// Why this exists (see memory `extension-seeds`): until now, extensions
// scaffolded their own way — governing promoted root → Ruler via
// afterBoot hook, life set up its own ad-hoc structure, etc. The
// "what's actually present in this tree" question required walking
// metadata across many namespaces. With seeds, scaffolding is a single
// substrate fact: which seeds were planted, where, when.
//
// **Shape of a seed recipe:**
//
//   {
//     name: "<ext>:<seed-action>",      // e.g. "governing:rulership"
//     description: "what planting this does",
//     ownerExtension: "<ext>",          // set by the loader
//     scaffold: async (ctx) => {
//       // free-form: the recipe calls core verbs to create structure
//       // returns a `plantedThings` descriptor used by unplantSeed
//     },
//   }
//
// **Plant lifecycle:**
//
//   plant   → recipe.scaffold runs; creates structure; stamps
//             metadata.seeds.<plantedSeedId> on the target node with
//             { name, plantedAt, plantedBy, plantedThings }
//   listed  → readSeedsPlantedAt(nodeId) returns the namespace blob
//   unplant → walks plantedThings (in reverse) and deletes them; clears
//             the metadata entry
//
// Two registry maps: SEEDS (recipes by name) and a per-extension owner
// lookup so unregisterFromExtension at unload time stays clean.

import { v4 as uuidv4 } from "uuid";
import log from "./log.js";
import Node from "../models/node.js";

const SEEDS = new Map();             // name → recipe
const SEED_OWNER = new Map();        // name → owning extension

const SEED_NAME_RE = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;
const MAX_SEEDS = 200;

/**
 * Register a seed recipe. Extensions call this via core.seeds.register
 * (or declare seeds in their init() return value and the loader registers).
 *
 * @param {string} name - "<ext>:<seed-action>" — kernel namespace convention
 * @param {object} recipe
 * @param {string} recipe.description - one-line explanation of what planting creates
 * @param {Function} recipe.scaffold - async ({ rootNodeId, plantedSeedId, identity, core }) => plantedThings
 * @param {string} [ownerExtension] - the registering extension; "kernel" if omitted
 * @returns {boolean} true on success
 */
export function registerSeed(name, recipe, ownerExtension = "kernel") {
  if (typeof name !== "string" || !SEED_NAME_RE.test(name)) {
    log.error("Seeds", `Invalid seed name "${String(name).slice(0, 30)}". Use "<ext>:<seed-action>" (lowercase, hyphens).`);
    return false;
  }
  if (!recipe || typeof recipe !== "object") {
    log.error("Seeds", `Seed "${name}" rejected: recipe object required`);
    return false;
  }
  if (typeof recipe.scaffold !== "function") {
    log.error("Seeds", `Seed "${name}" rejected: recipe.scaffold must be a function`);
    return false;
  }
  if (typeof recipe.description !== "string" || !recipe.description.length) {
    log.error("Seeds", `Seed "${name}" rejected: recipe.description is required`);
    return false;
  }
  const declaredPrefix = name.split(":")[0];
  if (ownerExtension !== "kernel" && declaredPrefix !== ownerExtension) {
    log.error("Seeds",
      `Seed "${name}" rejected: prefix "${declaredPrefix}" does not match owner "${ownerExtension}".`);
    return false;
  }
  if (SEEDS.size >= MAX_SEEDS) {
    log.error("Seeds", `Seed registry full (${MAX_SEEDS}). "${name}" rejected.`);
    return false;
  }
  if (SEEDS.has(name)) {
    log.warn("Seeds", `Seed "${name}" already registered by "${SEED_OWNER.get(name)}". Re-registration from "${ownerExtension}" rejected.`);
    return false;
  }
  SEEDS.set(name, Object.freeze({ name, ...recipe, ownerExtension }));
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
  if (count > 0) log.verbose("Seeds", `Unregistered ${count} seed(s) from "${extName}"`);
  return count;
}

/**
 * Look up a seed recipe by name. Returns null when unknown.
 */
export function getSeed(name) {
  return SEEDS.get(name) || null;
}

/**
 * List every registered seed with light metadata for catalog UIs.
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
 * Plant a seed at a node. Runs the recipe's `scaffold` function with the
 * kernel's core services and stamps the result on the target node's
 * metadata.seeds namespace.
 *
 * @param {object} args
 * @param {string} args.name - registered seed name
 * @param {string} args.atNodeId - target node id (the seed's plant point)
 * @param {object} args.identity - { beingId, username } of the planter
 * @param {object} args.core - core services bundle (passed to recipe)
 * @returns {Promise<{ plantedSeedId, plantedThings }>} on success
 * @throws when the seed isn't registered or the target node doesn't exist
 */
export async function plantSeed({ name, atNodeId, identity, core }) {
  const recipe = SEEDS.get(name);
  if (!recipe) throw new Error(`Seed "${name}" not registered`);
  if (!atNodeId) throw new Error("plantSeed requires atNodeId");
  if (!identity?.beingId) throw new Error("plantSeed requires identity.beingId");

  const target = await Node.findById(atNodeId).select("_id name").lean();
  if (!target) throw new Error(`Target node ${String(atNodeId).slice(0, 8)} not found`);

  const plantedSeedId = uuidv4();
  const plantedAt = new Date().toISOString();

  const ctx = {
    rootNodeId: String(atNodeId),
    plantedSeedId,
    identity,
    core,
  };

  let plantedThings;
  try {
    plantedThings = await recipe.scaffold(ctx);
  } catch (err) {
    log.error("Seeds", `Plant "${name}" at ${String(atNodeId).slice(0, 8)} failed: ${err.message}`);
    throw err;
  }

  // Stamp the planted-seed record on the target node. metadata.seeds
  // is a namespace blob keyed by plantedSeedId.
  const { setExtMeta, getExtMeta } = await import("../tree/extensionMetadata.js");
  const node = await Node.findById(atNodeId);
  if (node) {
    const existing = (await getExtMeta(node, "seeds")) || {};
    existing[plantedSeedId] = {
      name,
      plantedAt,
      plantedBy: String(identity.beingId),
      plantedThings: plantedThings || null,
    };
    await setExtMeta(node, "seeds", existing);
  }

  log.info("Seeds",
    `🌱 planted "${name}" at ${String(atNodeId).slice(0, 8)} ` +
    `(plantedSeedId=${plantedSeedId.slice(0, 8)})`);

  return { plantedSeedId, plantedThings };
}

/**
 * Read the planted-seed entries on a node. Returns an array of
 * { plantedSeedId, name, plantedAt, plantedBy, plantedThings } records.
 */
export async function listPlantedAt(nodeId) {
  if (!nodeId) return [];
  const node = await Node.findById(nodeId).select("_id metadata").lean();
  if (!node) return [];
  const meta = node.metadata instanceof Map
    ? node.metadata.get("seeds")
    : node.metadata?.seeds;
  if (!meta || typeof meta !== "object") return [];
  return Object.entries(meta).map(([plantedSeedId, entry]) => ({
    plantedSeedId,
    ...entry,
  }));
}

/**
 * Unplant a previously-planted seed. Walks `plantedThings` and asks the
 * recipe's optional `unscaffold` to undo the structure, then clears the
 * metadata entry. Recipes without `unscaffold` are best-effort —
 * plantedThings stays as the audit trail.
 */
export async function unplantSeed({ atNodeId, plantedSeedId, identity, core }) {
  if (!atNodeId || !plantedSeedId) {
    throw new Error("unplantSeed requires atNodeId and plantedSeedId");
  }
  const node = await Node.findById(atNodeId);
  if (!node) throw new Error(`Target node ${String(atNodeId).slice(0, 8)} not found`);

  const { getExtMeta, setExtMeta } = await import("../tree/extensionMetadata.js");
  const seeds = (await getExtMeta(node, "seeds")) || {};
  const entry = seeds[plantedSeedId];
  if (!entry) throw new Error(`Planted seed ${plantedSeedId.slice(0, 8)} not found at ${String(atNodeId).slice(0, 8)}`);

  const recipe = SEEDS.get(entry.name);
  if (recipe && typeof recipe.unscaffold === "function") {
    try {
      await recipe.unscaffold({
        rootNodeId: String(atNodeId),
        plantedSeedId,
        identity,
        core,
        plantedThings: entry.plantedThings,
      });
    } catch (err) {
      log.error("Seeds", `Unplant "${entry.name}" recipe.unscaffold failed: ${err.message}`);
      throw err;
    }
  } else {
    log.warn("Seeds",
      `Seed "${entry.name}" has no unscaffold(); plantedThings record kept as audit trail`);
  }

  delete seeds[plantedSeedId];
  await setExtMeta(node, "seeds", seeds);

  log.info("Seeds",
    `🪦 unplanted ${plantedSeedId.slice(0, 8)} ("${entry.name}") from ${String(atNodeId).slice(0, 8)}`);
}
