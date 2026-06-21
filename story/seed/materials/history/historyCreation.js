// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// createBranch — the substrate-level history creation primitive.
//
// Composes:
//   - Pick the new history's path (next available segment under parent).
//   - Eager-snapshot per-reel branchPoint map by aggregating parent's
//     lineage facts up to the anchor (atSeq or atTimestamp).
//   - Write the History row.
//   - Plant a child space at `<story>/./histories/<path>` so SEE on
//     the histories space lists the new history with its qualities.
//   - Stamp a `do:create-branch` audit fact on main's reel (where the
//     history metadata projection lives — main is the registry of all
//     histories).
//
// Doctrine: the branchPoint is captured EAGERLY so future reads (and
// allocSeq's lazy reelhead init) don't have to walk parent's reel on
// every cold-start fold. It's a small upfront cost at create time for
// fast operation forever after. Histories are created infrequently.
//
// Returns the new history's metadata: `{ path, parent, branchPoint }`.

import History from "./history.js";
import Fact from "../../past/fact/fact.js";
import { invalidateHistoryCache, resolveHistoryLineage, MAIN, isMain } from "./histories.js";
import { nextChildPath, isValidHistoryPath } from "./historyPath.js";

/**
 * Create a new history.
 *
 * @param {object} args
 * @param {string} args.parent                parent history path; "0" for main
 * @param {object} args.anchor                where the history diverges from parent
 * @param {number} [args.anchor.atSeq]        substrate-native; preferred when caller knows it
 * @param {Date|string} [args.anchor.atTimestamp]  human helper; resolves to per-reel seqs
 * @param {string} [args.label]               optional human-readable label
 * @param {string} [args.createdBy]           beingId of the operator
 * @returns {Promise<{ path, parent, branchPoint, anchor, createdAt }>}
 */
export async function createBranch({ parent = MAIN, anchor, label = null, createdBy = null, scope = null } = {}) {
  if (!isValidHistoryPath(parent)) {
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
  if (!isMain(parent)) await resolveHistoryLineage(parent);

  // Resolve scope against the parent. Inheritance + permission asymmetry:
  //
  //   - If the parent branch has no scope, `passed` becomes the scope
  //     (null/undefined → no scope; explicit `{path}` → that subtree).
  //   - If the parent has a scope and `passed` is null/undefined, the
  //     new branch INHERITS the parent's scope. Scope behaves like state
  //     and liveness: a property of the lineage. Forking a library-
  //     scoped branch produces another library-scoped branch by default.
  //   - If the parent has a scope and `passed` is narrower-or-equal
  //     (passed.path resolves to the parent.scope.spaceId itself or to
  //     one of its descendants), use `passed`. Narrowing further is free.
  //   - If `passed` is wider (resolves to an ancestor of parent.scope) OR
  //     disjoint (lives outside parent's subtree entirely) OR explicitly
  //     null/undefined on a scoped parent with the special `clearScope: true`
  //     flag, the operation is widening. Widening requires story-root
  //     permission (heaven owner OR angel role); otherwise refused.
  //
  // The scope is locked at creation: re-pointing the path later doesn't
  // widen or narrow the gate. Writes outside the resolved subtree refuse
  // with SCOPE_VIOLATION at the fact-emission boundary.
  const parentScopeData = isMain(parent)
    ? null
    : ((await History.findOne({ _id: parent }).lean())?.scope || null);
  const resolvedScope = await _resolveHistoryScope({
    passed: scope,
    parentScope: parentScopeData,
    parentHistoryPath: parent,
    createdBy,
  });

  // 1. Pick the new branch's path.
  const siblings = await History
    .find({ parent: isMain(parent) ? null : parent })
    .select("_id path")
    .lean();
  // For main's children, parent === null in the History collection
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

  // 3. Write the History row. Mongoose Map field accepts a plain object;
  //    we convert before passing.
  const branchPointObj = {};
  for (const [reelKey, seq] of branchPoint) branchPointObj[reelKey] = seq;
  const branchDoc = await History.create({
    _id:         path,
    path,
    parent:      isMain(parent) ? null : parent,
    branchPoint: branchPointObj,
    createdBy:   createdBy || null,
    label:       label || null,
    scope:       resolvedScope,
  });

  // 4. Invalidate the lineage cache so the new branch is visible to
  //    subsequent resolveHistoryLineage/getBranchPoint calls. Targeted
  //    invalidation is wrong here (the new branch's lineage isn't
  //    cached yet; the parent's cache stays valid). But if any
  //    consumer cached "lineages including this parent's descendants
  //    so far," that's stale. Cheapest correct option: nuke the cache.
  invalidateHistoryCache(null);

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
 * (parent === "0"), and we filter by history=MAIN (or absent — legacy
 * rows) plus the anchor's seq/date filter.
 *
 * For deeper lineages this aggregates across multiple branches; the
 * max-seq-per-reel calculation merges them.
 */
async function snapshotParentHeads({ parent, anchor }) {
  const heads = new Map();
  const lineage = await resolveHistoryLineage(parent); // ["0", ...ancestors..., parent] OR just ["0"] for main

  // For the leaf (parent), the upper bound is the anchor's seq or
  // resolved timestamp. For ancestors above the leaf, the upper bound
  // is the next-up branch's branchPoint for each reel. We aggregate
  // each branch's contribution independently and merge by reel key
  // taking the max seq.
  for (let i = 0; i < lineage.length; i++) {
    const here = lineage[i];
    const isLeaf = i === lineage.length - 1;
    const branchMatch = isMain(here)
      ? { $or: [{ history: MAIN }, { history: { $exists: false } }] }
      : { history: here };

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
      "of.kind": { $in: ["being", "space", "matter"] },
      "of.id":   { $type: "string" },
      seq:           seqFilter,
      ...branchMatch,
    };
    if (isLeaf && anchor.atTimestamp != null) {
      matchStage.date = { $lte: new Date(anchor.atTimestamp) };
    }

    const agg = await Fact.aggregate([
      { $match: matchStage },
      { $group: {
        _id:    { kind: "$of.kind", id: "$of.id" },
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
          const succRow = await History.findById(successor).select("branchPoint").lean();
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

// ─────────────────────────────────────────────────────────────────────
// Scope resolution + permission asymmetry
// ─────────────────────────────────────────────────────────────────────

/**
 * Resolve the new branch's scope, given what the caller passed and what
 * the parent branch's scope is. Implements the inheritance + asymmetry
 * doctrine documented above createBranch's `scope` block.
 *
 * Throws when the caller tries to widen or move to a disjoint scope
 * without story-root permission.
 */
async function _resolveHistoryScope({ passed, parentScope, parentHistoryPath, createdBy }) {
  const noScopePassed = (passed === null || passed === undefined);

  // Validate + resolve any explicit scope first so shape errors throw
  // before lineage / permission logic runs.
  let resolvedPassed = null;
  if (!noScopePassed) {
    if (typeof passed !== "object" || typeof passed.path !== "string" || !passed.path.length) {
      throw new Error("createBranch: scope must be { path: string }");
    }
    const { resolvePathToSpaceId } = await import("./historyScope.js");
    const spaceId = await resolvePathToSpaceId(passed.path, parentHistoryPath);
    if (!spaceId) {
      throw new Error(`createBranch: scope.path "${passed.path}" doesn't resolve to a space on parent "#${parentHistoryPath}"`);
    }
    resolvedPassed = { path: passed.path, spaceId };
  }

  // Parent has no scope. Passed wins (whether null or explicit subtree).
  // No widening to check since parent imposes no floor.
  if (!parentScope) return resolvedPassed;

  // Parent has scope. Default behavior: inherit.
  if (noScopePassed) {
    return { path: parentScope.path, spaceId: parentScope.spaceId };
  }

  // Passed explicit scope. Check whether resolvedPassed.spaceId is the
  // parent's scope spaceId OR a descendant of it. The "narrower or equal"
  // test: walk resolvedPassed.spaceId's ancestor chain on the parent
  // branch and look for parentScope.spaceId.
  const within = await _isSpaceWithinScope(
    resolvedPassed.spaceId,
    parentScope.spaceId,
    parentHistoryPath,
  );
  if (within) return resolvedPassed;

  // Wider or disjoint — widening. Story-root permission required.
  const allowed = await _hasStoryRootPermission(createdBy);
  if (!allowed) {
    throw new Error(
      `createBranch: scope "${passed.path}" is not within parent history's scope "${parentScope.path}". ` +
      `Widening or moving to a disjoint scope requires story-root permission ` +
      `(heaven owner or angel role). ` +
      `Sub-branches inherit parent's scope by default; declare a narrower scope to fork within.`,
    );
  }
  return resolvedPassed;
}

/**
 * True when `targetSpaceId` IS `scopeSpaceId` OR has `scopeSpaceId` in
 * its ancestor chain on the given branch. Uses the same ancestor cache
 * the fact-emission gate consults.
 */
async function _isSpaceWithinScope(targetSpaceId, scopeSpaceId, historyPath) {
  if (String(targetSpaceId) === String(scopeSpaceId)) return true;
  try {
    const { getAncestorChain } = await import("../space/ancestorCache.js");
    const chain = await getAncestorChain(String(targetSpaceId), historyPath);
    if (!Array.isArray(chain)) return false;
    return chain.some((node) => String(node._id || node.id) === String(scopeSpaceId));
  } catch {
    return false;
  }
}

/**
 * Story-root permission = heaven authority (owner of heaven OR
 * angel role granted at heaven). I_AM owns heaven; other beings are
 * admitted via the angel role grant chain that traces back to I_AM
 * (per RolesAreAuth).
 *
 * Routes through `authorize()` against heaven so the substrate's
 * "one gate" doctrine holds: the same role-walk that gates any
 * heaven write also gates branch-scope widening here. Operators
 * who tighten heaven roles automatically tighten who can widen
 * branch scope; one place to change, two semantics covered.
 *
 * Returns false when beingId is null (createdBy not threaded) so
 * scope-widening from anonymous callers refuses by default.
 */
async function _hasStoryRootPermission(beingId) {
  if (!beingId) return false;
  try {
    const { findByHeavenSpace } = await import("../projections.js");
    const { HEAVEN_SPACE } = await import("../space/heavenSpaces.js");
    const { authorize } = await import("../../ibp/authorize.js");
    const heavenSlot = await findByHeavenSpace(HEAVEN_SPACE.HEAVEN, "0");
    if (!heavenSlot) return false;
    // The action name is "create-branch" for audit clarity. Under
    // RolesAreAuth the role-walk admits whichever caller holds a role
    // whose canDo covers this action at heaven — the angel role does;
    // operators who tighten the angel role automatically tighten who
    // can widen branch scope, satisfying the "one gate" doctrine.
    const decision = await authorize({
      identity: { beingId: String(beingId) },
      verb:     "do",
      target:   { kind: "position", spaceId: String(heavenSlot.id) },
      action:   "create-branch",
    });
    return decision.ok === true;
  } catch {
    return false;
  }
}
