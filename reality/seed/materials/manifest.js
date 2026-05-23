// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// I make my live state manifest in the world I formed.
//
// My in-memory collections (tools, roles, DO operations) are the
// runtime source of truth. I also make them manifest as spaces
// under .tools, .roles, and .operations so SEE can introspect
// them through the same protocol as everything else; each
// registered item becomes a child space. The sync is one-way:
// memory leads; the manifest follows. A manifest miss is
// cosmetic, not a functional break.
//
// Fact-driven (slice F-manifest, 2026-05-23) for the refresh and
// delete paths. The Space.create path (new child) still flows
// through legacy until Slice C-space-full converts the birth
// handler's space branch — at which point the manifest opts
// entirely into the fact stream.

import { v4 as uuidv4 } from "uuid";
import Space from "../materials/space/space.js";
import log from "../parentReality/log.js";

// Iterate over a qualities Map / Object and emit one do:set fact per
// namespace key. The reducer derives the per-namespace state from each
// fact; per-reel append lock serializes them.
async function refreshQualitiesByFact(spaceId, qualities) {
  if (!qualities) return;
  const entries = qualities instanceof Map
    ? [...qualities.entries()]
    : Object.entries(qualities);
  if (entries.length === 0) return;
  const { doVerb } = await import("../ibp/verbs.js");
  for (const [ns, value] of entries) {
    const refreshed = await Space.findById(spaceId);
    if (!refreshed) return;
    await doVerb(
      refreshed,
      "set",
      { field: `qualities.${ns}`, value, merge: false },
      { scaffold: true },
    );
  }
}

// Emit a do:death fact for the child Space. Uses scaffold:true because
// manifest sync is seed-internal (I_AM is the actor reconciling memory
// against the substrate manifestation).
async function deleteChildByFact(childId) {
  const childDoc = await Space.findById(childId);
  if (!childDoc) return;
  const { doVerb } = await import("../ibp/verbs.js");
  await doVerb(childDoc, "death", {}, { scaffold: true });
}

export async function manifestItems({
  seedSpace,
  items,
  itemType = "resource",
}) {
  if (!seedSpace) throw new Error("manifestItems requires seedSpace");
  if (!Array.isArray(items)) items = [];

  const parent = await Space.findOne({ seedSpace });
  if (!parent) {
    log.warn(
      "Manifest",
      `place seed space for ${seedSpace} not found; skipping sync`,
    );
    return { created: 0, removed: 0, kept: 0 };
  }

  const existingChildren = await Space.find({
    parent: parent._id,
    type: itemType,
  })
    .select("_id name qualities")
    .lean();

  const existingByName = new Map(existingChildren.map((c) => [c.name, c]));
  const desiredByName = new Map(items.map((it) => [it.name, it]));

  let created = 0;
  let removed = 0;
  let kept = 0;

  for (const item of items) {
    const existing = existingByName.get(item.name);
    if (existing) {
      // Refresh existing child's qualities. Fact-driven: one fact per
      // namespace; serialized via the per-reel append lock so a SEE in
      // flight sees consistent state.
      if (item.qualities) {
        await refreshQualitiesByFact(existing._id, item.qualities);
      }
      kept++;
      continue;
    }
    // New child: legacy Space.create path until Slice C-space-full
    // converts the birth handler to write through fact-driven space
    // birth. Until then, this is the one mutation in this file that
    // bypasses the fact stream.
    const child = await Space.create({
      _id: uuidv4(),
      name: item.name,
      type: itemType,
      parent: parent._id,
      contributors: [],
      ...(item.qualities ? { qualities: item.qualities } : {}),
    });
    // No parent.children write — parent-side cache retired; the
    // child's `parent` is the single source of truth for the relation.
    created++;
  }

  for (const [name, c] of existingByName) {
    if (desiredByName.has(name)) continue;
    await deleteChildByFact(c._id);
    // No parent.children $pull — the child's parent flips to DELETED
    // inside deleteSpaceBranch; parent-query readers stop seeing it.
    removed++;
  }

  return { created, removed, kept };
}

// Idempotent single-child add/refresh for runtime registrations.
export async function addManifestChild({
  seedSpace,
  name,
  qualities = null,
  itemType = "resource",
}) {
  if (!name) return null;
  const parent = await Space.findOne({ seedSpace });
  if (!parent) return null;
  const existing = await Space.findOne({
    parent: parent._id,
    name,
    type: itemType,
  })
    .select("_id")
    .lean();
  if (existing) {
    if (qualities) {
      await refreshQualitiesByFact(existing._id, qualities);
    }
    return existing._id;
  }
  // New child: legacy Space.create until Slice C-space-full lands.
  const child = await Space.create({
    _id: uuidv4(),
    name,
    type: itemType,
    parent: parent._id,
    contributors: [],
    ...(qualities ? { qualities } : {}),
  });
  // No parent.children write — parent-side cache retired.
  return child._id;
}

export async function removeManifestChild({
  seedSpace,
  name,
  itemType = "resource",
}) {
  if (!name) return false;
  const parent = await Space.findOne({ seedSpace });
  if (!parent) return false;
  const child = await Space.findOne({
    parent: parent._id,
    name,
    type: itemType,
  })
    .select("_id")
    .lean();
  if (!child) return false;
  await deleteChildByFact(child._id);
  // No parent.children $pull — parent-side cache retired.
  return true;
}
