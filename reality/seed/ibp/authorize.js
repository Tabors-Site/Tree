// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The gate. Every SEE, DO, SUMMON, BE passes through authorize().
//
// Per seed/RolesAreAuth.md — roles ARE auth. The role-walk in
// roleAuth.js is the gate. This file is the thin verb-dispatch entry
// point that handles the three code-level short-circuits and delegates
// the substantive permission decision.
//
// Evaluation order:
//
//   1. I-Am bypass                    (bootstrap axiom)
//   2. SEE on .discovery               (pre-identity surface)
//   3. Extension scope gate            (orthogonal — refuses ext:op
//                                       at a position where the
//                                       extension is blocked)
//   4. authorizeViaRoles               (the role-walk gate)
//
// The role-walk:
//   - Anonymous callers run under the implicit arrival role.
//   - Authenticated callers walk their qualities.rolesGranted.
//   - For each grant: reach gate (anchor for anchored roles;
//     role.reach for global roles) + canX gate (the role's
//     canSee/canDo/canSummon/canBe lists are the permission rules).
//
// The verb dispatch passes args.action / args.intent / args.operation
// through; the role-walk evaluates them against the matching canX.
//
// What this file NO LONGER does (retired with the hard cut):
//   - qualities.permissions.<verb>.<keyParts> rule lookups
//   - stance properties as gates (memberClasses can still be derived
//     for descriptor enrichment but they no longer gate authorize —
//     granted roles do; the contributor class is fully retired)
//   - registerDefaultPermissions extension contributions
//   - REALITY_ROOT_DEFAULT_PERMISSIONS / HEAVEN_DEFAULT_PERMISSIONS seeding
//
// Migration path for old surface: extensions author roles via
// reality.declare.registerRole and grants are emitted at the relevant
// boot/lifecycle moment. See seed/RolesAreAuth.md.

import log from "../seedReality/log.js";
import { IBP_ERR } from "./protocol.js";
import { I_AM } from "../materials/being/seedBeings.js";
import { getOperation } from "./operations.js";
import { isExtensionBlockedAtSpace } from "../materials/space/extensionScope.js";
import { authorizeViaRoles } from "./roleAuth.js";
import { getSpaceRootId } from "../sprout.js";
import { getRealityDomain } from "./address.js";
import { resolveTargetBranch } from "./branchResolve.js";

/**
 * Authorize a verb request.
 *
 * @param {object} args
 * @param {object|null} args.identity { beingId, name } if authenticated
 * @param {"see"|"do"|"summon"|"be"} args.verb
 * @param {object} args.target     { kind, value, spaceId?, being?, isDiscovery? }
 * @param {string} [args.action]   DO action name
 * @param {string} [args.intent]   SUMMON intent
 * @param {string} [args.operation] BE operation
 * @param {string} [args.seeOp]    SEE op name (when target is a SEE op call)
 * @param {object} [args.moment] caller's moment context
 * @returns {Promise<{ ok: boolean, actor: string, reason?: string }>}
 */
export async function authorize(args) {
  const { identity, verb, target, moment = null } = args;

  // 1. I-Am bypass. The bootstrap axiom.
  if (identity?.name === I_AM || identity?.beingId === I_AM) {
    return { ok: true, actor: I_AM };
  }

  // 2. SEE on .discovery. Pre-identity surface every client reads on
  // socket open before any other verb fires.
  if (verb === "see" && target?.isDiscovery) {
    return { ok: true, actor: "discovery" };
  }

  // 3. Extension scope gate. Refuses `ext:op` if the owning extension
  // is blocked at the target's ancestor chain. Orthogonal to roles.
  if (
    verb === "do" &&
    target?.spaceId &&
    typeof args.action === "string" &&
    args.action.includes(":")
  ) {
    try {
      const op = getOperation(args.action);
      const ownerExt = op?.ownerExtension;
      if (ownerExt && ownerExt !== "seed") {
        const blocked = await isExtensionBlockedAtSpace(ownerExt, target.spaceId);
        if (blocked) {
          return {
            ok: false,
            actor: "extension-blocked",
            reason: `Extension "${ownerExt}" is blocked at this position`,
          };
        }
      }
    } catch {
      // Registry not initialized in some test paths. Fall through.
    }
  }

  // 4. The role-walk. Anonymous callers → implicit arrival floor.
  // Authenticated callers → walk qualities.rolesGranted.
  //
  // Two branches surface here:
  //
  //   • targetBranch — where the target lives. Used to look up role
  //     specs on the target's qualities chain, and to evaluate reach
  //     (which space's projection should the reach pattern walk).
  //     Precedence: the parsed target's own branch is the most
  //     specific statement and wins; then the moment's seated
  //     targetBranch (where this moment's facts land — auth must
  //     evaluate the same world the stamp rides); then the actor's
  //     act branch (same-world acts); then the caller's session
  //     branch as the last resort (SEE ops and other targets that
  //     have no world of their own are evaluated from where the
  //     caller stands).
  //
  //   • actorBranch — the actor's branch, where their grants live.
  //     Caller passes args.actorBranch from socket.currentBranch
  //     (seated by BE:birth/connect/release/switch). When a being is
  //     seated on #0 and SEEs onto branch #1, their grants are read
  //     from #0 (where they actually exist), not from #1 (where they
  //     may not exist if their reel was created post-fork). This is
  //     the "look through the portal" semantic — you remain yourself
  //     when navigating across branches.
  //
  // Anonymous callers (no being bound, or the arrival floor's
  // identity) with no branch anywhere fall to the operator's default
  // branch via the pointer registry — never literal "0"; set-pointer
  // can re-point main. Authenticated callers with no branch anywhere
  // are a perimeter threading bug: fail loud.
  // Shared precedence (PORT-NOTES #10): target.branch →
  // moment.targetBranch → moment.actorAct.branch → the caller's
  // seated branch (args.actorBranch here). Identical chain to the verb
  // layer's resolveBranchForFact, so the branch that GATES an act and
  // the branch a fact STAMPS on can never diverge.
  let targetBranch = resolveTargetBranch({
    target,
    moment,
    currentBranch: args.actorBranch,
  });
  if (!targetBranch) {
    const isAnonymous = !identity?.beingId || identity?.name === "arrival";
    if (isAnonymous) {
      const { getDefaultBranch } = await import("../materials/branch/branchRegistry.js");
      targetBranch = await getDefaultBranch();
    } else {
      throw new Error(
        `authorize: branch could not be resolved for ${verb}:${args.action || args.seeOp || args.operation || args.intent || "?"} ` +
        `(identity=${identity?.name || identity?.beingId || "anonymous"}). ` +
        `Pass moment, include branch on the parsed target, or thread actorBranch.`,
      );
    }
  }
  // actorBranch falls back to the moment's actor branch, then to
  // targetBranch (genesis/scaffold paths where there's no separate
  // session branch). Same-branch acts collapse to one value naturally.
  //
  // Foreign-actor guard: an inbound cross-reality actor's act carries
  // THEIR home branch — a path in another substrate's namespace.
  // Looking their grants up on that path locally is meaningless at
  // best (no such branch row → noisy cold-fold failure) and wrong at
  // worst (a coincidentally same-named local branch). Any roles a
  // foreign actor holds HERE were granted here, on local branches, so
  // their grants read from the target's branch instead.
  const actorActIsLocal =
    !moment?.actorAct?.reality ||
    moment.actorAct.reality === getRealityDomain();
  const actorBranch =
    args.actorBranch ||
    (actorActIsLocal ? moment?.actorAct?.branch : null) ||
    targetBranch;
  const result = await authorizeViaRoles({
    identity,
    verb,
    target,
    action:      args.action || null,
    intent:      args.intent || null,
    operation:   args.operation || null,
    seeOp:       args.seeOp || null,
    branch:      targetBranch,
    actorBranch,
  });

  // Adapt to the verb-dispatch return shape. roleAuth returns
  // {ok, role?, anchor?, reason?}; verb dispatchers expect {ok, actor, reason?}.
  if (result.ok) {
    return { ok: true, actor: result.role || "permitted", reason: result.reason || null };
  }

  // 5. Inheritation coverage (fallback, DO-on-being only). The role-walk
  // is the CAPABILITY axis; the being-tree is the orthogonal DOWNWARD-
  // AUTHORITY axis. A Name that owns the target being (or any ancestor),
  // or holds an inheritation point covering it, has authority over it
  // even with no role grant — the same authority that lets it grant/
  // revoke points there. Consulted ONLY after a role denial, so role-
  // authorized acts (the hot path) never pay for the tree walk. Purely
  // additive: it can GRANT but never deny.
  if (verb === "do" && identity?.nameId && args.auditBeingId) {
    const { hasAuthorityOver } = await import(
      "../materials/being/identity/inheritation.js"
    );
    if (await hasAuthorityOver(identity.nameId, String(args.auditBeingId), targetBranch)) {
      return { ok: true, actor: String(identity.nameId) };
    }
  }

  return {
    ok:     false,
    actor:  "anonymous",
    reason: result.reason || null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Auth config flags (birth/connect enabled) — orthogonal to roles
// ─────────────────────────────────────────────────────────────────────

/**
 * Read reality-level BE config flags. Defaults to true/true. These
 * flags are operator-controlled toggles for the registration flow;
 * they're NOT permission rules. Stored under place-root
 * `qualities.auth.{birth_enabled, connect_enabled}`.
 */
export async function getAuthConfig() {
  const spaceRootId = getSpaceRootId();
  if (!spaceRootId) return { birth_enabled: true, connect_enabled: true };
  const { loadProjection } = await import("../materials/projections.js");
  const rootSlot = await loadProjection("space", spaceRootId, "0");
  const auth = rootSlot?.state?.qualities?.auth;
  const get = (key, fallback) => {
    if (auth instanceof Map) return auth.has(key) ? auth.get(key) : fallback;
    return auth && key in auth ? auth[key] : fallback;
  };
  return {
    birth_enabled:   get("birth_enabled",   true) !== false,
    connect_enabled: get("connect_enabled", true) !== false,
  };
}

// Re-export for use in verb handlers.
export { IBP_ERR };
