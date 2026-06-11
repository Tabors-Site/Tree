// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// roleAuth.js — the role-walk authorize.
//
// Per seed/RolesAreAuth.md "Final doctrine": every role-in-effect
// lives on a space's `qualities.roles[<name>]`. A being's grants
// (in qualities.rolesGranted) reference the role by name + the
// anchor space where it was hosted. To check if a grant permits an
// action at a target:
//
//   1. Walk the grant's anchorSpaceId UP the qualities chain
//      looking for `qualities.roles[<name>]`. The first ancestor
//      that has it IS the role's host.
//   2. Compute the host's natural coverage (host + descendants) AND
//      apply the role's `reach` filter (additions and !-prefix
//      exclusions) to decide if the target is reachable.
//   3. If reachable, check the role's canX against the verb +
//      action/intent/operation. Match → allow.
//
// The walk:
//   - I-Am bypass (bootstrap axiom; never walks the space chain).
//   - Anonymous arrival floor (implicit arrival role on the reality
//     root; canSee:* + canBe:["birth","connect","release"]).
//   - For each grant in identity.rolesGranted: getRoleSpec → reach
//     check → canX check → first match wins.
//
// Pattern matching: small grammar.
//   - <exact-path>      — match by exact pathByNames (when known)
//   - <spaceId>         — match by exact space id
//   - prefix/**         — any descendant (any depth)
//   - prefix/*          — direct children only
//   - **                — wildcard (everything)
//   - !<pattern>        — exclude (carve out from the default base)
//
// Default base coverage for a role hosted at H: every target at or
// below H. The `reach` list adjusts the base in order; later entries
// win on conflict.

import { I_AM } from "../materials/being/seedBeings.js";
import { loadOrFold } from "../materials/projections.js";
import { getSpaceRootId } from "../sprout.js";
import { getAncestorChain } from "../materials/space/ancestorCache.js";
import {
  getRoleSpecForGrant,
  roleReachesTarget as reachCovers,
} from "../present/roles/spaceLookup.js";

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
  const { identity, verb, target, action, intent, operation, seeOp, branch } = args || {};
  if (typeof branch !== "string" || !branch.length) {
    throw new Error(
      "authorizeViaRoles requires `branch` as a non-empty string. " +
      "Callers must pass summonCtx.actorAct?.branch (or '0' for genesis / pre-summon paths) " +
      "explicitly; no silent default.",
    );
  }
  // actorBranch = the actor's branch (their session.currentBranch
  // or homeBranch). Where their grants actually live. branch (= target's
  // branch) is used for role spec lookups and reach evaluation; actor's
  // grants are loaded from actorBranch so a being seated on #0 can SEE
  // onto branch #1 without needing to exist on #1 (the "look through
  // the portal" semantic). Defaults to branch when caller didn't
  // distinguish.
  const actorBranch = args.actorBranch || branch;

  // Bootstrap axiom.
  if (identity?.beingId === I_AM || identity?.name === I_AM) {
    return { ok: true, role: "i-am", anchor: null };
  }

  // Anonymous arrival floor. Stateless callers run under the implicit
  // arrival role (looked up at the reality root's qualities.roles or
  // — if not yet installed there — the in-memory REGISTRY).
  if (!identity?.beingId) {
    return await checkArrivalFloor({ verb, target, action, intent, operation, seeOp, branch });
  }

  // Ownership step (seed/RolesAreAuth.md "Nearest claim wins").
  // Walk target's ancestors looking for the NEAREST space with a
  // non-empty members.owner — that's the space's "claim." Two cases:
  //
  //   1. Actor in the claim's owners → ALLOW (private ownership).
  //   2. Someone else's claim → fall through to the role-walk; actor
  //      might still have a granted role reaching here.
  //
  // Nearest-claim-wins means a private sub-space inside a public-owned
  // commons IS private (the inner owner "takes over"). Without this
  // rule, ownership inheritance would leak through any sub-space, and
  // staking a private claim inside a commons would be impossible.
  //
  // Owner is the ONE base-axiom membership class. All other authority
  // shapes live in the role registry — operators model "secondary
  // owners" as roles with the right canDo (set-role, grant-role,
  // create-space, etc.). Custom members.<class> entries are
  // operator-authored bookkeeping and do NOT gate authorize.
  //
  // @public's spaces are NOT special at this layer. A public-owned
  // space is just a space whose owner happens to be @public. Visitors
  // get admitted via the regular role-walk because public's roles use
  // acquisition.autoOnEntry=true to silently grant on first SEE; the
  // grant rides in qualities.rolesGranted and the role-walk picks it
  // up uniformly. No "public-commons" branch lives in this file.
  const targetSpaceForOwner = deriveSpaceId(target);
  if (targetSpaceForOwner) {
    const claim = await findNearestOwnedAncestor(String(targetSpaceForOwner), branch);
    if (claim) {
      const actorIdStr = String(identity.beingId);
      if (claim.ownerIds.some((id) => String(id) === actorIdStr)) {
        return { ok: true, role: "owner", anchor: claim.spaceId };
      }
      // Else: someone else's claim. Fall through to role-walk.
    }
  }

  // Load the caller's grants from their ACTOR branch (their home
  // branch / session.currentBranch), NOT the target's branch. A being
  // seated on #0 looking onto branch #1 reads their own grants from
  // #0 (where they exist), then we evaluate reach against the target
  // on branch #1. This is the "stay yourself when navigating across
  // branches" semantic — your identity travels with you; only an
  // explicit be:switch changes the branch your session rides.
  const slot = await loadOrFold("being", String(identity.beingId), actorBranch);
  const grants = readGrantsFromSlot(slot);

  const targetPath  = derivePath(target);
  const targetBeing = deriveBeingName(target);
  let targetSpace = deriveSpaceId(target);
  // Fallback: when target carries no spaceId (BE on self, SUMMON to a
  // bare stance, DO on a being-target where the verb didn't resolve
  // the auth space upstream), use the ACTOR's current position. This
  // lets roles with no explicit reach (default = host + descendants)
  // gate the action at the actor's standing space. Without this
  // fallback, BE on self always denied because reachCovers needs a
  // spaceId to evaluate "is target at or below the role's host."
  if (!targetSpace) {
    targetSpace = String(slot?.state?.position || slot?.state?.homeSpace || "") || null;
  }

  for (const grant of grants) {
    const { spec, hostSpaceId } = await getRoleSpecForGrant(grant, branch);
    if (!spec) continue;

    if (!await reachCovers(spec, hostSpaceId, { spaceId: targetSpace, path: targetPath }, branch)) {
      continue;
    }

    if (!permits(spec, verb, { action, intent, operation, seeOp, targetBeing })) {
      continue;
    }

    return {
      ok: true,
      role: grant.role,
      anchor: hostSpaceId || grant.anchorSpaceId || null,
    };
  }

  // Cross-reality fallback. A canopy-verified foreign actor has an
  // identity (the verified beingId on their home reality) but no local
  // grants here (their being row doesn't exist on this reality). Fall
  // through to the arrival floor so they can at least reach what every
  // anonymous visitor can . SUMMON @cherub:mate (cross-world
  // citizenship via vessel), SUMMON @federation-manager (initiate a
  // negotiation), arrival-view SEE. Without this fallthrough, any
  // peer reality's outbound SUMMON to @federation-manager would deny
  // because the local grants table has no record of the remote
  // federation-manager being.
  if (identity?.canopyVerifiedSender || identity?.reality) {
    return await checkArrivalFloor({ verb, target, action, intent, operation, seeOp, branch });
  }

  return {
    ok: false,
    reason: `no granted role permits ${verb}` +
      (action ? `:${action}` : operation ? `:${operation}` : intent ? `:${intent}` : "") +
      ` at this target`,
  };
}

// ────────────────────────────────────────────────────────────────────
// Ownership — nearest-claim-wins
// ────────────────────────────────────────────────────────────────────

/**
 * Walk targetSpaceId up the ancestor chain looking for the NEAREST
 * ancestor (including target) whose `owner` is set. Returns
 * { spaceId, ownerIds[] } for that ancestor, or null when no ancestor
 * on the chain has an owner.
 *
 * "Nearest claim wins" — a private sub-space inside a public-owned
 * commons claims itself, and that private claim takes precedence over
 * the inherited public ownership above. Without this rule, commons
 * inheritance would leak through into every private sub-space.
 * See seed/RolesAreAuth.md "@public being".
 */
async function findNearestOwnedAncestor(targetSpaceId, branch) {
  // Self space first. loadOrFold inherits from main for branches
  // that haven't diverged this space — otherwise a branch read would
  // miss the owner that was set on main.
  const self = await loadOrFold("space", targetSpaceId, branch);
  const selfOwners = readOwners(self?.state);
  if (selfOwners.length > 0) {
    return { spaceId: String(targetSpaceId), ownerIds: selfOwners };
  }

  let chain = null;
  try { chain = await getAncestorChain(targetSpaceId, branch); } catch { chain = null; }
  if (!Array.isArray(chain)) return null;
  for (const node of chain) {
    const slot = await loadOrFold("space", String(node._id), branch);
    const owners = readOwners(slot?.state);
    if (owners.length > 0) {
      return { spaceId: String(node._id), ownerIds: owners };
    }
  }
  return null;
}

function readOwners(state) {
  if (!state) return [];
  return state.owner ? [String(state.owner)] : [];
}

// ────────────────────────────────────────────────────────────────────
// canX matching (action-only; no patterns inside canX)
// ────────────────────────────────────────────────────────────────────

function permits(spec, verb, { action, intent, operation, seeOp, targetBeing }) {
  if (verb === "see")    return permitsSee(spec, seeOp);
  if (verb === "do")     return permitsDo(spec, action);
  if (verb === "summon") return permitsSummon(spec, targetBeing, intent);
  if (verb === "be")     return permitsBe(spec, operation);
  return false;
}

function permitsSee(spec, seeOp) {
  if (!Array.isArray(spec.canSee) || spec.canSee.length === 0) return false;
  // canSee enumerates the SEE ops a role can dispatch. Raw-address SEE
  // requires "*" — roles with only named-op entries (arrival's
  // ["arrival-view"], global's ["place"]) refuse raw position SEE.
  // The see verb wraps this with an anonymous-redirect: when arrival
  // gets refused on raw SEE, the verb dispatches arrival-view instead.
  for (const entry of spec.canSee) {
    const name = typeof entry === "string" ? entry : entry?.name;
    if (!name) continue;
    if (name === "*") return true;
    if (seeOp && name === seeOp) return true;
  }
  return false;
}

function permitsDo(spec, action) {
  if (!action || !Array.isArray(spec.canDo)) return false;
  for (const entry of spec.canDo) {
    const a = typeof entry === "string" ? entry : entry?.action;
    if (!a) continue;
    if (a === "*") return true;
    if (a === action) return true;
    // Namespace match: action `set-being:position` matches canDo `set-being:*` or `set-being`.
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

// canSummon's auth path. A role declares its summon participation —
// some entries are caller-side ("I can summon these"), some are
// receiver-side ("I accept these"). The discriminator is `as`:
//   "actor"     — caller side; this role can SEND this summon (default)
//   "receiver"  — receiver side; this role ACCEPTS this summon
//
// Authorization here checks the CALLER'S role, so only entries with
// `as: "actor"` (or absent — the legacy/default sense) count.
// Receiver-side acceptance is checked separately at the summon verb
// via `permitsReceiverSummon` below (the "other half of the post
// office check" per seed/SUMMON.md).
function permitsSummon(spec, targetBeing, intent) {
  if (!Array.isArray(spec.canSummon)) return false;
  for (const entry of spec.canSummon) {
    if (typeof entry === "object" && entry?.as === "receiver") continue;
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

/**
 * Receiver-side acceptance check. Asks the RECEIVER'S role spec
 * whether it accepts a summon with the given intent. Per seed/SUMMON.md
 * this is the second half of the post office check — the actor's
 * authorize() gates the OUTGOING side; this gates the INCOMING side.
 *
 * Progressive enhancement (the safe shape): a role with NO `as: receiver`
 * canSummon entries is unrestricted and accepts any incoming summon.
 * A role with at least one `as: receiver` entry has DECLARED its
 * accepted intents; the receiver check then becomes strict — the
 * envelope intent must match an entry's intent (or wildcard "*"), or
 * the summon refuses with a "role X does not accept intent Y" reason.
 *
 * @param {object} role     receiver's role spec (from registry.getRole)
 * @param {string} intent   envelope intent (null/undefined allowed)
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function permitsReceiverSummon(role, intent) {
  if (!role || typeof role !== "object") {
    return { ok: false, reason: "receiver role missing" };
  }
  const receiverEntries = Array.isArray(role.canSummon)
    ? role.canSummon.filter((e) => typeof e === "object" && e?.as === "receiver")
    : [];
  if (receiverEntries.length === 0) {
    // No declared receiver entries → role accepts anything. Current
    // behavior for roles that haven't yet declared their accepted
    // intents; preserves cross-reality summons and all legacy paths
    // until each role authors its receiver list.
    return { ok: true };
  }
  // Role HAS declared receiver entries → intent is required and must
  // match one of them. A summon without intent to a role with
  // declared receiver entries refuses; omitting intent can't be used
  // to bypass the receiver gate.
  if (!intent) {
    const declared = receiverEntries.map((e) => e?.intent || "(any)").join(", ");
    return {
      ok: false,
      reason: `role "${role.name}" declares accepted intents [${declared}] but the summon carried no intent`,
    };
  }
  for (const entry of receiverEntries) {
    const want = entry?.intent;
    if (!want || want === "*" || want === intent) return { ok: true };
  }
  const declared = receiverEntries.map((e) => e?.intent || "(any)").join(", ");
  return {
    ok: false,
    reason: `role "${role.name}" does not accept intent "${intent}" (accepts: ${declared})`,
  };
}

function permitsBe(spec, operation) {
  if (!operation || !Array.isArray(spec.canBe)) return false;
  for (const entry of spec.canBe) {
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

async function checkArrivalFloor({ verb, target, action, intent, operation, seeOp, branch }) {
  // The arrival role's host IS the reality root. The shared lookup
  // walks anchorSpaceId=realityRoot for qualities.roles.arrival; the
  // registry fallback covers boot-order edges before install.
  const realityRootId = getSpaceRootId();
  const { spec, hostSpaceId } = await getRoleSpecForGrant(
    { role: ARRIVAL_ROLE, anchorSpaceId: realityRootId },
    branch,
  );
  if (!spec) {
    return { ok: false, reason: "no arrival role registered; anonymous callers have no floor." };
  }

  const targetPath  = derivePath(target);
  const targetSpace = deriveSpaceId(target);
  const targetBeing = deriveBeingName(target);

  if (!await reachCovers(spec, hostSpaceId, { spaceId: targetSpace, path: targetPath }, branch)) {
    return { ok: false, reason: "arrival floor does not reach this position." };
  }
  if (permits(spec, verb, { action, intent, operation, seeOp, targetBeing })) {
    return { ok: true, role: ARRIVAL_ROLE, anchor: hostSpaceId };
  }
  return { ok: false, reason: "arrival floor does not permit this action; please authenticate." };
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
