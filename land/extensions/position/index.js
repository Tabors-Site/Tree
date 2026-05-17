// `position` — 2D coordinates for nodes, beings, and artifacts.
//
// Namespace shape (all under metadata.position on a node):
//   {
//     coords:    { x, y },                     // this node's own coords
//     beings:    { <embodiment>: { x, y } },   // beings invocable here
//     artifacts: { <noteId>:    { x, y } },    // artifacts attached here
//   }
//
// The same namespace covers every kind of placement. Other extensions
// read coords through the exported helpers; DO actions (place,
// place-being, place-artifact) write through the portal layer.

import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";

// Deterministic-from-id offset so freshly created nodes spread around
// their parent in a stable layout. Range is roughly [-SPREAD, +SPREAD]
// units per axis, which keeps a fresh tree visible without overlapping
// the parent's origin.
const SPREAD = 30;

function hashKey(s) {
  const str = String(s || "");
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function offsetFromId(id) {
  const h = hashKey(id);
  const angle  = ((h % 360) * Math.PI) / 180;
  const radius = 8 + ((h >> 9) % SPREAD);
  return {
    x: Math.round(Math.cos(angle) * radius),
    y: Math.round(Math.sin(angle) * radius),
  };
}

export async function init(core) {
  log.info("Position", "loaded");

  // Auto-placement at create. Just the initial write to metadata.position.coords;
  // the same field is rewritten by every subsequent `do place`. There is no
  // "default vs moved" distinction in the data — the create hook just happens
  // to be the first writer.
  core.hooks.register("afterNodeCreate", async ({ node }) => {
    if (!node || !node._id) return;
    try {
      // Find the parent's coords (default 0,0 for roots or when missing).
      let parentCoords = { x: 0, y: 0 };
      if (node.parent) {
        const parent = await Node.findById(node.parent).select("metadata").lean();
        const parentPosition = parent?.metadata?.position
          || (parent?.metadata instanceof Map ? parent.metadata.get("position") : null);
        if (parentPosition?.coords) {
          parentCoords = parentPosition.coords;
        }
      }
      const offset = offsetFromId(node._id);
      const coords = {
        x: parentCoords.x + offset.x,
        y: parentCoords.y + offset.y,
      };
      // Merge so we don't clobber any other position sub-keys that another
      // hook handler might write first (artifacts/beings live in the same ns).
      await core.metadata.mergeExtMeta(node, "position", { coords });
    } catch (err) {
      log.warn("Position", `afterNodeCreate placement failed for ${node._id}: ${err.message}`);
    }
  }, "position");

  return {
    exports: {
      getCoords,
      getBeingCoords,
      getArtifactCoords,
      distance,
    },
  };
}

// ────────────────────────────────────────────────────────────────
// Exports
// ────────────────────────────────────────────────────────────────

/**
 * Read a node's own coords. Returns null if unplaced.
 * Accepts either a node document (with metadata) or a node id.
 */
export async function getCoords(nodeOrId) {
  const ns = await readPositionNs(nodeOrId);
  return ns?.coords || null;
}

/**
 * Read a being's coords at the given node. Returns null if unplaced.
 */
export async function getBeingCoords(nodeOrId, embodiment) {
  if (!embodiment) return null;
  const ns = await readPositionNs(nodeOrId);
  return ns?.beings?.[embodiment] || null;
}

/**
 * Read an artifact's coords at the given node. `ref` is typically the
 * note id (string). Returns null if unplaced.
 */
export async function getArtifactCoords(nodeOrId, ref) {
  if (!ref) return null;
  const ns = await readPositionNs(nodeOrId);
  return ns?.artifacts?.[ref] || null;
}

/**
 * Euclidean distance between two coords. Useful for "is the target
 * close enough to walk to" decisions or sort-by-proximity.
 */
export function distance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
}

// ────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────

async function readPositionNs(nodeOrId) {
  if (!nodeOrId) return null;
  let node = nodeOrId;
  if (typeof nodeOrId === "string" || (nodeOrId && !nodeOrId.metadata)) {
    const id = typeof nodeOrId === "string" ? nodeOrId : nodeOrId._id;
    node = await Node.findById(id).select("metadata").lean();
    if (!node) return null;
  }
  const meta = node.metadata;
  if (!meta) return null;
  if (meta instanceof Map) return meta.get("position") || null;
  return meta.position || null;
}
