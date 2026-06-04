// branchesCatalog.js — read-side helper that returns the branch graph
// as a plain object. Powers the synthetic `<reality>/.branches[/<path>]`
// SEE catalog the portal uses to draw its chip row.
//
// Returns:
//   {
//     current: { path, parent, anchor, label, paused, isLive, createdAt },
//     lineage: [ "0", ..., <path> ],
//     children: [ ...same shape as current ],
//   }
//

import Branch from "./branch.js";
import {
  MAIN,
  loadBranch,
  resolveBranchLineage,
  commonAncestor,
  divergentFactsSince,
} from "./branches.js";

export async function describeBranchesCatalog(branchPath = MAIN) {
  const path =
    typeof branchPath === "string" && branchPath.length > 0 ? branchPath : MAIN;
  const isMainPath = path === MAIN;

  // Lineage: just ["0"] for main; ["0", ..., path] for everything else.
  const lineage = isMainPath ? [MAIN] : await resolveBranchLineage(path);

  // Current branch row. Main starts implicit (no document), but
  // pause-branch upserts a row when the operator first pauses main.
  // If a real row exists, surface it; otherwise synthesize the
  // implicit-live default. Either way the portal renders main and
  // non-main with the same shape.
  let current;
  if (isMainPath) {
    const mainRow = await loadBranch(MAIN).catch(() => null);
    if (mainRow) {
      current = _serializeBranch(mainRow);
      // Even after a pause row exists, main's structural fields stay
      // implicit (parent=null, no anchor, the synthetic label).
      current.parent = null;
      current.anchor = null;
      if (!current.label) current.label = "main";
    } else {
      current = {
        path: MAIN,
        parent: null,
        anchor: null,
        label: "main",
        paused: false,
        deleted: false,
        createdAt: null,
        isLive: true,
      };
    }
  } else {
    const row = await loadBranch(path);
    if (!row) {
      // Caller is asking about a branch that doesn't exist. Return a
      // not-found shape rather than throwing; SEE callers can render
      // "unknown branch" without an error envelope.
      return {
        current: null,
        lineage: [MAIN],
        children: [],
        notFound: true,
      };
    }
    current = _serializeBranch(row);
  }

  // Direct children: rows whose parent is this path. Main's children
  // carry parent=null (main has no row).
  //
  // Deleted branches drop from the default listing. They still exist
  // in the chain and SEE on a specific deleted path still resolves
  // (current slot above honors the direct lookup), but they don't
  // clutter the branch picker. Undelete brings them back.
  const childRows = await Branch.find({
    ...(isMainPath ? { parent: null } : { parent: path }),
    deleted: { $ne: true },
  })
    .sort({ path: 1 })
    .lean();
  const children = childRows.map(_serializeBranch);

  return {
    current,
    lineage,
    children,
  };
}

function _serializeBranch(row) {
  if (!row) return null;
  const bp =
    row.branchPoint instanceof Map
      ? Object.fromEntries(row.branchPoint)
      : row.branchPoint || {};
  return {
    path: row.path,
    parent: row.parent || null,
    anchor: bp,
    label: row.label || null,
    paused: !!row.paused,
    deleted: !!row.deleted,
    isLive: !!row.isLive,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    createdBy: row.createdBy || null,
    mergeSources: Array.isArray(row.mergeSources) ? [...row.mergeSources] : [],
  };
}

/**
 * Return the conflict catalog for a merged branch. Reads the branch's
 * `mergeSources` to identify the two source branches, computes their
 * common ancestor, runs `divergentFactsSince` for both sides, and
 * groups by reel key into one of three categories:
 *
 *   - "clean-A": only source A touched this reel since the ancestor.
 *                The merged branch already inherits source A's state
 *                through reel-lineage when the operator chooses to
 *                propagate it; suggestedStrategy is "take-A".
 *   - "clean-B": symmetric.
 *   - "conflict": both sources touched it. User must resolve.
 *
 * Reset reels (state that's branch-private by nature, like inhabit-
 * state) get their own category in Phase 5; this returns "conflict"
 * for them today.
 *
 * @param {string} branchPath  the merged branch's path
 * @returns {Promise<object>}
 */
export async function describeMergeConflicts(branchPath) {
  const row = await loadBranch(branchPath);
  if (!row) {
    return { branch: branchPath, notFound: true, conflicts: [] };
  }
  const sources = Array.isArray(row.mergeSources) ? row.mergeSources : [];
  if (sources.length !== 2) {
    return {
      branch: branchPath,
      notAMerge: true,
      reason: "branch has no mergeSources (was not created by merge-branches)",
      conflicts: [],
    };
  }
  const [sourceA, sourceB] = sources;
  const ancestor = await commonAncestor(sourceA, sourceB);

  const [diffA, diffB] = await Promise.all([
    divergentFactsSince(sourceA, ancestor),
    divergentFactsSince(sourceB, ancestor),
  ]);

  // Union of reel keys touched on either side.
  const allReels = new Set([...diffA.keys(), ...diffB.keys()]);
  const conflicts = [];
  for (const reelKey of allReels) {
    const factsA = diffA.get(reelKey) || [];
    const factsB = diffB.get(reelKey) || [];
    const inA = factsA.length > 0;
    const inB = factsB.length > 0;
    let side, suggestedStrategy;
    if (inA && inB) {
      side = "conflict";
      suggestedStrategy = "compose";
    } else if (inA) {
      side = "clean-A";
      suggestedStrategy = "take-A";
    } else {
      side = "clean-B";
      suggestedStrategy = "take-B";
    }
    conflicts.push({
      reelKey,
      side,
      suggestedStrategy,
      factCountA: factsA.length,
      factCountB: factsB.length,
      // Last fact on each side is the most-recent divergent write; the
      // mediator surfaces it as the "current value" candidate. Full fact
      // lists are reachable via the reel-explorer SEE catalog if the
      // operator wants to dig deeper.
      lastFactA:
        factsA.length > 0 ? _summarizeFact(factsA[factsA.length - 1]) : null,
      lastFactB:
        factsB.length > 0 ? _summarizeFact(factsB[factsB.length - 1]) : null,
    });
  }

  // Sort: conflicts first (the work to do), then clean reels grouped
  // by side. Within each group, alphabetical by reel key for stable
  // rendering.
  const order = { conflict: 0, "clean-A": 1, "clean-B": 2 };
  conflicts.sort((a, b) => {
    const o = order[a.side] - order[b.side];
    return o !== 0 ? o : a.reelKey.localeCompare(b.reelKey);
  });

  return {
    branch: branchPath,
    sourceA,
    sourceB,
    ancestor,
    conflicts,
    totals: {
      total: conflicts.length,
      conflicts: conflicts.filter((c) => c.side === "conflict").length,
      cleanA: conflicts.filter((c) => c.side === "clean-A").length,
      cleanB: conflicts.filter((c) => c.side === "clean-B").length,
    },
  };
}

function _summarizeFact(fact) {
  return {
    seq: fact.seq,
    verb: fact.verb,
    action: fact.action,
    branch: fact.branch,
    date: fact.date ? new Date(fact.date).toISOString() : null,
    beingId: fact.beingId || null,
    params: fact.params || null,
  };
}
