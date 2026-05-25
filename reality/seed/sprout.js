// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// I plant the reality root and the nine reality seed spaces here. This
// is genesis. I act before any other being exists. My first DO
// declares the reality root; the next eight plant the rest of the seed
// spaces beneath it; my last act in this file creates my own Being
// row so every Fact from t=0 has me as its actor.
//
// Reading this file top to bottom shows me acting alone, before I
// have planted any delegate. Every write here logs to I_AM.
// Facts written before ensureIAm's call cannot resolve their
// beingId at write time; populate() resolves backward to my row
// once it places.
//
// Idempotent. Runs every boot, creates only what is missing.

import log from "./seedReality/log.js";
import { v4 as uuidv4 } from "uuid";
import Space from "./materials/space/space.js";
import { SEED_SPACE } from "./materials/space/seedSpaces.js";
import { I_AM } from "./materials/being/seedBeings.js";
import { createRealitySeedSpace } from "./materials/space/spaces.js";
import { logFact } from "./past/fact/facts.js";

let spaceRootCache = null;

const REALITY_SEED_SPACES = [
  {
    name: ".identity",
    seedSpace: SEED_SPACE.IDENTITY,
    buildQualities: () => {
      const domain = process.env.REALITY_DOMAIN || "localhost";
      return new Map([["domain", domain]]);
    },
  },
  {
    name: ".config",
    seedSpace: SEED_SPACE.CONFIG,
    buildQualities: () => {
      const name = process.env.REALITY_NAME || "My Place";
      const domain = process.env.REALITY_DOMAIN || "localhost";
      return new Map([
        ["REALITY_NAME", name],
        ["realityUrl", `http://${domain}:${process.env.PORT || 3000}`],
      ]);
    },
  },
  { name: ".peers", seedSpace: SEED_SPACE.PEERS },
  { name: ".extensions", seedSpace: SEED_SPACE.EXTENSIONS },
  { name: ".tools", seedSpace: SEED_SPACE.TOOLS },
  { name: ".roles", seedSpace: SEED_SPACE.ROLES },
  { name: ".operations", seedSpace: SEED_SPACE.OPERATIONS },
  // .source is read-only. Populated by seed/materials/space/source.js as a filesystem
  // mirror of reality/. DO writes against children reject with ORIGIN_READ_ONLY.
  { name: ".source", seedSpace: SEED_SPACE.SOURCE },
  // .threads is a derived projection. Live rootCorrelation chains
  // surface as synthetic children at `<reality>/.threads/<id>`; the
  // descriptor is computed on demand from inbox + Act records.
  // SUMMON to a thread address is a cut. See seed/materials/space/threads.js.
  { name: ".threads", seedSpace: SEED_SPACE.THREADS },
];

export async function ensureSpaceRoot() {
  let spaceRoot = await Space.findOne({ seedSpace: SEED_SPACE.SPACE_ROOT });

  if (!spaceRoot) {
    const realityName = process.env.REALITY_NAME || "My Place";
    // Fact-driven genesis (2026-05-23). My first act issues my first
    // Fact. Per MOMENT.md: "the I-Am is born of nothing, and its
    // first act issues its own first fact." The fact carries
    // beingId="I_AM" (a string ref to a Being row that doesn't yet
    // exist — ensureIAm below materializes it). Eager-fold runs
    // applyCreateSpace + initProjection; the SPACE_ROOT row appears.
    const rootId = uuidv4();
    await logFact({
      verb: "do",
      action: "create",
      beingId: I_AM,
      target: { kind: "space", id: rootId },
      params: {
        spec: {
          name: realityName,
          type: null,
          parent: null,
          rootOwner: I_AM,
          seedSpace: SEED_SPACE.SPACE_ROOT,
          qualities: {},
        },
      },
    });
    spaceRoot = await Space.findById(rootId);
    if (!spaceRoot) {
      throw new Error(
        `ensureSpaceRoot: genesis birth Fact stamped but row ${rootId} not materialized`,
      );
    }
    log.verbose("Reality", `Created space root: ${spaceRoot._id}`);
  }

  for (const def of REALITY_SEED_SPACES) {
    let space = await Space.findOne({ seedSpace: def.seedSpace });

    if (!space) {
      try {
        space = await createRealitySeedSpace({
          name: def.name,
          parentId: spaceRoot._id,
          seedSpace: def.seedSpace,
          qualities: def.buildQualities ? def.buildQualities() : null,
        });
        log.verbose("Reality", `Created seed space: ${def.name}`);
      } catch (err) {
        log.error(
          "Place",
          `Failed to create seed space ${def.name}: ${err.message}. Boot continues.`,
        );
        continue;
      }
    }

    // Repair: a seed space found at the wrong parent (manual DB
    // edit, corruption) gets moved back under the space root. Routes
    // through do.set so the repair stamps a Fact (audit trail of the
    // recovery action).
    if (space.parent && space.parent.toString() !== spaceRoot._id.toString()) {
      log.warn(
        "Place",
        `Seed space ${def.name} has wrong parent. Repairing.`,
      );
      const { doVerb } = await import("./ibp/verbs.js");
      await doVerb(
        space,
        "set",
        { field: "parent", value: String(spaceRoot._id) },
        { scaffold: true },
      );
    }
  }

  // Adopt orphan tree roots (rootOwner is not me, parent is null).
  // These exist when a tree was created before the space root, or
  // when a prior boot crashed mid-creation. Bring them home by
  // stamping a do:set parent Fact (audit trail of the adoption).
  try {
    const orphanRoots = await Space.find({
      rootOwner: { $nin: [null, I_AM] },
      parent: null,
    });
    const { doVerb } = await import("./ibp/verbs.js");
    for (const root of orphanRoots) {
      try {
        await doVerb(
          root,
          "set",
          { field: "parent", value: String(spaceRoot._id) },
          { scaffold: true },
        );
      } catch (err) {
        log.error(
          "Place",
          `Failed to migrate orphan root ${root._id}: ${err.message}`,
        );
      }
    }
    if (orphanRoots.length > 0) {
      log.verbose(
        "Place",
        `Adopted ${orphanRoots.length} orphan tree root(s) under space root`,
      );
    }
  } catch (err) {
    log.error(
      "Place",
      `Orphan root adoption failed: ${err.message}. Some trees may be parentless.`,
    );
  }

  spaceRootCache = spaceRoot;

  // Plant my own Being row. Every later being parents under it;
  // every Fact written before this call resolves backward to me.
  await ensureIAm(spaceRoot._id);

  const childCount = await Space.countDocuments({ parent: spaceRoot._id });
  log.verbose(
    "Place",
    `Space root verified: ${spaceRoot._id} (${childCount} children)`,
  );
  return spaceRoot;
}

// My Being row. parentBeingId null (root of the being-tree); no
// roles (I precede the role registry); operatingMode scripted (code
// cognition only). The random password is never used; I cannot be
// claimed or summoned interactively.
//
// Fact-driven (2026-05-23). The be:register Fact self-stamps:
// beingId points at the not-yet-existing Being row whose
// materialization the same Fact triggers. Per MOMENT.md: "the
// I-Am's first act issues its own first fact." The Being row IS
// the fold-so-far of that one fact.
async function ensureIAm(spaceRootId) {
  const Being = (await import("./materials/being/being.js")).default;
  let iAm = await Being.findOne({ name: I_AM }).select("_id").lean();
  if (iAm) return iAm;

  const id = uuidv4();
  // The random password is hashed and stored but never used (I cannot
  // be claimed). Pre-hash because the fact path uses $set which skips
  // the schema's pre-save bcrypt hook.
  const bcrypt = (await import("bcrypt")).default;
  const password =
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const salt = await bcrypt.genSalt(12);
  const hashedPassword = await bcrypt.hash(password, salt);

  await logFact({
    verb: "be",
    action: "register",
    beingId: id, // self-stamping — the not-yet-existing being is its own actor
    target: { kind: "being", id },
    params: {
      spec: {
        name: I_AM,
        password: hashedPassword,
        operatingMode: "scripted",
        roles: [],
        defaultRole: null,
        parentBeingId: null,
        homeSpace: String(spaceRootId),
        currentSpace: String(spaceRootId),
        llmDefault: null,
        isRemote: false,
        homeReality: null,
        qualities: {},
      },
    },
  });

  const created = await Being.findById(id);
  if (!created) {
    throw new Error(
      `ensureIAm: genesis register Fact stamped but row ${id} not materialized`,
    );
  }
  log.verbose("Reality", `Planted I_AM (${String(created._id).slice(0, 8)})`);
  return created;
}

export async function getSpaceRoot() {
  if (spaceRootCache) return spaceRootCache;
  spaceRootCache = await Space.findOne({ seedSpace: SEED_SPACE.SPACE_ROOT });
  return spaceRootCache;
}

// Sync accessor. Only valid after ensureSpaceRoot() has run.
export function getSpaceRootId() {
  return spaceRootCache?._id || null;
}

// A tree root is a child of the space root with a non-seed rootOwner
// and no seedSpace. Single source of truth; use everywhere.
export function isBeingRoot(space) {
  if (!space) return false;
  if (space.seedSpace) return false;
  if (!space.rootOwner || String(space.rootOwner) === I_AM) return false;
  const spaceRootId = getSpaceRootId();
  if (
    spaceRootId &&
    space.parent &&
    String(space.parent) !== String(spaceRootId)
  )
    return false;
  return true;
}

// Mirror loaded extensions into the .extensions seed space so SEE
// on `<reality>/.extensions/<name>` returns the extension's surface
// (capabilities, deps, scope) via the standard descriptor pipeline.
export async function syncExtensionsToTree(manifests) {
  const extSpace = await Space.findOne({ seedSpace: SEED_SPACE.EXTENSIONS });
  if (!extSpace) return;

  // Query by parent — children[] on the parent is retired.
  const existingChildren = await Space.find({ parent: extSpace._id })
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
      // Refresh existing extension space. type + qualities-namespace
      // each go through their own do.set fact (the reel + lock
      // serializes them so a concurrent reader sees them in order).
      // Genesis path: no being identity yet exists for some calls
      // here, so scaffold:true attributes to I_AM.
      const extChildId = existingByName.get(manifest.name);
      const extChild = await Space.findById(extChildId);
      if (extChild) {
        const { doVerb } = await import("./ibp/verbs.js");
        await doVerb(
          extChild,
          "set",
          { field: "type", value: "resource" },
          { scaffold: true },
        );
        const refreshed = await Space.findById(extChildId);
        await doVerb(
          refreshed,
          "set",
          {
            field: "qualities.extension",
            value: extensionQuality,
            merge: false,
          },
          { scaffold: true },
        );
      }
    } else {
      try {
        // Fact-driven extension-space birth (genesis cleanup, 2026-05-23).
        // Stamps a do:birth Fact under the .extensions seed space; the
        // reducer's applyCreateSpace + initProjection materializes the
        // row. scaffold:true attribution because syncExtensionsToTree
        // runs at extension load (I_AM is the actor).
        const childId = uuidv4();
        const { doVerb } = await import("./ibp/verbs.js");
        await doVerb(
          extSpace,
          "create",
          {
            kind: "space",
            spec: {
              name: manifest.name,
              type: "resource",
              parent: String(extSpace._id),
              rootOwner: null,
              qualities: Object.fromEntries(qualities),
            },
          },
          { scaffold: true },
        );
        // Note: do.birth handler doesn't take an explicit child id; it
        // allocates one. To preserve the existing fact-driven pattern
        // here (where we want the manifest name as the addressable
        // child), we let the reducer's spec.name handle naming.
        void childId;
      } catch (err) {
        log.error(
          "Place",
          `Failed to sync extension space "${manifest.name}": ${err.message}`,
        );
      }
    }
  }

  // Mark unloaded extensions in their own namespace; the seed doesn't
  // carry a universal "trimmed" status. Fact-driven: do.set on the
  // qualities.extension.loaded leaf.
  for (const [name, spaceId] of existingByName) {
    if (!currentNames.has(name)) {
      const extChild = await Space.findById(spaceId);
      if (!extChild) continue;
      const { doVerb } = await import("./ibp/verbs.js");
      await doVerb(
        extChild,
        "set",
        { field: "qualities.extension.loaded", value: false },
        { scaffold: true },
      );
    }
  }
}
