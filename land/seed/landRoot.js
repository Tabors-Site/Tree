// TreeOS Seed . AGPL-3.0 . https://treeos.ai
// Land root bootstrap. Creates the land root and all system nodes on first boot.
// Idempotent: runs every boot but only creates what's missing.
// This is the foundation. If this fails, nothing works.

import log from "./log.js";
import Node from "./models/node.js";
import { NODE_STATUS, SYSTEM_ROLE, SYSTEM_OWNER } from "./protocol.js";

let landRootCache = null;

// ─────────────────────────────────────────────────────────────────────────
// SYSTEM NODE DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────
// Every system node that must exist under the land root.
// If any is missing on boot, it's created. This covers both first boot
// and recovery from partial failures (crash between saves).

const SYSTEM_NODES = [
  { name: ".identity", systemRole: SYSTEM_ROLE.IDENTITY, buildMetadata: () => {
    const domain = process.env.LAND_DOMAIN || "localhost";
    return new Map([["domain", domain]]);
  }},
  { name: ".config", systemRole: SYSTEM_ROLE.CONFIG, buildMetadata: () => {
    const name = process.env.LAND_NAME || "My Land";
    const domain = process.env.LAND_DOMAIN || "localhost";
    return new Map([
      ["LAND_NAME", name],
      ["landUrl", `http://${domain}:${process.env.PORT || 3000}`],
    ]);
  }},
  { name: ".peers", systemRole: SYSTEM_ROLE.PEERS },
  { name: ".extensions", systemRole: SYSTEM_ROLE.EXTENSIONS },
  { name: ".flow", systemRole: SYSTEM_ROLE.FLOW },
];

// ─────────────────────────────────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────────────────────────────────

/**
 * Bootstrap the Land root and system nodes. Idempotent.
 * Called once at startup after DB connects.
 *
 * On first boot: creates everything.
 * On subsequent boots: verifies all system nodes exist under the land root.
 * If any are missing (crash during first boot, manual deletion), they're recreated.
 */
export async function ensureLandRoot() {
  let landRoot = await Node.findOne({ systemRole: SYSTEM_ROLE.LAND_ROOT });

  if (!landRoot) {
    // First boot. Create the land root.
    const landName = process.env.LAND_NAME || "My Land";
    landRoot = new Node({
      name: landName,
      rootOwner: SYSTEM_OWNER,
      parent: null,
      systemRole: SYSTEM_ROLE.LAND_ROOT,
      children: [],
      contributors: [],
      status: NODE_STATUS.ACTIVE,
    });
    await landRoot.save();
    log.info("Land", `Created land root: ${landRoot._id}`);
  }

  // Ensure every system node exists. This covers first boot AND recovery
  // from partial failures where some nodes were created before a crash.
  let childrenChanged = false;
  for (const def of SYSTEM_NODES) {
    let node = await Node.findOne({ systemRole: def.systemRole });

    if (!node) {
      // System node missing. Create it.
      node = new Node({
        name: def.name,
        parent: landRoot._id,
        systemRole: def.systemRole,
        children: [],
        contributors: [],
        status: NODE_STATUS.ACTIVE,
        ...(def.buildMetadata ? { metadata: def.buildMetadata() } : {}),
      });
      try {
        await node.save();
        log.info("Land", `Created system node: ${def.name}`);
      } catch (err) {
        log.error("Land", `Failed to create ${def.name}: ${err.message}. Boot continues.`);
        continue;
      }
    }

    // Verify parent is correct. If someone moved a system node to a wrong
    // location (manual DB edit, corruption), move it back.
    if (node.parent && node.parent.toString() !== landRoot._id.toString()) {
      log.warn("Land", `System node ${def.name} has wrong parent. Repairing.`);
      await Node.findByIdAndUpdate(node._id, { $set: { parent: landRoot._id } });
    }

    // Ensure it's in the land root's children array
    const childIds = landRoot.children.map(String);
    if (!childIds.includes(String(node._id))) {
      landRoot.children.push(node._id);
      childrenChanged = true;
    }
  }

  // Adopt orphan user roots (parent: null) under the land root
  try {
    const orphanRoots = await Node.find({
      rootOwner: { $nin: [null, SYSTEM_OWNER] },
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
  log.verbose("Land", `Land root verified: ${landRoot._id} (${landRoot.children.length} children)`);
  return landRoot;
}

// ─────────────────────────────────────────────────────────────────────────
// ACCESSORS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get the Land root node. Lazy-loads from DB if not cached.
 * Returns a lean copy to prevent cache mutation.
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
  return !!node?.rootOwner && node.rootOwner !== SYSTEM_OWNER;
}

// ─────────────────────────────────────────────────────────────────────────
// EXTENSION SYNC
// ─────────────────────────────────────────────────────────────────────────

/**
 * Sync loaded extensions to the .extensions system node.
 * Creates/updates a child node per extension.
 * Called after extension loading is complete.
 */
export async function syncExtensionsToTree(manifests) {
  const extNode = await Node.findOne({ systemRole: SYSTEM_ROLE.EXTENSIONS });
  if (!extNode) return;

  const existingChildren = await Node.find({
    _id: { $in: extNode.children },
  }).select("_id name").lean();

  const existingByName = new Map();
  for (const c of existingChildren) existingByName.set(c.name, c._id);

  const currentNames = new Set();
  let childrenChanged = false;

  for (const manifest of manifests) {
    currentNames.add(manifest.name);

    const metadata = { version: manifest.version || "0.0.0" };
    if (manifest.description) metadata.description = manifest.description;

    if (existingByName.has(manifest.name)) {
      await Node.findByIdAndUpdate(existingByName.get(manifest.name), {
        $set: { type: "resource", status: NODE_STATUS.ACTIVE, metadata },
      });
    } else {
      try {
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
        // Use atomic $addToSet instead of in-memory push + single save.
        // If this save fails, the child exists but isn't in children[].
        // The integrity check repairs it. No in-memory corruption.
        await Node.findByIdAndUpdate(extNode._id, { $addToSet: { children: child._id } });
        childrenChanged = true;
      } catch (err) {
        log.error("Land", `Failed to sync extension node "${manifest.name}": ${err.message}`);
      }
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

  // Only save extNode if we need to update something other than children
  // (children are updated atomically via $addToSet above)
}
