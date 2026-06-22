// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The gate. Every SEE, DO, SUMMON, BE passes through authorize().
//
// Per seed/AblesAreAuth.md — ables ARE auth. The able-walk in
// ableAuth.js is the gate. This file is the thin verb-dispatch entry
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
//   4. authorizeViaAbles               (the able-walk gate)
//
// The able-walk:
//   - Anonymous callers run under the implicit arrival able.
//   - Authenticated callers walk their qualities.ablesGranted.
//   - For each grant: reach gate (anchor for anchored ables;
//     able.reach for global ables) + canX gate (the able's
//     canSee/canDo/canSummon/canBe lists are the permission rules).
//
// The verb dispatch passes args.action / args.intent / args.operation
// through; the able-walk evaluates them against the matching canX.
//
// What this file NO LONGER does (retired with the hard cut):
//   - qualities.permissions.<verb>.<keyParts> rule lookups
//   - stance properties as gates (memberClasses can still be derived
//     for descriptor enrichment but they no longer gate authorize —
//     granted ables do; the contributor class is fully retired)
//   - registerDefaultPermissions extension contributions
//   - STORY_ROOT_DEFAULT_PERMISSIONS / HEAVEN_DEFAULT_PERMISSIONS seeding
//
// Migration path for old surface: extensions author ables via
// story.declare.registerAble and grants are emitted at the relevant
// boot/lifecycle moment. See seed/AblesAreAuth.md.

import log from "../seedStory/log.js";
import { IBP_ERR } from "./protocol.js";
import { I_AM } from "../materials/being/seedBeings.js";
import { getWordSync } from "../present/word/wordStore.js";
import { isExtensionBlockedAtSpace } from "../materials/space/extensionScope.js";
import { authorizeViaAbles } from "./ableAuth.js";
import { getSpaceRootId } from "../sprout.js";
import { getStoryDomain } from "./address.js";
import { resolveTargetHistory } from "./historyResolve.js";

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
  // is blocked at the target's ancestor chain. Orthogonal to ables.
  if (
    verb === "do" &&
    target?.spaceId &&
    typeof args.action === "string" &&
    args.action.includes(":")
  ) {
    try {
      const op = getWordSync(args.action); // ext-scope gate reads the fold, not the Map (10.md step 6)
      const ownerExt = op?.ownerExtension;
      if (ownerExt && ownerExt !== "seed") {
        const blocked = await isExtensionBlockedAtSpace(
          ownerExt,
          target.spaceId,
        );
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

  // 4. The able-walk. Anonymous callers → implicit arrival floor.
  // Authenticated callers → walk qualities.ablesGranted.
  //
  // Two histories surface here:
  //
  //   • targetHistory — where the target lives. Used to look up able
  //     specs on the target's qualities chain, and to evaluate reach
  //     (which space's projection should the reach pattern walk).
  //     Precedence: the parsed target's own history is the most
  //     specific statement and wins; then the moment's seated
  //     targetHistory (where this moment's facts land — auth must
  //     evaluate the same world the stamp rides); then the actor's
  //     act history (same-world acts); then the caller's session
  //     history as the last resort (SEE ops and other targets that
  //     have no world of their own are evaluated from where the
  //     caller stands).
  //
  //   • actorHistory — the actor's history, where their grants live.
  //     Caller passes args.actorHistory from socket.currentHistory
  //     (seated by BE:birth/connect/release/switch). When a being is
  //     seated on #0 and SEEs onto history #1, their grants are read
  //     from #0 (where they actually exist), not from #1 (where they
  //     may not exist if their reel was created post-fork). This is
  //     the "look through the portal" semantic — you remain yourself
  //     when navigating across branches.
  //
  // Anonymous callers (no being bound, or the arrival floor's
  // identity) with no history anywhere fall to the operator's default
  // history via the pointer registry — never literal "0"; set-pointer
  // can re-point main. Authenticated callers with no history anywhere
  // are a perimeter threading bug: fail loud.
  // Shared precedence (PORT-NOTES #10): target.history →
  // moment.targetHistory → moment.actorAct.history → the caller's
  // seated history (args.actorHistory here). Identical chain to the verb
  // layer's resolveHistoryForFact, so the history that GATES an act and
  // the history a fact STAMPS on can never diverge.
  let targetHistory = resolveTargetHistory({
    target,
    moment,
    currentHistory: args.actorHistory,
  });
  if (!targetHistory) {
    const isAnonymous = !identity?.beingId || identity?.name === "arrival";
    if (isAnonymous) {
      const { getDefaultHistory } =
        await import("../materials/history/historyRegistry.js");
      targetHistory = await getDefaultHistory();
    } else {
      throw new Error(
        `authorize: history could not be resolved for ${verb}:${args.action || args.seeOp || args.operation || args.intent || "?"} ` +
          `(identity=${identity?.name || identity?.beingId || "anonymous"}). ` +
          `Pass moment, include history on the parsed target, or thread actorHistory.`,
      );
    }
  }
  // actorHistory falls back to the moment's actor history, then to
  // targetHistory (genesis/scaffold paths where there's no separate
  // session history). Same-history acts collapse to one value naturally.
  //
  // Foreign-actor guard: an inbound cross-story actor's act carries
  // THEIR home history — a path in another substrate's namespace.
  // Looking their grants up on that path locally is meaningless at
  // best (no such history row → noisy cold-fold failure) and wrong at
  // worst (a coincidentally same-named local history). Any ables a
  // foreign actor holds HERE were granted here, on local histories, so
  // their grants read from the target's history instead.
  const actorActIsLocal =
    !moment?.actorAct?.story || moment.actorAct.story === getStoryDomain();
  const actorHistory =
    args.actorHistory ||
    (actorActIsLocal ? moment?.actorAct?.history : null) ||
    targetHistory;
  const result = await authorizeViaAbles({
    identity,
    verb,
    target,
    action: args.action || null,
    intent: args.intent || null,
    operation: args.operation || null,
    seeOp: args.seeOp || null,
    history: targetHistory,
    actorHistory,
  });

  // Adapt to the verb-dispatch return shape. ableAuth returns
  // {ok, able?, anchor?, reason?}; verb dispatchers expect {ok, actor, reason?}.
  if (result.ok) {
    return {
      ok: true,
      actor: result.able || "permitted",
      reason: result.reason || null,
    };
  }

  // 5. Inheritation coverage (fallback, DO-on-being only). The able-walk
  // is the CAPABILITY axis; the being-tree is the orthogonal DOWNWARD-
  // AUTHORITY axis. A Name that owns the target being (or any ancestor),
  // or holds an inheritation point covering it, has authority over it
  // even with no able grant — the same authority that lets it grant/
  // revoke points there. Consulted ONLY after a able denial, so able-
  // authorized acts (the hot path) never pay for the tree walk. Purely
  // additive: it can GRANT but never deny.
  if (verb === "do" && identity?.nameId && args.auditBeingId) {
    const { hasAuthorityOver } =
      await import("../materials/being/identity/inheritation.js");
    if (
      await hasAuthorityOver(
        identity.nameId,
        String(args.auditBeingId),
        targetHistory,
      )
    ) {
      return { ok: true, actor: String(identity.nameId) };
    }
  }

  return {
    ok: false,
    actor: "anonymous",
    reason: result.reason || null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Auth config flags (birth/connect enabled) — orthogonal to ables
// ─────────────────────────────────────────────────────────────────────

/**
 * Read story-level BE config flags. Defaults to true/true. These
 * flags are operator-controlled toggles for the registration flow;
 * they're NOT permission rules. Stored under story-root
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
    birth_enabled: get("birth_enabled", true) !== false,
    connect_enabled: get("connect_enabled", true) !== false,
  };
}

// Re-export for use in verb handlers.
export { IBP_ERR };
