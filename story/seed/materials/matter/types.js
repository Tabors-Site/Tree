// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// types.js — the matter TYPE registry.
//
// Matter is the universal interface (philosophy/OS/matter.md): every
// external system — file formats, web pages, APIs, chains, devices —
// integrates into the story as a TYPED piece of matter, and
// extensions are how new types arrive. A type declares what the
// matter IS (content kinds it may carry) and what may be DONE with it
// (the DO ops that apply — the descriptor advertises them as the
// matter's actions, the role-walk gates them per caller). The verbs
// stay uniform; the implementations vary by type.
//
// `type` is orthogonal to `origin`:
//   origin — where the bytes live / how they're bridged
//            (ibp = the CAS owns them, filesystem = source mirror,
//            web = a URL, cross-story = another world's matter)
//   type   — what the matter IS and what can be done with it
//            (generic note, file, web page, model, ext:invoice, ...)
//
// The seed ships the BASIC types only (generic, file, web, model) —
// the same set the kernel will carry natively later. Everything else
// comes from extensions via registerMatterType, exactly like DO ops
// via registerOperation: seed types use bare names, extension types
// are namespaced "<ext>:<type>".
//
// Enforcement vs advertisement:
//   typeDef.ops        — advertisement. The descriptor surfaces these
//                        as the matter's actions[] menu.
//   op.matterTypes     — enforcement. An op registered with
//                        `matterTypes: [...]` refuses to run against
//                        matter of any other type (gate in doVerb).
//   create-matter auth — refined per-type: the role-walk sees
//                        `create-matter:<type>` so canDo entries can
//                        scope which types a role may bring into the
//                        world (bare `create-matter` still matches —
//                        same namespace semantics as grant-role:<role>).

import log from "../../seedStory/log.js";

const REGISTRY = new Map();

const MAX_REGISTERED = 500;
const SEED_NAME_RE = /^[a-z][a-z0-9-]*$/;
const EXT_NAME_RE = /^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/;

const VALID_CONTENT_KINDS = new Set(["text", "binary", "none"]);

/**
 * Register a matter type.
 *
 * @param {string} name   "generic" (seed) or "<ext>:<type>" (extension)
 * @param {object} def
 * @param {string}   [def.description]   one-line, shown in pickers
 * @param {string[]} [def.contentKinds]  subset of ["text","binary","none"];
 *                                       default ["text","none"]. Validated
 *                                       at create/edit time.
 * @param {string[]} [def.mimeTypes]     optional allowlist ("image/*" or
 *                                       exact) enforced on binary puts
 * @param {string[]} [def.ops]           DO op names that apply to this
 *                                       type — the descriptor's actions[]
 * @param {object}   [def.render]        opaque portal hints
 *                                       ({ icon, mode, ... })
 * @param {object}   [def.claims]        CLASSIFICATION advertisement —
 *                                       how this type claims incoming
 *                                       content in classifyMatter (the
 *                                       "what will this become?" answer).
 *                                       Distinct job from mimeTypes,
 *                                       which is the ENFORCEMENT
 *                                       allowlist at create/edit time.
 *                                       { mimeTypes?: ["image/*", ...],
 *                                         extensions?: [".pdf", ...],
 *                                         urlPatterns?: ["youtube.com", ...],
 *                                         schemes?: ["http","https"],
 *                                         priority?: number (tiebreak bump) }
 * @param {string}   [extName]           owning extension ("seed" default)
 * @returns {boolean} registered
 */
export function registerMatterType(name, def = {}, extName = "seed") {
  if (typeof name !== "string" || !name.length) {
    log.warn("MatterTypes", "registerMatterType: name must be a non-empty string");
    return false;
  }
  const owner = extName || "seed";
  const isSeedName = SEED_NAME_RE.test(name);
  const isExtName = EXT_NAME_RE.test(name);
  if (!isSeedName && !isExtName) {
    log.warn(
      "MatterTypes",
      `registerMatterType("${name}"): invalid name. Use "type" (seed) or "ext:type" (extension).`,
    );
    return false;
  }
  if (isSeedName && owner !== "seed") {
    log.warn(
      "MatterTypes",
      `registerMatterType("${name}"): bare names are reserved for the seed. Extension "${owner}" must register as "${owner}:${name}".`,
    );
    return false;
  }
  if (isExtName) {
    const prefix = name.split(":")[0];
    if (prefix !== owner) {
      log.warn(
        "MatterTypes",
        `registerMatterType("${name}"): prefix "${prefix}" does not match owner "${owner}".`,
      );
      return false;
    }
  }
  if (REGISTRY.size >= MAX_REGISTERED) {
    log.error("MatterTypes", `Matter-type registry full (${MAX_REGISTERED}). "${name}" rejected.`);
    return false;
  }
  if (REGISTRY.has(name)) {
    const existing = REGISTRY.get(name);
    log.warn(
      "MatterTypes",
      `Matter type "${name}" already registered by "${existing.ownerExtension}". Re-registration from "${owner}" rejected.`,
    );
    return false;
  }

  let contentKinds = Array.isArray(def.contentKinds) && def.contentKinds.length > 0
    ? def.contentKinds.filter((k) => VALID_CONTENT_KINDS.has(k))
    : ["text", "none"];
  if (contentKinds.length === 0) contentKinds = ["none"];

  REGISTRY.set(name, Object.freeze({
    name,
    description: typeof def.description === "string" ? def.description : null,
    contentKinds: Object.freeze([...contentKinds]),
    mimeTypes: Array.isArray(def.mimeTypes)
      ? Object.freeze(def.mimeTypes.filter((m) => typeof m === "string" && m.length))
      : null,
    ops: Array.isArray(def.ops)
      ? Object.freeze(def.ops.filter((o) => typeof o === "string" && o.length))
      : Object.freeze([]),
    render: def.render && typeof def.render === "object"
      ? Object.freeze({ ...def.render })
      : null,
    claims: freezeClaims(def.claims),
    ownerExtension: owner,
  }));
  log.verbose("MatterTypes", `Registered: ${name} (${owner})`);
  return true;
}

/** Validate + freeze a claims block. Null when absent/malformed. */
function freezeClaims(claims) {
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) return null;
  const strList = (v) =>
    Array.isArray(v)
      ? Object.freeze(v.filter((s) => typeof s === "string" && s.length).map((s) => s.toLowerCase()))
      : null;
  const out = {
    mimeTypes:   strList(claims.mimeTypes),
    extensions:  strList(claims.extensions),
    urlPatterns: strList(claims.urlPatterns),
    schemes:     strList(claims.schemes),
    priority:    Number.isFinite(claims.priority) ? claims.priority : 0,
  };
  const empty = !out.mimeTypes?.length && !out.extensions?.length
    && !out.urlPatterns?.length && !out.schemes?.length;
  return empty && out.priority === 0 ? null : Object.freeze(out);
}

export function unregisterMatterType(name) {
  return REGISTRY.delete(name);
}

/** Called by the loader when an extension unloads. */
export function unregisterMatterTypesFromExtension(extName) {
  let count = 0;
  for (const [name, def] of REGISTRY) {
    if (def.ownerExtension === extName) {
      REGISTRY.delete(name);
      count++;
    }
  }
  if (count > 0) {
    log.verbose("MatterTypes", `Unregistered ${count} matter type(s) from "${extName}"`);
  }
  return count;
}

export function getMatterType(name) {
  if (typeof name !== "string" || !name.length) return null;
  return REGISTRY.get(name) || null;
}

export function listMatterTypes() {
  return [...REGISTRY.values()];
}

/**
 * May matter of this type carry this kind of content?
 * kind: "text" | "binary" | "none"
 */
export function typeAllowsContentKind(typeDef, kind) {
  if (!typeDef) return false;
  return typeDef.contentKinds.includes(kind);
}

/** Does the type's mime allowlist (if any) admit this mimeType? */
export function typeAllowsMime(typeDef, mimeType) {
  if (!typeDef || !typeDef.mimeTypes || typeDef.mimeTypes.length === 0) return true;
  if (typeof mimeType !== "string" || !mimeType.length) return false;
  const bare = mimeType.split(";")[0].trim().toLowerCase();
  for (const pattern of typeDef.mimeTypes) {
    const p = pattern.toLowerCase();
    if (p === bare) return true;
    if (p.endsWith("/*") && bare.startsWith(p.slice(0, -1))) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────
// Seed basic types — the kernel-bound set. Most types come from
// extensions; these four are the substrate floor.
// ─────────────────────────────────────────────────────────────────────

registerMatterType("generic", {
  description: "Freeform matter — a note, a context chunk, a qualities-only object.",
  contentKinds: ["text", "none"],
  ops: ["set-matter", "end-matter"],
  render: { icon: "note", mode: "text" },
  // The text floor: bare text classifies here unless a more specific
  // type claims it.
  claims: { priority: -10 },
});

registerMatterType("file", {
  description: "A file — bytes of any format, stored by content hash.",
  contentKinds: ["binary", "text"],
  ops: ["set-matter", "end-matter", "purge-content"],
  render: { icon: "file", mode: "download" },
  // The binary catch-all: any mime classifies here at low priority so
  // specific types (model, ext image/video/...) outrank it.
  claims: { mimeTypes: ["*/*"], priority: -5 },
});

registerMatterType("http", {
  description:
    "Website content — strictly an HTTP/HTTPS link (that is what " +
    "loads in an iframe; nothing more general). The content shape is " +
    "the reference `{ url, contentType?, ... }` — `url` is the " +
    "DEFAULT (reset) link. The current page may move: navigation is " +
    "a fact (`set-matter field=qualities.http.currentUrl`), so every " +
    "being SEEs the same page and a reset is just clearing the " +
    "quality back to the default. The descriptor surfaces contentUrl " +
    "+ external so portals embed (iframe / player) or link out.",
  contentKinds: ["none"],
  ops: ["set-matter", "end-matter"],
  render: { icon: "globe", mode: "embed" },
  claims: { schemes: ["http", "https"] },
});

registerMatterType("model", {
  description:
    "A 3D model (.glb/.gltf) — a being's body in the 3D world. The " +
    "matter follows the being it embodies (matter.beingId); the being's " +
    "qualities point back at it. Bytes load natively from the content " +
    "store.",
  contentKinds: ["binary"],
  mimeTypes: ["model/gltf-binary", "model/gltf+json", "application/octet-stream"],
  ops: ["set-matter", "end-matter", "purge-content"],
  render: { icon: "model", mode: "model" },
  claims: {
    mimeTypes: ["model/gltf-binary", "model/gltf+json"],
    extensions: [".glb", ".gltf"],
  },
});

registerMatterType("source", {
  description:
    "Source matter — one matter row per file/dir under the repo " +
    "checkout, surfaced at the ./source heaven space and projected " +
    "onto disk by the mirror mount (philosophy/OS/MIRROR.md step 2). " +
    "The disk-fold populator (materials/space/source.js) births rows " +
    "with the reference `{ path, kind, size?, mtime?, mimeType?, " +
    "hash? }`; live writes through the mirror mount replace content " +
    "with a CAS ref (`{ kind:\"cas\", hash, ... }`) the same way file " +
    "matter does. Both content shapes are legal here; the mount " +
    "rendering layer reads whichever the row currently carries.",
  contentKinds: ["text", "binary", "none"],
  ops: ["create-matter", "set-matter", "end-matter", "rename-matter"],
  render: { icon: "code", mode: "source" },
});

registerMatterType("ibpa", {
  description:
    "An IBPA — the inter-story portal. Content carries the target " +
    "address (`{ target: \"<story>#<branch>/<position>\" }`), the " +
    "IBP sibling of web's `{ url }` — a COMPLETELY different " +
    "reference world: a url opens into the WWW over HTTP (render " +
    "only, iframes); an IBPA opens into another story over IBP " +
    "(four verbs, never an iframe). The same matter for every " +
    "viewer; what it IS for each (window / reach-through / " +
    "walk-through / black) is decided per-verb by the FOREIGN side's " +
    "stance auth for their identity — the matter just points. Not " +
    "3D-specific: a headless being reads `external.target` off the " +
    "descriptor entry and issues SEE/DO/SUMMON/BE at that address " +
    "through normal cross-world dispatch; that IS how beings move " +
    "between realities or act on one story from another. Formed " +
    "via `do form-portal`.",
  contentKinds: ["none"],
  ops: ["set-matter", "end-matter"],
  render: { icon: "portal", mode: "portal" },
});

registerMatterType("connection", {
  description:
    "A live WebSocket connection. One row per socket in " +
    "./host/websocket; the websocket-pool being creates it on " +
    "connect, updates qualities.connection.branch on a branch " +
    "reseat, and ends it on disconnect. qualities.connection " +
    "carries the socket identity (socketId, beingId, name, " +
    "branch, connectedAt). The pool's " +
    "act-chain is the connection log; the row is the live state.",
  contentKinds: ["none"],
  ops: ["set-matter", "end-matter"],
  render: { icon: "plug", mode: "qualities" },
  // No claims block: never auto-classified. Only the websocket-pool
  // being creates these (seed/materials/host/host.js).
});
