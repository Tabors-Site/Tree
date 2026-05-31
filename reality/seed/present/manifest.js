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
import log from "../seedReality/log.js";
import { emitFact } from "../past/fact/facts.js";
import { I_AM } from "../materials/being/seedBeings.js";

// Stamp a do:birth Fact for a new manifest child Space. Slice C
// (2026-05-23): the legacy Space.create bypass is gone; eager-fold
// inside logFact runs applyCreateSpace + initProjection to
// materialize the row. scaffold-style attribution (I_AM as actor)
// because manifest sync is seed-internal scaffolding — extension
// load runs after I_AM is planted, so the Being row exists.
async function createChildByFact({ parentId, name, type, qualities, summonCtx }) {
  const id = uuidv4();
  const specQualities = qualities instanceof Map
    ? Object.fromEntries(qualities)
    : (qualities || {});
  await emitFact({
    verb:    "do",
    action:  "create-space",
    beingId: I_AM,
    target:  { kind: "space", id },
    params:  {
      spec: {
        name,
        type:      type ?? null,
        parent:    String(parentId),
        rootOwner: null,
        qualities: specQualities,
      },
    },
    actId: summonCtx.actId,
  }, summonCtx);
  return id;
}

// Iterate over a qualities Map / Object and emit one do:set fact per
// namespace key. The reducer derives the per-namespace state from each
// fact; per-reel append lock serializes them.
async function refreshQualitiesByFact(spaceId, qualities, summonCtx) {
  if (!qualities) return;
  const entries = qualities instanceof Map
    ? [...qualities.entries()]
    : Object.entries(qualities);
  if (entries.length === 0) return;
  const { doVerb } = await import("../ibp/verbs/do.js");
  for (const [ns, value] of entries) {
    const refreshed = await Space.findById(spaceId).select("_id").lean();
    if (!refreshed) return;
    await doVerb(
      { kind: "space", id: String(refreshed._id) },
      "set-space",
      { field: `qualities.${ns}`, value, merge: false },
      { scaffold: true, summonCtx },
    );
  }
}

// do:end-space fact for the child Space. I-Am is the actor.
async function deleteChildByFact(childId, summonCtx) {
  const { doVerb } = await import("../ibp/verbs/do.js");
  await doVerb(
    { kind: "space", id: String(childId) },
    "end-space",
    {},
    { scaffold: true, summonCtx },
  );
}

export async function manifestItems({
  seedSpace,
  items,
  itemType = "resource",
  summonCtx,
}) {
  if (!summonCtx) {
    throw new Error(
      "manifestItems requires summonCtx. Wrap the call in withIAmAct(...).",
    );
  }
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
      if (item.qualities) {
        await refreshQualitiesByFact(existing._id, item.qualities, summonCtx);
      }
      kept++;
      continue;
    }
    await createChildByFact({
      parentId:  parent._id,
      name:      item.name,
      type:      itemType,
      qualities: item.qualities,
      summonCtx,
    });
    created++;
  }

  for (const [name, c] of existingByName) {
    if (desiredByName.has(name)) continue;
    await deleteChildByFact(c._id, summonCtx);
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
  summonCtx,
}) {
  if (!summonCtx) {
    throw new Error(
      "addManifestChild requires summonCtx. Wrap the call in withIAmAct(...).",
    );
  }
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
      await refreshQualitiesByFact(existing._id, qualities, summonCtx);
    }
    return existing._id;
  }
  return await createChildByFact({
    parentId: parent._id,
    name,
    type: itemType,
    qualities,
    summonCtx,
  });
}

export async function removeManifestChild({
  seedSpace,
  name,
  itemType = "resource",
  summonCtx,
}) {
  if (!summonCtx) {
    throw new Error(
      "removeManifestChild requires summonCtx. Wrap the call in withIAmAct(...).",
    );
  }
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
  await deleteChildByFact(child._id, summonCtx);
  return true;
}
