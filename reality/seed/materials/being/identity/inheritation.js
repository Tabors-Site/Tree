// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// inheritation.js — fold answers about who has authority over a being.
//
// The being-tree (containment, walked via parentBeingId) carries
// DOWNWARD authority. A Name gains authority over a being-subtree by
// holding an AUTHORITY ANCHOR at the subtree's root — and that anchor
// is one of two things:
//
//   ownership          — a being's `trueName` is the Name that owns it.
//                        Owning a being grants authority over it AND
//                        everything below it in the tree (you control
//                        the subtree you planted).
//   inheritation point — an explicit `do:grant-inheritation` naming a
//                        Name at a being-tree position. The granted
//                        Name gains authority over that position and
//                        its whole subtree, WITHOUT owning any of it.
//                        This is delegation: a Name handing another
//                        Name authority over part of its tree.
//
// Authority "covers" a being if an anchor for the asking Name sits at
// the being OR at any ancestor on the walk up to the story root.
// That is why "new beings inherit coverage automatically (nothing
// stored)": a child born under a covered position is itself covered,
// because the walk from the child passes through the anchor.
//
// I_AM is the source of all authority on its own story and covers
// everything (parallel to authorize.js's I_AM short-circuit).
//
// Inheritation points are asymmetric grant/revoke pairs, read the same
// way lineage.js reads credential attach/detach: the LATEST of the two
// (by Fact.date at seal) for a given (position, granted Name) decides
// the live state. Points are identity-level facts (who may act, not
// what is where), so — like lineage.js's authority reads — the point
// queries are branch-agnostic; only the tree WALK is branch-aware
// (a being's parent/owner are read from its projection on `branch`).

import Fact from "../../../past/fact/fact.js";
import { loadProjection } from "../../projections.js";

const MAX_TREE_DEPTH = 256; // cycle/runaway guard for the upward walk.

/**
 * The set of Names with a LIVE inheritation point at EXACTLY this
 * being-tree position (not its ancestors). A point is live when the
 * latest grant-inheritation naming that Name is more recent than the
 * latest revoke-inheritation naming it (latest-of-two-by-date, the
 * lineage.js attach/detach pattern).
 *
 * Branch-aware when `branch` is given: only points granted on `branch`'s
 * reel-lineage count (a sub-branch sees main's grants; main does not see
 * a sub-branch's). This is what lets the portal scope "who has access"
 * to the branch you're standing on. Omit `branch` for the branch-
 * agnostic union (any grant anywhere) — used where authority is read
 * without a branch in hand.
 *
 * Both facts land on the POSITION being's reel (of.id = position),
 * attributed to the granting/revoking Name (the actor). The granted
 * Name rides in params.name.
 */
export async function livePointsAt(beingId, branch) {
  if (!beingId) return new Set();
  const position = String(beingId);

  let branchClause = {};
  if (branch) {
    const { resolveBranchLineage } = await import("../../branch/branches.js");
    branchClause = { branch: { $in: await resolveBranchLineage(String(branch)) } };
  }

  const [grants, revokes] = await Promise.all([
    Fact.find({
      "of.kind": "being",
      "of.id": position,
      verb: "do",
      act: "grant-inheritation",
      ...branchClause,
    })
      .sort({ seq: 1, date: 1 })
      .select("params date")
      .lean(),
    Fact.find({
      "of.kind": "being",
      "of.id": position,
      verb: "do",
      act: "revoke-inheritation",
      ...branchClause,
    })
      .sort({ seq: 1, date: 1 })
      .select("params date")
      .lean(),
  ]);

  // Latest grant / latest revoke per granted Name. Sorted ascending, so
  // the last write for each name wins.
  const latestGrant = new Map();
  for (const g of grants) {
    const n = g?.params?.name ? String(g.params.name) : null;
    if (n) latestGrant.set(n, g.date);
  }
  const latestRevoke = new Map();
  for (const r of revokes) {
    const n = r?.params?.name ? String(r.params.name) : null;
    if (n) latestRevoke.set(n, r.date);
  }

  const live = new Set();
  for (const [name, gDate] of latestGrant) {
    const rDate = latestRevoke.get(name);
    if (!rDate || gDate > rDate) live.add(name);
  }
  return live;
}

/**
 * The authority anchors AT one being-tree node: the Name that owns it
 * (trueName) plus every Name holding a live inheritation point there.
 * `beingRow` is an already-loaded projection (avoids re-folding during
 * the walk). Returns a Set of nameIds.
 */
function anchorsAtNode(beingRow, livePoints) {
  const anchors = new Set(livePoints);
  const owner = beingRow?.state?.trueName;
  if (owner) anchors.add(String(owner));
  return anchors;
}

/**
 * Walk the being-tree UP from `beingId` (via the live parentBeingId on
 * each projection) yielding [node, livePointsAt(node)] for each node up
 * to the story root. Bounded by MAX_TREE_DEPTH. Stops when a being
 * has no parent (the I-AM being / a root) or can't be loaded.
 */
async function* walkUp(beingId, branch) {
  let id = beingId ? String(beingId) : null;
  const seen = new Set();
  for (let depth = 0; id && depth < MAX_TREE_DEPTH; depth++) {
    if (seen.has(id)) break; // defensive: a cycle in parentBeingId.
    seen.add(id);
    const row = await loadProjection("being", id, branch);
    if (!row?.state) break;
    const points = await livePointsAt(id, branch);
    yield { id, row, points };
    const parent = row.state.parentBeingId;
    id = parent ? String(parent) : null;
  }
}

/**
 * Does `nameId` have authority over `beingId`?
 *
 *   I_AM            → yes, always (universal authority on its story)
 *   owns being or
 *   any ancestor    → yes (ownership anchors downward authority)
 *   holds a point at
 *   being/ancestor  → yes (delegated downward authority)
 *   anyone else     → no
 *
 * Short-circuits on the first covering anchor found on the walk up, so
 * it's cheaper than computing the full authoritiesOver set.
 */
export async function hasAuthorityOver(nameId, beingId, branch) {
  if (!nameId || !beingId) return false;
  const name = String(nameId);

  const { I_AM } = await import("../seedBeings.js");
  if (name === String(I_AM) || name === "i-am" || name === "I_AM") return true;

  for await (const { row, points } of walkUp(beingId, branch)) {
    if (anchorsAtNode(row, points).has(name)) return true;
  }
  return false;
}

/**
 * The full set of nameIds with authority over `beingId`: I_AM, every
 * owner on the walk up, and every Name holding a live inheritation
 * point on the walk up. Use hasAuthorityOver when you only need a
 * yes/no for one Name (it short-circuits).
 */
export async function authoritiesOver(beingId, branch) {
  const out = new Set();
  const { I_AM } = await import("../seedBeings.js");
  out.add(String(I_AM));

  for await (const { row, points } of walkUp(beingId, branch)) {
    for (const a of anchorsAtNode(row, points)) out.add(a);
  }
  return out;
}
