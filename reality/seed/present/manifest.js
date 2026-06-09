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
import { assertBranchOrThrow } from "../materials/projections.js";

// Normalize a qualities container (Map or plain object) into a
// recursively-key-sorted JSON string for stable equality comparison.
// Used by manifestItems to skip redundant set-space facts on reboot.
// Recursive sort handles nested namespaces (qualities.role.permissions etc.).
function canonJson(v) {
  if (v === null || typeof v !== "object") return v;
  if (v instanceof Map) v = Object.fromEntries(v);
  if (Array.isArray(v)) return v.map(canonJson);
  return Object.keys(v).sort().reduce((acc, k) => { acc[k] = canonJson(v[k]); return acc; }, {});
}

function qualitiesDiffer(existingQuals, desiredQuals) {
  return JSON.stringify(canonJson(existingQuals)) !== JSON.stringify(canonJson(desiredQuals));
}

// Stamp a do:birth Fact for a new manifest child Space. Slice C
// (2026-05-23): the legacy Space.create bypass is gone; eager-fold
// inside logFact runs applyCreateSpace + initProjection to
// materialize the row. scaffold-style attribution (I_AM as actor)
// because manifest sync is seed-internal scaffolding — extension
// load runs after I_AM is planted, so the Being row exists.
async function createChildByFact({ parentId, name, type, qualities }) {
  const id = uuidv4();
  const specQualities = qualities instanceof Map
    ? Object.fromEntries(qualities)
    : (qualities || {});
  // One-DO-per-moment doctrine: each create-space is its own act.
  // The wrapping withIAmAct opens a fresh summonCtx so emitFact's
  // counter sees an isolated op, sealAct gets opCount=1.
  const { withIAmAct } = await import("../sprout.js");
  await withIAmAct(`manifest:create ${name}`, async (ctx) => {
    await emitFact({
      verb:    "do",
      action:  "create-space",
      beingId: I_AM,
      target:  { kind: "space", id },
      params:  {
        name,
        type:      type ?? null,
        parent:    String(parentId),
        // No initial owner class — heaven-tier spaces inherit access
        // through the walker.
        qualities: specQualities,
      },
      actId: ctx.actId,
      branch: assertBranchOrThrow(ctx.actorAct?.branch, "manifest(createSpace)"),
    }, ctx);
  });
  return id;
}

// Iterate over a qualities Map / Object and emit one do:set fact per
// namespace key. The reducer derives the per-namespace state from each
// fact; per-reel append lock serializes them.
async function refreshQualitiesByFact(spaceId, qualities) {
  if (!qualities) return;
  const entries = qualities instanceof Map
    ? [...qualities.entries()]
    : Object.entries(qualities);
  if (entries.length === 0) return;
  const { doVerb } = await import("../ibp/verbs/do.js");
  const { loadOrFold } = await import("../materials/projections.js");
  const { withIAmAct } = await import("../sprout.js");
  // One-DO-per-moment doctrine: each namespace write rides its own
  // moment. Setting 3 namespaces on one item = 3 acts on the same
  // reel across 3 moments. Cleaner than one moment with 3 facts —
  // matches the doctrine "each one is a DO, not a group of DOs."
  for (const [ns, value] of entries) {
    await withIAmAct(`manifest:refresh-${ns}`, async (ctx) => {
      const refreshed = await loadOrFold("space", spaceId, ctx.actorAct.branch);
      if (!refreshed) return;
      await doVerb(
        { kind: "space", id: String(refreshed.id) },
        "set-space",
        { field: `qualities.${ns}`, value, merge: false },
        { identity: I_AM, summonCtx: ctx },
      );
    });
  }
}

// do:end-space fact for the child Space. I-Am is the actor. Each
// delete is its own moment so the chain reads cleanly as "I removed
// this", not "I removed N things at once."
async function deleteChildByFact(childId) {
  const { doVerb } = await import("../ibp/verbs/do.js");
  const { withIAmAct } = await import("../sprout.js");
  await withIAmAct(`manifest:delete ${String(childId).slice(0, 8)}`, async (ctx) => {
    await doVerb(
      { kind: "space", id: String(childId) },
      "end-space",
      {},
      { identity: I_AM, summonCtx: ctx },
    );
  });
}

export async function manifestItems({
  heavenSpace,
  items,
  itemType = "resource",
}) {
  // No summonCtx parameter — each per-item write opens its own
  // moment via withIAmAct inside createChildByFact /
  // refreshQualitiesByFact / deleteChildByFact. Callers don't need
  // to wrap (per the one-DO-per-moment doctrine: each item-sync is
  // its own act).
  if (!heavenSpace) throw new Error("manifestItems requires heavenSpace");
  if (!Array.isArray(items)) items = [];

  const { findByHeavenSpace } = await import("../materials/projections.js");
  const parentSlot = await findByHeavenSpace(heavenSpace, "0");
  if (!parentSlot) {
    log.warn(
      "Manifest",
      `place heaven space for ${heavenSpace} not found; skipping sync`,
    );
    return { created: 0, removed: 0, kept: 0 };
  }
  const parent = { _id: parentSlot.id };

  // Children with parent === parentSlot.id and type matching itemType.
  // Direct projection query for the type+parent intersection.
  const { default: Projection } = await import("../materials/branch/projection.js");
  const existingChildren = (await Projection.find({
    branch: "0", type: "space",
    "state.parent": parentSlot.id,
    "state.type": itemType,
    tombstoned: { $ne: true },
  }).select("id state").lean()).map((s) => ({
    _id: s.id,
    name: s.state?.name,
    qualities: s.state?.qualities,
  }));

  const existingByName = new Map(existingChildren.map((c) => [c.name, c]));
  const desiredByName = new Map(items.map((it) => [it.name, it]));

  let created = 0;
  let removed = 0;
  let kept = 0;

  for (const item of items) {
    const existing = existingByName.get(item.name);
    if (existing) {
      // Idempotent skip: if the existing qualities already match the
      // desired ones, don't emit a redundant set-space fact. Without
      // this guard, every reboot re-stamped the full sync state for
      // every tool/role/operation, inflating the chain by ~one fact
      // per registered item per boot.
      //
      // The valid emission cases stay covered: an extension was added
      // (existing miss → create-space below), an extension was removed
      // (existing kept but not desired → delete loop below), or an
      // extension's quality data actually changed (deep-unequal here
      // → fall through to refresh).
      if (item.qualities && qualitiesDiffer(existing.qualities, item.qualities)) {
        await refreshQualitiesByFact(existing._id, item.qualities);
      }
      kept++;
      continue;
    }
    await createChildByFact({
      parentId:  parent._id,
      name:      item.name,
      type:      itemType,
      qualities: item.qualities,
    });
    created++;
  }

  for (const [name, c] of existingByName) {
    if (desiredByName.has(name)) continue;
    await deleteChildByFact(c._id);
    removed++;
  }

  return { created, removed, kept };
}

// Idempotent single-child add/refresh for runtime registrations.
export async function addManifestChild({
  heavenSpace,
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
  const { findByHeavenSpace } = await import("../materials/projections.js");
  const parentSlot = await findByHeavenSpace(heavenSpace, "0");
  if (!parentSlot) return null;
  const parent = { _id: parentSlot.id };
  const { default: Projection } = await import("../materials/branch/projection.js");
  const existing = await Projection.findOne({
    branch: "0", type: "space",
    "state.parent": parentSlot.id,
    "state.name": name,
    "state.type": itemType,
    tombstoned: { $ne: true },
  }).select("id").lean();
  if (existing) {
    if (qualities) {
      await refreshQualitiesByFact(existing.id, qualities, summonCtx);
    }
    return existing.id;
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
  heavenSpace,
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
  const { findByHeavenSpace } = await import("../materials/projections.js");
  const parentSlot = await findByHeavenSpace(heavenSpace, "0");
  if (!parentSlot) return false;
  const { default: Projection } = await import("../materials/branch/projection.js");
  const child = await Projection.findOne({
    branch: "0", type: "space",
    "state.parent": parentSlot.id,
    "state.name": name,
    "state.type": itemType,
    tombstoned: { $ne: true },
  }).select("id").lean();
  if (!child) return false;
  await deleteChildByFact(child.id, summonCtx);
  return true;
}
