// Perspective Address parser + formatter.
//
// TreeOS replaces URLs with a three-tier addressing hierarchy:
//
//   Position           = land/path           (where)
//   Stance             = land/path@embodiment (where + as what being) — one side of a bridge
//   Perspective Address = stance -> stance   (full bridged form — one being addressing another)
//
// Each level answers a different question. "What's the position?" → just
// the land/path. "What's the stance?" → land/path/embodiment (one side).
// "What's the perspective address?" → the full bridged form.
//
// Full grammar (see ../docs/perspective-address.md):
//
//   PerspectiveAddress := Bridge | Stance
//   Bridge             := Stance "->" Stance
//   Stance             := Position "@" Embodiment | Position | Embodiment
//   Position           := Land? Path?
//   Land               := Domain (":" Port)?
//   Path               := "/"                        (land zone)
//                       | "/" Segment ("/" Segment)* (node — full chain or leaf-only)
//                       | "/~" UserSlug ("/" Segment)*  (home zone)
//                       | "~" ...                    (home shorthand; expands to /~<user>)
//   Segment            := node-name | node-id (uuid)
//   Embodiment         := "@" Identifier
//
// Path representations (browser switches between freely):
//   Each node has a stable id (uuid) AND a display name. A path can be
//   written as either form, and at either depth:
//     /tagay-book/chapter-1        full chain, names
//     /chapter-1                   leaf only, name
//     /<uuid-a>/<uuid-b>           full chain, ids
//     /<uuid-b>                    leaf only, id
//   All four resolve to the same node. The parser accepts any form; the
//   server resolves to a canonical nodeId and returns BOTH forms (the
//   id chain and the name chain) in the Position Descriptor so the
//   browser can render either.
//
// Both sides of a bridge are stances. They use the SAME grammar. A
// human user is represented as `<land>/@<username>` — i.e. an
// embodiment at the land root. A bare identifier on the left side
// (e.g. `tabor`) is the display shorthand for that. In future, the
// left side of a bridge may carry a deeper path so the request
// reflects WHERE in the user's land they're sending from (more
// location context for federated requests).
//
// The parser accepts shorthands and expands them against an optional
// context (currentLand / currentPath / currentUser / defaultEmbodiment).
// The formatter round-trips: format(parse(s, ctx), ctx) yields the
// canonical form.
//
// Errors are structured so the address-bar UI can highlight the bad
// segment.

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Parse a Perspective Address string into a normalized object.
 *
 * @param {string} input
 * @param {object} [ctx]
 * @param {string} [ctx.currentLand]       — e.g. "treeos.ai"
 * @param {string} [ctx.currentPath]       — e.g. "/~tabor/flappybird"
 * @param {string} [ctx.currentUser]       — e.g. "tabor"
 * @param {string} [ctx.defaultEmbodiment] — embodiment to assume when omitted
 * @returns {{ left: Stance|null, right: Stance }}
 */
export function parse(input, ctx = {}) {
  if (typeof input !== "string") {
    throw paError(
      "input-not-string",
      input,
      "Perspective address must be a string",
    );
  }
  const trimmed = input.trim();
  if (!trimmed) {
    throw paError("empty-input", input, "Perspective address cannot be empty");
  }
  // Bridge?
  const bridgeIdx = trimmed.indexOf("->");
  let leftStr = null;
  let rightStr = trimmed;
  if (bridgeIdx >= 0) {
    leftStr = trimmed.slice(0, bridgeIdx).trim();
    rightStr = trimmed.slice(bridgeIdx + 2).trim();
    if (!leftStr) {
      throw paError("empty-left", input, "Bridge has empty left stance", {
        offset: 0,
      });
    }
    if (!rightStr) {
      throw paError("empty-right", input, "Bridge has empty right stance", {
        offset: bridgeIdx + 2,
      });
    }
    if (rightStr.includes("->")) {
      throw paError(
        "multiple-bridges",
        input,
        "Only one '->' separator allowed",
      );
    }
  }
  const right = parseStance(rightStr, ctx);
  const left = leftStr
    ? parseStance(leftStr, ctx, { isLeftSide: true })
    : null;
  return { left, right };
}

/**
 * Format a parsed PA back to its canonical string form. Inverse of
 * parse() — round-trips for any parser-acceptable input.
 *
 * @param {{ left?: Stance|null, right: Stance }} pa
 * @param {object} [opts]
 * @param {boolean} [opts.omitDefaultEmbodiment] — drop @embodiment if it matches defaultEmbodiment
 * @param {string}  [opts.defaultEmbodiment]
 * @returns {string}
 */
export function format(pa, opts = {}) {
  if (!pa || typeof pa !== "object") {
    throw paError("format-bad-input", pa, "Cannot format non-object");
  }
  const rightStr = formatStance(pa.right, opts);
  if (pa.left) {
    return `${formatStance(pa.left, opts)} -> ${rightStr}`;
  }
  return rightStr;
}

/**
 * Expand a PA's shorthands against a context. Returns a new PA with
 * fully-resolved land / path / embodiment fields on each stance.
 * Useful at request time, where the server expects a fully-qualified
 * address.
 *
 * @param {{ left?, right }} pa
 * @param {object} ctx
 * @returns {{ left?, right }}
 */
export function expand(pa, ctx = {}) {
  return {
    left: pa.left ? expandStance(pa.left, ctx) : null,
    right: expandStance(pa.right, ctx),
  };
}

/**
 * Round-trip canonicalization: parse, expand against ctx, re-format.
 * The result is the most explicit form the address can take.
 */
export function canonical(input, ctx = {}) {
  return format(expand(parse(input, ctx), ctx));
}

/**
 * Validate that a parsed PA is well-formed (after expansion). Returns
 * { ok: true } or { ok: false, errors: [...] }.
 */
export function validate(pa, ctx = {}) {
  const errors = [];
  const check = (stance, label) => {
    if (!stance) return;
    if (
      stance.land !== null &&
      stance.land !== undefined &&
      !isValidLand(stance.land)
    ) {
      errors.push({
        side: label,
        field: "land",
        value: stance.land,
        reason: "invalid-land",
      });
    }
    if (
      stance.path !== null &&
      stance.path !== undefined &&
      !isValidPath(stance.path)
    ) {
      errors.push({
        side: label,
        field: "path",
        value: stance.path,
        reason: "invalid-path",
      });
    }
    if (
      stance.embodiment !== null &&
      stance.embodiment !== undefined &&
      !isValidEmbodiment(stance.embodiment)
    ) {
      errors.push({
        side: label,
        field: "embodiment",
        value: stance.embodiment,
        reason: "invalid-embodiment",
      });
    }
  };
  check(pa.left, "left");
  check(pa.right, "right");
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ─────────────────────────────────────────────────────────────────────
// Stance-level parsing
// ─────────────────────────────────────────────────────────────────────

function parseStance(input, ctx, opts = {}) {
  const { isLeftSide = false } = opts;
  const s = input.trim();
  if (!s) {
    throw paError("empty-stance", input, "Stance cannot be empty");
  }
  // Bare embodiment? "@ruler"
  if (s.startsWith("@")) {
    // On the left side of a bridge, `@tabor` is the explicit-@ form of
    // the human-user shorthand: it means the user `tabor` at the land
    // root.
    if (isLeftSide) {
      return {
        land: ctx.currentLand || null,
        path: "/",
        embodiment: parseEmbodiment(s),
      };
    }
    return {
      land: ctx.currentLand || null,
      path: ctx.currentPath || null,
      embodiment: parseEmbodiment(s),
    };
  }
  // Split embodiment off the tail.
  let embodiment = null;
  let rest = s;
  const atIdx = findStandaloneAt(s);
  if (atIdx >= 0) {
    embodiment = parseEmbodiment(s.slice(atIdx));
    rest = s.slice(0, atIdx);
  }
  // After stripping embodiment, `rest` is a position (land+path).
  if (!rest) {
    return {
      land: ctx.currentLand || null,
      path: ctx.currentPath || null,
      embodiment,
    };
  }
  // Determine if `rest` includes a land identifier or is just a zone marker.
  // The three zone markers are:
  //   "/"            → land zone (literal slash IS the land)
  //   "/<id>..."     → node zone (slash followed by node id or full path)
  //   "~" / "~user"  → home zone (shorthand; expands to "/~<user>")
  // A land identifier (e.g. "treeos.ai") never starts with "/" or "~", so a
  // leading slash or tilde means we're already inside the current land.
  if (rest.startsWith("/") || rest.startsWith("~")) {
    return {
      land: ctx.currentLand || null,
      path: parsePath(rest, ctx),
      embodiment,
    };
  }
  // Otherwise `rest` starts with a land identifier.
  // Find first "/" — that's the land/path boundary.
  const slashIdx = rest.indexOf("/");
  const tildeIdx = rest.indexOf("~");
  let boundary = -1;
  if (slashIdx >= 0 && tildeIdx >= 0) boundary = Math.min(slashIdx, tildeIdx);
  else if (slashIdx >= 0) boundary = slashIdx;
  else if (tildeIdx >= 0) boundary = tildeIdx;
  if (boundary < 0) {
    // No path separator. On the left side of a bridge with no '@', this
    // is the human-user shorthand: `tabor` → land root, embodied as
    // `tabor`. On either side without a path, this can also be a
    // land-only reference (rare).
    if (isLeftSide && !embodiment) {
      // Bare identifier on left → human user at land root.
      return {
        land: ctx.currentLand || null,
        path: "/",
        embodiment: rest,
      };
    }
    return {
      land: parseLand(rest),
      path: null,
      embodiment,
    };
  }
  const landPart = rest.slice(0, boundary);
  const pathPart = rest.slice(boundary);
  return {
    land: parseLand(landPart),
    path: parsePath(pathPart, ctx),
    embodiment,
  };
}

// Find an "@" that's NOT inside a path segment. The grammar puts the
// embodiment AT THE END after land and path, so we find the LAST "@"
// in the string.
function findStandaloneAt(s) {
  return s.lastIndexOf("@");
}

function parseEmbodiment(s) {
  if (!s.startsWith("@")) {
    throw paError(
      "invalid-embodiment-prefix",
      s,
      "Embodiment must start with @",
    );
  }
  const id = s.slice(1).trim();
  if (!id) {
    throw paError("empty-embodiment", s, "Embodiment identifier is empty");
  }
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw paError(
      "invalid-embodiment-chars",
      s,
      `Embodiment "${id}" must be lowercase kebab-case starting with a letter`,
    );
  }
  return id;
}

function parseLand(s) {
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (!isValidLand(trimmed)) {
    throw paError("invalid-land", trimmed, `Invalid land "${trimmed}"`);
  }
  return trimmed;
}

function parsePath(s, ctx) {
  const trimmed = s.trim();
  if (!trimmed) return null;
  // Home shorthand: "~" alone → current user's home.
  if (trimmed === "~") {
    if (!ctx.currentUser) {
      throw paError(
        "missing-user-context",
        trimmed,
        "Cannot expand '~' without ctx.currentUser",
      );
    }
    return `/~${ctx.currentUser}`;
  }
  // "~user/..." → "/~user/..."
  if (trimmed.startsWith("~") && !trimmed.startsWith("/~")) {
    return `/${trimmed}`;
  }
  // Land root: "/" stays "/".
  if (trimmed === "/") return "/";
  // Otherwise must start with "/".
  if (!trimmed.startsWith("/")) {
    throw paError(
      "invalid-path",
      trimmed,
      `Path "${trimmed}" must start with "/" or "~"`,
    );
  }
  if (!isValidPath(trimmed)) {
    throw paError(
      "invalid-path-segments",
      trimmed,
      `Path "${trimmed}" contains invalid segments`,
    );
  }
  return trimmed;
}

// ─────────────────────────────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────────────────────────────

function formatStance(stance, opts = {}) {
  if (!stance) return "";
  let out = "";
  if (stance.land) out += stance.land;
  if (stance.path) {
    // "/" at land root with an embodiment renders as "/" + "@xxx".
    // The grammar shows the canonical form as `<land>/@<embodiment>`,
    // i.e. the slash separates land from path. "/" + "@tabor" already
    // does that.
    out += stance.path;
  }
  if (stance.embodiment) {
    if (
      opts.omitDefaultEmbodiment &&
      opts.defaultEmbodiment &&
      stance.embodiment === opts.defaultEmbodiment
    ) {
      // skip
    } else {
      out += `@${stance.embodiment}`;
    }
  }
  return out;
}

function expandStance(stance, ctx) {
  if (!stance) return stance;
  return {
    ...stance,
    land: stance.land || ctx.currentLand || null,
    path: stance.path || ctx.currentPath || null,
    embodiment: stance.embodiment || ctx.defaultEmbodiment || null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Validation primitives
// ─────────────────────────────────────────────────────────────────────

// Lenient: DNS-like, also allows bare identifiers for local lands
// ("localhost", "tabor-laptop") and explicit port.
const LAND_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;

export function isValidLand(land) {
  return typeof land === "string" && LAND_RE.test(land);
}

const SEGMENT_RE = /^[a-z0-9_~][a-z0-9_.-]*$/i;

export function isValidPath(path) {
  if (typeof path !== "string") return false;
  if (path === "/") return true;
  if (!path.startsWith("/")) return false;
  const segments = path.slice(1).split("/").filter(Boolean);
  if (segments.length === 0) return false;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (i === 0 && seg.startsWith("~")) {
      // "~user" — validate the user part
      const userSlug = seg.slice(1);
      if (!userSlug || !/^[a-z0-9_-]+$/i.test(userSlug)) return false;
    } else if (!SEGMENT_RE.test(seg)) {
      return false;
    }
  }
  return true;
}

const EMBODIMENT_RE = /^[a-z][a-z0-9-]*$/;

export function isValidEmbodiment(embodiment) {
  return typeof embodiment === "string" && EMBODIMENT_RE.test(embodiment);
}

// ─────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────

function paError(code, input, message, extra = {}) {
  const err = new Error(`PerspectiveAddress: ${message}`);
  err.code = code;
  err.paInput = input;
  Object.assign(err, extra);
  return err;
}

// ─────────────────────────────────────────────────────────────────────
// Convenience: derive HTTP route shape from a Stance
// ─────────────────────────────────────────────────────────────────────

/**
 * Map a Stance (typically the right side of a PA) to the HTTP route
 * the land server uses. See ../docs/server-protocol.md for the contract.
 *
 * Returns: { url, method: "GET", embodiment }
 */
export function toHttpRoute(stance) {
  if (!stance || !stance.path) {
    throw paError(
      "missing-path-for-route",
      stance,
      "Cannot derive route without a path",
    );
  }
  const path = stance.path;
  let zone, encodedTail;
  if (path === "/") {
    zone = "land";
    encodedTail = "";
  } else if (path.startsWith("/~")) {
    zone = "home";
    // strip leading "/~"
    const rest = path.slice(2);
    // first segment is the user slug; remaining segments are inside the home
    const segs = rest.split("/").filter(Boolean);
    encodedTail = segs.map(encodeURIComponent).join("/");
  } else {
    zone = "node";
    const segs = path.slice(1).split("/").filter(Boolean);
    encodedTail = segs.map(encodeURIComponent).join("/");
  }
  const base = `/api/v1/position/${zone}${encodedTail ? `/${encodedTail}` : "/"}`;
  const url = stance.embodiment
    ? `${base}?embodiment=${encodeURIComponent(stance.embodiment)}`
    : base;
  return { url, method: "GET", embodiment: stance.embodiment || null };
}

/**
 * @typedef {object} Stance
 * @property {string|null} land       — e.g. "treeos.ai" (or null when implicit)
 * @property {string|null} path       — e.g. "/~tabor/flappybird" (or null)
 * @property {string|null} embodiment — e.g. "ruler" (or null)
 *
 * A Stance carries both a Position (land + path) and an Embodiment.
 * When `embodiment` is null, the Stance reduces to a bare Position.
 */
