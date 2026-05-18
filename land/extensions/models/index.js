// `models` — visual asset hints for nodes, beings, and artifacts.
//
// Namespace shape (all under metadata.models on a node):
//   {
//     model:     string,                                  // this node's asset hint
//     scale?:    number,                                  // optional, defaults to 1
//     beings:    { <being>: { model, scale? } },     // per-being visuals
//     artifacts: { <ref>:        { model, scale? } },     // per-artifact visuals
//   }
//
// Renderer interprets the `model` string. Unknown models fall back to
// the renderer's default shape for that kind.
//
// This extension is intentionally generic — it owns the namespace and
// exposes read helpers, but does not opinion about which kinds of nodes
// should get which visuals. A future TreeOS-flavored extension (e.g.
// `treeos-models`) listens to writes on TreeOS extension namespaces
// (governing, code-workspace, etc.) and stamps model hints through this
// extension's namespace — keeping the generic layer free of TreeOS
// knowledge.

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import { mergeExtMeta, getExtMeta } from "../../seed/tree/extensionMetadata.js";

export async function init(_core) {
  log.info("Models", "loaded");

  return {
    exports: {
      getModel,
      getBeingModel,
      getArtifactModel,
      setModel,
      setBeingModel,
      setArtifactModel,
      deriveModel,
    },
  };
}

// ────────────────────────────────────────────────────────────────
// Derivation
//
// `deriveModel(metadata)` computes the effective model for a node by
// looking at multiple namespaces in priority order:
//   1. Explicit metadata.models.model wins (operator-curated override)
//   2. Derive from common TreeOS extension data on this node:
//        - metadata.governing.role === "ruler" → "pyramid"
// Adding new derivations is additive — when the source extension
// (governing, code-workspace, etc.) is not installed, the corresponding
// branch is just dead. Synchronous so the descriptor can call it
// per-child without extra database lookups.
// ────────────────────────────────────────────────────────────────

function readNs(metadata, name) {
  if (!metadata) return null;
  if (metadata instanceof Map) return metadata.get(name) || null;
  return metadata[name] || null;
}

export function deriveModel(metadata) {
  if (!metadata) return null;
  const ns = readNs(metadata, "models");
  if (ns?.model) {
    return { model: ns.model, scale: typeof ns.scale === "number" ? ns.scale : 1 };
  }
  // Derived fallbacks. Each rule keys off a being-home registration in
  // the protocol-level beings namespace, not on extension-private
  // state. A Ruler at home → render as a pyramid. Future rules layer
  // alongside (Planner home → podium, Worker home → workshop, etc.).
  const beings = readNs(metadata, "beings");
  if (beings?.ruler) return { model: "pyramid", scale: 1 };
  return null;
}

// ────────────────────────────────────────────────────────────────
// Write helpers
//
// Other extensions (e.g. treeos-models) coordinate visuals by calling
// these helpers rather than writing the namespace directly. Keeping the
// write path inside the namespace's owning extension lets us layer in
// validation, defaults, and conflict resolution in one place.
// ────────────────────────────────────────────────────────────────

async function _resolveNode(nodeOrId) {
  if (!nodeOrId) return null;
  if (typeof nodeOrId === "object" && nodeOrId._id && nodeOrId.metadata !== undefined) return nodeOrId;
  const id = typeof nodeOrId === "string" ? nodeOrId : nodeOrId?._id;
  if (!id) return null;
  return Node.findById(id);
}

export async function setModel(nodeOrId, partial) {
  if (!partial || typeof partial !== "object") return false;
  const node = await _resolveNode(nodeOrId);
  if (!node) return false;
  // Only allow shallow node-level keys (model, scale) — sub-maps for
  // beings/artifacts go through setBeingModel / setArtifactModel.
  const clean = {};
  if (typeof partial.model === "string") clean.model = partial.model;
  if (typeof partial.scale === "number") clean.scale = partial.scale;
  if (Object.keys(clean).length === 0) return false;
  await mergeExtMeta(node, "models", clean);
  return true;
}

export async function setBeingModel(nodeOrId, being, partial) {
  if (!being || typeof partial !== "object") return false;
  const node = await _resolveNode(nodeOrId);
  if (!node) return false;
  const current = getExtMeta(node, "models");
  const beings  = { ...(current.beings || {}) };
  beings[being] = { ...(beings[being] || {}), ...partial };
  await mergeExtMeta(node, "models", { beings });
  return true;
}

export async function setArtifactModel(nodeOrId, ref, partial) {
  if (!ref || typeof partial !== "object") return false;
  const node = await _resolveNode(nodeOrId);
  if (!node) return false;
  const current = getExtMeta(node, "models");
  const artifacts = { ...(current.artifacts || {}) };
  artifacts[ref] = { ...(artifacts[ref] || {}), ...partial };
  await mergeExtMeta(node, "models", { artifacts });
  return true;
}

// ────────────────────────────────────────────────────────────────
// Exports
// ────────────────────────────────────────────────────────────────

/**
 * Read a node's own model + scale. Returns null if unset.
 */
export async function getModel(nodeOrId) {
  const ns = await readModelsNs(nodeOrId);
  if (!ns?.model) return null;
  return { model: ns.model, scale: ns.scale ?? 1 };
}

/**
 * Read a being's model + scale at the given node.
 */
export async function getBeingModel(nodeOrId, being) {
  if (!being) return null;
  const ns = await readModelsNs(nodeOrId);
  const m = ns?.beings?.[being];
  if (!m?.model) return null;
  return { model: m.model, scale: m.scale ?? 1 };
}

/**
 * Read an artifact's model + scale at the given node.
 */
export async function getArtifactModel(nodeOrId, ref) {
  if (!ref) return null;
  const ns = await readModelsNs(nodeOrId);
  const m = ns?.artifacts?.[ref];
  if (!m?.model) return null;
  return { model: m.model, scale: m.scale ?? 1 };
}

// ────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────

async function readModelsNs(nodeOrId) {
  if (!nodeOrId) return null;
  let node = nodeOrId;
  if (typeof nodeOrId === "string" || (nodeOrId && !nodeOrId.metadata)) {
    const id = typeof nodeOrId === "string" ? nodeOrId : nodeOrId._id;
    node = await Node.findById(id).select("metadata").lean();
    if (!node) return null;
  }
  const meta = node.metadata;
  if (!meta) return null;
  if (meta instanceof Map) return meta.get("models") || null;
  return meta.models || null;
}
