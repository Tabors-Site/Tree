// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// I plant the place root and the nine place seed spaces here. This
// is genesis. I act before any other being exists. My first DO
// creates the place root; the next eight plant the rest of the seed
// spaces beneath it; my last act in this file creates my own Being
// row so every Did from t=0 has me as its actor.
//
// Reading this file top to bottom shows me acting alone, before I
// have planted any delegate. Every write here logs to I_AM.
// Dids written before ensureIAm's call cannot resolve their
// beingId at write time; populate() resolves backward to my row
// once it places.
//
// Idempotent. Runs every boot, creates only what is missing.

import log from "./system/log.js";
import Space from "./models/space.js";
import { SEED_SPACE, I_AM } from "./place/space/seedSpaces.js";
import { createPlaceSeedSpace } from "./place/space/spaceManagement.js";
import { logDid } from "./place/dids.js";

let placeRootCache = null;

const PLACE_SEED_SPACES = [
  {
    name: ".identity",
    seedSpace: SEED_SPACE.IDENTITY,
    buildQualities: () => {
      const domain = process.env.PLACE_DOMAIN || "localhost";
      return new Map([["domain", domain]]);
    },
  },
  {
    name: ".config",
    seedSpace: SEED_SPACE.CONFIG,
    buildQualities: () => {
      const name = process.env.PLACE_NAME || "My Place";
      const domain = process.env.PLACE_DOMAIN || "localhost";
      return new Map([
        ["PLACE_NAME", name],
        ["placeUrl", `http://${domain}:${process.env.PORT || 3000}`],
      ]);
    },
  },
  { name: ".peers", seedSpace: SEED_SPACE.PEERS },
  { name: ".extensions", seedSpace: SEED_SPACE.EXTENSIONS },
  { name: ".flow", seedSpace: SEED_SPACE.FLOW },
  { name: ".tools", seedSpace: SEED_SPACE.TOOLS },
  { name: ".roles", seedSpace: SEED_SPACE.ROLES },
  { name: ".operations", seedSpace: SEED_SPACE.OPERATIONS },
  // .source is read-only. Populated by seed/place/space/source.js as a filesystem
  // mirror of place/. DO writes against children reject with ORIGIN_READ_ONLY.
  { name: ".source", seedSpace: SEED_SPACE.SOURCE },
  // .threads is a derived projection. Live rootCorrelation chains
  // surface as synthetic children at `<place>/.threads/<id>`; the
  // descriptor is computed on demand from inbox + Summon records.
  // SUMMON to a thread address is a cut. See seed/place/space/threads.js.
  { name: ".threads", seedSpace: SEED_SPACE.THREADS },
];

export async function ensurePlaceRoot() {
  let placeRoot = await Space.findOne({ seedSpace: SEED_SPACE.PLACE_ROOT });

  if (!placeRoot) {
    const placeName = process.env.PLACE_NAME || "My Place";
    placeRoot = new Space({
      name: placeName,
      rootOwner: I_AM,
      parent: null,
      seedSpace: SEED_SPACE.PLACE_ROOT,
      children: [],
      contributors: [],
    });
    await placeRoot.save();
    log.info("Place", `Created place root: ${placeRoot._id}`);
    // My first DO. populate() resolves the beingId backward to me
    // once ensureIAm's call places my Being row.
    try {
      await logDid({
        verb:    "do",
        action:  "create",
        beingId: I_AM,
        target:  { kind: "space", id: String(placeRoot._id) },
        params:  { name: placeName, seedSpace: SEED_SPACE.PLACE_ROOT },
      });
    } catch (err) {
      log.warn("Place", `Did write for place-root creation failed: ${err.message}`);
    }
  }

  let childrenChanged = false;
  for (const def of PLACE_SEED_SPACES) {
    let space = await Space.findOne({ seedSpace: def.seedSpace });

    if (!space) {
      try {
        space = await createPlaceSeedSpace({
          name:      def.name,
          parentId:  placeRoot._id,
          seedSpace: def.seedSpace,
          qualities: def.buildQualities ? def.buildQualities() : null,
        });
        log.info("Place", `Created place seed space: ${def.name}`);
      } catch (err) {
        log.error(
          "Place",
          `Failed to create ${def.name}: ${err.message}. Boot continues.`,
        );
        continue;
      }
    }

    // Repair: a place seed space found at the wrong parent (manual DB
    // edit, corruption) gets moved back under the place root.
    if (space.parent && space.parent.toString() !== placeRoot._id.toString()) {
      log.warn(
        "Place",
        `Place seed space ${def.name} has wrong parent. Repairing.`,
      );
      await Space.findByIdAndUpdate(space._id, {
        $set: { parent: placeRoot._id },
      });
    }

    const childIds = placeRoot.children.map(String);
    if (!childIds.includes(String(space._id))) {
      placeRoot.children.push(space._id);
      childrenChanged = true;
    }
  }

  // Adopt orphan tree roots (rootOwner is not me, parent is null).
  // These exist when a tree was created before the place root, or
  // when a prior boot crashed mid-creation. Bring them home.
  try {
    const orphanRoots = await Space.find({
      rootOwner: { $nin: [null, I_AM] },
      parent: null,
    });
    for (const root of orphanRoots) {
      try {
        root.parent = placeRoot._id;
        await root.save();
        placeRoot.children.push(root._id);
        childrenChanged = true;
      } catch (err) {
        log.error(
          "Place",
          `Failed to migrate orphan root ${root._id}: ${err.message}`,
        );
      }
    }
    if (orphanRoots.length > 0) {
      log.info(
        "Place",
        `Adopted ${orphanRoots.length} orphan tree root(s) under place root`,
      );
    }
  } catch (err) {
    log.error(
      "Place",
      `Orphan root adoption failed: ${err.message}. Some trees may be parentless.`,
    );
  }

  if (childrenChanged) {
    await placeRoot.save();
  }

  placeRootCache = placeRoot;

  // Plant my own Being row. Every later being parents under it;
  // every Did written before this call resolves backward to me.
  await ensureIAm(placeRoot._id);

  log.verbose(
    "Place",
    `Place root verified: ${placeRoot._id} (${placeRoot.children.length} children)`,
  );
  return placeRoot;
}

// My Being row. parentBeingId null (root of the being-tree); no
// roles (I precede the role registry); operatingMode scripted (code
// cognition only). The random password is never used; I cannot be
// claimed or summoned interactively.
async function ensureIAm(placeRootId) {
  const Being = (await import("../models/being.js")).default;
  let iAm = await Being.findOne({ name: I_AM })
    .select("_id")
    .lean();
  if (iAm) return iAm;

  const password =
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const created = await Being.create({
    name: I_AM,
    password,
    operatingMode: "scripted",
    parentBeingId: null,
    homeSpace: placeRootId,
    currentSpace: placeRootId,
  });
  log.info("Place", `Planted I_AM (${String(created._id).slice(0, 8)})`);
  return created;
}

export async function getPlaceRoot() {
  if (placeRootCache) return placeRootCache;
  placeRootCache = await Space.findOne({ seedSpace: SEED_SPACE.PLACE_ROOT });
  return placeRootCache;
}

// Sync accessor. Only valid after ensurePlaceRoot() has run.
export function getPlaceRootId() {
  return placeRootCache?._id || null;
}

// A tree root is a child of the place root with a non-seed rootOwner
// and no seedSpace. Single source of truth; use everywhere.
export function isBeingRoot(space) {
  if (!space) return false;
  if (space.seedSpace) return false;
  if (!space.rootOwner || String(space.rootOwner) === I_AM) return false;
  const placeId = getPlaceRootId();
  if (placeId && space.parent && String(space.parent) !== String(placeId))
    return false;
  return true;
}

// Mirror loaded extensions into the .extensions place seed space so SEE
// on `<place>/.extensions/<name>` returns the extension's surface
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

    const extensionQuality = {
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
    const qualities = new Map([["extension", extensionQuality]]);

    if (existingByName.has(manifest.name)) {
      await Space.findByIdAndUpdate(existingByName.get(manifest.name), {
        $set: { type: "resource", qualities },
      });
    } else {
      try {
        const child = new Space({
          name: manifest.name,
          parent: extSpace._id,
          type: "resource",
          children: [],
          contributors: [],
          qualities,
        });
        await child.save();
        await Space.findByIdAndUpdate(extSpace._id, {
          $addToSet: { children: child._id },
        });
      } catch (err) {
        log.error(
          "Place",
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
        $set: { "qualities.extension.loaded": false },
      });
    }
  }
}
