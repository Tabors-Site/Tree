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
//     chain                  — [{ name, id }] top-down (reality root → leaf)
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
import { getSpaceOwner } from "../materials/space/members.js";
import { HEAVEN_SPACE } from "../materials/space/heavenSpaces.js";

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
  // Branch flows from the parsed stance. Null in the address means
  // "default to main" — resolve the operator's `#main` pointer through
  // the registry (which may have been re-pointed away from "0" via
  // set-pointer). Every return shape carries an explicit canonical
  // branch field; the verb layer reads this to thread into summonCtx
  // + emitFact.
  const { getDefaultBranch } = await import("../materials/branch/branchRegistry.js");
  const branch = stance.branch || await getDefaultBranch();

  // reality root: path is "/". The reality root IS a Space (the heavenSpace:
  // SPACE_ROOT row created by ensureSpaceRoot), so we surface its id as
  // spaceId. That makes beings whose home is the reality root —
  // reality-manager, llm-assigner, auth — summonable: the inbox sits on
  // the reality-root space like any other position.
  if (path === "/") {
    const spaceRootId = getSpaceRootId();
    return base({
      isSpaceRoot: true,
      spaceId: spaceRootId,
      leafId: spaceRootId,
      being,
      branch,
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
    const { findByName, loadOrFold } =
      await import("../materials/projections.js");
    if (being) {
      const slot = await findByName("being", being, branch);
      if (!slot) {
        throw new IbpError(
          IBP_ERR.BEING_NOT_FOUND,
          `No being named "${being}" on this reality`,
          { being },
        );
      }
      targetBeing = {
        _id: slot.id,
        name: slot.state?.name,
        homeSpace: slot.state?.homeSpace,
      };
    } else {
      if (!identity?.beingId) {
        throw new IbpError(
          IBP_ERR.UNAUTHORIZED,
          `Cannot resolve "~" without an @qualifier and no caller identity`,
        );
      }
      // loadOrFold (not loadProjection): on a branch, the caller's
      // being may have been created in main before the branch point,
      // so the branch slot doesn't exist yet. loadOrFold walks the
      // lineage and cold-folds from the appropriate reel.
      const slot = await loadOrFold("being", identity.beingId, branch);
      if (!slot) {
        throw new IbpError(IBP_ERR.BEING_NOT_FOUND, `Caller being not found`, {
          beingId: String(identity.beingId),
        });
      }
      targetBeing = {
        _id: slot.id,
        name: slot.state?.name,
        homeSpace: slot.state?.homeSpace,
      };
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

    // loadOrFold (not loadProjection): user's home may have been
    // created in main before the current branch. The lineage walk
    // produces the correct slot for the branch.
    const { loadOrFold: _lPhome } = await import("../materials/projections.js");
    const _hSlot = await _lPhome("space", targetBeing.homeSpace, branch);
    const homeSpace = _hSlot
      ? { _id: _hSlot.id, ...(_hSlot.state || {}) }
      : null;
    if (!homeSpace) {
      throw new IbpError(
        IBP_ERR.SPACE_NOT_FOUND,
        `@${targetBeing.name}'s homeSpace row not found`,
        {
          beingId: String(targetBeing._id),
          homeSpace: String(targetBeing.homeSpace),
        },
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
        rootId = getSpaceOwner(homeSpace) ? homeSpace._id : null;
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
        branch,
      });
    }

    // Walk children of the homeSpace.
    return walkSpacePath({
      segments: subPath,
      ownerFilter: {},
      contextBeing: null,
      being,
      branch,
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
    branch,
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
    // Branch the stance points at. Default "0" (main). The verb layer
    // reads this off the resolved stance to thread into summonCtx and
    // emitFact so every fact lands on the right branch's reel.
    branch: "0",
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
async function walkSpacePath({
  segments,
  ownerFilter,
  contextBeing,
  being,
  branch = "0",
  startAt = null,
}) {
  const spaceRootId = getSpaceRootId();
  if (!spaceRootId) {
    throw new IbpError(IBP_ERR.INTERNAL, "Space root not initialized yet");
  }

  const chain = startAt
    ? [{ name: startAt.name, id: startAt._id }]
    : contextBeing
      ? [{ name: `~${contextBeing.name}`, id: contextBeing._id }]
      : [];

  let currentParent = startAt ? startAt._id : spaceRootId;
  let leafSpace = startAt;

  // Track whether we're currently inside the heaven region. Heaven (".",
  // HEAVEN_SPACE.HEAVEN) sits directly under the reality root and parents
  // every Tier-3 heaven space (identity, config, tools, roles,
  // operations, extensions, source, peers, threads). Descending into
  // heaven or one of its Tier-3 children requires letting the
  // heavenSpace filter off. Once we pass through a Tier-3 child into
  // a normal sub-row (e.g. `./roles/<role-name>`), seed-space children
  // are no longer expected . the filter goes back on.
  let parentSeedSpace = null;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isFirst = i === 0;
    // Heaven's name at depth 0. The bare "." is the door into the
    // I-Am's room; we let the heavenSpace filter off so the heaven row
    // (heavenSpace: "heaven") resolves. No other dot-prefixed segment
    // lives directly under the reality root anymore . the legacy
    // ".config" / ".tools" etc shape retired 2026-06-01; all Tier-3
    // heaven spaces now live under heaven.
    const isHeavenDoor = isFirst && seg === ".";
    // Heaven children: when the parent we just descended into is
    // ANY heaven-marked space, drop the heavenSpace:null filter so
    // its heaven-marked children resolve. Heaven itself parents the
    // tier-3 spaces (config, tools, roles, ...); the region spaces
    // (host, factory) parent their own marked children (http,
    // websocket, mongo, present, past). Without this, `/./roles`
    // SPACE_NOT_FOUND at depth 1 and `/./host/http` at depth 2 —
    // marked rows get filtered out. Normal children under heaven
    // spaces (e.g. `./roles/<name>`) carry heavenSpace: null and
    // still match the unfiltered query, so relaxing is safe.
    const parentIsHeavenRegion = parentSeedSpace !== null;
    const allowSeedSpaceChildren = isHeavenDoor || parentIsHeavenRegion;
    // Branch-aware segment lookup. The walker checks the current
    // branch's slot first; on miss (and only on a non-main branch),
    // it falls through to main and validates the main slot existed
    // at branch creation via getBranchPoint (a tombstone in the
    // branch defeats the fall-through). Same shadow+lineage pattern
    // as findByName/listSpaceChildren.
    const baseQuery = {
      type: "space",
      "state.parent": currentParent,
      tombstoned: { $ne: true },
      ...(allowSeedSpaceChildren
        ? {}
        : {
            $or: [
              { "state.heavenSpace": null },
              { "state.heavenSpace": { $exists: false } },
            ],
          }),
    };
    if (isFirst && !isHeavenDoor && ownerFilter) {
      for (const [k, v] of Object.entries(ownerFilter)) {
        baseQuery[`state.${k}`] = v;
      }
    }
    const { default: Projection } =
      await import("../materials/branch/projection.js");
    async function _findIn(br) {
      if (UUID_RE.test(seg)) {
        const byId = await Projection.findOne({
          ...baseQuery,
          branch: br,
          _id: `${br}:space:${seg}`,
        }).lean();
        if (byId) return byId;
      }
      return Projection.findOne({
        ...baseQuery,
        branch: br,
        "state.name": seg,
      }).lean();
    }
    let _spaceRow = await _findIn(branch);
    if (!_spaceRow && branch !== "0") {
      const mainRow = await _findIn("0");
      if (mainRow) {
        const tomb = await Projection.findOne({
          branch,
          type: "space",
          id: mainRow.id,
          tombstoned: true,
        })
          .select("_id")
          .lean();
        if (!tomb) {
          const { getBranchPoint } =
            await import("../materials/branch/branches.js");
          const bp = await getBranchPoint(branch, "space", mainRow.id);
          if (bp && bp > 0) _spaceRow = mainRow;
        }
      }
    }
    const space = _spaceRow
      ? { _id: _spaceRow.id, ...(_spaceRow.state || {}) }
      : null;
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
    parentSeedSpace = space.heavenSpace || null;
  }

  // The enclosing tree root. Walk up to the nearest space with an
  // owner class; a space may itself be a root.
  let rootId = null;
  try {
    const treeRoot = await resolveRootSpace(leafSpace._id);
    rootId = treeRoot?._id || null;
  } catch {
    rootId = getSpaceOwner(leafSpace) ? leafSpace._id : null;
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
    branch,
  });
}
