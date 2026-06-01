// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Resolving a stance to substrate.
//
// IBP gives the speaker a way to NAME what they're acting on
// (address.js). This file turns that name into the actual substrate
// facts a SEE / DO / SUMMON / BE handler needs to act: which Space,
// which tree, which being, what the path looks like top-down. The
// address grammar layer is pure parsing; this layer crosses into
// the world the address points at.
//
// Without me the four verbs couldn't reach the substrate at all —
// every verb call would just be a string. I take a stance and
// produce the handles (`spaceId`, `rootId`, `beingId`) that my
// substrate primitives actually mutate.
//
// Result shape:
//   {
//     isSpaceRoot, isHomeRoot — flags describing leaf semantics
//     spaceId, rootId        — substrate handles (rootId = enclosing tree)
//     chain                  — [{ name, id }] top-down (place root → leaf)
//     leafName, leafId       — convenience: last entry of chain
//     beingId, name          — populated when the address names a being
//                              (the @being qualifier or a "/~user" home)
//     being                  — the raw @label from the stance
//     leafSpace              — optional pass-through Space doc
//                              (descriptor builders use it to avoid
//                              a refetch)
//   }
//
// Every address resolves to a space and callers branch on positional
// flags; there is no longer a "zone" concept above the position.

import { IbpError, IBP_ERR } from "../ibp/protocol.js";
import { getRealityDomain } from "./address.js";
import Being from "../materials/being/being.js";
import Space from "../materials/space/space.js";
import { getSpaceRootId } from "../sprout.js";
import { resolveRootSpace } from "../materials/space/spaces.js";
import { SEED_SPACE } from "../materials/space/seedSpaces.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {{ reality: string|null, path: string|null, being: string|null }} stance
 * @param {object} [opts]
 * @param {boolean} [opts.requireRealityMatch=true]
 *   reject stances whose reality doesn't match this server (only false for
 *   cross-reality previews that intentionally inspect remote paths).
 * @param {object|null} [opts.identity]
 *   the calling being's identity. Required when the path starts with "/~",
 *   because "~" means "the caller's homeSpace" — it's a self-relative
 *   shorthand, not a being-named address. Without identity, "/~" can't
 *   resolve.
 */
export async function resolveStance(stance, opts = {}) {
  const { requireRealityMatch = true, identity = null } = opts;
  if (!stance) {
    throw new IbpError(IBP_ERR.ADDRESS_PARSE_ERROR, "Stance is required");
  }

  const localReality = getRealityDomain();
  const stanceReality = stance.reality || localReality;
  if (requireRealityMatch && stanceReality !== localReality) {
    throw new IbpError(
      IBP_ERR.SPACE_NOT_FOUND,
      `Reality "${stanceReality}" is not served by this server`,
      { stanceReality, serverReality: localReality },
    );
  }

  const path = stance.path || "/";
  const being = stance.being || null;

  // Place root: path is "/". The place root IS a Space (the seedSpace:
  // SPACE_ROOT row created by ensureSpaceRoot), so we surface its id as
  // spaceId. That makes beings whose home is the place root —
  // reality-manager, llm-assigner, auth — summonable: the inbox sits on
  // the place-root space like any other position.
  if (path === "/") {
    const spaceRootId = getSpaceRootId();
    return base({
      isSpaceRoot: true,
      spaceId: spaceRootId,
      leafId: spaceRootId,
      being,
    });
  }

  // Home shorthand: path starts with "/~". "~" means "a being's
  // homeSpace" — which being is decided by the @qualifier:
  //
  //   "<reality>/~@tabor"  — tabor's home (explicit being)
  //   "<reality>/~"        — the caller's own home (implicit, default)
  //
  // Both forms collapse to a normal Space resolution. "~" is sugar; the
  // resolver swaps it for the actual Being.homeSpace row. Anything
  // after "/~/" walks into children of that home, e.g.
  // "<reality>/~@tabor/projects" → tabor's home's "projects" child.
  if (path.startsWith("/~")) {
    // Pick the target being. An explicit @qualifier wins; otherwise
    // default to the caller. Without either, "~" has nothing to
    // attach to.
    let targetBeing = null;
    if (being) {
      targetBeing = await Being.findOne({ name: being })
        .select("_id name homeSpace")
        .lean();
      if (!targetBeing) {
        throw new IbpError(
          IBP_ERR.BEING_NOT_FOUND,
          `No being named "${being}" on this reality`,
          { being },
        );
      }
    } else {
      if (!identity?.beingId) {
        throw new IbpError(
          IBP_ERR.UNAUTHORIZED,
          `Cannot resolve "~" without an @qualifier and no caller identity`,
        );
      }
      targetBeing = await Being.findById(identity.beingId)
        .select("_id name homeSpace")
        .lean();
      if (!targetBeing) {
        throw new IbpError(
          IBP_ERR.BEING_NOT_FOUND,
          `Caller being not found`,
          { beingId: String(identity.beingId) },
        );
      }
    }
    if (!targetBeing.homeSpace) {
      throw new IbpError(
        IBP_ERR.SPACE_NOT_FOUND,
        `@${targetBeing.name} has no homeSpace`,
        { beingId: String(targetBeing._id) },
      );
    }

    // "/~" stays literal — the parser no longer auto-expands it.
    // Everything after "/~" is a walk INTO the resolved home's
    // children: "/~" → [], "/~/projects" → ["projects"].
    const subPath = path.slice(2).split("/").filter(Boolean);

    const homeSpace = await Space
      .findById(targetBeing.homeSpace)
      .select("_id name type status parent rootOwner contributors visibility qualities")
      .lean();
    if (!homeSpace) {
      throw new IbpError(
        IBP_ERR.SPACE_NOT_FOUND,
        `@${targetBeing.name}'s homeSpace row not found`,
        { beingId: String(targetBeing._id), homeSpace: String(targetBeing.homeSpace) },
      );
    }

    // Display name for the home segment. Self-relative "/~" (no
    // @qualifier) stays cosmetic — chain shows "~" and the descriptor's
    // pathByNames reads back as "/~". With an explicit @qualifier the
    // sugar dissolves into the real space name: "/~@salem" displays
    // as "/<salem-home-name>".
    const homeChainName = being ? homeSpace.name : "~";

    if (subPath.length === 0) {
      // Resolve to the homeSpace itself. Normal placeAtSpace handles
      // the descriptor — no home-specific branching downstream.
      let rootId = null;
      try {
        const treeRoot = await resolveRootSpace(homeSpace._id);
        rootId = treeRoot?._id || null;
      } catch {
        rootId = homeSpace.rootOwner ? homeSpace._id : null;
      }
      return base({
        beingId: targetBeing._id,
        name: targetBeing.name,
        rootId,
        spaceId: homeSpace._id,
        chain: [{ name: homeChainName, id: homeSpace._id }],
        leafName: homeChainName,
        leafId: homeSpace._id,
        being,
        leafSpace: homeSpace,
      });
    }

    // Walk children of the homeSpace.
    return walkSpacePath({
      segments: subPath,
      ownerFilter: {},
      contextBeing: null,
      being,
      startAt: { ...homeSpace, name: homeChainName },
    });
  }

  // Plain position: "/<segments>". First segment is a tree root under
  // the place root.
  const segments = path.slice(1).split("/").filter(Boolean);
  if (segments.length === 0) {
    throw new IbpError(IBP_ERR.ADDRESS_PARSE_ERROR, `Invalid path "${path}"`);
  }
  return walkSpacePath({
    segments,
    ownerFilter: {},
    contextBeing: null,
    being,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────

/**
 * Base resolved-stance shape. All fields present (most null) so callers
 * can destructure without optional chaining and `Array.isArray(chain)`
 * is a reliable resolved-stance discriminator.
 */
function base(over = {}) {
  return {
    isSpaceRoot: false,
    isHomeRoot: false,
    beingId: null,
    name: null,
    rootId: null,
    spaceId: null,
    chain: [],
    leafName: null,
    leafId: null,
    being: null,
    leafSpace: null,
    ...over,
  };
}

/**
 * Walk a sequence of path segments under the place root, matching each
 * segment by UUID (preferred) or by name. Returns the resolved-stance
 * shape pointing at the final leaf.
 *
 * `startAt` (optional) seeds the walk inside a known Space row instead
 * of starting from the place root — used by the "/~" branch to walk
 * children of the caller's homeSpace.
 */
async function walkSpacePath({ segments, ownerFilter, contextBeing, being, startAt = null }) {
  const spaceRootId = getSpaceRootId();
  if (!spaceRootId) {
    throw new IbpError(IBP_ERR.INTERNAL, "Space root not initialized yet");
  }

  const chain = startAt
    ? [{ name: startAt.name, id: startAt._id }]
    : (contextBeing
        ? [{ name: `~${contextBeing.name}`, id: contextBeing._id }]
        : []);

  let currentParent = startAt ? startAt._id : spaceRootId;
  let leafSpace = startAt;

  // Track whether we're currently inside the heaven region. Heaven (".",
  // SEED_SPACE.HEAVEN) sits directly under the place root and parents
  // every Tier-3 seed space (identity, config, tools, roles,
  // operations, extensions, source, peers, threads). Descending into
  // heaven or one of its Tier-3 children requires letting the
  // seedSpace filter off. Once we pass through a Tier-3 child into
  // a normal sub-row (e.g. `./roles/<role-name>`), seed-space children
  // are no longer expected . the filter goes back on.
  let parentSeedSpace = null;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isFirst = i === 0;
    // Heaven's name at depth 0. The bare "." is the door into the
    // I-Am's room; we let the seedSpace filter off so the heaven row
    // (seedSpace: "heaven") resolves. No other dot-prefixed segment
    // lives directly under the place root anymore . the legacy
    // ".config" / ".tools" etc shape retired 2026-06-01; all Tier-3
    // seed spaces now live under heaven.
    const isHeavenDoor = isFirst && seg === ".";
    // Heaven children: when the parent we just descended into is
    // heaven itself, drop the seedSpace:null filter so its Tier-3
    // seed-space children (config, tools, roles, ...) resolve.
    // Without this, paths like `/./roles` SPACE_NOT_FOUND at depth 1
    // because `roles` IS a seedSpace and would get filtered out.
    const parentIsHeaven = parentSeedSpace === SEED_SPACE.HEAVEN;
    const allowSeedSpaceChildren = isHeavenDoor || parentIsHeaven;
    const baseQuery = {
      parent: currentParent,
      ...(allowSeedSpaceChildren ? {} : { seedSpace: null }),
      ...(isFirst && !isHeavenDoor ? ownerFilter : {}),
    };

    const fields =
      "_id name type status parent rootOwner contributors visibility qualities seedSpace";
    let space = null;
    if (UUID_RE.test(seg)) {
      space = await Space.findOne({ ...baseQuery, _id: seg })
        .select(fields)
        .lean();
    }
    if (!space) {
      space = await Space.findOne({ ...baseQuery, name: seg })
        .select(fields)
        .lean();
    }
    if (!space) {
      throw new IbpError(
        IBP_ERR.SPACE_NOT_FOUND,
        `Segment "${seg}" not found at depth ${i} of path`,
        { segment: seg, depth: i, parent: currentParent },
      );
    }

    chain.push({ name: space.name, id: space._id });
    currentParent = space._id;
    leafSpace = space;
    parentSeedSpace = space.seedSpace || null;
  }

  // The enclosing tree root. Walk up to the nearest space with rootOwner;
  // a space may itself be a root.
  let rootId = null;
  try {
    const treeRoot = await resolveRootSpace(leafSpace._id);
    rootId = treeRoot?._id || null;
  } catch {
    rootId = leafSpace.rootOwner ? leafSpace._id : null;
  }

  return base({
    beingId: contextBeing?._id || null,
    name: contextBeing?.name || null,
    rootId,
    spaceId: leafSpace._id,
    chain,
    leafName: leafSpace.name,
    leafId: leafSpace._id,
    being,
    leafSpace,
  });
}
