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

import { getRole, canViews } from "./registry.js";
import { getAncestorChain } from "../../materials/space/ancestorCache.js";
import { getSpaceRootId } from "../../sprout.js";

/**
 * Look up the role spec a grant resolves to. Walks grant.anchorSpaceId
 * up the qualities ancestor chain looking for qualities.roles[name];
 * the first ancestor that has it IS the host. Falls back to the
 * in-memory REGISTRY when no space in the anchor chain has the role
 * (code-cognition roles not yet installed; boot-order edge).
 *
 * The walk reads off the ancestor chain's own nodes: getAncestorChain
 * is loadOrFold-backed (lineage-aware, history-keyed) and each node
 * already carries normalized qualities, so the chain IS the read.
 * The per-node loadProjection this used to do was both redundant and
 * history-blind — on a history where a host space hadn't been lazily
 * folded yet, the installed role was invisible and the lookup fell
 * through to the registry, silently serving the template instead of
 * the space-installed override.
 *
 * Registry fallback host: the GRANT's anchor, not the story root.
 * The grant names where the role lives for this being; an uninstalled
 * role defaulting its host to the root silently widened every
 * anchored grant to story-wide coverage. Seed roles that need
 * story-wide reach declare it (`reach: ["/**"]` on angel/arrival)
 * or are anchored at the root (global). Being-anchored grants (no
 * anchorSpaceId) keep the root host: their coverage comes from the
 * spec's reach, with the root as the neutral base.
 *
 * @param {object} grant   { role, anchorSpaceId, anchorBeingId?, ... }
 * @param {string} history  required
 * @returns {Promise<{spec: object|null, hostSpaceId: string|null}>}
 */
export async function getRoleSpecForGrant(grant, history) {
  if (typeof history !== "string" || !history.length) {
    throw new Error("getRoleSpecForGrant requires `history` (no silent default)");
  }
  const name = grant?.role;
  if (!name) return { spec: null, hostSpaceId: null };

  const anchor = grant?.anchorSpaceId;
  if (anchor) {
    let chain = null;
    try { chain = await getAncestorChain(String(anchor), history); } catch { chain = null; }
    if (Array.isArray(chain)) {
      // chain[0] is the anchor itself; the walk covers self + ancestors.
      for (const node of chain) {
        const roles = node?.qualities?.roles;
        const found = roles && typeof roles === "object" ? roles[name] : null;
        // A spec synced to a space stores the canonical `can`; derive the four group-by-verb
        // views when they're absent, so the role-walk (permitsDo/See/Summon/Be) reads them.
        if (found) {
          const spec = (Array.isArray(found.can) && !Array.isArray(found.canDo)) ? { ...found, ...canViews(found.can) } : found;
          return { spec, hostSpaceId: String(node._id) };
        }
      }
    }
  }

  // Registry fallback (templates / code-cognition roles).
  const registryRole = getRole(name);
  if (registryRole) {
    const rootId = getSpaceRootId();
    const host = anchor ? String(anchor) : (rootId ? String(rootId) : null);
    return { spec: registryRole, hostSpaceId: host };
  }
  return { spec: null, hostSpaceId: null };
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
 * @param {string}  history      — required
 * @returns {Promise<boolean>}  — true iff the spec reaches the target
 */
export async function roleReachesTarget(spec, hostSpaceId, target, history) {
  if (typeof history !== "string" || !history.length) {
    throw new Error("roleReachesTarget requires `history` (no silent default)");
  }
  const { spaceId: targetSpace = null, path: targetPath = null } = target || {};

  // Default base — target at or below host.
  let covered = false;
  if (hostSpaceId && targetSpace) {
    covered = await spaceIsAtOrBelow(targetSpace, hostSpaceId, history);
  }

  const reach = Array.isArray(spec?.reach) ? spec.reach : null;
  if (!reach || reach.length === 0) return covered;

  // Reach patterns are path-shaped ("prefix/**"). Verbs that
  // authorize by spaceId alone (DO, BE, in-moment SUMMON) carry no
  // path, so derive it from the ancestor chain. Without this, path
  // patterns only ever matched on SEE (whose parse supplies the
  // path): a role reaching /garden via an ADD pattern could see it
  // but not act there, and an EXCLUDE like `!/vault/**` failed OPEN
  // for DO — base coverage stood and the carve-out never applied.
  let path = targetPath;
  if (!path && targetSpace) {
    path = await pathOfSpace(targetSpace, history);
  }

  for (const pat of reach) {
    if (typeof pat !== "string" || !pat.length) continue;
    if (pat.startsWith("!")) {
      if (matchPattern(pat.slice(1), { targetSpace, targetPath: path })) covered = false;
    } else {
      if (matchPattern(pat, { targetSpace, targetPath: path })) covered = true;
    }
  }
  return covered;
}

/**
 * Path-by-names of a space, derived from the (cached, lineage-aware)
 * ancestor chain. Matches the resolver's display form: "/" + segment
 * names below the story root, so "/garden/shed" — the same shape
 * role authors write reach patterns in. Null when any segment lacks
 * a name (the pattern then simply doesn't match; spaceId patterns
 * still can).
 */
async function pathOfSpace(spaceId, history) {
  try {
    const chain = await getAncestorChain(String(spaceId), history);
    if (!Array.isArray(chain) || chain.length === 0) return null;
    // chain is [self, ..., storyRoot]; drop the root, reverse to
    // top-down, join names.
    const names = chain.slice(0, -1).map((n) => n?.name).reverse();
    if (names.some((n) => typeof n !== "string" || !n.length)) return null;
    return "/" + names.join("/");
  } catch {
    return null;
  }
}

async function spaceIsAtOrBelow(targetSpaceId, hostSpaceId, history) {
  if (String(targetSpaceId) === String(hostSpaceId)) return true;
  try {
    const chain = await getAncestorChain(String(targetSpaceId), history);
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
