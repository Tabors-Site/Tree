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
// Mirrors the shape the (now-retired) `list-branches` DO op returned, so
// the portal's render code can adopt the SEE path with no reshape.

import Branch from "./branch.js";
import { MAIN, loadBranch, resolveBranchLineage } from "./branches.js";

export async function describeBranchesCatalog(branchPath = MAIN) {
  const path = typeof branchPath === "string" && branchPath.length > 0
    ? branchPath
    : MAIN;
  const isMainPath = path === MAIN;

  // Lineage: just ["0"] for main; ["0", ..., path] for everything else.
  const lineage = isMainPath ? [MAIN] : await resolveBranchLineage(path);

  // Current branch row. Main has no Branch document (it's implicit), so
  // we synthesize one. The portal renders main and non-main with the
  // same shape.
  let current;
  if (isMainPath) {
    current = {
      path:      MAIN,
      parent:    null,
      anchor:    null,
      label:     "main",
      paused:    false,
      createdAt: null,
      isLive:    true,
    };
  } else {
    const row = await loadBranch(path);
    if (!row) {
      // Caller is asking about a branch that doesn't exist. Return a
      // not-found shape rather than throwing; SEE callers can render
      // "unknown branch" without an error envelope.
      return {
        current:  null,
        lineage:  [MAIN],
        children: [],
        notFound: true,
      };
    }
    current = _serializeBranch(row);
  }

  // Direct children: rows whose parent is this path. Main's children
  // carry parent=null (main has no row).
  const childRows = await Branch
    .find(isMainPath ? { parent: null } : { parent: path })
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
  const bp = row.branchPoint instanceof Map
    ? Object.fromEntries(row.branchPoint)
    : (row.branchPoint || {});
  return {
    path:        row.path,
    parent:      row.parent || null,
    anchor:      bp,
    label:       row.label || null,
    paused:      !!row.paused,
    isLive:      !!row.isLive,
    createdAt:   row.createdAt ? new Date(row.createdAt).toISOString() : null,
    createdBy:   row.createdBy || null,
  };
}
