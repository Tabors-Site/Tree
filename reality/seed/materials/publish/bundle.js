// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Clone bundle. Portable representation of a subtree's current state.
// A clone is one of two portable artifacts (the other is a seed, which
// preserves acts and is plant-only). See `seed/Chain-Rebuild.md` for
// the vocabulary doctrine.
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
//       operatorBeingId,      who cloned (audit, not used at graft time)
//     },
//     manifest: {
//       extensions,           array of extension names the receiver must have loaded
//       roles,                array of role names the receiver must have registered
//     },
//     parameters: [           // declared parameter holes (may be empty)
//       { name, type, default?, description? }
//     ],
//     content: { spaces, beings, matter }
//   }
//
// PARAMETERS. Authored clones can declare named parameter holes the
// grafter fills at apply time. Any string field value of the form
// `"$paramName"` is substituted with `opts.params[paramName]` (or the
// parameter's default) by the graft walker. Missing required parameters
// refuse the graft up front; unknown `$names` refuse the graft loudly
// so silent misroutes don't survive.
//
// `$placeholder` strings that match a bundle sourceId pattern (the ID
// remap from spaces/beings/matter entries) continue to flow through
// the existing Refs system. Parameters are the operator-supplied
// counterpart: ID-substitution for the clone's internal refs,
// parameter-substitution for the clone's operator-controlled knobs.
//
// `type` is informational (no runtime coercion) but reserved for a
// future "validate parameter shape" pass. Documented types: "string",
// "number", "boolean", "json".
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
  // parameters: array (possibly empty) of declarations. Each entry has a
  // name string; `type` and `default` are free-form. Duplicate names are
  // rejected so substitution is unambiguous.
  if (!Array.isArray(bundle.parameters)) {
    throw new Error("bundle.parameters: required array (use [] when none)");
  }
  const seen = new Set();
  for (const p of bundle.parameters) {
    if (!p || typeof p !== "object" || typeof p.name !== "string" || !p.name) {
      throw new Error("bundle.parameters: every entry needs a name string");
    }
    if (seen.has(p.name)) {
      throw new Error(`bundle.parameters: duplicate name "${p.name}"`);
    }
    seen.add(p.name);
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
      createdAt:         null,  // stamped by cloneSubtree at completion
      operatorBeingId:   operatorBeingId || null,
    },
    manifest: {
      extensions: [],
      roles:      [],
    },
    // Captured clones don't author parameters — operators add them by
    // hand if they want to turn a captured snapshot into a template.
    // Statically-authored clones (extension manifest scaffolds) emit
    // their own bundle with parameters declared.
    parameters: [],
    content: {
      spaces: [],
      beings: [],
      matter: [],
    },
  };
}
