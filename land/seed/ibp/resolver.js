// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// IBP Address resolves to stance.
//
// Resolution turns a parsed stance into the concrete substrate facts a
// verb handler needs: which Space is being addressed, which tree contains
// it, which being (if any) is invoked, and the top-down path the client
// can use for breadcrumb-style rendering. Positions are flat space-IDs;
// flags on the result describe what kind of position the leaf is
// (land root, a being's home, or a plain space).
//
// Result shape:
//   {
//     isLandRoot, isHomeRoot — flags describing leaf semantics
//     spaceId, rootId         — substrate handles (rootId = enclosing tree)
//     chain                  — [{ name, id }] top-down (land root → leaf)
//     leafName, leafId       — convenience: last entry of chain
//     beingId, name          — populated when the address names a being
//                              (the @being qualifier or a "/~user" home)
//     being                  — the raw @label from the stance
//     leafSpace               — optional pass-through Space doc (descriptor
//                              builders use it to avoid a refetch)
//   }
//
// Per [[project_zones_retired]] the "zone" concept is gone; every
// address resolves to a space and callers branch on positional flags.

import { IbpError, IBP_ERR } from "../ibp/errors.js";
import { getLandDomain } from "./address.js";
import Being from "../models/being.js";
import Space from "../models/space.js";
import { getLandRootId } from "../landRoot.js";
import { resolveRootSpace } from "../land/space/spaceFetch.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {{ land: string|null, path: string|null, being: string|null }} stance
 * @param {object} [opts]
 * @param {boolean} [opts.requireLandMatch=true]
 *   reject stances whose land doesn't match this server (only false for
 *   cross-land previews that intentionally inspect remote paths).
 */
export async function resolveStance(stance, opts = {}) {
  const { requireLandMatch = true } = opts;
  if (!stance) {
    throw new IbpError(IBP_ERR.ADDRESS_PARSE_ERROR, "Stance is required");
  }

  const localLand = getLandDomain();
  const stanceLand = stance.land || localLand;
  if (requireLandMatch && stanceLand !== localLand) {
    throw new IbpError(
      IBP_ERR.SPACE_NOT_FOUND,
      `Land "${stanceLand}" is not served by this server`,
      { stanceLand, serverLand: localLand },
    );
  }

  const path = stance.path || "/";
  const being = stance.being || null;

  // Land root: path is "/". The land root IS a Space (the seedSpace:
  // LAND_ROOT row created by ensureLandRoot), so we surface its id as
  // spaceId. That makes beings whose home is the land root —
  // land-manager, llm-assigner, auth — summonable: the inbox sits on
  // the land-root space like any other position.
  if (path === "/") {
    const landRootId = getLandRootId();
    return base({
      isLandRoot: true,
      spaceId:     landRootId,
      leafId:     landRootId,
      being,
    });
  }

  // Being home: path starts with "/~". First segment after ~ names the
  // being; remaining segments walk into their home tree.
  if (path.startsWith("/~")) {
    const segments = path.slice(2).split("/").filter(Boolean);
    const name = segments[0];
    if (!name) {
      throw new IbpError(
        IBP_ERR.ADDRESS_PARSE_ERROR,
        `Invalid home path "${path}" (missing being name after ~)`,
      );
    }

    const beingDoc = await Being.findOne({ name }).select("_id name").lean();
    if (!beingDoc) {
      throw new IbpError(
        IBP_ERR.USER_NOT_FOUND,
        `No being named "${name}" on this land`,
        { name },
      );
    }

    const subPath = segments.slice(1);
    // Bare "/~name" → the home position itself.
    if (subPath.length === 0) {
      return base({
        isHomeRoot: true,
        beingId:    beingDoc._id,
        name:       beingDoc.name,
        chain:      [{ name: `~${beingDoc.name}`, id: beingDoc._id }],
        leafName:   `~${beingDoc.name}`,
        leafId:     beingDoc._id,
        being,
      });
    }

    // "/~name/<segments>" → walk the being's home tree.
    return walkSpacePath({
      segments:    subPath,
      ownerFilter: { rootOwner: beingDoc._id },
      contextBeing: beingDoc,
      being,
    });
  }

  // Plain position: "/<segments>". First segment is a tree root under
  // the land root.
  const segments = path.slice(1).split("/").filter(Boolean);
  if (segments.length === 0) {
    throw new IbpError(IBP_ERR.ADDRESS_PARSE_ERROR, `Invalid path "${path}"`);
  }
  return walkSpacePath({
    segments,
    ownerFilter:  {},
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
    isLandRoot: false,
    isHomeRoot: false,
    beingId:    null,
    name:       null,
    rootId:     null,
    spaceId:     null,
    chain:      [],
    leafName:   null,
    leafId:     null,
    being:      null,
    leafSpace:   null,
    ...over,
  };
}

/**
 * Walk a sequence of path segments under the land root, matching each
 * segment by UUID (preferred) or by name. Returns the resolved-stance
 * shape pointing at the final leaf.
 */
async function walkSpacePath({ segments, ownerFilter, contextBeing, being }) {
  const landRootId = getLandRootId();
  if (!landRootId) {
    throw new IbpError(IBP_ERR.INTERNAL, "Land root not initialized yet");
  }

  const chain = contextBeing
    ? [{ name: `~${contextBeing.name}`, id: contextBeing._id }]
    : [];

  let currentParent = landRootId;
  let leafSpace = null;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isFirst = i === 0;
    const baseQuery = {
      parent:     currentParent,
      seedSpace: null,
      ...(isFirst ? ownerFilter : {}),
    };

    const fields = "_id name type status parent rootOwner contributors visibility metadata";
    let space = null;
    if (UUID_RE.test(seg)) {
      space = await Space.findOne({ ...baseQuery, _id: seg }).select(fields).lean();
    }
    if (!space) {
      space = await Space.findOne({ ...baseQuery, name: seg }).select(fields).lean();
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
    beingId:  contextBeing?._id || null,
    name:     contextBeing?.name || null,
    rootId,
    spaceId:   leafSpace._id,
    chain,
    leafName: leafSpace.name,
    leafId:   leafSpace._id,
    being,
    leafSpace,
  });
}
