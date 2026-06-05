// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Replicate. Walk a subtree's current projection state and produce a
// portable bundle that another reality (or another part of this one)
// can graft.
//
// Replicate is a projection-walker, not a chain-walker. It captures
// the subtree's CURRENT shape: what would appear in a SEE descriptor
// at the scope root, recursively. History does not transfer.
//
// Inside the bundle:
//
//   - Spaces, beings, and matter become content entries, each with a
//     `sourceId` that other entries Ref against. The walker doesn't see
//     bare-string IDs inside the bundle — every reference to an
//     aggregate is a `{ __ref, id }` whose id is a sourceId.
//
//   - References that point OUTSIDE the captured subtree are replaced
//     with sentinels:
//       * `REF_INSERTION_POINT` for the scope root's own parent (the
//         graft target fills it in at apply time)
//       * `REF_GRAFT_INITIATOR` for beings/owners outside the subtree
//         (the operator who runs the graft fills it in)
//
// Skip rules (v1):
//
//   - Beings with `password` set (human-cognition) are skipped. Passwords
//     don't replicate; humans can't be portable. A future "ghost being"
//     mechanism might mint a placeholder identity on graft, but v1 stays
//     conservative.
//   - Seed spaces (dot-namespace) are skipped — they're substrate
//     furniture, not user content.
//
// See `bundle.js` for the bundle shape; see `graft.js` for the apply
// side.

import { ref, REF_INSERTION_POINT, REF_GRAFT_INITIATOR } from "../ref.js";
import { remapRefs } from "../refWalker.js";
import { emptyBundle } from "./bundle.js";

/**
 * Replicate the subtree rooted at `scopeSpaceId` into a bundle.
 *
 * @param {string} scopeSpaceId       bare space-id of the subtree root
 * @param {object} opts
 * @param {string} [opts.branch]      branch to snapshot (default "0")
 * @param {string} [opts.scopeName]   human-friendly label for the bundle meta
 * @param {string} [opts.sourceReality] reality domain (for meta)
 * @param {string} [opts.operatorBeingId] who initiated (for audit meta)
 * @returns {Promise<object>} the bundle
 */
export async function replicateSubtree(scopeSpaceId, opts = {}) {
  if (!scopeSpaceId || typeof scopeSpaceId !== "string") {
    throw new Error("replicateSubtree: scopeSpaceId is required");
  }
  const branch = opts.branch || "0";
  const { loadProjection } = await import("../projections.js");
  const { default: Projection } = await import("../branch/projection.js");

  // Direct projection query for "children of space X in branch B".
  // (The generic findByParent helper is being-specific; spaces don't
  // have a single substrate wrapper, so we query directly here.)
  const findSpaceChildren = async (parentId) => {
    return await Projection.find({
      branch, type: "space",
      "state.parent": parentId,
      tombstoned: { $ne: true },
    }).select("id").lean();
  };

  const rootSlot = await loadProjection("space", scopeSpaceId, branch);
  if (!rootSlot) {
    throw new Error(`replicateSubtree: space "${scopeSpaceId}" not found in branch "${branch}"`);
  }

  const bundle = emptyBundle({
    sourceReality:      opts.sourceReality || null,
    sourceBranch:       branch,
    sourceScopeName:    opts.scopeName || rootSlot.state?.name || null,
    sourceScopeSpaceId: scopeSpaceId,
    operatorBeingId:    opts.operatorBeingId || null,
  });

  // ── 1. Walk the space subtree (BFS, depth-ascending) ──
  // The captured set defines what counts as "inside" the bundle for
  // remap purposes. Anything pointing outside this set becomes a
  // sentinel; anything inside becomes a sourceId-keyed Ref.
  const capturedSpaceIds = new Set();
  const capturedBeingIds = new Set();
  const capturedMatterIds = new Set();

  // Queue: [{ id, parentId, depth }]
  // depth 0 = scope root. We capture root + all descendants.
  const spaceQueue = [{ id: scopeSpaceId, parentId: null, depth: 0 }];
  while (spaceQueue.length > 0) {
    const { id, depth } = spaceQueue.shift();
    if (capturedSpaceIds.has(id)) continue;
    const slot = await loadProjection("space", id, branch);
    if (!slot) continue;
    // Skip seed spaces (dot-namespace) — substrate furniture.
    if (slot.state?.seedSpace) continue;
    capturedSpaceIds.add(id);

    // Queue children for the next pass. countByParent + findByParent
    // give us the per-space children list.
    const children = await findSpaceChildren(id);
    for (const child of children) {
      spaceQueue.push({ id: child.id, parentId: id, depth: depth + 1 });
    }
  }

  // ── 2. Walk beings whose homeSpace is inside the captured set ──
  // findByPosition gets us per-space inhabitants. A being's homeSpace
  // is the canonical "is this in the subtree" question.
  for (const spaceId of capturedSpaceIds) {
    const beingRows = await Projection.find({
      branch, type: "being",
      "state.homeSpace": spaceId,
      tombstoned: { $ne: true },
    }).lean();
    for (const row of beingRows) {
      const state = row.state || {};
      // Skip human-cognition beings (password set). Conservative v1.
      if (state.password) continue;
      capturedBeingIds.add(row.id);
    }
  }

  // ── 3. Walk matter whose spaceId is in the captured set ──
  for (const spaceId of capturedSpaceIds) {
    const matterRows = await Projection.find({
      branch, type: "matter",
      "state.spaceId": spaceId,
      tombstoned: { $ne: true },
    }).lean();
    for (const row of matterRows) {
      capturedMatterIds.add(row.id);
    }
  }

  // ── 4. Build the remap function. ──
  // For each captured aggregate id, produce a Ref whose id is the
  // sourceId (which equals the source-substrate id for v1; future
  // versions might re-key for privacy). For uncaptured ids, use the
  // appropriate sentinel.
  const isCapturedSpace  = (id) => capturedSpaceIds.has(id);
  const isCapturedBeing  = (id) => capturedBeingIds.has(id);
  const isCapturedMatter = (id) => capturedMatterIds.has(id);

  // Build a tagging function: turns a bare-string id (or null) into a
  // Ref (or sentinel, or null). Kind is given by the field's known type.
  const tagId = (kind, id, { uncapturedSentinel }) => {
    if (id === null || id === undefined) return null;
    if (typeof id !== "string") return id;  // already a Ref or other shape; pass through
    const inside =
      kind === "space"  ? isCapturedSpace(id)  :
      kind === "being"  ? isCapturedBeing(id)  :
      kind === "matter" ? isCapturedMatter(id) :
      false;
    if (inside) return ref(kind, id);
    return uncapturedSentinel;
  };

  // Walker for `qualities`: aggregate IDs inside qualities namespaces
  // need tagging too. The walker doesn't know what's an ID without a
  // hint, so for v1 we keep qualities as opaque (substrate doctrine:
  // qualities are extension-defined; the bundle preserves them
  // verbatim). Future versions might let extensions register a
  // namespace-level tagger.

  // ── 5. Capture spaces in depth order. ──
  // Sort by source depth so parents come before children in
  // bundle.content.spaces. The graft side relies on this ordering
  // to stamp create-space facts with already-existing parents.
  const spaceDepth = new Map();
  spaceDepth.set(scopeSpaceId, 0);
  {
    const q = [scopeSpaceId];
    while (q.length > 0) {
      const id = q.shift();
      const kids = await findSpaceChildren(id);
      for (const k of kids) {
        if (capturedSpaceIds.has(k.id) && !spaceDepth.has(k.id)) {
          spaceDepth.set(k.id, (spaceDepth.get(id) || 0) + 1);
          q.push(k.id);
        }
      }
    }
  }
  const orderedSpaceIds = [...capturedSpaceIds].sort(
    (a, b) => (spaceDepth.get(a) || 0) - (spaceDepth.get(b) || 0),
  );

  for (const spaceId of orderedSpaceIds) {
    const slot = await loadProjection("space", spaceId, branch);
    if (!slot) continue;
    const state = slot.state || {};
    bundle.content.spaces.push({
      sourceId:     spaceId,
      name:         state.name || null,
      type:         state.type || null,
      // parent → INSERTION_POINT if it's the scope root (its parent
      // sits outside); otherwise it's another captured space.
      parent:       spaceId === scopeSpaceId
        ? REF_INSERTION_POINT
        : tagId("space", state.parent, { uncapturedSentinel: REF_INSERTION_POINT }),
      // rootOwner → GRAFT_INITIATOR if the original owner was outside
      // the bundle (or was the I_AM); a being inside the bundle keeps
      // the Ref so the graft remap table preserves the relationship.
      rootOwner:    tagId("being", state.rootOwner, { uncapturedSentinel: REF_GRAFT_INITIATOR }),
      contributors: Array.isArray(state.contributors)
        ? state.contributors.map((c) => tagId("being", c, { uncapturedSentinel: REF_GRAFT_INITIATOR }))
        : [],
      size:         state.size || null,
      coord:        state.coord || null,
      qualities:    state.qualities || {},
    });
  }

  // ── 6. Capture beings ──
  for (const beingId of capturedBeingIds) {
    const slot = await loadProjection("being", beingId, branch);
    if (!slot) continue;
    const state = slot.state || {};
    bundle.content.beings.push({
      sourceId:      beingId,
      name:          state.name || null,
      defaultRole:   state.defaultRole || null,
      parentBeingId: tagId("being", state.parentBeingId, { uncapturedSentinel: REF_GRAFT_INITIATOR }),
      homeSpace:     tagId("space", state.homeSpace, { uncapturedSentinel: REF_INSERTION_POINT }),
      position:      tagId("space", state.position, { uncapturedSentinel: REF_INSERTION_POINT }),
      coord:         state.coord || null,
      qualities:     state.qualities || {},
    });
  }

  // ── 7. Capture matter ──
  for (const matterId of capturedMatterIds) {
    const slot = await loadProjection("matter", matterId, branch);
    if (!slot) continue;
    const state = slot.state || {};
    bundle.content.matter.push({
      sourceId:       matterId,
      name:           state.name || null,
      spaceId:        tagId("space", state.spaceId, { uncapturedSentinel: REF_INSERTION_POINT }),
      beingId:        tagId("being", state.beingId, { uncapturedSentinel: REF_GRAFT_INITIATOR }),
      parentMatterId: tagId("matter", state.parentMatterId, { uncapturedSentinel: null }),
      origin:         state.origin || "ibp",
      content:        state.content || null,
      qualities:      state.qualities || {},
    });
  }

  // ── 8. Stamp completion meta ──
  bundle.meta.createdAt = new Date().toISOString();

  return bundle;
}
