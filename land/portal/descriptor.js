// Position Description builder.
//
// Given a resolved stance (from resolver.js), produce the Position Description
// JSON the Portal client will render. The descriptor shape is specified in
// /portal/docs/position-description.md.
//
// Pass 1 Slice 1 implements ONLY the land-zone descriptor with empty children
// and artifacts. Subsequent slices populate children (public trees) and add
// home / tree zone branches.

import { getLandDomain } from "./address.js";
import { DESCRIPTOR_VERSION } from "./discovery.js";
import { getLandConfigValue } from "../seed/landConfig.js";
import Node from "../seed/models/node.js";
import { getLandRootId } from "../seed/landRoot.js";
import { NODE_STATUS } from "../seed/protocol.js";
import { getNotes } from "../seed/tree/notes.js";
import { resolveTreeAccess } from "../seed/tree/treeAccess.js";
import { getInboxSummary } from "./inbox.js";
import { getEmbodiment, listEmbodiments } from "./embodiments/registry.js";

/**
 * Build a Position Description for a resolved stance.
 *
 * @param {object} resolved — output of resolver.resolveStance()
 * @param {object} [opts]
 * @param {object} [opts.identity] — { userId, username } for the requesting being
 * @returns {object} Position Description
 */
export async function buildDescriptor(resolved, opts = {}) {
  if (resolved.zone === "land") {
    return buildLandDescriptor(resolved, opts);
  }
  if (resolved.zone === "home") {
    return buildHomeDescriptor(resolved, opts);
  }
  if (resolved.zone === "tree") {
    return buildTreeDescriptor(resolved, opts);
  }
  throw new Error(`Unknown zone: ${resolved.zone}`);
}

async function buildLandDescriptor(resolved, { identity } = {}) {
  const landDomain = getLandDomain();
  const children = await listPublicTrees();
  return {
    address: {
      land: landDomain,
      path: "/",
      embodiment: resolved.embodiment || null,
      nodeId: null,
      userId: null,
      chain: [],
      pathByNames: "/",
      pathByIds: "/",
      leafName: null,
      leafId: null,
    },
    zone: "land",
    // Beings invocable at the land root. Pass 1 Slice 1 lists just the
    // default land-manager being. Future slices will read this from the
    // mode registry filtered by land-zone scope.
    beings: [
      {
        embodiment: "land-manager",
        label: "Land Manager",
        description: "Land-level governance: extensions, config, peers. God-tier only.",
        invocableBy: "owner",
        available: true,
        modeKey: "land:manager",
        icon: "🏛️",
      },
      {
        embodiment: "citizen",
        label: "Citizen",
        description: "Read-only browsing of the land's public surface.",
        invocableBy: "anyone",
        available: true,
        modeKey: "land:citizen",
        icon: "👤",
      },
    ],
    // Public trees at land scope. Populated from the user-root nodes
    // directly under the land root with visibility === "public".
    children,
    artifacts: [],
    land: {
      name: getLandConfigValue("LAND_NAME") || "Unnamed Land",
      operator: null,
      extensionsAvailable: [],
      policies: { registrationOpen: true, guestsAllowed: true },
    },
    identity: identity
      ? {
          userId: identity.userId,
          username: identity.username,
          authorizedHere: true,
          writeAllowed: false,
        }
      : null,
    _meta: {
      descriptorVersion: DESCRIPTOR_VERSION,
      serverVersion: process.env.LAND_VERSION || "treeos-land",
      generatedAt: new Date().toISOString(),
      renderHints: [],
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Home-zone builder
// ─────────────────────────────────────────────────────────────────────

async function buildHomeDescriptor(resolved, { identity } = {}) {
  const landDomain = getLandDomain();
  const homePath = `/~${resolved.username}`;
  const children = await listUserTrees(resolved.userId, resolved.username);
  const isOwner =
    identity && String(identity.userId) === String(resolved.userId);
  return {
    address: {
      land: landDomain,
      path: homePath,
      embodiment: resolved.embodiment || null,
      nodeId: null,
      userId: resolved.userId,
      chain: resolved.chain,
      pathByNames: homePath,
      pathByIds: `/~${resolved.userId}`,
      leafName: resolved.leafName,
      leafId: resolved.leafId,
    },
    zone: "home",
    beings: [
      {
        embodiment: resolved.username, // human-being label = the user's username
        label: resolved.username,
        description: `${resolved.username} at their home zone.`,
        invocableBy: "owner",
        available: isOwner === true,
        modeKey: "home:human",
        kind: "human",
      },
      {
        embodiment: "dreamer",
        label: "Dreamer",
        description: "Creative / generative cognition at the home zone.",
        invocableBy: "owner",
        available: isOwner === true,
        modeKey: "home:dreamer",
        kind: "ai",
      },
      {
        embodiment: "archivist",
        label: "Archivist",
        description: "Read-only browsing of the user's tree history.",
        invocableBy: "owner",
        available: isOwner === true,
        modeKey: "home:archivist",
        kind: "ai",
      },
    ],
    children,
    artifacts: [],
    identity: identity
      ? {
          userId: identity.userId,
          username: identity.username,
          authorizedHere: isOwner === true,
          writeAllowed: isOwner === true,
        }
      : null,
    _meta: {
      descriptorVersion: DESCRIPTOR_VERSION,
      serverVersion: process.env.LAND_VERSION || "treeos-land",
      generatedAt: new Date().toISOString(),
      renderHints: isOwner ? [] : ["read-only"],
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tree-zone builder
// ─────────────────────────────────────────────────────────────────────

async function buildTreeDescriptor(resolved, { identity } = {}) {
  const landDomain = getLandDomain();
  const node = resolved.leafNode;
  if (!node) {
    throw new Error("Resolved node missing leafNode reference");
  }

  // Build the two convenience path strings from the chain.
  const pathByNames = "/" + resolved.chain.map((c) => c.name).join("/");
  const pathByIds = "/" + resolved.chain.map((c) => c.id).join("/");

  // Children of this node (immediate descendants).
  const children = await listChildren(node._id);

  // Notes attached to this node, as artifact previews.
  const artifacts = await listArtifacts(node._id);

  // Lineage walk: parent chain back up to and including the tree root.
  // The chain we already have is the path-segments chain; lineage may
  // include ancestor nodes that weren't named explicitly (intermediate
  // segments). For Slice 4 we use the chain we already have, plus a
  // synthetic "land root" entry at index 0.
  const lineage = buildLineage(resolved);

  // Siblings: other children of the parent.
  const siblings = node.parent ? await listChildren(node.parent, { exclude: node._id }) : [];

  // Authorization check.
  let writeAllowed = false;
  let authorizedHere = false;
  if (identity?.userId) {
    try {
      const access = await resolveTreeAccess(node._id, identity.userId);
      writeAllowed = access?.ok && access?.write === true;
      authorizedHere = access?.ok === true;
    } catch {
      // Defensive — leave as false.
    }
  }

  return {
    address: {
      land: landDomain,
      path: pathByNames,
      embodiment: resolved.embodiment || null,
      nodeId: node._id,
      userId: resolved.userId || null,
      chain: resolved.chain,
      pathByNames,
      pathByIds,
      leafName: resolved.leafName,
      leafId: resolved.leafId,
    },
    zone: "tree",
    // Beings invocable at this node. Pass 1 Slice 4 returns a small
    // default set; Slice 4b will pull from the mode registry filtered
    // by the node's actual scope + governance state.
    beings: await buildBeings(node._id, [
      { embodiment: "ruler",     label: "Ruler",     description: "Coordinates work at this scope.",                    invocableBy: "owner",  available: writeAllowed,  modeKey: "tree:governing-ruler",  kind: "ai", icon: "\u{1F451}" },
      { embodiment: "worker",    label: "Worker",    description: "Produces artifacts.",                                 invocableBy: "owner",  available: writeAllowed,  modeKey: "tree:governing-worker", kind: "ai", icon: "\u{1F528}" },
      { embodiment: "archivist", label: "Archivist", description: "Read-only inspection of artifacts and history.",       invocableBy: "anyone", available: authorizedHere, modeKey: "tree:archivist",        kind: "ai", icon: "\u{1F4DA}" },
      { embodiment: "echo",      label: "Echo",      description: "Demo: returns whatever you send. Phase 4 round-trip.", invocableBy: "anyone", available: true,           modeKey: "tree:echo",             kind: "ai", icon: "\u{1F501}" },
    ]),
    children,
    artifacts,
    lineage,
    siblings,
    // Governance block: populated in Slice 4b when we wire to the
    // governing extension's buildDashboardData. For now, declare the
    // shape with empty/null placeholders so portal clients can render
    // a consistent surface.
    governance: null,
    identity: identity
      ? {
          userId: identity.userId,
          username: identity.username,
          authorizedHere,
          writeAllowed,
        }
      : null,
    _meta: {
      descriptorVersion: DESCRIPTOR_VERSION,
      serverVersion: process.env.LAND_VERSION || "treeos-land",
      generatedAt: new Date().toISOString(),
      renderHints: writeAllowed ? [] : ["read-only"],
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Tree-zone helpers
// ─────────────────────────────────────────────────────────────────────

async function listChildren(parentId, { exclude } = {}) {
  if (!parentId) return [];
  const query = {
    parent: parentId,
    systemRole: null,
    status: { $ne: NODE_STATUS.DELETED || "deleted" },
  };
  if (exclude) query._id = { $ne: exclude };
  const nodes = await Node.find(query)
    .select("_id name type status dateCreated")
    .sort({ dateCreated: 1 })
    .limit(500)
    .lean();
  return nodes.map((n) => ({
    name: n.name,
    nodeId: n._id,
    type: n.type || null,
    summary: null,
    noteCount: 0,
    lifecycle: deriveLifecycle(n.status),
  }));
}

async function listArtifacts(nodeId) {
  if (!nodeId) return [];
  try {
    const result = await getNotes({ nodeId, limit: 50 });
    const notes = Array.isArray(result?.notes) ? result.notes : [];
    return notes.map((n) => ({
      kind: "note",
      noteId: n._id,
      contentType: n.contentType || "text/markdown",
      preview: typeof n.content === "string" ? n.content.slice(0, 400) : null,
      previewBytes: typeof n.content === "string" ? Buffer.byteLength(n.content, "utf8") : 0,
      totalBytes: typeof n.content === "string" ? Buffer.byteLength(n.content, "utf8") : 0,
      createdAt: n.createdAt,
      byUsername: n.username || null,
      fullContentRef: `/api/v1/node/${nodeId}/notes/${n._id}`, // legacy URL; will move to a portal:see artifact path
    }));
  } catch {
    return [];
  }
}

function buildLineage(resolved) {
  // Top-down: each entry shows what to display in a breadcrumb.
  const landDomain = getLandDomain();
  const lineage = [
    { path: "/", name: landDomain, kind: "land" },
  ];
  // The chain already walks from the first segment to the leaf. Each
  // intermediate entry becomes a breadcrumb step. We accumulate the path
  // prefix as we go.
  let prefix = "";
  for (let i = 0; i < resolved.chain.length - 1; i++) {
    const seg = resolved.chain[i];
    prefix += "/" + seg.name;
    lineage.push({
      path: prefix,
      name: seg.name,
      nodeId: seg.id,
      kind: seg.name.startsWith("~") ? "home" : "tree",
    });
  }
  return lineage;
}

// ─────────────────────────────────────────────────────────────────────
// Land-zone helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * List public trees rooted at the Land root.
 *
 * A "public tree" is a node where:
 *   - parent === landRootId (it's a tree-root directly under the land)
 *   - rootOwner is set (it's a user tree, not a system node)
 *   - systemRole is null
 *   - visibility === "public"
 *   - status !== DELETED
 *
 * Returned in the Position Description `children` shape.
 */
async function listPublicTrees() {
  const landRootId = getLandRootId();
  if (!landRootId) return [];
  const trees = await Node.find({
    parent: landRootId,
    rootOwner: { $ne: null },
    systemRole: null,
    visibility: "public",
    status: { $ne: NODE_STATUS.DELETED || "deleted" },
  })
    .select("_id name type status dateCreated")
    .sort({ dateCreated: -1 })
    .limit(200)
    .lean();

  return trees.map((t) => ({
    name: t.name,
    path: `/${t.name}`, // human-readable path; ids form is `/${t._id}`
    nodeId: t._id,
    type: t.type || null,
    summary: null, // future: pull from notes/metadata
    noteCount: 0,  // future: count via notes index
    lifecycle: deriveLifecycle(t.status),
  }));
}

/**
 * List the user's tree-root nodes. A user-tree-root is a node where:
 *   - parent === landRootId
 *   - rootOwner === userId
 *   - systemRole is null
 *   - status !== DELETED
 *
 * Visibility is NOT filtered here — the home zone shows the owner all their
 * trees (public and private). When another identity browses someone else's
 * home, the resolver/authorization step would gate access (Slice 3 doesn't
 * gate yet; that's a future-pass authorization concern).
 */
async function listUserTrees(userId, username) {
  const landRootId = getLandRootId();
  if (!landRootId || !userId || !username) return [];
  const trees = await Node.find({
    parent: landRootId,
    rootOwner: userId,
    systemRole: null,
    status: { $ne: NODE_STATUS.DELETED || "deleted" },
  })
    .select("_id name type status dateCreated visibility")
    .sort({ dateCreated: -1 })
    .limit(500)
    .lean();

  return trees.map((t) => ({
    name: t.name,
    path: `/~${username}/${t.name}`,
    nodeId: t._id,
    type: t.type || null,
    visibility: t.visibility || "private",
    summary: null,
    noteCount: 0,
    lifecycle: deriveLifecycle(t.status),
  }));
}

function deriveLifecycle(status) {
  // Map the existing NODE_STATUS values onto Position Description lifecycle.
  // Conservative mapping; can be refined as governing-extension status
  // becomes the source of truth in later slices.
  if (!status) return "idle";
  if (status === "running" || status === "active") return "running";
  if (status === "completed" || status === "done") return "completed";
  if (status === "blocked" || status === "stalled") return "stalled";
  return "idle";
}

// ─────────────────────────────────────────────────────────────────────
// Beings + inbox preview
// ─────────────────────────────────────────────────────────────────────

/**
 * Enrich a beings list with registered embodiment metadata
 * (honoredIntents, respondMode, triggerOn) and the per-embodiment inbox
 * summary at this node.
 *
 * `entries` is the static portion (embodiment, label, description, kind,
 * icon, invocableBy, available, modeKey). The function attaches:
 *   - honoredIntents, respondMode, triggerOn from the embodiment registry
 *     (or null if the embodiment is not registered yet)
 *   - inbox: { total, unconsumed, recent } from getInboxSummary
 */
async function buildBeings(nodeId, entries) {
  const inboxByEmbodiment = await getInboxSummary(nodeId);
  return entries.map((entry) => {
    const def = getEmbodiment(entry.embodiment);
    return {
      ...entry,
      honoredIntents: def ? def.honoredIntents : null,
      respondMode:    def ? def.respondMode : null,
      triggerOn:      def ? def.triggerOn : null,
      inbox:          inboxByEmbodiment[entry.embodiment] || { total: 0, unconsumed: 0, recent: [] },
    };
  });
}
