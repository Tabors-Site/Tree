// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// How I show my registries to the world I formed.
//
// My in-memory registries (tools, roles, DO operations) are the
// runtime source of truth. They also surface as spaces under .tools,
// .roles, and .operations so SEE can introspect them through the
// same protocol as everything else; each registered item becomes a
// child space. The sync is one-way: the registry leads; the mirror
// follows. A mirror miss is cosmetic, not a functional break.

import { v4 as uuidv4 } from "uuid";
import Space from "../models/space.js";
import log from "../system/log.js";

export async function syncRegistryToSubstrate({ seedSpace, items, itemType = "resource" }) {
  if (!seedSpace) throw new Error("syncRegistryToSubstrate requires seedSpace");
  if (!Array.isArray(items)) items = [];

  const parent = await Space.findOne({ seedSpace });
  if (!parent) {
    log.warn("RegistryMirror", `land seed space for ${seedSpace} not found; skipping sync`);
    return { created: 0, removed: 0, kept: 0 };
  }

  const existingChildren = await Space.find({
    parent: parent._id,
    type: itemType,
  }).select("_id name qualities").lean();

  const existingByName = new Map(existingChildren.map((c) => [c.name, c]));
  const desiredByName = new Map(items.map((it) => [it.name, it]));

  let created = 0;
  let removed = 0;
  let kept = 0;

  for (const item of items) {
    const existing = existingByName.get(item.name);
    if (existing) {
      if (item.qualities) {
        await Space.updateOne(
          { _id: existing._id },
          { $set: { qualities: item.qualities } },
        );
      }
      kept++;
      continue;
    }
    const child = await Space.create({
      _id: uuidv4(),
      name: item.name,
      type: itemType,
      parent: parent._id,
      children: [],
      contributors: [],
      ...(item.qualities ? { qualities: item.qualities } : {}),
    });
    await Space.updateOne(
      { _id: parent._id },
      { $addToSet: { children: child._id } },
    );
    created++;
  }

  for (const [name, c] of existingByName) {
    if (desiredByName.has(name)) continue;
    await Space.deleteOne({ _id: c._id });
    await Space.updateOne(
      { _id: parent._id },
      { $pull: { children: c._id } },
    );
    removed++;
  }

  return { created, removed, kept };
}

// Idempotent single-child add/refresh for runtime registrations.
export async function addRegistryChild({ seedSpace, name, qualities = null, itemType = "resource" }) {
  if (!name) return null;
  const parent = await Space.findOne({ seedSpace });
  if (!parent) return null;
  const existing = await Space.findOne({ parent: parent._id, name, type: itemType }).select("_id").lean();
  if (existing) {
    if (qualities) {
      await Space.updateOne({ _id: existing._id }, { $set: { qualities } });
    }
    return existing._id;
  }
  const child = await Space.create({
    _id: uuidv4(),
    name,
    type: itemType,
    parent: parent._id,
    children: [],
    contributors: [],
    ...(qualities ? { qualities } : {}),
  });
  await Space.updateOne(
    { _id: parent._id },
    { $addToSet: { children: child._id } },
  );
  return child._id;
}

export async function removeRegistryChild({ seedSpace, name, itemType = "resource" }) {
  if (!name) return false;
  const parent = await Space.findOne({ seedSpace });
  if (!parent) return false;
  const child = await Space.findOne({ parent: parent._id, name, type: itemType }).select("_id").lean();
  if (!child) return false;
  await Space.deleteOne({ _id: child._id });
  await Space.updateOne(
    { _id: parent._id },
    { $pull: { children: child._id } },
  );
  return true;
}
