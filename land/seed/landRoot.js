// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import log from "./log.js";
import Node from "./models/node.js";
import { NODE_STATUS, SYSTEM_ROLE } from "./protocol.js";

let landRootCache = null;

/**
 * Bootstrap the Land root and system nodes. Idempotent.
 * Called once at startup after DB connects.
 */
export async function ensureLandRoot() {
  const existing = await Node.findOne({ systemRole: SYSTEM_ROLE.LAND_ROOT });
  if (existing) {
    landRootCache = existing;
    log.verbose("Land", "Land root found:", existing._id);
    return existing;
  }

  const landName = process.env.LAND_NAME || "My Land";
  const landDomain = process.env.LAND_DOMAIN || "localhost";

  const landRoot = new Node({
    name: landName,
    rootOwner: "SYSTEM",
    parent: null,
    systemRole: SYSTEM_ROLE.LAND_ROOT,
    children: [],
    contributors: [],
    status: NODE_STATUS.ACTIVE,
  });
  await landRoot.save();

  const identityNode = new Node({
    name: ".identity",
    parent: landRoot._id,
    systemRole: SYSTEM_ROLE.IDENTITY,
    children: [],
    contributors: [],
    status: NODE_STATUS.ACTIVE,
    metadata: new Map([
      ["domain", landDomain],
    ]),
  });
  await identityNode.save();

  const configNode = new Node({
    name: ".config",
    parent: landRoot._id,
    systemRole: SYSTEM_ROLE.CONFIG,
    children: [],
    contributors: [],
    status: NODE_STATUS.ACTIVE,
    metadata: new Map([
      ["LAND_NAME", landName],
      ["landUrl", `http://${landDomain}:${process.env.PORT || 3000}`],
    ]),
  });
  await configNode.save();

  const peersNode = new Node({
    name: ".peers",
    parent: landRoot._id,
    systemRole: SYSTEM_ROLE.PEERS,
    children: [],
    contributors: [],
    status: NODE_STATUS.ACTIVE,
  });
  await peersNode.save();

  const extensionsNode = new Node({
    name: ".extensions",
    parent: landRoot._id,
    systemRole: SYSTEM_ROLE.EXTENSIONS,
    children: [],
    contributors: [],
    status: NODE_STATUS.ACTIVE,
  });
  await extensionsNode.save();

  const flowNode = new Node({
    name: ".flow",
    parent: landRoot._id,
    systemRole: SYSTEM_ROLE.FLOW,
    children: [],
    contributors: [],
    status: NODE_STATUS.ACTIVE,
  });
  await flowNode.save();

  landRoot.children = [identityNode._id, configNode._id, peersNode._id, extensionsNode._id, flowNode._id];

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

  log.verbose("Land",
    `[Land] Created Land root (${landRoot._id}) with ${orphanRoots.length} migrated tree(s)`
  );
  return landRoot;
}

/**
 * Get cached Land root node. Lazy-loads from DB if needed.
 */
export async function getLandRoot() {
  if (landRootCache) return landRootCache;
  landRootCache = await Node.findOne({ systemRole: SYSTEM_ROLE.LAND_ROOT });
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

/**
 * Sync loaded extensions to the .extensions system node.
 * Creates/updates a child node per extension with manifest as notes and status as values.
 * Called after extension loading is complete.
 */
export async function syncExtensionsToTree(manifests) {
  const extNode = await Node.findOne({ systemRole: SYSTEM_ROLE.EXTENSIONS });
  if (!extNode) return; // Land root not bootstrapped yet

  // Get existing extension child nodes
  const existingChildren = await Node.find({
    _id: { $in: extNode.children },
  }).select("_id name").lean();

  const existingByName = new Map();
  for (const c of existingChildren) existingByName.set(c.name, c._id);

  const currentNames = new Set();

  for (const manifest of manifests) {
    currentNames.add(manifest.name);

    const values = new Map();
    values.set("loaded", 1);
    if (manifest.provides?.routes) values.set("routes", 1);
    if (manifest.provides?.tools) values.set("tools", 1);
    if (manifest.provides?.jobs) values.set("jobs", 1);
    if (manifest.provides?.cli?.length) values.set("cli_commands", manifest.provides.cli.length);

    // Version is a string, can't go in values (numbers only). Store in metadata.
    const metadata = { version: manifest.version || "0.0.0" };
    if (manifest.description) metadata.description = manifest.description;

    if (existingByName.has(manifest.name)) {
      // Update existing
      const nodeId = existingByName.get(manifest.name);
      await Node.findByIdAndUpdate(nodeId, {
        $set: {
          type: "resource",
          status: NODE_STATUS.ACTIVE,
          metadata,
        },
      });
    } else {
      // Create new
      const child = new Node({
        name: manifest.name,
        parent: extNode._id,
        type: "resource",
        status: NODE_STATUS.ACTIVE,
        children: [],
        contributors: [],
        metadata,
      });
      await child.save();
      extNode.children.push(child._id);
    }
  }

  // Mark unloaded extensions as trimmed
  for (const [name, nodeId] of existingByName) {
    if (!currentNames.has(name)) {
      await Node.findByIdAndUpdate(nodeId, {
        $set: { status: NODE_STATUS.TRIMMED },
      });
    }
  }

  await extNode.save();
}
