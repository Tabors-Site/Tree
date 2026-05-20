// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Position Description builder.
//
// Given a resolved stance (from resolver.js), produce the Position
// Description JSON the Portal client will render. The descriptor shape
// is specified in /portal/docs/position-description.md.
//
// Three builder paths, picked by the resolved stance's flags:
//   - buildLandDescriptor — `<land>` (land root)
//   - buildHomeDescriptor — `<land>/~<being>` (a being's home view)
//   - buildTreeDescriptor — any other position (tree node)

import { getLandDomain } from "./address.js";
import { getLandConfigValue } from "../landConfig.js";

// Wire-shape version. Bumped when the Position Description shape changes
// in a way that clients must opt into. The IBP discovery payload lists
// this in `descriptorVersionSupported`.
export const DESCRIPTOR_VERSION = "1.0";
import Node from "../models/node.js";
import { getLandRootId } from "../landRoot.js";
// NODE_STATUS retired 2026-05-18 — status is domain-specific extension
// metadata, not a universal kernel field. Descriptor queries no longer
// filter on a node-level status.
import { getArtifacts } from "../tree/artifacts.js";
import Artifact from "../models/artifact.js";
import { resolveTreeAccess } from "../tree/treeAccess.js";
import { getInboxSummary } from "../scheduler/inbox.js";
import { getRole, listRoles } from "../roles/registry.js";
import { getExtension } from "../../extensions/loader.js";
import { getActiveSummonForBeing } from "../llm/summonTracker.js";
import Did from "../models/did.js";

// ─────────────────────────────────────────────────────────────────────
// Place-bundle readers
//
// The position/scenes/models extensions hold all spatial data. The
// descriptor reads them through getExtension(). When an extension is
// not installed, the corresponding field is simply omitted — clients
// fall back to client-side defaults (hash placement, default models).
// ─────────────────────────────────────────────────────────────────────

function readPositionNs(metadata) {
  if (!metadata) return null;
  if (metadata instanceof Map) return metadata.get("position") || null;
  return metadata.position || null;
}

function readModelsNs(metadata) {
  if (!metadata) return null;
  if (metadata instanceof Map) return metadata.get("models") || null;
  return metadata.models || null;
}

// Use the models extension's derivation if available (it knows how to
// fall back to governing.role and other extension namespaces). Without
// the extension installed, return the raw models namespace.
function effectiveModel(meta) {
  const ext = getExtension("models");
  const fn = ext?.exports?.deriveModel;
  if (typeof fn === "function") return fn(meta);
  const raw = readModelsNs(meta);
  return raw?.model ? { model: raw.model, scale: raw.scale ?? 1 } : null;
}

// Same idea for scenes — derive the per-node doorway/sceneType from
// explicit metadata.scenes plus fallbacks (e.g. governing.role).
function effectiveScene(meta) {
  const ext = getExtension("scenes");
  const fn = ext?.exports?.deriveScene;
  if (typeof fn === "function") return fn(meta);
  const raw = (meta instanceof Map ? meta.get("scenes") : meta?.scenes) || {};
  return {
    doorway:   raw.doorway === true,
    sceneType: typeof raw.sceneType === "string" ? raw.sceneType : null,
    ambient:   raw.ambient || null,
  };
}

function childPlacement(meta) {
  const pos = readPositionNs(meta);
  const mod = effectiveModel(meta);
  const scn = effectiveScene(meta);
  const out = {};
  if (pos?.coords) out.position = { coords: pos.coords };
  if (mod?.model)  out.model    = mod;
  // Surface per-child doorway info so renderers can decide whether this
  // child is its own scene boundary.
  if (scn?.doorway || scn?.sceneType) {
    out.scene = { doorway: !!scn.doorway, sceneType: scn.sceneType || null };
  }
  return out;
}

function beingPlacement(parentMeta, beingName) {
  const pos = readPositionNs(parentMeta);
  const mod = readModelsNs(parentMeta);
  const out = {};
  const coords = pos?.beings?.[beingName];
  if (coords) out.position = { coords };
  const m = mod?.beings?.[beingName];
  if (m?.model) out.model = { model: m.model, scale: m.scale ?? 1 };
  return out;
}

function artifactPlacement(parentMeta, ref) {
  const pos = readPositionNs(parentMeta);
  const mod = readModelsNs(parentMeta);
  const out = {};
  const coords = pos?.artifacts?.[ref];
  if (coords) out.position = { coords };
  const m = mod?.artifacts?.[ref];
  if (m?.model) out.model = { model: m.model, scale: m.scale ?? 1 };
  return out;
}

async function resolveSceneBlock(nodeId) {
  if (!nodeId) return null;
  try {
    const scenes = getExtension("scenes");
    const fn = scenes?.exports?.getScene;
    if (typeof fn !== "function") return null;
    return await fn(nodeId);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Beings list for a tree node
//
// A position's beings are the beings whose HOME is this position — not
// "beings invocable here." Each being has a durable home (a place
// in the world); the descriptor for a position lists the beings living
// there. Beings at child positions (inline, non-doorway) are composed
// into the parent's scene by the renderer, so the parent's descriptor
// stays focused on its own residents.
//
// Two paths surface beings here:
//   1. metadata.beings.<name> on this node — the canonical home
//      record. When an extension's lifecycle places a being at a
//      position (Planner at a plan node, Foreman at a foreman node,
//      etc.), it writes the namespace and the descriptor surfaces it.
//   2. Derived signals for legacy / shorthand cases. Today only one:
//      metadata.governing.role === "ruler" implies the Ruler is at
//      home, even if metadata.beings.ruler hasn't been written
//      explicitly. As governing's lifecycle migrates to creating real
//      sub-positions (plan/contract/foreman child nodes with their own
//      beings), it can drop the derived signal in favor of explicit
//      being-home writes.
//
// Workers, Planners, Contractors, Foremen are NOT listed here for a
// rulership — they live at their own positions (plan child node,
// contract child node, leaf artifact positions) and surface through
// those positions' descriptors. The renderer composes them visually
// because they're inline children of the rulership.
// ─────────────────────────────────────────────────────────────────────

function readNsFrom(metadata, name) {
  if (!metadata) return null;
  if (metadata instanceof Map) return metadata.get(name) || null;
  return metadata[name] || null;
}

// Known being presentation metadata. The kernel being registry
// (roles/registry.js) tracks behavior (honoredIntents, respondMode,
// summon). This map carries label/description/icon/modeKey for known
// names so the descriptor can render whatever is found in
// metadata.beings without each writer having to ship them.
const BEING_PRESENTATION = {
  ruler:      { label: "Ruler",      description: "Coordinates work at this scope.",            modeKey: "tree:governing-ruler",  icon: "\u{1F451}", invocableBy: "owner"  },
  planner:    { label: "Planner",    description: "Drafts plans for this scope.",                modeKey: "tree:governing-planner", icon: "\u{1F4DD}", invocableBy: "owner"  },
  contractor: { label: "Contractor", description: "Issues contracts for this scope.",            modeKey: "tree:governing-contractor", icon: "\u{1F4DC}", invocableBy: "owner" },
  foreman:    { label: "Foreman",    description: "Dispatches execution for this scope.",        modeKey: "tree:governing-foreman", icon: "\u{1F4CB}", invocableBy: "owner" },
  worker:     { label: "Worker",     description: "Produces artifacts.",                         modeKey: "tree:governing-worker-build", icon: "\u{1F528}", invocableBy: "owner" },
  archivist:  { label: "Archivist",  description: "Read-only inspection of artifacts.",          modeKey: "tree:archivist",        icon: "\u{1F4DA}", invocableBy: "anyone" },
};

function beingsForTreeNode(node, { writeAllowed, authorizedHere }) {
  const beings = [];

  // Read explicit being-home registrations on this node. Each entry
  // under metadata.beings is either a being-home (Ruler/Planner/
  // Contractor/etc.) or a stance-permission profile (arrival/owner/
  // member). We treat any entry NOT in the well-known stance set as a
  // being-home — letting future extensions register their own beings
  // without changing this filter.
  const beingHomes = readNsFrom(node?.metadata, "beings");
  if (!beingHomes) return beings;
  const STANCE_NAMES = new Set(["arrival", "owner", "member"]);
  const names = beingHomes instanceof Map
    ? Array.from(beingHomes.keys())
    : Object.keys(beingHomes);
  for (const name of names) {
    if (STANCE_NAMES.has(name)) continue;
    const pres = BEING_PRESENTATION[name] || {
      label: name, description: "", modeKey: `tree:${name}`, icon: "\u{1F464}", invocableBy: "owner",
    };
    // The home record may carry a `scopeRulerId` (governing's lifecycle
    // writes it). The Planner chainstep is bound to the Ruler's nodeId
    // even though the Planner's home is at the plan trio. Carrying the
    // scopeRulerId lets activity derivation look up the chainstep in
    // the right place. Renderer-only field, ignored by clients that
    // don't need it.
    const home = beingHomes instanceof Map ? beingHomes.get(name) : beingHomes[name];
    beings.push({
      being: name,
      label:       pres.label,
      description: pres.description,
      invocableBy: pres.invocableBy,
      available:   pres.invocableBy === "anyone" ? authorizedHere : writeAllowed,
      modeKey:     pres.modeKey,
      kind:        "ai",
      icon:        pres.icon,
      // Internal-only fields (stripped before going on the wire). The
      // descriptor's deriveActivity queries getActiveSummonForBeing(beingId)
      // to surface "this being is currently doing X." Stored at descriptor
      // build time so the activity walk doesn't re-resolve them.
      _activeSummonLookupBeingId: home?.beingId || null,
      _activeSummonLookupNodeId:  home?.scopeRulerId || null,
    });
  }

  return beings;
}

// ─────────────────────────────────────────────────────────────────────
// Activity derivation
//
// For each being at a position, derive an `activity` object from the
// latest active chainstep (Chat doc) bound to (nodeId, modeKey). When
// no chainstep is active the being is idle and activity is null.
//
// Today the Chat document persists: startMessage, toolCalls[]. Thinking
// text is socket-only and not persisted, so the field's `content` is
// the latest tool call summary (or the start message until tools run).
// ─────────────────────────────────────────────────────────────────────

const ACTIVITY_CONTENT_CAP = 240;

function summarizeArgs(args) {
  if (args == null) return "";
  if (typeof args === "string") return args;
  try { return JSON.stringify(args); } catch { return String(args); }
}

function truncate(s, n) {
  if (typeof s !== "string") return "";
  return s.length > n ? s.slice(0, n) + "..." : s;
}

// Convert a Summon document into an activity object the descriptor
// surfaces for the being whose Summon it is. Returns null when no
// Summon is given. Tool-call surface reads Dids keyed by summonId.
async function summonToActivity(summon) {
  if (!summon) return null;
  let lastCall = null;
  try {
    const lastDid = await Did.findOne({ summonId: summon._id, action: "tool-call" })
      .sort({ date: -1 })
      .select("toolCall date")
      .lean();
    if (lastDid?.toolCall) lastCall = lastDid;
  } catch {
    // skip — descriptor never blocks on tool-call lookup
  }
  const target = await inferActivityTarget(summon);

  if (lastCall) {
    const tc = lastCall.toolCall;
    return {
      kind:        tc.success === false ? "tool-result" : "tool-called",
      content:     truncate(`${tc.name}(${summarizeArgs(tc.args)})`, ACTIVITY_CONTENT_CAP),
      chainstepId: String(summon._id),
      target,
      ts:          lastCall.date,
    };
  }

  return {
    kind:        "summoned",
    content:     truncate(summon.startMessage?.content || "", ACTIVITY_CONTENT_CAP),
    chainstepId: String(summon._id),
    target,
    ts:          summon.summonedAt || new Date(),
  };
}

// Infer what a Summon is acting on. The Summon schema doesn't carry an
// explicit target field, but the reply linkage tells us: when inReplyTo
// is set, the Summon was spawned by another being. Treat the parent's
// activeRole/position as the target so sub-beings animate walking toward
// their spawner.
async function inferActivityTarget(summon) {
  if (!summon?.inReplyTo) return null;
  let parent;
  try {
    const Summon = (await import("../models/summon.js")).default;
    parent = await Summon.findById(summon.inReplyTo)
      .select("activeRole beingOut")
      .lean();
  } catch {
    return null;
  }
  if (!parent || !parent.activeRole || !parent.beingOut) return null;
  // Without aiContext/treeContext we no longer have a (nodeId, modeKey)
  // tuple to hand the renderer. Surface the parent being + role so the
  // 3D portal can map "which mesh is this being" via its descriptor entry.
  return {
    kind:    "being",
    beingId: String(parent.beingOut),
    role:    parent.activeRole,
  };
}

/**
 * Build a Position Description for a resolved stance.
 *
 * @param {object} resolved — output of resolver.resolveStance()
 * @param {object} [opts]
 * @param {object} [opts.identity] — { beingId, username } for the requesting being
 * @returns {object} Position Description
 */
export async function buildDescriptor(resolved, opts = {}) {
  if (resolved.isLandRoot) return buildLandDescriptor(resolved, opts);
  if (resolved.isHomeRoot) return buildHomeDescriptor(resolved, opts);
  return buildTreeDescriptor(resolved, opts);
}

async function buildLandDescriptor(resolved, { identity } = {}) {
  const landDomain = getLandDomain();
  const children = await listPublicTrees();
  // `available` reflects whether the being's role is actually registered.
  // When the backing extension is missing, the entry stays in the
  // descriptor (so 3D clients still see the slot) but is non-invocable.
  const isRegistered = (beingName) => !!getRole(beingName);
  // Artifacts at the land root. The llm-assigner intro tutorial is the
  // seeded example (web-origin, points at a YouTube URL).
  const landRootId = getLandRootId();
  const artifacts = landRootId ? await readLandRootArtifacts(landRootId) : [];
  return {
    address: {
      land: landDomain,
      path: "/",
      being: resolved.being || null,
      nodeId: null,
      beingId: null,
      chain: [],
      pathByNames: "/",
      pathByIds: "/",
      leafName: null,
      leafId: null,
    },
    isLandRoot: true,
    isHomeRoot: false,
    // Beings whose home is the land root. All four are real Being rows
    // (created by ensureSystemBeings). With the resolver now exposing
    // landRootId as the nodeId for land-root stances, the SUMMON inbox
    // sits on the land-root node like any other position — so these
    // beings are addressable via both BE (auth, llm-assigner — code
    // cognition) and SUMMON (land-manager, citizen — LLM-driven once
    // their role specs are registered).
    beings: [
      {
        being:       "auth",
        label:       "Auth",
        description: "The land's welcome character. Processes register, claim, release, switch.",
        invocableBy: "anyone",
        available:   isRegistered("auth"),
        modeKey:     "land:auth",
        kind:        "ai",
        icon:        "\u{1F511}",
      },
      {
        being:       "llm-assigner",
        label:       "LLM Assigner",
        description: "Configure LLM connections on your being, on a tree you own, or on the land (root operator).",
        invocableBy: "authenticated",
        available:   isRegistered("llm-assigner"),
        modeKey:     "land:llm-assigner",
        kind:        "ai",
        icon:        "\u{1F9E0}",
      },
      {
        being:       "land-manager",
        label:       "Land Manager",
        description: "Land-level governance: extensions, config, peers. Root-operator only.",
        invocableBy: "owner",
        available:   isRegistered("land-manager"),
        modeKey:     "land:manager",
        kind:        "ai",
        icon:        "\u{1F3DB}\u{FE0F}",
      },
      {
        being:       "citizen",
        label:       "Citizen",
        description: "Read-only browsing of the land's public surface.",
        invocableBy: "anyone",
        available:   isRegistered("citizen"),
        modeKey:     "land:citizen",
        kind:        "ai",
        icon:        "\u{1F464}",
      },
    ],
    // Public trees at land scope. Populated from the user-root nodes
    // directly under the land root with visibility === "public".
    children,
    artifacts,
    land: {
      name: getLandConfigValue("LAND_NAME") || "Unnamed Land",
      operator: null,
      extensionsAvailable: [],
      policies: { registrationOpen: true, guestsAllowed: true },
    },
    identity: identity
      ? {
          beingId: identity.beingId,
          name: identity.name,
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
  const homePath = `/~${resolved.name}`;
  const children = await listUserTrees(resolved.beingId, resolved.name);
  const isOwner =
    identity && String(identity.beingId) === String(resolved.beingId);
  return {
    address: {
      land: landDomain,
      path: homePath,
      being: resolved.being || null,
      nodeId: null,
      beingId: resolved.beingId,
      chain: resolved.chain,
      pathByNames: homePath,
      pathByIds: `/~${resolved.beingId}`,
      leafName: resolved.leafName,
      leafId: resolved.leafId,
    },
    isLandRoot: false,
    isHomeRoot: true,
    // The owning being is the only being at their home by default.
    // Extensions (or the operator) can place additional beings here
    // by writing metadata.beings.<name> on the home node; they will
    // surface through the regular being-home reader.
    beings: [
      {
        being:       resolved.name,
        label:       resolved.name,
        description: `${resolved.name} at their home position.`,
        invocableBy: "owner",
        available:   isOwner === true,
        modeKey:     "home:human",
        kind:        "human",
      },
    ],
    children,
    artifacts: [],
    identity: identity
      ? {
          beingId: identity.beingId,
          name: identity.name,
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

  // Children of this node (immediate descendants). Backfill `path` from
  // this node's pathByNames so clients can navigate deeper.
  const children = await listChildren(node._id);
  for (const c of children) {
    c.path = `${pathByNames}/${c.name}`;
  }

  // Notes attached to this node, as artifact previews.
  const artifacts = await listArtifacts(node._id);

  // Lineage walk: parent chain back up to and including the tree root.
  // The chain we already have is the path-segments chain; lineage may
  // include ancestor nodes that weren't named explicitly (intermediate
  // segments). Today we use the chain we already have plus a synthetic
  // "land root" entry at index 0.
  const lineage = buildLineage(resolved);

  // Siblings: other children of the parent. Backfill paths from the
  // parent's path (this node's path minus the leaf segment).
  const siblings = node.parent ? await listChildren(node.parent, { exclude: node._id }) : [];
  const parentPath = pathByNames.replace(/\/[^/]+$/, "") || "/";
  for (const s of siblings) {
    s.path = parentPath === "/" ? `/${s.name}` : `${parentPath}/${s.name}`;
  }

  // Authorization check.
  let writeAllowed = false;
  let authorizedHere = false;
  if (identity?.beingId) {
    try {
      const access = await resolveTreeAccess(node._id, identity.beingId);
      writeAllowed = access?.ok && access?.write === true;
      authorizedHere = access?.ok === true;
    } catch {
      // Defensive — leave as false.
    }
  }

  // Scene block: nearest doorway ancestor + resolved sceneType + ambient.
  // Null if the scenes extension is not installed.
  const scene = await resolveSceneBlock(node._id);

  return {
    address: {
      land: landDomain,
      path: pathByNames,
      being: resolved.being || null,
      nodeId: node._id,
      beingId: resolved.beingId || null,
      chain: resolved.chain,
      pathByNames,
      pathByIds,
      leafName: resolved.leafName,
      leafId: resolved.leafId,
    },
    isLandRoot: false,
    isHomeRoot: false,
    // Beings invocable at this node. Only beings that are actually
    // configured here appear — placeholder defaults (worker/archivist/
    // echo on every node) were causing phantom figures in fresh trees.
    // Each entry below is gated by a real signal:
    //   - ruler: governing extension has promoted this node
    // Other beings (workers, planners, etc.) are transient chainstep
    // roles, not standing beings; they surface through the activity
    // field on the ruler's entry rather than as their own beings.
    beings: await buildBeings(node._id, beingsForTreeNode(node, { writeAllowed, authorizedHere })),
    children,
    artifacts,
    lineage,
    siblings,
    scene,
    identity: identity
      ? {
          beingId: identity.beingId,
          name: identity.name,
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
  };
  if (exclude) query._id = { $ne: exclude };
  const nodes = await Node.find(query)
    .select("_id name type dateCreated metadata")
    .sort({ dateCreated: 1 })
    .limit(500)
    .lean();
  return nodes.map((n) => ({
    name:      n.name,
    nodeId:    n._id,
    type:      n.type || null,
    summary:   null,
    noteCount: 0,
    ...childPlacement(n.metadata),
  }));
}

async function listArtifacts(nodeId) {
  if (!nodeId) return [];
  try {
    const result = await getArtifacts({ nodeId, limit: 50 });
    const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
    // Artifact placement lives on the parent node's position/models
    // namespaces, keyed by artifact id.
    const parent = await Node.findById(nodeId).select("metadata").lean();
    const parentMetadata = parent?.metadata || null;
    return artifacts.map((a) => {
      const isText = typeof a.content === "string";
      return {
        kind: "artifact",
        artifactId: a._id,
        origin: a.origin || "ibp",
        preview: isText ? a.content.slice(0, 400) : null,
        previewBytes: isText ? Buffer.byteLength(a.content, "utf8") : 0,
        totalBytes: isText ? Buffer.byteLength(a.content, "utf8") : 0,
        createdAt: a.createdAt,
        byUsername: a.name || null,
        fullContentRef: `/api/v1/node/${nodeId}/artifacts/${a._id}`,
        ...artifactPlacement(parentMetadata, String(a._id)),
      };
    });
  } catch {
    return [];
  }
}

function buildLineage(resolved) {
  // Top-down: each entry shows what to display in a breadcrumb.
  const landDomain = getLandDomain();
  const lineage = [
    { path: "/", name: landDomain, nodeId: null },
  ];
  // The chain already walks from the first segment to the leaf. Each
  // intermediate entry becomes a breadcrumb step. We accumulate the path
  // prefix as we go.
  let prefix = "";
  for (let i = 0; i < resolved.chain.length - 1; i++) {
    const seg = resolved.chain[i];
    prefix += "/" + seg.name;
    lineage.push({
      path:   prefix,
      name:   seg.name,
      nodeId: seg.id,
    });
  }
  return lineage;
}

// ─────────────────────────────────────────────────────────────────────
// Land-zone helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * List public sections of the land.
 *
 * A "public tree" is any node marked `visibility: "public"` — it can
 * sit at any depth, not just under the land root. Any section of any
 * tree can be made public; the section's root is whatever node carries
 * the `public` marker. System nodes (`.extensions`, `.flow`, etc.) are
 * filtered out.
 *
 * Returned in the Position Description `children` shape.
 */
async function listPublicTrees() {
  const trees = await Node.find({
    systemRole: null,
    visibility: "public",
  })
    .select("_id name type dateCreated metadata")
    .sort({ dateCreated: -1 })
    .limit(200)
    .lean();

  return trees.map((t) => ({
    name:      t.name,
    path:      `/${t.name}`, // human-readable path; ids form is `/${t._id}`
    nodeId:    t._id,
    type:      t.type || null,
    summary:   null, // future: pull from artifacts/metadata
    noteCount: 0,    // future: count via artifacts index
    ...childPlacement(t.metadata),
  }));
}

// Read artifacts attached to the land root. Slim shape the 3D portal
// renders directly: id, name (the artifact's own name), beingId (so
// clients can filter by which being authored it), origin (so they know
// whether to embed an iframe, fetch a file, etc.), and the content blob.
//
// Queries the Artifact model directly instead of getArtifacts() because
// that helper populates beingId and overwrites the artifact's `name` field
// with the being's name. The land-root descriptor needs the artifact's
// real name.
async function readLandRootArtifacts(landRootId) {
  const list = await Artifact.find({ nodeId: String(landRootId) })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  return list.map((a) => ({
    artifactId: String(a._id),
    name:       a.name || null,
    beingId:    a.beingId ? String(a.beingId) : null,
    origin:     a.origin || "ibp",
    content:    a.content || null,
    metadata:   a.metadata instanceof Map
      ? Object.fromEntries(a.metadata)
      : (a.metadata || {}),
  }));
}

/**
 * List the being's tree-root nodes. A being-tree-root is a node where:
 *   - parent === landRootId
 *   - rootOwner === beingId
 *   - systemRole is null
 *
 * Visibility is NOT filtered here — a being's home view shows all of
 * their trees (public and private). When another identity browses
 * someone else's home, stance authorization gates access.
 */
async function listUserTrees(beingId, username) {
  const landRootId = getLandRootId();
  if (!landRootId || !beingId || !username) return [];
  const trees = await Node.find({
    parent: landRootId,
    rootOwner: beingId,
    systemRole: null,
  })
    .select("_id name type dateCreated visibility metadata")
    .sort({ dateCreated: -1 })
    .limit(500)
    .lean();

  return trees.map((t) => ({
    name: t.name,
    // Canonical land-level path. A being-owned root tree lives at the
    // land root (parent === landRootId), so its address is /<name>.
    // The home view is a listing surface; entering a tree takes you
    // to the tree's own address, not to a home-prefixed sub-path.
    path:       `/${t.name}`,
    nodeId:     t._id,
    type:       t.type || null,
    visibility: t.visibility || "private",
    summary:    null,
    noteCount:  0,
    ...childPlacement(t.metadata),
  }));
}

// ─────────────────────────────────────────────────────────────────────
// Beings + inbox preview
// ─────────────────────────────────────────────────────────────────────

/**
 * Enrich a beings list with registered being metadata
 * (honoredIntents, respondMode, triggerOn) and the per-being inbox
 * summary at this node.
 *
 * `entries` is the static portion (being, label, description, kind,
 * icon, invocableBy, available, modeKey). The function attaches:
 *   - honoredIntents, respondMode, triggerOn from the being registry
 *     (or null if the being is not registered yet)
 *   - inbox: { total, unconsumed, recent } from getInboxSummary
 */
async function buildBeings(nodeId, entries) {
  // Inbox is keyed by recipient beingId (the receiving Being's _id). Each
  // descriptor entry's _activeSummonLookupBeingId is the canonical home-record
  // beingId, so it doubles as the inbox lookup key.
  const inboxByBeing = await getInboxSummary(nodeId);
  // Per-being placement lives on the parent node (where the being is
  // listed): metadata.position.beings.<being>, metadata.models.beings.<...>.
  let parentMetadata = null;
  if (nodeId) {
    const parent = await Node.findById(nodeId).select("metadata").lean();
    parentMetadata = parent?.metadata || null;
  }
  // Look up the live Summon for each being in parallel. The slim Summon
  // shape carries beingOut directly, so _activeSummonLookupBeingId is the
  // only working path. (The legacy nodeId+modeKey fallbacks queried
  // aiContext/treeContext, which no longer exist on Summon.)
  const activities = await Promise.all(
    entries.map(async (e) => {
      if (!e._activeSummonLookupBeingId) return null;
      const summon = await getActiveSummonForBeing(e._activeSummonLookupBeingId);
      return summonToActivity(summon);
    }),
  );
  return entries.map((entry, i) => {
    const def = getRole(entry.being);
    // Inbox lookup key is the receiving being's id (not the role name).
    // Falls back to an empty summary when the entry has no resolved being
    // yet (e.g. an extension registered a being-home that hasn't been
    // lazily instantiated).
    const inboxKey = entry._activeSummonLookupBeingId
      ? String(entry._activeSummonLookupBeingId)
      : null;
    const inb = (inboxKey && inboxByBeing[inboxKey]) || {
      total: 0, unconsumed: 0, recent: [], activeFrom: null, pendingFrom: [], queueDepth: 0,
    };
    // Strip internal lookup hints from the wire entry — they're only
    // used inside this builder.
    const { _activeSummonLookupNodeId, _activeSummonLookupBeingId, ...wireEntry } = entry;
    return {
      ...wireEntry,
      permissions:    def ? def.permissions : null,
      respondMode:    def ? def.respondMode : null,
      triggerOn:      def ? def.triggerOn : null,
      inbox:          inb,
      activity:       activities[i],
      // Queue state: derived from inbox. Renderer uses these to draw a
      // line of waiting beings behind whoever is currently being
      // responded to.
      busy:           inb.activeFrom !== null,
      talkingTo:      inb.activeFrom,
      queueDepth:     inb.queueDepth,
      pendingFrom:    inb.pendingFrom,
      ...beingPlacement(parentMetadata, entry.being),
    };
  });
}
