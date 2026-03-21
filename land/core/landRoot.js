import Node from "../db/models/node.js";
import { getLandIdentity } from "../canopy/identity.js";

let landRootCache = null;

/**
 * Bootstrap the Land root and system nodes. Idempotent.
 * Called once at startup after DB connects.
 */
export async function ensureLandRoot() {
  const existing = await Node.findOne({ systemRole: "land-root" });
  if (existing) {
    landRootCache = existing;
    console.log("[Land] Land root found:", existing._id);
    return existing;
  }

  const identity = getLandIdentity();

  const landRoot = new Node({
    name: identity.name || "My Land",
    rootOwner: "SYSTEM",
    parent: null,
    isSystem: true,
    systemRole: "land-root",
    children: [],
    contributors: [],
    versions: [
      {
        prestige: 0,
        values: {},
        status: "active",
        dateCreated: new Date(),
      },
    ],
  });
  await landRoot.save();

  const identityNode = new Node({
    name: ".identity",
    parent: landRoot._id,
    isSystem: true,
    systemRole: "identity",
    children: [],
    contributors: [],
    versions: [
      {
        prestige: 0,
        values: {},
        status: "active",
        dateCreated: new Date(),
      },
    ],
    metadata: new Map([
      ["landId", identity.landId],
      ["domain", identity.domain],
      ["publicKey", identity.publicKey],
    ]),
  });
  await identityNode.save();

  const configNode = new Node({
    name: ".config",
    parent: landRoot._id,
    isSystem: true,
    systemRole: "config",
    children: [],
    contributors: [],
    versions: [
      {
        prestige: 0,
        values: {},
        status: "active",
        dateCreated: new Date(),
      },
    ],
    metadata: new Map([
      ["LAND_NAME", identity.name || "My Land"],
      ["LAND_DEFAULT_TIER", process.env.LAND_DEFAULT_TIER || "basic"],
      ["ENABLE_FRONTEND_HTML", process.env.ENABLE_FRONTEND_HTML || ""],
      ["DIRECTORY_URL", process.env.DIRECTORY_URL || ""],
      ["REQUIRE_EMAIL", process.env.REQUIRE_EMAIL || "true"],
      ["AI_MODEL_DEFAULT", null],
    ]),
  });
  await configNode.save();

  const peersNode = new Node({
    name: ".peers",
    parent: landRoot._id,
    isSystem: true,
    systemRole: "peers",
    children: [],
    contributors: [],
    versions: [
      {
        prestige: 0,
        values: {},
        status: "active",
        dateCreated: new Date(),
      },
    ],
  });
  await peersNode.save();

  landRoot.children = [identityNode._id, configNode._id, peersNode._id];

  // Migrate existing user roots under the Land root
  const orphanRoots = await Node.find({
    rootOwner: { $nin: [null, "SYSTEM"] },
    parent: null,
  });

  for (const root of orphanRoots) {
    root.parent = landRoot._id;
    await root.save();
    landRoot.children.push(root._id);
  }

  await landRoot.save();
  landRootCache = landRoot;

  console.log(
    `[Land] Created Land root (${landRoot._id}) with ${orphanRoots.length} migrated tree(s)`
  );
  return landRoot;
}

/**
 * Get cached Land root node. Lazy-loads from DB if needed.
 */
export async function getLandRoot() {
  if (landRootCache) return landRootCache;
  landRootCache = await Node.findOne({ systemRole: "land-root" });
  return landRootCache;
}

/**
 * Sync getter for cached Land root ID.
 * Only valid after ensureLandRoot() has run.
 */
export function getLandRootId() {
  return landRootCache?._id || null;
}

/**
 * Check if a node is a user-created root (not the Land system root).
 */
export function isUserRoot(node) {
  return !!node.rootOwner && node.rootOwner !== "SYSTEM";
}
