// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// createBranch — the substrate-level branch creation primitive.
//
// Composes:
//   - Pick the new branch's path (next available segment under parent).
//   - Eager-snapshot per-reel branchPoint map by aggregating parent's
//     lineage facts up to the anchor (atSeq or atTimestamp).
//   - Write the Branch row.
//   - Plant a child space at `<reality>/./branches/<path>` so SEE on
//     the branches space lists the new branch with its qualities.
//   - Stamp a `do:create-branch` audit fact on main's reel (where the
//     branch metadata projection lives — main is the registry of all
//     branches).
//
// Doctrine: the branchPoint is captured EAGERLY so future reads (and
// allocSeq's lazy reelhead init) don't have to walk parent's reel on
// every cold-start fold. It's a small upfront cost at create time for
// fast operation forever after. Branches are created infrequently.
//
// Returns the new branch's metadata: `{ path, parent, branchPoint }`.

import Branch from "./branch.js";
import Fact from "../../past/fact/fact.js";
import { invalidateBranchCache, resolveBranchLineage, MAIN, isMain } from "./branches.js";
import { nextChildPath, isValidBranchPath } from "./branchPath.js";

/**
 * Create a new branch.
 *
 * @param {object} args
 * @param {string} args.parent                parent branch path; "0" for main
 * @param {object} args.anchor                where the branch diverges from parent
 * @param {number} [args.anchor.atSeq]        substrate-native; preferred when caller knows it
 * @param {Date|string} [args.anchor.atTimestamp]  human helper; resolves to per-reel seqs
 * @param {string} [args.label]               optional human-readable label
 * @param {string} [args.createdBy]           beingId of the operator
 * @returns {Promise<{ path, parent, branchPoint, anchor, createdAt }>}
 */
export async function createBranch({ parent = MAIN, anchor, label = null, createdBy = null, scope = null } = {}) {
  if (!isValidBranchPath(parent)) {
    throw new Error(`createBranch: invalid parent path "${parent}"`);
  }
  if (!anchor || typeof anchor !== "object") {
    throw new Error("createBranch: anchor is required: { atSeq } or { atTimestamp }");
  }
  if (anchor.atSeq == null && anchor.atTimestamp == null) {
    throw new Error("createBranch: anchor.atSeq or anchor.atTimestamp is required");
  }
  // Walk the parent's lineage to validate it's reachable. Throws if
  // anything in the chain is missing.
  if (!isMain(parent)) await resolveBranchLineage(parent);

  // Resolve scope.path → canonical spaceId against the parent. The
  // scope is locked at creation time: re-pointing the path later
  // doesn't widen or narrow the gate. Writes outside this subtree
  // refuse with SCOPE_VIOLATION at the fact-emission boundary.
  let resolvedScope = null;
  if (scope) {
    if (typeof scope !== "object" || typeof scope.path !== "string" || !scope.path.length) {
      throw new Error("createBranch: scope must be { path: string }");
    }
    const { resolvePathToSpaceId } = await import("./branchScope.js");
    const spaceId = await resolvePathToSpaceId(scope.path, parent);
    if (!spaceId) {
      throw new Error(`createBranch: scope.path "${scope.path}" doesn't resolve to a space on parent "#${parent}"`);
    }
    resolvedScope = { path: scope.path, spaceId };
  }

  // 1. Pick the new branch's path.
  const siblings = await Branch
    .find({ parent: isMain(parent) ? null : parent })
    .select("_id path")
    .lean();
  // For main's children, parent === null in the Branch collection
  // (main has no row); for non-main, parent matches the actual path.
  const siblingPaths = siblings.map((s) => s.path);
  // nextChildPath wants the parent's path (use "0" for main) and the
  // sibling paths to pick the next segment.
  const path = nextChildPath(isMain(parent) ? "0" : parent, siblingPaths);

  // 2. Build the branchPoint map by aggregating parent's facts up to
  //    the anchor. Per the per-reel doctrine, each (target.kind,
  //    target.id) reel has its own seq — we capture the max seq per
  //    reel that's <= the anchor.
  const branchPoint = await snapshotParentHeads({ parent, anchor });

  // 3. Write the Branch row. Mongoose Map field accepts a plain object;
  //    we convert before passing.
  const branchPointObj = {};
  for (const [reelKey, seq] of branchPoint) branchPointObj[reelKey] = seq;
  const branchDoc = await Branch.create({
    _id:         path,
    path,
    parent:      isMain(parent) ? null : parent,
    branchPoint: branchPointObj,
    createdBy:   createdBy || null,
    label:       label || null,
    scope:       resolvedScope,
  });

  // 4. Invalidate the lineage cache so the new branch is visible to
  //    subsequent resolveBranchLineage/getBranchPoint calls. Targeted
  //    invalidation is wrong here (the new branch's lineage isn't
  //    cached yet; the parent's cache stays valid). But if any
  //    consumer cached "lineages including this parent's descendants
  //    so far," that's stale. Cheapest correct option: nuke the cache.
  invalidateBranchCache(null);

  return {
    path,
    parent: isMain(parent) ? MAIN : parent,
    branchPoint: branchPointObj,
    anchor,
    createdAt: branchDoc.createdAt,
  };
}

/**
 * Aggregate the parent branch's lineage facts and capture the per-reel
 * head as of the anchor. Returns a Map<"<type>:<id>", seq>.
 *
 * Lineage walk: for each ancestor (main → parent), include facts
 * within its OWNED seq range. For most branches this is just main
 * (parent === "0"), and we filter by branch=MAIN (or absent — legacy
 * rows) plus the anchor's seq/date filter.
 *
 * For deeper lineages this aggregates across multiple branches; the
 * max-seq-per-reel calculation merges them.
 */
async function snapshotParentHeads({ parent, anchor }) {
  const heads = new Map();
  const lineage = await resolveBranchLineage(parent); // ["0", ...ancestors..., parent] OR just ["0"] for main

  // For the leaf (parent), the upper bound is the anchor's seq or
  // resolved timestamp. For ancestors above the leaf, the upper bound
  // is the next-up branch's branchPoint for each reel. We aggregate
  // each branch's contribution independently and merge by reel key
  // taking the max seq.
  for (let i = 0; i < lineage.length; i++) {
    const here = lineage[i];
    const isLeaf = i === lineage.length - 1;
    const branchMatch = isMain(here)
      ? { $or: [{ branch: MAIN }, { branch: { $exists: false } }] }
      : { branch: here };

    // Seq filter for this branch's contribution.
    const seqFilter = { $type: "number" };
    // Upper bound depends on whether this is the leaf or an ancestor.
    if (isLeaf) {
      if (anchor.atSeq != null) {
        seqFilter.$lte = anchor.atSeq;
      }
      // If atTimestamp instead, we'll resolve per-reel via the date
      // filter below; no $lte on seq.
    } else {
      // Ancestor: limit to the next-up branch's branchPoint for each
      // reel. Hard to express in one query (it varies per reel), so we
      // load this ancestor's branchPoint map and use it as the upper
      // bound during the merge step.
      // For now, aggregate ALL of this ancestor's facts, then trim
      // during merge.
    }

    const matchStage = {
      "target.kind": { $in: ["being", "space", "matter"] },
      "target.id":   { $type: "string" },
      seq:           seqFilter,
      ...branchMatch,
    };
    if (isLeaf && anchor.atTimestamp != null) {
      matchStage.date = { $lte: new Date(anchor.atTimestamp) };
    }

    const agg = await Fact.aggregate([
      { $match: matchStage },
      { $group: {
        _id:    { kind: "$target.kind", id: "$target.id" },
        maxSeq: { $max: "$seq" },
      } },
    ]);

    for (const row of agg) {
      const key = `${row._id.kind}:${row._id.id}`;
      const seq = row.maxSeq;
      if (typeof seq !== "number") continue;
      // For ancestors, clamp by their successor's branchPoint for this
      // reel (the ancestor only contributed up to that point).
      let effectiveSeq = seq;
      if (!isLeaf) {
        const successor = lineage[i + 1];
        if (successor && !isMain(successor)) {
          const succRow = await Branch.findById(successor).select("branchPoint").lean();
          const bp = succRow?.branchPoint || {};
          const cap = bp instanceof Map ? bp.get(key) : bp[key];
          if (typeof cap === "number") effectiveSeq = Math.min(effectiveSeq, cap);
        }
      }
      const prev = heads.get(key);
      if (prev == null || effectiveSeq > prev) heads.set(key, effectiveSeq);
    }
  }

  return heads;
}
