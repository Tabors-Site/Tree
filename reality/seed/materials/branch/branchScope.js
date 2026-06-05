// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Subtree-branch scope helpers.
//
// A branch can declare a scope . a specific space subtree the branch
// is allowed to write to. Writes outside scope refuse at the fact-
// emission boundary; reads outside scope inherit from the parent
// transparently.
//
// The classification:
//   - scope = null              → whole-reality branch (default; no check)
//   - scope.spaceId = "abc-123" → only writes whose target home space
//                                 lineage walks through abc-123 are allowed
//
// Heaven writes bypass scope entirely: facts that route to heaven
// (via heavenLineage's isHeavenSpace) get re-stamped on MAIN before
// the scope check runs. Subtree branches can still author roles,
// edit reality config, etc. through normal heaven routing.

import { loadBranch } from "./branches.js";
import { getAncestorChain } from "../space/ancestorCache.js";
import { getSpaceRoot } from "../../sprout.js";

// ─────────────────────────────────────────────────────────────────────
// Path resolution (for scope creation)
// ─────────────────────────────────────────────────────────────────────

/**
 * Walk a slash-delimited path from the reality root and return the
 * resolved space's _id. Used by createBranch when an operator passes
 * a scope path like "/library" or "/library/reading-room" — the
 * branch's scope.spaceId is locked at creation time against the
 * parent branch's view.
 *
 * Returns null when:
 *   - the path is empty or invalid
 *   - any segment doesn't resolve to a child space
 *   - the reality root isn't planted yet (pre-bootstrap)
 *
 * @param {string} pathString  e.g. "/library", "/library/reading-room"
 * @param {string} branch      branch path to resolve against (parent of the new branch)
 * @returns {Promise<string|null>}
 */
export async function resolvePathToSpaceId(pathString, branch) {
  if (typeof pathString !== "string" || !pathString.length) return null;
  const trimmed = pathString.trim();
  if (!trimmed.startsWith("/")) return null;
  if (trimmed === "/") {
    const root = await getSpaceRoot();
    return root?._id ? String(root._id) : null;
  }

  const segments = trimmed.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  const root = await getSpaceRoot();
  const rootId = root?._id ? String(root._id) : null;
  if (!rootId) return null;

  let cursorId = rootId;
  const { default: Projection } = await import("./projection.js");
  const { isMain } = await import("./branches.js");
  const { resolveBranchLineage } = await import("./branches.js");

  // Build the branch's lineage chain (e.g. ["0"] for main, ["0", "1"]
  // for a child of main, etc.) so segment lookups walk inherited
  // content. A subtree branch may need to find a space planted on its
  // parent's reel; querying only the current branch's projection table
  // misses it.
  const lineage = isMain(branch) ? ["0"] : await resolveBranchLineage(branch);
  // From leaf branch outward to root, so the most-divergent branch
  // wins on shadow.
  const orderedBranches = [...lineage].reverse();

  for (const segment of segments) {
    let resolvedChild = null;
    for (const b of orderedBranches) {
      const child = await Projection.findOne({
        branch: b,
        type: "space",
        "state.parent": cursorId,
        "state.name": segment,
        tombstoned: { $ne: true },
      }).lean();
      if (child) { resolvedChild = child; break; }
    }
    if (!resolvedChild) return null;
    cursorId = String(resolvedChild.id);
  }
  return cursorId;
}

// Cache of branchPath → scope.spaceId | null. Branch metadata is
// effectively append-only (the scope field is set at creation and
// never modified); cache aggressively.
const _scopeCache = new Map();

/**
 * Read the scope spaceId for a branch. Returns null for whole-reality
 * branches (no scope) or when the branch row is missing.
 *
 * Cached per-process. Use `_invalidateScopeCache(path)` after any op
 * that creates or mutates a branch's scope (currently only
 * create-branch, which sets it at creation).
 *
 * @param {string} branchPath
 * @returns {Promise<string|null>}
 */
export async function getBranchScopeSpaceId(branchPath) {
  if (_scopeCache.has(branchPath)) return _scopeCache.get(branchPath);
  const row = await loadBranch(branchPath);
  const spaceId = row?.scope?.spaceId ? String(row.scope.spaceId) : null;
  _scopeCache.set(branchPath, spaceId);
  return spaceId;
}

/**
 * True when the fact-target lives inside the branch's scope subtree.
 *
 * Decision matrix:
 *   - Whole-reality branch (scope = null)             → always true
 *   - target.kind missing or id missing               → true (defensive)
 *   - target.kind === "space" with id === scopeId     → true (scope root)
 *   - target.kind === "space" with scopeId in lineage → true (descendant)
 *   - target.kind === "being": resolve homeSpace,     → recurse with space target
 *     then check space lineage
 *   - target.kind === "matter": resolve parentSpace,  → recurse with space target
 *     then check space lineage
 *
 * Cost: cache hit (warm) is one map lookup. Cold path walks the
 * ancestor chain (cached). Per-target homeSpace resolution may
 * trigger a projection load on miss, but the load is the same one
 * the fact write was about to do anyway.
 *
 * @param {string} branchPath
 * @param {{kind: string, id: string}} target
 */
export async function isTargetInBranchScope(branchPath, target) {
  const scopeSpaceId = await getBranchScopeSpaceId(branchPath);
  if (!scopeSpaceId) return true;                  // unrestricted
  if (!target?.kind || !target?.id) return true;   // no target = no check

  const homeSpaceId = await _resolveHomeSpace(target, branchPath);
  if (!homeSpaceId) return true;                   // can't classify; allow

  return await _isSpaceInScope(homeSpaceId, scopeSpaceId, branchPath);
}

/**
 * True when `spaceId` is the scope root OR has the scope root in its
 * ancestor chain. Direct walks; cached.
 */
async function _isSpaceInScope(spaceId, scopeSpaceId, branchPath) {
  if (String(spaceId) === scopeSpaceId) return true;
  try {
    const chain = await getAncestorChain(String(spaceId), branchPath);
    if (!Array.isArray(chain)) return false;
    return chain.some(node => String(node._id || node.id) === scopeSpaceId);
  } catch {
    return false;
  }
}

/**
 * Resolve a target to its home space id (for beings) or parent space
 * id (for matter). Returns null when classification is impossible.
 *
 * Lineage-aware via loadOrFold: a being inherited from the parent
 * branch (no divergent slot on this branch yet) still resolves to its
 * homeSpace via cold-fold over the inherited reel. Bare loadProjection
 * here would return null for inherited aggregates and the gate's
 * defensive "can't classify → allow" fallback would let out-of-scope
 * writes against inherited targets through silently.
 */
async function _resolveHomeSpace(target, branchPath) {
  if (target.kind === "space") return String(target.id);

  const { loadOrFold } = await import("../projections.js");
  const slot = await loadOrFold(target.kind, String(target.id), branchPath);
  if (!slot) return null;
  const state = slot.state || {};

  if (target.kind === "being") return state.homeSpace || null;
  if (target.kind === "matter") return state.spaceId || null;
  return null;
}

/**
 * Invalidate the scope cache for one branch (or all branches when
 * called with no args). Called from create-branch and from branch-
 * delete machinery if the scope field is ever made mutable.
 */
export function invalidateScopeCache(path) {
  if (path == null) {
    _scopeCache.clear();
    return;
  }
  _scopeCache.delete(path);
}
