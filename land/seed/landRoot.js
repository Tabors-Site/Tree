// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Land root bootstrap. I-am's genesis pass: plants the land root,
// plants the nine land seed spaces, then registers its own Being
// row. Idempotent — runs every boot, creates only what's missing.
//
// This file is point 6 of THE PHILOSOPHY OF THE SEED (see
// seed/space/seedSpaces.js): the ordered genesis sequence. Reading
// it top to bottom shows I-am acting alone before it has planted
// any delegate. Every write here is logged to SEED_BEING; Did
// populate() resolves backward once ensureSeedBeing lands the row.

import log from "./system/log.js";
import Space from "./models/space.js";
import { SEED_SPACE, SEED_BEING } from "./space/seedSpaces.js";
import { createLandSeedSpace } from "./space/spaceManagement.js";
import { logDid } from "./space/dids.js";

let landRootCache = null;

const LAND_SEED_SPACES = [
  {
    name: ".identity",
    seedSpace: SEED_SPACE.IDENTITY,
    buildMetadata: () => {
      const domain = process.env.LAND_DOMAIN || "localhost";
      return new Map([["domain", domain]]);
    },
  },
  {
    name: ".config",
    seedSpace: SEED_SPACE.CONFIG,
    buildMetadata: () => {
      const name = process.env.LAND_NAME || "My Land";
      const domain = process.env.LAND_DOMAIN || "localhost";
      return new Map([
        ["LAND_NAME", name],
        ["landUrl", `http://${domain}:${process.env.PORT || 3000}`],
      ]);
    },
  },
  { name: ".peers", seedSpace: SEED_SPACE.PEERS },
  { name: ".extensions", seedSpace: SEED_SPACE.EXTENSIONS },
  { name: ".flow", seedSpace: SEED_SPACE.FLOW },
  { name: ".tools", seedSpace: SEED_SPACE.TOOLS },
  { name: ".roles", seedSpace: SEED_SPACE.ROLES },
  { name: ".operations", seedSpace: SEED_SPACE.OPERATIONS },
  // .source is read-only. Populated by seed/space/source.js as a filesystem
  // mirror of land/. DO writes against children reject with ORIGIN_READ_ONLY.
  { name: ".source", seedSpace: SEED_SPACE.SOURCE },
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
    // I-am's first DO. Did populate() resolves once ensureSeedBeing lands.
    try {
      await logDid({
        verb:    "do",
        action:  "create",
        beingId: SEED_BEING,
        target:  { kind: "space", id: String(landRoot._id) },
        params:  { name: landName, seedSpace: SEED_SPACE.LAND_ROOT },
      });
    } catch (err) {
      log.warn("Land", `Did write for land-root creation failed: ${err.message}`);
    }
  }

  let childrenChanged = false;
  for (const def of LAND_SEED_SPACES) {
    let space = await Space.findOne({ seedSpace: def.seedSpace });

    if (!space) {
      try {
        space = await createLandSeedSpace({
          name:      def.name,
          parentId:  landRoot._id,
          seedSpace: def.seedSpace,
          metadata:  def.buildMetadata ? def.buildMetadata() : null,
        });
        log.info("Land", `Created land seed space: ${def.name}`);
      } catch (err) {
        log.error(
          "Land",
          `Failed to create ${def.name}: ${err.message}. Boot continues.`,
        );
        continue;
      }
    }

    // Repair: a land seed space found at the wrong parent (manual DB
    // edit, corruption) gets moved back under the land root.
    if (space.parent && space.parent.toString() !== landRoot._id.toString()) {
      log.warn(
        "Land",
        `Land seed space ${def.name} has wrong parent. Repairing.`,
      );
      await Space.findByIdAndUpdate(space._id, {
        $set: { parent: landRoot._id },
      });
    }

    const childIds = landRoot.children.map(String);
    if (!childIds.includes(String(space._id))) {
      landRoot.children.push(space._id);
      childrenChanged = true;
    }
  }

  // Adopt orphan tree roots (rootOwner != I-am, parent: null).
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
        log.error(
          "Land",
          `Failed to migrate orphan root ${root._id}: ${err.message}`,
        );
      }
    }
    if (orphanRoots.length > 0) {
      log.info(
        "Land",
        `Adopted ${orphanRoots.length} orphan tree root(s) under land root`,
      );
    }
  } catch (err) {
    log.error(
      "Land",
      `Orphan root adoption failed: ${err.message}. Some trees may be parentless.`,
    );
  }

  if (childrenChanged) {
    await landRoot.save();
  }

  landRootCache = landRoot;

  // Lands I-am's Being row. Did populate() resolves backward to it
  // after this call; every later being parents under it.
  await ensureSeedBeing(landRoot._id);

  log.verbose(
    "Land",
    `Land root verified: ${landRoot._id} (${landRoot.children.length} children)`,
  );
  return landRoot;
}

// I-am: parentBeingId null (root of the being-tree), no roles (precedes
// the role registry), code cognition only. Random password unused —
// I-am isn't claimable.
async function ensureSeedBeing(landRootId) {
  const Being = (await import("../models/being.js")).default;
  let seedBeing = await Being.findOne({ name: SEED_BEING })
    .select("_id")
    .lean();
  if (seedBeing) return seedBeing;

  const password =
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const created = await Being.create({
    name: SEED_BEING,
    password,
    operatingMode: "scripted",
    parentBeingId: null,
    homeSpace: landRootId,
    currentSpace: landRootId,
  });
  log.info("Land", `Created I-am I-am (${String(created._id).slice(0, 8)})`);
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
export function isBeingRoot(space) {
  if (!space) return false;
  if (space.seedSpace) return false;
  if (!space.rootOwner || String(space.rootOwner) === SEED_BEING) return false;
  const landId = getLandRootId();
  if (landId && space.parent && String(space.parent) !== String(landId))
    return false;
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
  })
    .select("_id name")
    .lean();

  const existingByName = new Map();
  for (const c of existingChildren) existingByName.set(c.name, c._id);

  const currentNames = new Set();

  for (const manifest of manifests) {
    currentNames.add(manifest.name);

    const extensionMeta = {
      version: manifest.version || "0.0.0",
      description: manifest.description || null,
      type: manifest.type || null,
      scope: manifest.scope === "confined" ? "confined" : "open",
      needs: manifest.needs || {},
      optional: manifest.optional || {},
      provides: {
        routes: !!manifest.provides?.routes,
        tools: !!manifest.provides?.tools,
        jobs: !!manifest.provides?.jobs,
        models: Object.keys(manifest.provides?.models || {}),
        energyActions: Object.keys(manifest.provides?.energyActions || {}),
        sessionTypes: Object.keys(manifest.provides?.sessionTypes || {}),
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
        await Space.findByIdAndUpdate(extSpace._id, {
          $addToSet: { children: child._id },
        });
      } catch (err) {
        log.error(
          "Land",
          `Failed to sync extension space "${manifest.name}": ${err.message}`,
        );
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
