// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// IBP Address: parser + formatter + server-side context helpers.
//
// TreeOS replaces URLs with a three-tier addressing hierarchy:
//
//   Position    = land/path           (where)
//   Stance      = land/path@being     (where + as what being) — one side of a bridge
//   IBP Address = stance :: stance    (full bridged form — one being addressing another)
//
// Each level answers a different question. "What's the position?" → just
// the land/path. "What's the stance?" → land/path@being (one side).
// "What's the IBP address?" → the full bridged form. See [[project_ibp_wire_shape]]
// and [[project_ibp_address_asymmetry]] for the architectural locks.
//
// Full grammar (see docs/ibp-address.md):
//
//   IbpAddress := Bridge | Stance
//   Bridge     := Stance "::" Stance
//   Stance     := Position "@" Being | Position | Being
//   Position   := Land? Path?
//   Land       := Domain (":" Port)?
//   Path       := "/"                            (land zone)
//               | "/" Segment ("/" Segment)*     (space — full chain or leaf-only)
//               | "/~" UserSlug ("/" Segment)*   (home zone)
//               | "~" ...                        (home shorthand; expands to /~<user>)
//   Segment    := space-name | space-id (uuid)
//   Being      := "@" Identifier
//
// Path representations (portal switches between freely):
//   Each space has a stable id (uuid) AND a display name. A path can be
//   written as either form, and at either depth:
//     /tagay-book/chapter-1        full chain, names
//     /chapter-1                   leaf only, name
//     /<uuid-a>/<uuid-b>           full chain, ids
//     /<uuid-b>                    leaf only, id
//   All four resolve to the same space. The parser accepts any form; the
//   server resolves to a canonical spaceId and returns BOTH forms (the
//   id chain and the name chain) in the Position Description so the
//   portal can render either.
//
// Both sides of a bridge are stances. They use the SAME grammar. A
// human user is represented as `<land>/@<username>` — i.e. a being at
// the land root. A bare identifier on the left side (e.g. `tabor`) is
// the display shorthand for that. In future, the left side of a bridge
// may carry a deeper path so the request reflects WHERE in the user's
// land they're sending from (more location context for federated
// requests).
//
// The parser accepts shorthands and expands them against an optional
// context (currentLand / currentPath / currentUser / defaultBeing).
// The formatter round-trips: format(parse(s, ctx), ctx) yields the
// canonical form.
//
// Errors are structured so the address-bar UI can highlight the bad
// segment. On the server, parseFromSocket and parseWithContext rethrow
// as IbpError so wire handlers can serialize them onto the IBP envelope.
//
// THIS FILE IS THE SINGLE SOURCE OF TRUTH for the IBP Address grammar.
// Portal clients (browser, 3D) import the parser through a Vite alias
// (`@ibp-address`) pointing at this file. Server code imports directly.

// ─────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────

/**
 * Parse an IBP Address string into a normalized object.
 *
 * @param {string} input
 * @param {object} [ctx]
 * @param {string} [ctx.currentLand]   — e.g. "treeos.ai"
 * @param {string} [ctx.currentPath]   — e.g. "/~tabor/flappybird"
 * @param {string} [ctx.currentUser]   — e.g. "tabor"
 * @param {string} [ctx.defaultBeing]  — being to assume when omitted
 * @returns {{ left: Stance|null, right: Stance }}
 */
export function parse(input, ctx = {}) {
  if (typeof input !== "string") {
    throw paError("input-not-string", input, "Portal address must be a string");
  }
  const trimmed = input.trim();
  if (!trimmed) {
    throw paError("empty-input", input, "Portal address cannot be empty");
  }
  // Bridge?
  const bridgeIdx = trimmed.indexOf("::");
  let leftStr = null;
  let rightStr = trimmed;
  if (bridgeIdx >= 0) {
    leftStr = trimmed.slice(0, bridgeIdx).trim();
    rightStr = trimmed.slice(bridgeIdx + 2).trim();
    if (!leftStr) {
      throw paError("empty-left", input, "Bridge has empty left stance", { offset: 0 });
    }
    if (!rightStr) {
      throw paError("empty-right", input, "Bridge has empty right stance", { offset: bridgeIdx + 2 });
    }
    if (rightStr.includes("::")) {
      throw paError("multiple-bridges", input, "Only one '::' separator allowed");
    }
  }
  const right = parseStance(rightStr, ctx);
  const left = leftStr
    ? parseStance(leftStr, ctx, { isLeftSide: true })
    : null;
  return { left, right };
}

/**
 * Format a parsed IBPA back to its canonical string form. Inverse of
 * parse() — round-trips for any parser-acceptable input.
 *
 * @param {{ left?: Stance|null, right: Stance }} pa
 * @param {object} [opts]
 * @param {boolean} [opts.omitDefaultBeing] — drop @being if it matches defaultBeing
 * @param {string}  [opts.defaultBeing]
 * @returns {string}
 */
export function format(pa, opts = {}) {
  if (!pa || typeof pa !== "object") {
    throw paError("format-bad-input", pa, "Cannot format non-object");
  }
  const rightStr = formatStance(pa.right, opts);
  if (pa.left) {
    return `${formatStance(pa.left, opts)} :: ${rightStr}`;
  }
  return rightStr;
}

/**
 * Expand an IBPA's shorthands against a context. Returns a new IBPA
 * with fully-resolved land / path / being fields on each stance.
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
 * Validate that a parsed IBPA is well-formed (after expansion). Returns
 * { ok: true } or { ok: false, errors: [...] }.
 */
export function validate(pa) {
  const errors = [];
  const check = (stance, label) => {
    if (!stance) return;
    if (stance.land != null && !isValidLand(stance.land)) {
      errors.push({ side: label, field: "land", value: stance.land, reason: "invalid-land" });
    }
    if (stance.path != null && !isValidPath(stance.path)) {
      errors.push({ side: label, field: "path", value: stance.path, reason: "invalid-path" });
    }
    if (stance.being != null && !isValidBeing(stance.being)) {
      errors.push({ side: label, field: "being", value: stance.being, reason: "invalid-being" });
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
  // Bare being? "@ruler"
  if (s.startsWith("@")) {
    // On the left side of a bridge, `@tabor` is the explicit-@ form of
    // the human-user shorthand: it means the user `tabor` at the land root.
    if (isLeftSide) {
      return { land: ctx.currentLand || null, path: "/", being: parseBeing(s) };
    }
    return { land: ctx.currentLand || null, path: ctx.currentPath || null, being: parseBeing(s) };
  }
  // Split being off the tail.
  let being = null;
  let rest = s;
  const atIdx = findStandaloneAt(s);
  if (atIdx >= 0) {
    being = parseBeing(s.slice(atIdx));
    rest = s.slice(0, atIdx);
  }
  // After stripping being, `rest` is a position (land+path).
  if (!rest) {
    return { land: ctx.currentLand || null, path: ctx.currentPath || null, being };
  }
  // Determine if `rest` includes a land identifier or is just a zone marker.
  // The three zone markers are:
  //   "/"            → land zone (literal slash IS the land)
  //   "/<id>..."     → tree zone (slash followed by space id or full path)
  //   "~" / "~user"  → home zone (shorthand; expands to "/~<user>")
  // A land identifier (e.g. "treeos.ai") never starts with "/" or "~", so a
  // leading slash or tilde means we're already inside the current land.
  if (rest.startsWith("/") || rest.startsWith("~")) {
    return { land: ctx.currentLand || null, path: parsePath(rest, ctx), being };
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
    if (isLeftSide && !being) {
      return { land: ctx.currentLand || null, path: "/", being: rest };
    }
    return { land: parseLand(rest), path: null, being };
  }
  const landPart = rest.slice(0, boundary);
  const pathPart = rest.slice(boundary);
  return { land: parseLand(landPart), path: parsePath(pathPart, ctx), being };
}

// Find an "@" that's NOT inside a path segment. The grammar puts the
// being AT THE END after land and path, so we find the LAST "@".
function findStandaloneAt(s) {
  return s.lastIndexOf("@");
}

function parseBeing(s) {
  if (!s.startsWith("@")) {
    throw paError("invalid-being-prefix", s, "Being must start with @");
  }
  const id = s.slice(1).trim();
  if (!id) {
    throw paError("empty-being", s, "Being identifier is empty");
  }
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw paError("invalid-being-chars", s, `Being "${id}" must be lowercase kebab-case starting with a letter`);
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
  // Home shorthand: "~" or "/~" alone → current user's home.
  if (trimmed === "~" || trimmed === "/~") {
    if (!ctx.currentUser) {
      throw paError("missing-user-context", trimmed, "Cannot expand '~' without ctx.currentUser");
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
    throw paError("invalid-path", trimmed, `Path "${trimmed}" must start with "/" or "~"`);
  }
  if (!isValidPath(trimmed)) {
    throw paError("invalid-path-segments", trimmed, `Path "${trimmed}" contains invalid segments`);
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
    // "/" at land root with a being renders as "/" + "@xxx".
    // The grammar shows the canonical form as `<land>/@<being>`,
    // i.e. the slash separates land from path. "/" + "@tabor" already
    // does that.
    out += stance.path;
  }
  if (stance.being) {
    if (opts.omitDefaultBeing && opts.defaultBeing && stance.being === opts.defaultBeing) {
      // skip
    } else {
      out += `@${stance.being}`;
    }
  }
  return out;
}

function expandStance(stance, ctx) {
  if (!stance) return stance;
  return {
    ...stance,
    land:  stance.land  || ctx.currentLand  || null,
    path:  stance.path  || ctx.currentPath  || null,
    being: stance.being || ctx.defaultBeing || null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Validation primitives
// ─────────────────────────────────────────────────────────────────────

// Lenient: DNS-like, also allows bare identifiers for local lands
// ("localhost", "tabor-laptop") and explicit port.
const LAND_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;

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

const BEING_RE = /^[a-z][a-z0-9-]*$/;

export function isValidBeing(being) {
  return typeof being === "string" && BEING_RE.test(being);
}

// ─────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────

function paError(code, input, message, extra = {}) {
  const err = new Error(`IbpAddress: ${message}`);
  err.code = code;
  err.paInput = input;
  Object.assign(err, extra);
  return err;
}

// ─────────────────────────────────────────────────────────────────────
// Convenience: derive HTTP route shape from a Stance
// ─────────────────────────────────────────────────────────────────────

/**
 * Map a Stance (typically the right side of an IBPA) to the HTTP route
 * the land server uses. See docs/server-protocol.md for the contract.
 *
 * Returns: { url, method: "GET", being }
 */
export function toHttpRoute(stance) {
  if (!stance || !stance.path) {
    throw paError("missing-path-for-route", stance, "Cannot derive route without a path");
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
    zone = "tree";
    const segs = path.slice(1).split("/").filter(Boolean);
    encodedTail = segs.map(encodeURIComponent).join("/");
  }
  const base = `/api/v1/position/${zone}${encodedTail ? `/${encodedTail}` : "/"}`;
  const url = stance.being
    ? `${base}?being=${encodeURIComponent(stance.being)}`
    : base;
  return { url, method: "GET", being: stance.being || null };
}

// ─────────────────────────────────────────────────────────────────────
// Server-side context helpers
//
// The pure parser above is environment-agnostic. The two helpers below
// are server-only: they pull this land's bare domain from process.env
// and inject it as `currentLand`. Wire handlers use these so they don't
// have to assemble the parse context themselves.
//
// Browser-side consumers (Portal, 3D) import the parser directly via
// `parse(input, ctx)` and supply their own `currentLand` from the
// client's address bar or socket bootstrap.
// ─────────────────────────────────────────────────────────────────────

// `IbpError` lives in seed/ibp/errors.js so the parser doesn't need to
// know about wire-error wrapping. The server helpers import it locally;
// the pure parser throws plain Error objects with .code + .paInput.
import { IbpError, IBP_ERR } from "../ibp/errors.js";

// Cache the land's bare domain. Derived from process.env.LAND_DOMAIN
// with a localhost fallback. Stripped of protocol/port because an IBP
// Address Land is just the domain.
let cachedLandDomain = null;
export function getLandDomain() {
  if (cachedLandDomain) return cachedLandDomain;
  const raw = process.env.LAND_DOMAIN || "localhost";
  cachedLandDomain = raw
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .replace(/:\d+$/, "");
  return cachedLandDomain;
}

// Parse an IBP Address string using a socket's identity context.
// Throws IbpError on parse failure so wire handlers can ack-fail.
//
//   socket.name → currentUser (for ~ shorthand)
//   getLandDomain() → currentLand
export function parseFromSocket(socket, input, extraCtx = {}) {
  const ctx = {
    currentLand: getLandDomain(),
    currentUser: socket?.name || null,
    ...extraCtx,
  };
  try {
    return parse(input, ctx);
  } catch (e) {
    throw new IbpError(
      IBP_ERR.ADDRESS_PARSE_ERROR,
      e.message || "Invalid IBP Address",
      { code: e.code, paInput: e.paInput },
    );
  }
}

// Parse without a socket — HTTP bootstrap path, internal kernel callers,
// tests. Same shape; caller supplies any extra context.
export function parseWithContext(input, ctx = {}) {
  const fullCtx = { currentLand: getLandDomain(), ...ctx };
  try {
    return parse(input, fullCtx);
  } catch (e) {
    throw new IbpError(
      IBP_ERR.ADDRESS_PARSE_ERROR,
      e.message || "Invalid IBP Address",
      { code: e.code, paInput: e.paInput },
    );
  }
}

/**
 * @typedef {object} Stance
 * @property {string|null} land   — e.g. "treeos.ai" (or null when implicit)
 * @property {string|null} path   — e.g. "/~tabor/flappybird" (or null)
 * @property {string|null} being  — e.g. "ruler" (or null)
 *
 * A Stance carries both a Position (land + path) and a Being.
 * When `being` is null, the Stance reduces to a bare Position.
 */
