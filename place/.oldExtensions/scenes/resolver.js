// Scene resolver: walks the ancestor chain to determine which scene a
// node belongs to, plus its effective sceneType and ambient values.
//
// Rules:
//   - A node with metadata.scenes.doorway === true is a scene boundary.
//     Its descendants render in its own scene; ancestors above it are
//     out of scope for the resolution.
//   - sceneType and ambient are inherited from the nearest ancestor (up
//     to and including the doorway) that has the value set. Closer wins.
//   - If no doorway is found, the topmost node in the chain (root) is
//     the scene root.
//   - These rules mirror extension scope / tool scope / mode resolution
//     so reasoning about scoping behavior carries across the kernel.

import { getAncestorChain } from "../../seed/tree/ancestorCache.js";

function readNs(metadata, name) {
  if (!metadata) return null;
  if (metadata instanceof Map) return metadata.get(name) || null;
  return metadata[name] || null;
}

function readScenesNs(node) {
  return readNs(node?.metadata, "scenes");
}

// Derive the effective scenes data on a node by combining the explicit
// metadata.scenes namespace with fallbacks from other extensions' data.
// Explicit values always win; fallbacks fill gaps.
//
//   - metadata.scenes.{doorway,sceneType,ambient} are operator-curated
//   - metadata.governing.role === "ruler" implies doorway=true,
//     sceneType="pyramid-interior" when those fields aren't set
//
// Synchronous: the caller passes a node's metadata (already loaded).
export function deriveScene(metadata) {
  const explicit = readNs(metadata, "scenes") || {};
  let doorway   = explicit.doorway === true;
  let sceneType = typeof explicit.sceneType === "string" ? explicit.sceneType : null;
  let ambient   = explicit.ambient && typeof explicit.ambient === "object" ? explicit.ambient : null;

  // Derivations key off the protocol-level beings namespace so any
  // extension that places a Ruler home at a node gets the rulership
  // visual treatment, not just the governing extension specifically.
  const beings = readNs(metadata, "beings");
  if (beings?.ruler) {
    if (!explicit.doorway)   doorway = true;
    if (!sceneType)          sceneType = "pyramid-interior";
  }

  return { doorway, sceneType, ambient };
}

/**
 * Resolve the scene a node belongs to.
 *
 * Returns:
 *   { sceneNodeId, sceneType, ambient }
 *   - sceneNodeId: id of the nearest doorway ancestor (or root if none)
 *   - sceneType:   first non-null sceneType from node up to sceneNodeId
 *   - ambient:     first non-null ambient from node up to sceneNodeId
 *
 * Returns null if the node id resolves to nothing.
 */
export async function resolveScene(nodeId) {
  if (!nodeId) return null;
  const ancestors = await getAncestorChain(nodeId);
  if (!ancestors || ancestors.length === 0) return null;

  let sceneNodeId = null;
  let sceneType = null;
  let ambient = null;

  for (let i = 0; i < ancestors.length; i++) {
    const n = ancestors[i];
    // deriveScene combines explicit metadata.scenes with fallbacks from
    // other extensions (e.g. governing.role === "ruler" → pyramid-interior).
    const eff = deriveScene(n.metadata);
    if (sceneType === null && typeof eff.sceneType === "string") sceneType = eff.sceneType;
    if (ambient === null && eff.ambient && typeof eff.ambient === "object") ambient = eff.ambient;
    if (eff.doorway === true) {
      sceneNodeId = String(n._id);
      break;
    }
  }

  // No doorway found: the topmost ancestor is the implicit scene root.
  if (!sceneNodeId) {
    sceneNodeId = String(ancestors[ancestors.length - 1]._id);
  }

  return { sceneNodeId, sceneType, ambient };
}

/**
 * True iff this node is itself a doorway. Honors deriveScene so derived
 * doorways (e.g. ruler nodes) count even without explicit metadata.scenes.
 */
export async function nodeIsDoorway(nodeId) {
  if (!nodeId) return false;
  const ancestors = await getAncestorChain(nodeId);
  if (!ancestors || ancestors.length === 0) return false;
  return deriveScene(ancestors[0].metadata).doorway === true;
}

/**
 * True iff two nodes share a scene (same nearest-doorway ancestor).
 */
export async function inSameScene(nodeIdA, nodeIdB) {
  if (!nodeIdA || !nodeIdB) return false;
  if (String(nodeIdA) === String(nodeIdB)) return true;
  const [a, b] = await Promise.all([resolveScene(nodeIdA), resolveScene(nodeIdB)]);
  if (!a || !b) return false;
  return String(a.sceneNodeId) === String(b.sceneNodeId);
}
