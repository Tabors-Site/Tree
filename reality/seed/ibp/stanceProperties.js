// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Stance properties. The facts a SEE, DO, SUMMON, or BE brings to
// the gate.
//
// Every verb call has an asker (the being on the left of the
// address) and a target (the position on the right). Before any
// SEE / DO / SUMMON / BE places, the gate (authorize.js) has to know
// how the asker relates to the target — is it their home? do they
// own this space? are they a contributor anywhere up the chain? are
// they arriving without an identity? This file computes that bag
// of facts.
//
// Pure read. This function never writes; it just collects facts
// from Layer 1 sources (Being row + Space fields + ancestor cache).
// There is no duplication of state — the stance bag is a computed
// projection of substrate data the gate consults.
//
// Output shape (every field always present so the comparator can do
// simple equality / membership checks without undefined sniffing):
//
//   {
//     beingId, name, role,
//
//     // identity-tier markers
//     arrival,                  // true when no beingId resolves
//
//     // membership-class markers (relative to targetSpace, walked up
//     // the ancestor chain)
//     owner,                    // is in `owner` class on the closest
//                                  ancestor that has one
//     contributor,              // is in `contributor` class anywhere
//                                  on the chain between target and
//                                  the ownership boundary
//     hasAccess,                 // owner OR any trust class — convenience
//                                  shorthand for "in any trust class"
//     memberClasses,            // [string] every class this being is in
//                                  across the walked chain (owner +
//                                  contributor + custom: auditor / editor
//                                  / angel / etc.). The rule comparator
//                                  uses `requires: { memberClasses:
//                                  { includes: "<className>" } }` to gate
//                                  on custom classes.
//
//     // home relations
//     homeAtPosition,           // home === target
//     homeInDomain,             // target is an ancestor of home (home lives inside target's subtree)
//     positionInHomeDomain,     // home is an ancestor of target (target lives inside home's subtree)
//
//     // federation
//     homeOnThisReality,        // !being.isRemote
//     federatedFrom,            // being.homeReality if remote, else null
//   }
//
// History. The earlier `reigning` stance tracked heaven's roster as a
// separate quality; it was redundant with the ownership model and
// retired 2026-06-04. The earlier `rootOwner` / `contributors[]`
// schema fields were unnamed two-class storage; they retired 2026-06-07
// in favor of the membership-class primitive (members map). Heaven's
// authority class is now named `angel`, accessible via memberClasses
// includes-comparator instead of an unnamed flag. See PERMISSIONS.md.
//
// Pure: no side effects, no throws on missing data. Defensive against
// stale beingIds (returns arrival shape).

import Being from "../materials/being/being.js";
import { resolveSpaceAccess } from "../materials/space/spaces.js";
import { getAncestorChain } from "../materials/space/ancestorCache.js";

const ARRIVAL_PROPS = Object.freeze({
  beingId: null,
  name: null,
  role: null,
  arrival: true,
  owner: false,
  contributor: false,
  hasAccess: false,
  memberClasses: Object.freeze([]),
  homeAtPosition: false,
  homeInDomain: false,
  positionInHomeDomain: false,
  // homeAncestors: the set of spaceIds along the home's ancestor chain
  // (including the home itself). Layer 4's comparator uses this to
  // resolve scoped checks like `homeInDomain: "<rulership-spaceId>"`
  // ("is this specific space anywhere in the home's ancestry?").
  homeAncestors: Object.freeze([]),
  homeOnThisReality: true,
  federatedFrom: null,
});

/**
 * @param {object} args
 * @param {string|null} args.beingId       acting being's id (null = unauthenticated arrival)
 * @param {string|null} args.targetSpace  the position the verb is acting on (null = reality/discovery)
 * @returns {Promise<object>}              the stance property bag
 */
export async function deriveStanceProperties({
  beingId,
  targetSpace,
  branch = "0",
}) {
  if (!beingId) return { ...ARRIVAL_PROPS };

  // loadOrFold (not loadProjection): on a fresh branch the being's slot
  // hasn't been cold-folded yet. A bare loadProjection returns null and
  // this function falls back to ARRIVAL_PROPS — the user is silently
  // treated as a stranger, loses owner/contributor relations, and
  // gets denied at heaven on every branch they create. loadOrFold
  // walks the lineage (branchPoint-respecting) so the slot resolves
  // the same way it does on main.
  const { loadOrFold } = await import("../materials/projections.js");
  const slot = await loadOrFold("being", beingId, branch);
  if (!slot) return { ...ARRIVAL_PROPS, beingId };
  const being = { _id: slot.id, ...slot.state };

  const props = {
    beingId: String(being._id),
    name: being.name,
    // `role` here is the derived default capacity for authorization
    // gating when the summon hasn't named an active role. The verb
    // handler passes `activeRole` separately into authorize so
    // per-role gates can use the more specific value when present.
    role: being.defaultRole || null,
    arrival: false,
    owner: false,
    contributor: false,
    hasAccess: false,
    memberClasses: [],
    homeAtPosition: false,
    homeInDomain: false,
    positionInHomeDomain: false,
    homeAncestors: [],
    homeOnThisReality: !being.isRemote,
    federatedFrom: being.isRemote ? being.homeReality || null : null,
  };

  // Precompute the home's ancestor chain (as ids) so the comparator
  // can answer "is <some-spaceId> in this being's home ancestry?" with
  // a constant-time membership check. Includes the home itself.
  if (being.homeSpace) {
    try {
      const homeChain = await getAncestorChain(String(being.homeSpace), branch);
      if (Array.isArray(homeChain)) {
        props.homeAncestors = homeChain.map((n) => String(n._id));
      } else {
        props.homeAncestors = [String(being.homeSpace)];
      }
    } catch {
      props.homeAncestors = [String(being.homeSpace)];
    }
  }

  if (!targetSpace) return props;

  // Membership-class relations via the chain walker. The walker
  // collects every class this being is in across the walked ancestor
  // chain (including the canonical `owner` and `contributor`); the
  // property bag exposes that set as `memberClasses`. The convenience
  // flags `owner` / `contributor` / `hasAccess` mirror the canonical
  // classes for the common-case rule shapes
  // (`requires: { isOwner: true }`, `requires: { hasAccess: true }`).
  // Custom classes go through the `includes` comparator.
  try {
    const access = await resolveSpaceAccess(targetSpace, beingId, branch);
    if (access?.ok) {
      if (access.isOwner) props.owner = true;
      if (access.hasAccess && !access.isOwner) props.contributor = true;
      if (access.hasAccess) props.hasAccess = true;
      if (Array.isArray(access.memberClasses)) {
        props.memberClasses = access.memberClasses;
      }
    }
  } catch {
    /* defensive — leave as false */
  }

  // Home relations. Two directions: home-inside-target's-subtree, and
  // target-inside-home's-subtree. Either or both can be true.
  if (being.homeSpace) {
    const homeId = String(being.homeSpace);
    const targetId = String(targetSpace);

    if (homeId === targetId) props.homeAtPosition = true;

    // homeInDomain: targetSpace appears in home's ancestor chain.
    try {
      const homeChain = await getAncestorChain(homeId, branch);
      if (Array.isArray(homeChain)) {
        for (const anc of homeChain) {
          if (String(anc._id) === targetId) {
            props.homeInDomain = true;
            break;
          }
        }
      }
    } catch {
      /* defensive */
    }

    // positionInHomeDomain: homeSpace appears in target's ancestor chain.
    try {
      const targetChain = await getAncestorChain(targetId, branch);
      if (Array.isArray(targetChain)) {
        for (const anc of targetChain) {
          if (String(anc._id) === homeId) {
            props.positionInHomeDomain = true;
            break;
          }
        }
      }
    } catch {
      /* defensive */
    }
  }

  return props;
}

// Convenience exports for tests / instrumentation.
export const _internals = { ARRIVAL_PROPS };
