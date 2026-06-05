// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Graft. Apply a replicate bundle into this reality, producing fresh
// spaces / beings / matter with new local IDs.
//
// The graft is the inverse of replicate:
//
//   - Each captured aggregate gets a fresh uuid in the target's
//     namespace.
//   - Refs inside content get remapped from sourceId-keyed Refs to the
//     fresh bare-string ids (or sentinels resolve to the operator /
//     insertion point).
//   - Facts get stamped in dependency order: spaces first (parents
//     before children), beings next, matter last.
//
// Conflict resolution (v1):
//
//   - Name collision in the insertion-point's children: refuse with a
//     specific error. The operator chooses (rename in the bundle,
//     graft elsewhere, or delete the conflicting child first). Future
//     versions can wire the merge mediator.
//
// History does not transfer. A grafted subtree begins its life on the
// target's reels at the moment of the graft; subsequent reads see
// fresh facts only. The bundle's sourceReality / sourceBranch are
// recorded in the graft-completed meta-fact for audit, not replayed.

import { v4 as uuidv4 } from "uuid";
import { isSentinelRef, isAggregateRef, refKind, refId } from "../ref.js";
import { remapRefs } from "../refWalker.js";
import { assertValidBundle } from "./bundle.js";
import { emitFact } from "../../past/fact/facts.js";

/**
 * Graft a replicate bundle into the target.
 *
 * @param {object} bundle              the replicate bundle
 * @param {string} targetParentSpaceId where to insert (the new subtree's parent)
 * @param {object} opts
 * @param {string} opts.operatorBeingId  who is grafting (must be authenticated; used for GRAFT_INITIATOR + audit)
 * @param {string} [opts.branch]       target branch (default "0")
 * @param {object} [opts.summonCtx]    if invoked inside an existing moment; otherwise the eager-fold singleton path is used
 * @returns {Promise<{ rootSpaceId, counts, remapTable }>}
 */
export async function graftReplicate(bundle, targetParentSpaceId, opts = {}) {
  assertValidBundle(bundle);
  if (!targetParentSpaceId || typeof targetParentSpaceId !== "string") {
    throw new Error("graftReplicate: targetParentSpaceId is required");
  }
  if (!opts.operatorBeingId || typeof opts.operatorBeingId !== "string") {
    throw new Error("graftReplicate: opts.operatorBeingId is required (identifies the grafter for GRAFT_INITIATOR + audit)");
  }
  const branch = opts.branch || "0";

  const { loadProjection } = await import("../projections.js");
  const { default: Projection } = await import("../branch/projection.js");

  // ── 1. Verify the target parent space exists. ──
  const targetParentSlot = await loadProjection("space", targetParentSpaceId, branch);
  if (!targetParentSlot) {
    throw new Error(`graftReplicate: target parent space "${targetParentSpaceId}" not found in branch "${branch}"`);
  }
  if (targetParentSlot.state?.seedSpace) {
    throw new Error(`graftReplicate: cannot graft under seed space "${targetParentSlot.state.seedSpace}"`);
  }

  // ── 2. Conflict check: name collision at the insertion point. ──
  // The bundle's scope root will land as a child of targetParentSpaceId.
  // Refuse if a sibling with the same name already exists.
  const rootBundleSpace = bundle.content.spaces.find(
    (s) => s.sourceId === bundle.meta.sourceScopeSpaceId,
  );
  if (!rootBundleSpace) {
    throw new Error("graftReplicate: bundle.content.spaces is missing the scope root");
  }
  const targetSiblings = await Projection.find({
    branch, type: "space",
    "state.parent": targetParentSpaceId,
    "state.name": rootBundleSpace.name,
    tombstoned: { $ne: true },
  }).select("id").lean();
  if (targetSiblings.length > 0) {
    throw new Error(
      `graftReplicate: a sibling named "${rootBundleSpace.name}" already exists at the insertion point. ` +
      `Rename the bundle's scope root, graft into a different parent, or remove the conflicting sibling first.`,
    );
  }

  // ── 3. Build the remap table. ──
  // Each bundle aggregate gets a fresh uuid. The remap table feeds the
  // walker (`remapRefs`) when we substitute Refs in each entry's fields.
  const remapTable = new Map();  // sourceId → newLocalId
  for (const s of bundle.content.spaces) remapTable.set(s.sourceId, uuidv4());
  for (const b of bundle.content.beings) remapTable.set(b.sourceId, uuidv4());
  for (const m of bundle.content.matter) remapTable.set(m.sourceId, uuidv4());

  // The walker callback: turns a Ref or sentinel into a bare-string id
  // (or null). Substrate consumers downstream of the reducers read bare
  // strings; this is the boundary where Refs become bare ids.
  const resolveRef = (r) => {
    if (isSentinelRef(r)) {
      if (refKind(r) === "graft-initiator") return opts.operatorBeingId;
      if (refKind(r) === "insertion-point") return targetParentSpaceId;
      throw new Error(`graftReplicate: unknown sentinel kind "${refKind(r)}"`);
    }
    if (isAggregateRef(r)) {
      const sourceId = r.id;
      const newId = remapTable.get(sourceId);
      if (!newId) {
        throw new Error(`graftReplicate: bundle references unknown sourceId "${sourceId}" (not in content)`);
      }
      // Return the bare-string id; the receiver substrate stores bare.
      return newId;
    }
    return r;
  };

  // remapInBundleField walks an arbitrary content value and substitutes
  // every Ref / sentinel with its resolved bare-string id. Plain values
  // (numbers, strings, etc.) pass through unchanged.
  const remapInBundleField = (value) => remapRefs(value, resolveRef);

  // ── 4. Stamp create-space facts in depth order. ──
  // bundle.content.spaces is already depth-ordered by replicateSubtree;
  // we trust that. Each space's parent is either INSERTION_POINT (→
  // targetParentSpaceId) or another bundle space (→ remapTable lookup).
  const counts = { spaces: 0, beings: 0, matter: 0 };
  let rootSpaceId = null;

  for (const s of bundle.content.spaces) {
    const newId = remapTable.get(s.sourceId);
    if (!rootSpaceId) rootSpaceId = newId;  // first space (depth 0) is the graft root

    const spec = {
      name:         s.name,
      type:         s.type,
      parent:       remapInBundleField(s.parent),
      rootOwner:    remapInBundleField(s.rootOwner),
      qualities:    remapInBundleField(s.qualities),
      ...(s.size  ? { size:  s.size }  : {}),
      ...(s.coord ? { coord: s.coord } : {}),
    };
    // contributors: array; remap entry-by-entry.
    if (Array.isArray(s.contributors) && s.contributors.length > 0) {
      spec.contributors = s.contributors.map(remapInBundleField);
    }
    await emitFact({
      verb:    "do",
      action:  "create-space",
      beingId: opts.operatorBeingId,
      target:  { kind: "space", id: newId },
      params:  { spec },
      actId:   opts.summonCtx?.actId || null,
      branch,
    }, opts.summonCtx);
    counts.spaces++;
  }

  // ── 5. Stamp be:birth facts for each captured being. ──
  for (const b of bundle.content.beings) {
    const newId = remapTable.get(b.sourceId);
    const spec = {
      name:          b.name,
      // Beings in the bundle are non-human (replicateSubtree filtered
      // password-bearing ones). Birth needs a password field on the
      // reducer path; we plant an empty hash since these beings can't
      // be auth-driven by humans anyway.
      password:      "",
      defaultRole:   b.defaultRole || null,
      cognition:     "scripted",  // v1 default; future revisions can carry cognition in bundle
      parentBeingId: remapInBundleField(b.parentBeingId),
      homeSpace:     remapInBundleField(b.homeSpace),
      position:      remapInBundleField(b.position),
      qualities:     remapInBundleField(b.qualities),
      ...(b.coord ? { coord: b.coord } : {}),
    };
    await emitFact({
      verb:    "be",
      action:  "birth",
      beingId: newId,  // self-stamping — the new being is its own actor at birth
      target:  { kind: "being", id: newId },
      params:  { spec },
      actId:   opts.summonCtx?.actId || null,
      branch,
    }, opts.summonCtx);
    counts.beings++;
  }

  // ── 6. Stamp create-matter facts. ──
  // Matter depth: parentMatterId chains within the bundle; we need
  // parents-before-children order. The bundle preserves source order
  // which isn't depth-guaranteed; sort here for safety.
  const matterById = new Map(bundle.content.matter.map((m) => [m.sourceId, m]));
  const matterDepth = new Map();
  const computeMatterDepth = (m) => {
    if (matterDepth.has(m.sourceId)) return matterDepth.get(m.sourceId);
    const parentRef = m.parentMatterId;
    if (!isAggregateRef(parentRef)) {
      matterDepth.set(m.sourceId, 0);
      return 0;
    }
    const parent = matterById.get(parentRef.id);
    if (!parent) {
      matterDepth.set(m.sourceId, 0);
      return 0;
    }
    const d = 1 + computeMatterDepth(parent);
    matterDepth.set(m.sourceId, d);
    return d;
  };
  for (const m of bundle.content.matter) computeMatterDepth(m);
  const orderedMatter = [...bundle.content.matter].sort(
    (a, b) => (matterDepth.get(a.sourceId) || 0) - (matterDepth.get(b.sourceId) || 0),
  );

  for (const m of orderedMatter) {
    const newId = remapTable.get(m.sourceId);
    const spec = {
      name:           m.name,
      origin:         m.origin || "ibp",
      content:        remapInBundleField(m.content),
      spaceId:        remapInBundleField(m.spaceId),
      beingId:        remapInBundleField(m.beingId),
      parentMatterId: remapInBundleField(m.parentMatterId),
      qualities:      remapInBundleField(m.qualities),
    };
    await emitFact({
      verb:    "do",
      action:  "create-matter",
      beingId: opts.operatorBeingId,
      target:  { kind: "matter", id: newId },
      params:  { spec },
      actId:   opts.summonCtx?.actId || null,
      branch,
    }, opts.summonCtx);
    counts.matter++;
  }

  // ── 7. Stamp a graft-completed meta-fact on the new root's reel. ──
  // Records provenance: where this came from, who applied it, what
  // counts landed. Read-side audit only; doesn't drive any reducer.
  await emitFact({
    verb:    "do",
    action:  "graft-completed",
    beingId: opts.operatorBeingId,
    target:  { kind: "space", id: rootSpaceId },
    params:  {
      sourceReality:      bundle.meta.sourceReality || null,
      sourceBranch:       bundle.meta.sourceBranch || null,
      sourceScopeSpaceId: bundle.meta.sourceScopeSpaceId || null,
      sourceScopeName:    bundle.meta.sourceScopeName || null,
      bundleCreatedAt:    bundle.meta.createdAt || null,
      counts,
    },
    actId:  opts.summonCtx?.actId || null,
    branch,
  }, opts.summonCtx);

  return {
    rootSpaceId,
    counts,
    // remapTable converted to a plain object for the wire return.
    remapTable: Object.fromEntries(remapTable),
  };
}
