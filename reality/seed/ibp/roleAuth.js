// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// roleAuth.js — the role-walk authorize.
//
// Per seed/RolesAreAuth.md: roles ARE auth. A being acts under one or
// more granted roles; each role's canSee / canDo / canSummon / canBe
// IS the permission gate. There is no parallel "qualities.permissions"
// namespace; the role registry is the single source of truth.
//
// The walk:
//   1. I-Am bypass — the bootstrap axiom. Always succeeds.
//   2. Anonymous / arrival floor — anonymous callers run under an
//      implicit `arrival` role at the place root. canSee = the
//      public read surface; canBe = ["birth", "connect"] for
//      registration. Not stored as a grant; a code-level floor.
//   3. Reach + canX walk — for every grant in identity.rolesGranted:
//      a. Reach gate. Anchored role: target's space must be
//         at-or-below the grant's anchor (or target's being matches
//         the anchor's being for relationship grants). Global role:
//         either no `reach` declared (true-global, applies anywhere)
//         OR target matches one of the reach entries.
//      b. canX gate. Verb's canX field on the role must permit
//         the specific (action / intent / operation / SEE op key).
//      c. First (reach + canX) match → allow.
//   4. No grant matched → deny.
//
// Pattern matching in `reach` is small by design (RolesAreAuth.md):
//   - exact path / spaceId / "/"
//   - `prefix/**` for subtree inclusion
//   No regex. No per-canX patterns. The role's reach is one mechanism;
//   the canX entries are pure action lists.
//
// The output shape mirrors the legacy authorize:
//   { ok: true,  role: "<role-name>", anchor: <id|null> }
//   { ok: false, reason: "...", code?: <error code> }
// Verb dispatchers convert ok:false into IbpError with code FORBIDDEN.

import { I_AM } from "../materials/being/seedBeings.js";
import { getRole } from "../present/roles/registry.js";
import { loadProjection } from "../materials/projections.js";

const ARRIVAL_ROLE = "arrival";

/**
 * Walk the caller's granted roles against the target/verb/action and
 * return ok:true on the first match.
 *
 * @param {object} args
 * @param {object} args.identity        { beingId, name } | null
 * @param {string} args.verb            "see" | "do" | "summon" | "be"
 * @param {object} args.target          { kind, id, path?, being? }
 * @param {string} [args.action]        DO action name
 * @param {string} [args.intent]        SUMMON intent
 * @param {string} [args.operation]     BE operation
 * @param {string} [args.seeOp]         SEE op name (when target is a SEE op call)
 * @param {string} [args.branch]        branch (defaults to "0")
 * @returns {Promise<{ok: boolean, role?: string, anchor?: string, reason?: string}>}
 */
export async function authorizeViaRoles(args) {
  const { identity, verb, target, action, intent, operation, seeOp, branch = "0" } = args || {};

  // Bootstrap axiom. The I-Am has no granted roles — its authority IS
  // the substrate. Code-level bypass.
  if (identity?.beingId === I_AM || identity?.name === I_AM) {
    return { ok: true, role: "i-am", anchor: null };
  }

  // Anonymous arrival floor. Stateless callers (no beingId) run under
  // the arrival role at the place root, without a grant entry.
  if (!identity?.beingId) {
    return checkArrivalFloor({ verb, target, action, intent, operation, seeOp });
  }

  // Load the caller's grants from their being projection. Cold-fold if
  // the row isn't cached yet (boot, fresh fork, etc.).
  const slot = await loadProjection("being", String(identity.beingId), branch);
  const grants = readGrantsFromSlot(slot);
  if (!grants.length) {
    return {
      ok: false,
      reason: `being "${identity.beingId}" has no granted roles; ` +
        `authority must be granted by another being before they can act.`,
    };
  }

  // Walk each grant: reach gate, then canX gate.
  const targetPath  = derivePath(target);
  const targetSpace = deriveSpaceId(target);
  const targetBeing = deriveBeingName(target);

  for (const grant of grants) {
    const role = getRole(grant.role);
    if (!role) continue;

    if (!await reachReaches(role, grant, { targetSpace, targetBeing, targetPath, branch })) {
      continue;
    }

    if (!permits(role, verb, { action, intent, operation, seeOp, targetBeing })) {
      continue;
    }

    return {
      ok: true,
      role: grant.role,
      anchor: grant.anchorSpaceId || grant.anchorBeingId || null,
    };
  }

  return {
    ok: false,
    reason: `no granted role permits ${verb}` +
      (action ? `:${action}` : operation ? `:${operation}` : intent ? `:${intent}` : "") +
      ` at this target`,
  };
}

// ────────────────────────────────────────────────────────────────────
// Reach
// ────────────────────────────────────────────────────────────────────

/**
 * Does this grant's role reach the target?
 *
 * Anchored role: walk target's ancestor chain; true if anchor appears
 * OR target's being matches the anchorBeingId.
 *
 * Global role: if role.reach is null/empty, true (unconstrained).
 * Else check each pattern against the target's path / spaceId.
 */
async function reachReaches(role, grant, { targetSpace, targetBeing, targetPath, branch }) {
  if (role.scope === "global") {
    if (!Array.isArray(role.reach) || role.reach.length === 0) {
      return true; // true-global
    }
    return reachMatchesAny(role.reach, { targetSpace, targetPath });
  }

  // Anchored
  if (grant.anchorBeingId) {
    return targetBeing && String(grant.anchorBeingId) === String(targetBeing);
  }
  if (grant.anchorSpaceId) {
    if (!targetSpace) return false;
    if (String(grant.anchorSpaceId) === String(targetSpace)) return true;
    // Walk ancestors of target space; if any equals the anchor → reach.
    return await spaceHasAncestor(targetSpace, grant.anchorSpaceId, branch);
  }
  return false;
}

function reachMatchesAny(reach, { targetSpace, targetPath }) {
  for (const pat of reach) {
    if (matchReachPattern(pat, { targetSpace, targetPath })) return true;
  }
  return false;
}

function matchReachPattern(pat, { targetSpace, targetPath }) {
  if (pat === "/" && (targetPath === "/" || targetPath === "")) return true;
  if (targetSpace && pat === targetSpace) return true;
  if (targetPath && pat === targetPath)  return true;
  // prefix/** form
  const m = /^(.*?)\/\*\*$/.exec(pat);
  if (m) {
    const prefix = m[1] || "/";
    if (targetPath && (targetPath === prefix || targetPath.startsWith(prefix + "/"))) {
      return true;
    }
  }
  return false;
}

async function spaceHasAncestor(targetSpace, anchorSpaceId, branch) {
  try {
    const { walkAncestorChain } = await import("../materials/space/ancestorCache.js");
    const chain = await walkAncestorChain(String(targetSpace), branch);
    for (const node of chain) {
      if (String(node._id) === String(anchorSpaceId)) return true;
    }
  } catch {
    // Cache miss or transient; treat as not reachable. Surfaces as
    // FORBIDDEN, which is the safe default for a borderline read.
    return false;
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────
// canX matching
// ────────────────────────────────────────────────────────────────────

function permits(role, verb, { action, intent, operation, seeOp, targetBeing }) {
  if (verb === "see")    return permitsSee(role, seeOp);
  if (verb === "do")     return permitsDo(role, action);
  if (verb === "summon") return permitsSummon(role, targetBeing, intent);
  if (verb === "be")     return permitsBe(role, operation);
  return false;
}

function permitsSee(role, seeOp) {
  if (!Array.isArray(role.canSee)) return false;
  for (const entry of role.canSee) {
    const name = typeof entry === "string" ? entry : entry?.name;
    if (!name) continue;
    if (name === "*") return true;
    if (!seeOp) continue;
    if (name === seeOp) return true;
  }
  return false;
}

function permitsDo(role, action) {
  if (!action || !Array.isArray(role.canDo)) return false;
  for (const entry of role.canDo) {
    const a = typeof entry === "string" ? entry : entry?.action;
    if (!a) continue;
    if (a === "*") return true;
    if (a === action) return true;
    // Namespace match: `set-being:position` matches a canDo of `set-being:*` or `set-being`.
    const colonIdx = action.indexOf(":");
    if (colonIdx > 0) {
      const ns = action.slice(0, colonIdx);
      if (a === ns) return true;
      if (a === `${ns}:*`) return true;
    }
    // Wildcard prefix on canDo entry: `grant-role:*` matches `grant-role:human`.
    if (a.endsWith(":*")) {
      const prefix = a.slice(0, -2);
      if (action === prefix) return true;
      if (action.startsWith(prefix + ":")) return true;
    }
  }
  return false;
}

function permitsSummon(role, targetBeing, intent) {
  if (!Array.isArray(role.canSummon)) return false;
  for (const entry of role.canSummon) {
    const pattern = typeof entry === "string" ? entry : entry?.pattern;
    if (!pattern) continue;
    if (matchBeingNamePattern(pattern, targetBeing)) {
      if (!intent || !entry?.intent || entry.intent === "*" || entry.intent === intent) {
        return true;
      }
    }
  }
  return false;
}

function permitsBe(role, operation) {
  if (!operation || !Array.isArray(role.canBe)) return false;
  for (const entry of role.canBe) {
    const op = typeof entry === "string" ? entry : entry?.operation;
    if (!op) continue;
    if (op === "*") return true;
    if (op === operation) return true;
  }
  return false;
}

function matchBeingNamePattern(pattern, targetBeing) {
  if (!pattern) return false;
  if (pattern === "@*" || pattern === "*") return true;
  if (!targetBeing) return false;
  const want = pattern.startsWith("@") ? pattern.slice(1) : pattern;
  if (want.endsWith("*")) {
    return String(targetBeing).startsWith(want.slice(0, -1));
  }
  return String(targetBeing) === want;
}

// ────────────────────────────────────────────────────────────────────
// Anonymous arrival floor
// ────────────────────────────────────────────────────────────────────

function checkArrivalFloor({ verb, target, action, intent, operation, seeOp }) {
  const role = getRole(ARRIVAL_ROLE);
  if (!role) {
    return {
      ok: false,
      reason: "no arrival role registered; anonymous callers have no floor.",
    };
  }
  const targetBeing = deriveBeingName(target);
  if (permits(role, verb, {
    action, intent, operation, seeOp, targetBeing,
  })) {
    return { ok: true, role: ARRIVAL_ROLE, anchor: null };
  }
  return {
    ok: false,
    reason: "arrival floor does not permit this action; please authenticate.",
  };
}

// ────────────────────────────────────────────────────────────────────
// Target shape readers
// ────────────────────────────────────────────────────────────────────

function readGrantsFromSlot(slot) {
  if (!slot) return [];
  const q = slot.state?.qualities;
  const qualities = q instanceof Map ? Object.fromEntries(q.entries()) : q;
  const arr = qualities?.rolesGranted;
  return Array.isArray(arr) ? arr : [];
}

function derivePath(target) {
  if (!target) return null;
  if (typeof target === "string") return target;
  return target.path || target.address?.pathByNames || target.address?.path || null;
}

function deriveSpaceId(target) {
  if (!target) return null;
  if (target.kind === "space") return String(target.id);
  return target.spaceId || target.address?.spaceId || null;
}

function deriveBeingName(target) {
  if (!target) return null;
  if (target.kind === "being") return target.name || target.id || null;
  return target.being || target.beingName || target.address?.being || null;
}
