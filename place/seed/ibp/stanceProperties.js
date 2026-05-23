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
//     beingId, username, role, operatingMode,
//
//     // identity-tier markers
//     arrival,                  // true when no beingId resolves
//
//     // ownership-tier markers (relative to targetSpace)
//     owner,                    // is rootOwner along the chain
//     contributor,              // is in contributors[] along the chain
//
//     // home relations
//     homeAtPosition,           // home === target
//     homeInDomain,             // target is an ancestor of home (home lives inside target's subtree)
//     positionInHomeDomain,     // home is an ancestor of target (target lives inside home's subtree)
//
//     // federation
//     homeOnThisPlace,           // !being.isRemote
//     federatedFrom,            // being.homePlace if remote, else null
//   }
//
// Pure: no side effects, no throws on missing data. Defensive against
// stale beingIds (returns arrival shape).

import Being from "../models/being.js";
import { resolveSpaceAccess } from "../materials/space/spaceFetch.js";
import { getAncestorChain } from "../materials/space/ancestorCache.js";

const ARRIVAL_PROPS = Object.freeze({
  beingId:              null,
  name:                 null,
  role:                 null,
  operatingMode:        null,
  arrival:              true,
  owner:                false,
  contributor:          false,
  homeAtPosition:       false,
  homeInDomain:         false,
  positionInHomeDomain: false,
  // homeAncestors: the set of spaceIds along the home's ancestor chain
  // (including the home itself). Layer 4's comparator uses this to
  // resolve scoped checks like `homeInDomain: "<rulership-spaceId>"`
  // ("is this specific space anywhere in the home's ancestry?").
  homeAncestors:        Object.freeze([]),
  homeOnThisPlace:       true,
  federatedFrom:        null,
});

/**
 * @param {object} args
 * @param {string|null} args.beingId       acting being's id (null = unauthenticated arrival)
 * @param {string|null} args.targetSpace  the position the verb is acting on (null = place/discovery)
 * @returns {Promise<object>}              the stance property bag
 */
export async function deriveStanceProperties({ beingId, targetSpace }) {
  if (!beingId) return { ...ARRIVAL_PROPS };

  const being = await Being.findById(beingId)
    .select("name roles defaultRole operatingMode homeSpace isRemote homePlace")
    .lean();
  if (!being) return { ...ARRIVAL_PROPS, beingId };

  const props = {
    beingId:              String(being._id),
    name:             being.name,
    // `role` here is the derived default capacity for authorization
    // gating when the summon hasn't named an active role. The verb
    // handler passes `activeRole` separately into authorize so
    // per-role gates can use the more specific value when present.
    role:                 being.defaultRole || null,
    roles:                Array.isArray(being.roles) ? being.roles : [],
    operatingMode:        being.operatingMode || "human",
    arrival:              false,
    owner:                false,
    contributor:          false,
    homeAtPosition:       false,
    homeInDomain:         false,
    positionInHomeDomain: false,
    homeAncestors:        [],
    homeOnThisPlace:       !being.isRemote,
    federatedFrom:        being.isRemote ? (being.homePlace || null) : null,
  };

  // Precompute the home's ancestor chain (as ids) so the comparator
  // can answer "is <some-spaceId> in this being's home ancestry?" with
  // a constant-time membership check. Includes the home itself.
  if (being.homeSpace) {
    try {
      const homeChain = await getAncestorChain(String(being.homeSpace));
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

  // Ownership relations via the existing tree-access walker.
  try {
    const access = await resolveSpaceAccess(targetSpace, beingId);
    if (access?.ok) {
      if (access.isOwner) props.owner = true;
      // The access walker reports canWrite when the user owns OR is a
      // contributor anywhere on the chain. Mark contributor only when
      // not also the owner — owner subsumes it.
      if (access.canWrite && !access.isOwner) props.contributor = true;
    }
  } catch { /* defensive — leave as false */ }

  // Home relations. Two directions: home-inside-target's-subtree, and
  // target-inside-home's-subtree. Either or both can be true.
  if (being.homeSpace) {
    const homeId = String(being.homeSpace);
    const targetId = String(targetSpace);

    if (homeId === targetId) props.homeAtPosition = true;

    // homeInDomain: targetSpace appears in home's ancestor chain.
    try {
      const homeChain = await getAncestorChain(homeId);
      if (Array.isArray(homeChain)) {
        for (const anc of homeChain) {
          if (String(anc._id) === targetId) {
            props.homeInDomain = true;
            break;
          }
        }
      }
    } catch { /* defensive */ }

    // positionInHomeDomain: homeSpace appears in target's ancestor chain.
    try {
      const targetChain = await getAncestorChain(targetId);
      if (Array.isArray(targetChain)) {
        for (const anc of targetChain) {
          if (String(anc._id) === homeId) {
            props.positionInHomeDomain = true;
            break;
          }
        }
      }
    } catch { /* defensive */ }
  }

  return props;
}

// Convenience exports for tests / instrumentation.
export const _internals = { ARRIVAL_PROPS };
