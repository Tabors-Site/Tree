// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Land root bootstrap. Creates the land root and every land seed space
// on first boot, and recreates anything missing on subsequent boots
// (recovery from partial failures, manual deletion). Idempotent.

import log from "./system/log.js";
import Space from "./models/space.js";
import { SEED_SPACE, SEED_BEING } from "./space/seedSpaces.js";

let landRootCache = null;

const SYSTEM_NODES = [
  { name: ".identity", seedSpace: SEED_SPACE.IDENTITY, buildMetadata: () => {
    const domain = process.env.LAND_DOMAIN || "localhost";
    return new Map([["domain", domain]]);
  }},
  { name: ".config", seedSpace: SEED_SPACE.CONFIG, buildMetadata: () => {
    const name = process.env.LAND_NAME || "My Land";
    const domain = process.env.LAND_DOMAIN || "localhost";
    return new Map([
      ["LAND_NAME", name],
      ["landUrl", `http://${domain}:${process.env.PORT || 3000}`],
    ]);
  }},
  { name: ".peers", seedSpace: SEED_SPACE.PEERS },
  { name: ".extensions", seedSpace: SEED_SPACE.EXTENSIONS },
  { name: ".flow", seedSpace: SEED_SPACE.FLOW },
  { name: ".tools",      seedSpace: SEED_SPACE.TOOLS },
  { name: ".roles",      seedSpace: SEED_SPACE.ROLES },
  { name: ".operations", seedSpace: SEED_SPACE.OPERATIONS },
  // .source is read-only. Populated by seed/space/source.js as a filesystem
  // mirror of land/. DO writes against children reject with ORIGIN_READ_ONLY.
  { name: ".source",     seedSpace: SEED_SPACE.SOURCE },
];

export async function ensureLandRoot() {
  let landRoot = await Space.findOne({ seedSpace: SEED_SPACE.LAND_ROOT });

  if (!landRoot) {
    const landName = process.env.LAND_NAME || "My Land";
    landRoot = new Space({
      name: landName,
      rootOwner: SEED_BEING,
      parent: null,
      seedSpace: SEED_SPACE.LAND_ROOT,
      children: [],
      contributors: [],
    });
    await landRoot.save();
    log.info("Land", `Created land root: ${landRoot._id}`);
  }

  let childrenChanged = false;
  for (const def of SYSTEM_NODES) {
    let node = await Space.findOne({ seedSpace: def.seedSpace });

    if (!node) {
      node = new Space({
        name: def.name,
        parent: landRoot._id,
        seedSpace: def.seedSpace,
        children: [],
        contributors: [],
        ...(def.buildMetadata ? { metadata: def.buildMetadata() } : {}),
      });
      try {
        await node.save();
        log.info("Land", `Created land seed space: ${def.name}`);
      } catch (err) {
        log.error("Land", `Failed to create ${def.name}: ${err.message}. Boot continues.`);
        continue;
      }
    }

    // Repair: a land seed space found at the wrong parent (manual DB
    // edit, corruption) gets moved back under the land root.
    if (node.parent && node.parent.toString() !== landRoot._id.toString()) {
      log.warn("Land", `Land seed space ${def.name} has wrong parent. Repairing.`);
      await Space.findByIdAndUpdate(node._id, { $set: { parent: landRoot._id } });
    }

    const childIds = landRoot.children.map(String);
    if (!childIds.includes(String(node._id))) {
      landRoot.children.push(node._id);
      childrenChanged = true;
    }
  }

  // Adopt orphan tree roots (rootOwner != seed-being, parent: null).
  try {
    const orphanRoots = await Space.find({
      rootOwner: { $nin: [null, SEED_BEING] },
      parent: null,
    });
    for (const root of orphanRoots) {
      try {
        root.parent = landRoot._id;
        await root.save();
        landRoot.children.push(root._id);
        childrenChanged = true;
      } catch (err) {
        log.error("Land", `Failed to migrate orphan root ${root._id}: ${err.message}`);
      }
    }
    if (orphanRoots.length > 0) {
      log.info("Land", `Adopted ${orphanRoots.length} orphan tree root(s) under land root`);
    }
  } catch (err) {
    log.error("Land", `Orphan root adoption failed: ${err.message}. Some trees may be parentless.`);
  }

  if (childrenChanged) {
    await landRoot.save();
  }

  landRootCache = landRoot;

  // The seed-being is the kernel's first Being row so every scaffold-time
  // Did from this point forward attributes to a real Being.
  await ensureSeedBeing(landRoot._id);

  log.verbose("Land", `Land root verified: ${landRoot._id} (${landRoot.children.length} children)`);
  return landRoot;
}

// parentBeingId: null marks the root of the being-tree; every other
// being chains down from it. Code-cognition only — cannot be claimed
// or summoned interactively, so the random password is never used.
async function ensureSeedBeing(landRootId) {
  const Being = (await import("../models/being.js")).default;
  let seedBeing = await Being.findOne({ name: SEED_BEING }).select("_id").lean();
  if (seedBeing) return seedBeing;

  const password = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const created = await Being.create({
    name:          SEED_BEING,
    password,
    operatingMode: "scripted",
    roles:         ["seed-being"],
    defaultRole:   "seed-being",
    parentBeingId: null,
    homeSpace:     landRootId,
    currentSpace:  landRootId,
  });
  log.info("Land", `Created seed-being (${String(created._id).slice(0, 8)})`);
  return created;
}

export async function getLandRoot() {
  if (landRootCache) return landRootCache;
  landRootCache = await Space.findOne({ seedSpace: SEED_SPACE.LAND_ROOT });
  return landRootCache;
}

// Sync accessor. Only valid after ensureLandRoot() has run.
export function getLandRootId() {
  return landRootCache?._id || null;
}

// A tree root is a child of the land root with a non-seed rootOwner
// and no seedSpace. Single source of truth — use everywhere.
export function isBeingRoot(node) {
  if (!node) return false;
  if (node.seedSpace) return false;
  if (!node.rootOwner || String(node.rootOwner) === SEED_BEING) return false;
  const landId = getLandRootId();
  if (landId && node.parent && String(node.parent) !== String(landId)) return false;
  return true;
}

// Mirror loaded extensions into the .extensions land seed space so SEE
// on `<land>/.extensions/<name>` returns the extension's surface
// (capabilities, deps, scope) via the standard descriptor pipeline.
export async function syncExtensionsToTree(manifests) {
  const extSpace = await Space.findOne({ seedSpace: SEED_SPACE.EXTENSIONS });
  if (!extSpace) return;

  const existingChildren = await Space.find({
    _id: { $in: extSpace.children },
  }).select("_id name").lean();

  const existingByName = new Map();
  for (const c of existingChildren) existingByName.set(c.name, c._id);

  const currentNames = new Set();

  for (const manifest of manifests) {
    currentNames.add(manifest.name);

    const extensionMeta = {
      version:     manifest.version     || "0.0.0",
      description: manifest.description || null,
      type:        manifest.type        || null,
      scope:       manifest.scope === "confined" ? "confined" : "open",
      needs:       manifest.needs       || {},
      optional:    manifest.optional    || {},
      provides:    {
        routes:        !!manifest.provides?.routes,
        tools:         !!manifest.provides?.tools,
        jobs:          !!manifest.provides?.jobs,
        models:        Object.keys(manifest.provides?.models        || {}),
        energyActions: Object.keys(manifest.provides?.energyActions || {}),
        sessionTypes:  Object.keys(manifest.provides?.sessionTypes  || {}),
      },
    };
    const metadata = new Map([["extension", extensionMeta]]);

    if (existingByName.has(manifest.name)) {
      await Space.findByIdAndUpdate(existingByName.get(manifest.name), {
        $set: { type: "resource", metadata },
      });
    } else {
      try {
        const child = new Space({
          name: manifest.name,
          parent: extSpace._id,
          type: "resource",
          children: [],
          contributors: [],
          metadata,
        });
        await child.save();
        await Space.findByIdAndUpdate(extSpace._id, { $addToSet: { children: child._id } });
      } catch (err) {
        log.error("Land", `Failed to sync extension node "${manifest.name}": ${err.message}`);
      }
    }
  }

  // Mark unloaded extensions in their own namespace; the kernel doesn't
  // carry a universal "trimmed" status.
  for (const [name, spaceId] of existingByName) {
    if (!currentNames.has(name)) {
      await Space.findByIdAndUpdate(spaceId, {
        $set: { "metadata.extension.loaded": false },
      });
    }
  }
}
