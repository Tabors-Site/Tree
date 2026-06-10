// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// spaceLookup.js — the shared "where does this role live + does it
// reach here" helpers (seed/RolesAreAuth.md).
//
// Two consumers:
//   - roleAuth.js (the role-walk authorize gate, called per verb)
//   - roleFlow.js (the active-role evaluator at moment-open)
//
// Both need the same two questions answered:
//   1. Given a grant, what role spec actually applies?
//      → walk grant.anchorSpaceId up the qualities ancestor chain
//        looking for qualities.roles[name]; first hit is the host.
//      → registry fallback for code-cognition roles not yet installed
//        on a space.
//   2. Does the role's reach cover this target?
//      → default base: host + descendants
//      → role.reach list adjusts (bash-style; `!` prefix excludes)
//
// Keeping the logic in one place makes the auth path and the active-
// role pick consistent — same grant, same spec lookup, same reach
// answer.

import { getRole } from "./registry.js";
import { loadProjection } from "../../materials/projections.js";
import { getAncestorChain } from "../../materials/space/ancestorCache.js";
import { getSpaceRootId } from "../../sprout.js";

/**
 * Look up the role spec a grant resolves to. Walks grant.anchorSpaceId
 * up the qualities ancestor chain looking for qualities.roles[name];
 * the first ancestor that has it IS the host. Falls back to the
 * in-memory REGISTRY when no space in the anchor chain has the role
 * (code-cognition roles not yet installed; boot-order edge).
 *
 * @param {object} grant   { role, anchorSpaceId, anchorBeingId?, ... }
 * @param {string} branch  required
 * @returns {Promise<{spec: object|null, hostSpaceId: string|null}>}
 */
export async function getRoleSpecForGrant(grant, branch) {
  if (typeof branch !== "string" || !branch.length) {
    throw new Error("getRoleSpecForGrant requires `branch` (no silent default)");
  }
  const name = grant?.role;
  if (!name) return { spec: null, hostSpaceId: null };

  const anchor = grant?.anchorSpaceId;
  if (anchor) {
    const start = await loadProjection("space", String(anchor), branch);
    const startSpec = readRoleFromSpaceState(start, name);
    if (startSpec) return { spec: startSpec, hostSpaceId: String(anchor) };

    let chain = null;
    try { chain = await getAncestorChain(String(anchor), branch); } catch { chain = null; }
    if (Array.isArray(chain)) {
      for (const node of chain) {
        const ancestor = await loadProjection("space", String(node._id), branch);
        const found = readRoleFromSpaceState(ancestor, name);
        if (found) return { spec: found, hostSpaceId: String(node._id) };
      }
    }
  }

  // Registry fallback (templates / code-cognition roles).
  const registryRole = getRole(name);
  if (registryRole) {
    const rootId = getSpaceRootId();
    return { spec: registryRole, hostSpaceId: rootId ? String(rootId) : null };
  }
  return { spec: null, hostSpaceId: null };
}

function readRoleFromSpaceState(slot, name) {
  if (!slot) return null;
  const q = slot.state?.qualities;
  const qualities = q instanceof Map ? Object.fromEntries(q.entries()) : q;
  const roles = qualities?.roles;
  if (!roles || typeof roles !== "object") return null;
  return roles[name] || null;
}

/**
 * Does the role spec reach this target?
 *
 * Default base: every target at-or-below the host space (qualities
 * inheritance). The spec's optional `reach` list adjusts in order;
 * bare patterns ADD, `!`-prefix patterns REMOVE. Later wins on conflict.
 *
 * Pattern vocabulary:
 *   - "**" or "/**" or "/"   → match everything
 *   - "<spaceId>"            → exact space id match
 *   - "<exact-path>"         → exact path match
 *   - "prefix/**"            → subtree (any depth)
 *   - "prefix/*"             → direct children only
 *   - "!<pattern>"           → exclude
 *
 * @param {object}  spec        — the role spec
 * @param {string}  hostSpaceId — where the spec is hosted
 * @param {object}  target      — { spaceId?, path? } describing the target
 * @param {string}  branch      — required
 * @returns {Promise<boolean>}  — true iff the spec reaches the target
 */
export async function roleReachesTarget(spec, hostSpaceId, target, branch) {
  if (typeof branch !== "string" || !branch.length) {
    throw new Error("roleReachesTarget requires `branch` (no silent default)");
  }
  const { spaceId: targetSpace = null, path: targetPath = null } = target || {};

  // Default base — target at or below host.
  let covered = false;
  if (hostSpaceId && targetSpace) {
    covered = await spaceIsAtOrBelow(targetSpace, hostSpaceId, branch);
  }

  const reach = Array.isArray(spec?.reach) ? spec.reach : null;
  if (!reach || reach.length === 0) return covered;

  for (const pat of reach) {
    if (typeof pat !== "string" || !pat.length) continue;
    if (pat.startsWith("!")) {
      if (matchPattern(pat.slice(1), { targetSpace, targetPath })) covered = false;
    } else {
      if (matchPattern(pat, { targetSpace, targetPath })) covered = true;
    }
  }
  return covered;
}

async function spaceIsAtOrBelow(targetSpaceId, hostSpaceId, branch) {
  if (String(targetSpaceId) === String(hostSpaceId)) return true;
  try {
    const chain = await getAncestorChain(String(targetSpaceId), branch);
    if (Array.isArray(chain)) {
      for (const node of chain) {
        if (String(node._id) === String(hostSpaceId)) return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function matchPattern(pat, { targetSpace, targetPath }) {
  // Global wildcards
  if (pat === "**" || pat === "/**" || pat === "/") return true;
  // Exact id / path
  if (targetSpace && pat === String(targetSpace)) return true;
  if (targetPath && pat === targetPath) return true;
  // prefix/** — subtree any depth
  if (pat.endsWith("/**")) {
    const prefix = pat.slice(0, -3) || "/";
    if (targetPath && (targetPath === prefix || targetPath.startsWith(prefix + "/"))) {
      return true;
    }
  }
  // prefix/* — direct children only
  if (pat.endsWith("/*")) {
    const prefix = pat.slice(0, -2) || "/";
    if (targetPath && targetPath.startsWith(prefix + "/")) {
      const rest = targetPath.slice(prefix.length + 1);
      if (rest.length > 0 && !rest.includes("/")) return true;
    }
  }
  return false;
}
