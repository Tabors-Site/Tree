// TreeOS Seed — registry mirror.
//
// Bridges in-memory runtime registries (tool defs, role specs, DO
// operations) into the substrate by syncing their contents as children
// of dedicated system Nodes (`.tools`, `.roles`, `.operations`).
//
// Why: per [[project_meta_positions]], every meta-position is a real
// Node row. SEE on `<land>/.tools` goes through the standard descriptor
// pipeline; the children Nodes name the registered tools. No resolver,
// no synthetic addresses.
//
// Sync is one-way: registry → substrate. The registry stays the source
// of truth for runtime lookups (fast, in-memory); the substrate mirror
// is for SEE introspection and audit trails.
//
// Timing: most registrations happen at boot, before ensureLandRoot has
// even run. `syncRegistryToSubstrate` is idempotent and safe to call
// many times; startup.js invokes it once after extensions load. For
// runtime hot-load registrations (later), each registry fires a
// targeted sync to add/remove a single child.

import { v4 as uuidv4 } from "uuid";
import Node from "../models/node.js";
import log from "../core/log.js";

/**
 * Sync a registry to its corresponding `.<name>` system node. The system
 * node must already exist (created in ensureLandRoot).
 *
 * @param {object} opts
 * @param {string} opts.systemRole - SYSTEM_ROLE.<TOOLS|ROLES|OPERATIONS> value
 * @param {Array<{ name, metadata? }>} opts.items - items to mirror as children
 * @param {string} [opts.itemType="resource"] - Node.type for each mirror node
 * @returns {Promise<{ created: number, removed: number, kept: number }>}
 */
export async function syncRegistryToSubstrate({ systemRole, items, itemType = "resource" }) {
  if (!systemRole) throw new Error("syncRegistryToSubstrate requires systemRole");
  if (!Array.isArray(items)) items = [];

  const parent = await Node.findOne({ systemRole });
  if (!parent) {
    log.warn("RegistryMirror", `system node for ${systemRole} not found; skipping sync`);
    return { created: 0, removed: 0, kept: 0 };
  }

  // Existing children of this system node (the previous mirror state).
  const existingChildren = await Node.find({
    parent: parent._id,
    type: itemType,
  }).select("_id name metadata").lean();

  const existingByName = new Map(existingChildren.map((c) => [c.name, c]));
  const desiredByName = new Map(items.map((it) => [it.name, it]));

  let created = 0;
  let removed = 0;
  let kept = 0;

  // Add or update each desired item.
  for (const item of items) {
    const existing = existingByName.get(item.name);
    if (existing) {
      // Item already mirrored. Refresh metadata if it changed.
      if (item.metadata) {
        await Node.updateOne(
          { _id: existing._id },
          { $set: { metadata: item.metadata } },
        );
      }
      kept++;
      continue;
    }
    // Add new child Node.
    const child = await Node.create({
      _id: uuidv4(),
      name: item.name,
      type: itemType,
      parent: parent._id,
      children: [],
      contributors: [],
      ...(item.metadata ? { metadata: item.metadata } : {}),
    });
    await Node.updateOne(
      { _id: parent._id },
      { $addToSet: { children: child._id } },
    );
    created++;
  }

  // Remove children that no longer exist in the registry.
  for (const [name, c] of existingByName) {
    if (desiredByName.has(name)) continue;
    await Node.deleteOne({ _id: c._id });
    await Node.updateOne(
      { _id: parent._id },
      { $pull: { children: c._id } },
    );
    removed++;
  }

  return { created, removed, kept };
}

/**
 * Add (or refresh) a single mirror child Node. Used for runtime
 * registrations that happen after boot. Idempotent.
 */
export async function addRegistryChild({ systemRole, name, metadata = null, itemType = "resource" }) {
  if (!name) return null;
  const parent = await Node.findOne({ systemRole });
  if (!parent) return null;
  const existing = await Node.findOne({ parent: parent._id, name, type: itemType }).select("_id").lean();
  if (existing) {
    if (metadata) {
      await Node.updateOne({ _id: existing._id }, { $set: { metadata } });
    }
    return existing._id;
  }
  const child = await Node.create({
    _id: uuidv4(),
    name,
    type: itemType,
    parent: parent._id,
    children: [],
    contributors: [],
    ...(metadata ? { metadata } : {}),
  });
  await Node.updateOne(
    { _id: parent._id },
    { $addToSet: { children: child._id } },
  );
  return child._id;
}

/**
 * Remove a mirror child Node by name. Idempotent.
 */
export async function removeRegistryChild({ systemRole, name, itemType = "resource" }) {
  if (!name) return false;
  const parent = await Node.findOne({ systemRole });
  if (!parent) return false;
  const child = await Node.findOne({ parent: parent._id, name, type: itemType }).select("_id").lean();
  if (!child) return false;
  await Node.deleteOne({ _id: child._id });
  await Node.updateOne(
    { _id: parent._id },
    { $pull: { children: child._id } },
  );
  return true;
}
