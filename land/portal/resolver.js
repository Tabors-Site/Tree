// Portal Address → stance resolution.
//
// Given a parsed Stance, resolve what the Land server needs to ACT on:
//   - zone:        "land" | "home" | "tree"
//   - userId:      owning user (for home zone)
//   - rootId:      tree root (for tree zone)
//   - nodeId:      target node (for tree zone)
//   - chain:       [{ name, id }] top-down (land root → leaf)
//   - leafName:    convenience: chain[last].name
//   - leafId:      convenience: chain[last].id
//   - embodiment:  the @label from the stance (unchanged)
//
// Pass 1 Slice 1 implements ONLY the land-zone case (path === "/").
// Home and tree zones throw PA_UNSUPPORTED until subsequent slices land.

import { PortalError, PORTAL_ERR } from "./errors.js";
import { getLandDomain } from "./address.js";
import User from "../seed/models/user.js";
import Node from "../seed/models/node.js";
import { getLandRootId } from "../seed/landRoot.js";
import { resolveRootNode } from "../seed/tree/treeFetch.js";

/**
 * @param {{ land: string|null, path: string|null, embodiment: string|null }} stance
 * @param {object} [opts]
 * @param {boolean} [opts.requireLandMatch=true] — when true, reject stances whose land doesn't match this server
 * @returns {Promise<{
 *   zone: "land"|"home"|"tree",
 *   userId: string|null,
 *   rootId: string|null,
 *   nodeId: string|null,
 *   chain: Array<{name: string, id: string}>,
 *   leafName: string|null,
 *   leafId: string|null,
 *   embodiment: string|null,
 * }>}
 */
export async function resolveStance(stance, opts = {}) {
  const { requireLandMatch = true } = opts;
  if (!stance) {
    throw new PortalError(PORTAL_ERR.PA_PARSE, "Stance is required");
  }

  // Land must match this server (Pass 1 — no federated lookup yet).
  const stanceLand = stance.land || getLandDomain();
  if (requireLandMatch && stanceLand !== getLandDomain()) {
    throw new PortalError(
      PORTAL_ERR.PA_NOT_FOUND,
      `Land "${stanceLand}" is not served by this server`,
      { stanceLand, serverLand: getLandDomain() },
    );
  }

  const path = stance.path || "/";

  // Land zone: path === "/"
  if (path === "/") {
    return {
      zone: "land",
      userId: null,
      rootId: null,
      nodeId: null,
      chain: [],
      leafName: null,
      leafId: null,
      embodiment: stance.embodiment || null,
    };
  }

  // Home zone: path starts with "/~"
  if (path.startsWith("/~")) {
    // Parse the user slug + any sub-path beneath it.
    // "/~tabor"          → user = tabor, subPath = []
    // "/~tabor/notes"    → user = tabor, subPath = ["notes"]
    // "/~tabor/notes/x"  → user = tabor, subPath = ["notes", "x"]
    const rest = path.slice(2); // strip "/~"
    const segments = rest.split("/").filter(Boolean);
    const username = segments[0];
    const subPath = segments.slice(1);

    if (!username) {
      throw new PortalError(
        PORTAL_ERR.PA_PARSE,
        `Invalid home path: "${path}" (missing username after ~)`,
      );
    }

    const user = await User.findOne({ username }).select("_id username").lean();
    if (!user) {
      throw new PortalError(
        PORTAL_ERR.PA_NOT_FOUND,
        `No user "${username}" on this land`,
        { username },
      );
    }

    // Empty subPath = the home root itself.
    if (subPath.length === 0) {
      return {
        zone: "home",
        userId: user._id,
        username: user.username,
        rootId: null,
        nodeId: null,
        chain: [{ name: `~${user.username}`, id: user._id }],
        leafName: `~${user.username}`,
        leafId: user._id,
        embodiment: stance.embodiment || null,
      };
    }

    // Sub-path inside the user's home is a tree-zone resolution.
    // First segment is a tree-root owned by the user. Walk from there.
    const landRootId = getLandRootId();
    return resolveNodePath({
      startUnderParent: landRootId,
      segments: subPath,
      ownerFilter: { rootOwner: user._id },
      stance,
      contextUser: user,
    });
  }

  // Node zone: path starts with "/" (but not "/~"). First segment is a
  // tree-root directly under the land root.
  const segments = path.slice(1).split("/").filter(Boolean);
  if (segments.length === 0) {
    // Shouldn't happen: "/" is handled above. Defensive return.
    throw new PortalError(PORTAL_ERR.PA_PARSE, `Invalid path "${path}"`);
  }
  const landRootId = getLandRootId();
  return resolveNodePath({
    startUnderParent: landRootId,
    segments,
    ownerFilter: {},
    stance,
    contextUser: null,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Node-path walker
// ─────────────────────────────────────────────────────────────────────

/**
 * Walk a path of segments starting from a given parent, matching each
 * segment either by name OR by node-id (uuid). Builds the chain
 * [{name, id}] and returns the leaf as the resolved node.
 *
 * @param {object} args
 * @param {string} args.startUnderParent — parent node id to start from (typically landRootId)
 * @param {string[]} args.segments — path segments (already split by "/")
 * @param {object} args.ownerFilter — extra filter on the FIRST segment (e.g. rootOwner)
 * @param {object} args.stance — the original parsed stance (for embodiment)
 * @param {object|null} args.contextUser — user owning a home zone, if any
 */
async function resolveNodePath({ startUnderParent, segments, ownerFilter, stance, contextUser }) {
  if (!startUnderParent) {
    throw new PortalError(
      PORTAL_ERR.PA_INTERNAL,
      "Land root not initialized yet",
    );
  }

  const chain = [];
  // For home zones the chain starts with the ~user marker.
  if (contextUser) {
    chain.push({ name: `~${contextUser.username}`, id: contextUser._id });
  }

  let currentParent = startUnderParent;
  let leafNode = null;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isFirst = i === 0;
    const baseQuery = {
      parent: currentParent,
      systemRole: null,
      ...(isFirst ? ownerFilter : {}),
    };

    // Try id match first (UUID-shaped), then name match. Either form is valid.
    const isUuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg);
    let node = null;
    if (isUuidLike) {
      node = await Node.findOne({ ...baseQuery, _id: seg })
        .select("_id name type status parent rootOwner contributors visibility")
        .lean();
    }
    if (!node) {
      node = await Node.findOne({ ...baseQuery, name: seg })
        .select("_id name type status parent rootOwner contributors visibility")
        .lean();
    }
    if (!node) {
      throw new PortalError(
        PORTAL_ERR.PA_NOT_FOUND,
        `Segment "${seg}" not found at depth ${i} of path`,
        { segment: seg, depth: i, parent: currentParent },
      );
    }

    chain.push({ name: node.name, id: node._id });
    currentParent = node._id;
    leafNode = node;
  }

  // Determine the tree root (rootId) for this node. Walk up via existing
  // primitive — finds the first ancestor with rootOwner set.
  let rootId = null;
  try {
    const treeRoot = await resolveRootNode(leafNode._id);
    rootId = treeRoot?._id || null;
  } catch {
    // If we can't determine a tree root, the node may itself be a tree root.
    rootId = leafNode.rootOwner ? leafNode._id : null;
  }

  return {
    zone: "tree",
    userId: contextUser?._id || null,
    username: contextUser?.username || null,
    rootId,
    nodeId: leafNode._id,
    chain,
    leafName: leafNode.name,
    leafId: leafNode._id,
    embodiment: stance.embodiment || null,
    leafNode, // pass-through for the descriptor builder to avoid re-fetching
  };
}
