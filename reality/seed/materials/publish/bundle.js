// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Replicate bundle. Portable snapshot of a subtree's current state.
//
// Shape:
//   {
//     meta: {
//       bundleVersion,        "1.0"
//       sourceReality,        domain that produced it
//       sourceBranch,         which branch the snapshot was taken from
//       sourceScopeName,      human label for what was extracted
//       sourceScopeSpaceId,   the root space's source-namespace id
//       createdAt,            ISO string
//       operatorBeingId,      who replicated (audit, not used at graft time)
//     },
//     manifest: {
//       extensions,           array of extension names the receiver must have loaded
//       roles,                array of role names the receiver must have registered
//     },
//     content: {
//       // Aggregates in dependency order: spaces (depth-ascending), beings, matter.
//       // Each entry carries a sourceId; Refs in fields point at sourceIds within
//       // this bundle OR at the two sentinels (INSERTION_POINT, GRAFT_INITIATOR).
//       spaces:  [ { sourceId, name, type, parent, rootOwner, contributors, size, coord, qualities } ],
//       beings:  [ { sourceId, name, defaultRole, parentBeingId, homeSpace, position, coord, qualities } ],
//       matter:  [ { sourceId, name, spaceId, beingId, parentMatterId, origin, content, qualities } ],
//     },
//   }
//
// The walker (`findRefs` / `remapRefs` in seed/materials/refWalker.js)
// reads + remaps Refs in this format. Outside the bundle, the substrate
// uses bare-string IDs everywhere.

export const BUNDLE_VERSION = "1.0";

/**
 * Validate a bundle's structural shape. Throws on mismatch with a
 * specific message — the caller (graft handler, CLI, etc.) surfaces the
 * error. Returns true on success.
 *
 * Checks structure only; semantic validation (dependency resolution,
 * conflict detection) happens during graft.
 */
export function assertValidBundle(bundle) {
  if (!bundle || typeof bundle !== "object") {
    throw new Error("bundle: must be an object");
  }
  if (!bundle.meta || typeof bundle.meta !== "object") {
    throw new Error("bundle.meta: required object");
  }
  if (bundle.meta.bundleVersion !== BUNDLE_VERSION) {
    throw new Error(
      `bundle.meta.bundleVersion: expected ${BUNDLE_VERSION}, got ${bundle.meta.bundleVersion}`,
    );
  }
  if (!bundle.manifest || typeof bundle.manifest !== "object") {
    throw new Error("bundle.manifest: required object");
  }
  if (!Array.isArray(bundle.manifest.extensions)) {
    throw new Error("bundle.manifest.extensions: required array");
  }
  if (!Array.isArray(bundle.manifest.roles)) {
    throw new Error("bundle.manifest.roles: required array");
  }
  if (!bundle.content || typeof bundle.content !== "object") {
    throw new Error("bundle.content: required object");
  }
  for (const kind of ["spaces", "beings", "matter"]) {
    if (!Array.isArray(bundle.content[kind])) {
      throw new Error(`bundle.content.${kind}: required array`);
    }
    for (const entry of bundle.content[kind]) {
      if (!entry || typeof entry !== "object" || typeof entry.sourceId !== "string") {
        throw new Error(`bundle.content.${kind}: every entry needs a sourceId string`);
      }
    }
  }
  return true;
}

/**
 * Empty bundle scaffold. The replicator fills it in as it walks the
 * source subtree.
 */
export function emptyBundle({ sourceReality, sourceBranch, sourceScopeName, sourceScopeSpaceId, operatorBeingId }) {
  return {
    meta: {
      bundleVersion:     BUNDLE_VERSION,
      sourceReality:     sourceReality || null,
      sourceBranch:      sourceBranch || "0",
      sourceScopeName:   sourceScopeName || null,
      sourceScopeSpaceId: sourceScopeSpaceId || null,
      createdAt:         null,  // stamped by replicateSubtree at completion
      operatorBeingId:   operatorBeingId || null,
    },
    manifest: {
      extensions: [],
      roles:      [],
    },
    content: {
      spaces: [],
      beings: [],
      matter: [],
    },
  };
}
