// TreeOS Seed . AGPL-3.0 . https://treeos.ai
// Land root bootstrap. Creates the land root and all system nodes on first boot.
// Idempotent: runs every boot but only creates what's missing.
// This is the foundation. If this fails, nothing works.

import log from "./core/log.js";
import Node from "./models/node.js";
import { SYSTEM_ROLE, SYSTEM_OWNER } from "./core/protocol.js";

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
  // Registry-mirror system nodes. Children are added/removed when
  // tools / roles / DO operations register or unregister. SEE on
  // `<land>/.tools` etc. returns the live registry via the standard
  // descriptor pipeline.
  { name: ".tools",      systemRole: SYSTEM_ROLE.TOOLS },
  { name: ".roles",      systemRole: SYSTEM_ROLE.ROLES },
  { name: ".operations", systemRole: SYSTEM_ROLE.OPERATIONS },
  // The .source self-tree. Children are filesystem-origin artifacts in
  // a recursive tree mirroring land/. Populated by seed/source.js at
  // boot. Read-only: DO writes against artifacts under this node reject
  // with ORIGIN_READ_ONLY.
  { name: ".source",     systemRole: SYSTEM_ROLE.SOURCE },
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
 * Check if a node is a user-created tree root.
 * A tree root is: parent is land root, has rootOwner that isn't SYSTEM, no systemRole.
 * This is the single source of truth. Use it everywhere.
 */
export function isBeingRoot(node) {
  if (!node) return false;
  if (node.systemRole) return false;
  if (!node.rootOwner || String(node.rootOwner) === SYSTEM_OWNER) return false;
  const landId = getLandRootId();
  if (landId && node.parent && String(node.parent) !== String(landId)) return false;
  return true;
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

    // Substrate is the source of truth for "what's installed here":
    // mirror enough manifest fields so SEE on `<land>/.extensions/<name>`
    // returns the extension's full surface (capabilities, deps, version,
    // scope flags). Clients introspect via standard ibp:see; no legacy
    // /land/extensions endpoint needed. See [[project_meta_positions]].
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
      await Node.findByIdAndUpdate(existingByName.get(manifest.name), {
        $set: { type: "resource", metadata },
      });
    } else {
      try {
        const child = new Node({
          name: manifest.name,
          parent: extNode._id,
          type: "resource",
          children: [],
          contributors: [],
          metadata,
        });
        await child.save();
        await Node.findByIdAndUpdate(extNode._id, { $addToSet: { children: child._id } });
        childrenChanged = true;
      } catch (err) {
        log.error("Land", `Failed to sync extension node "${manifest.name}": ${err.message}`);
      }
    }
  }

  // Unloaded extensions: mark via extension-owned metadata namespace
  // (kernel doesn't carry a universal "trimmed" status anymore).
  for (const [name, nodeId] of existingByName) {
    if (!currentNames.has(name)) {
      await Node.findByIdAndUpdate(nodeId, {
        $set: { "metadata.extension.loaded": false },
      });
    }
  }

  // Only save extNode if we need to update something other than children
  // (children are updated atomically via $addToSet above)
}
