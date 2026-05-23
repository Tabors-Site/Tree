// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// IBP Address. How a SEE, DO, SUMMON, or BE names what it acts on.
//
// IBP is my communication primitive. Before any of the four verbs
// can act, the speaker has to name the position and the being
// involved — that naming is what this file produces. I replace URLs
// with a three-tier addressing hierarchy that captures more than a
// URL can: not just "where" but "where, and as what being,
// addressing what other being or thing."
//
//   Position    = place/path           (where)
//   Stance      = place/path@being     (where + as what being — one side of a bridge)
//   IBP Address = stance :: stance    (full bridged form — one being addressing another)
//
// Each level answers a different question. "What's the position?" →
// just the place/path. "What's the stance?" → place/path@being (one
// side). "What's the IBP address?" → the full bridged form. The
// shape is uniform across cross-being, face-to-face, same-being
// thinking, and self — one grammar covers every conversation I can
// witness.
//
// Full grammar (see docs/ibp-address.md):
//
//   IbpAddress := Bridge | Stance
//   Bridge     := Stance "::" Stance
//   Stance     := Position "@" Being | Position | Being
//   Position   := Place? Path?
//   Place       := Domain (":" Port)?
//   Path       := "/"                            (place space)
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
// human user is represented as `<place>/@<username>` — i.e. a being at
// the place root space. A bare identifier on the left side (e.g. `tabor`) is
// the display shorthand for that. In future, the left side of a bridge
// may carry a deeper path so the request reflects WHERE in the user's
// place they're sending from (more location context for federated
// requests).
//
// The parser accepts shorthands and expands them against an optional
// context (currentPlace / currentPath / currentUser / defaultBeing).
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
 * @param {string} [ctx.currentPlace]   — e.g. "treeos.ai"
 * @param {string} [ctx.currentPath]   — e.g. "/~tabor/flappybird"
 * @param {string} [ctx.currentUser]   — e.g. "tabor"
 * @param {string} [ctx.defaultBeing]  — being to assume when omitted
 * @returns {{ left: Stance|null, right: Stance }}
 */
export function parse(input, ctx = {}) {
  if (typeof input !== "string") {
    throw paError("input-not-string", input, "IBP address must be a string");
  }
  const trimmed = input.trim();
  if (!trimmed) {
    throw paError("empty-input", input, "IBP address cannot be empty");
  }
  // Bridge?
  const bridgeIdx = trimmed.indexOf("::");
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
    if (rightStr.includes("::")) {
      throw paError(
        "multiple-bridges",
        input,
        "Only one '::' separator allowed",
      );
    }
  }
  const right = parseStance(rightStr, ctx);
  const left = leftStr ? parseStance(leftStr, ctx, { isLeftSide: true }) : null;
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
 * with fully-resolved place / path / being fields on each stance.
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
    if (stance.place != null && !isValidPlace(stance.place)) {
      errors.push({
        side: label,
        field: "place",
        value: stance.place,
        reason: "invalid-place",
      });
    }
    if (stance.path != null && !isValidPath(stance.path)) {
      errors.push({
        side: label,
        field: "path",
        value: stance.path,
        reason: "invalid-path",
      });
    }
    if (stance.being != null && !isValidBeing(stance.being)) {
      errors.push({
        side: label,
        field: "being",
        value: stance.being,
        reason: "invalid-being",
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
  // Bare being? "@ruler"
  if (s.startsWith("@")) {
    // On the left side of a bridge, `@tabor` is the explicit-@ form of
    // the human-user shorthand: it means the user `tabor` at the place root.
    if (isLeftSide) {
      return { place: ctx.currentPlace || null, path: "/", being: parseBeing(s) };
    }
    return {
      place: ctx.currentPlace || null,
      path: ctx.currentPath || null,
      being: parseBeing(s),
    };
  }
  // Split being off the tail.
  let being = null;
  let rest = s;
  const atIdx = findStandaloneAt(s);
  if (atIdx >= 0) {
    being = parseBeing(s.slice(atIdx));
    rest = s.slice(0, atIdx);
  }
  // After stripping being, `rest` is a position (place+path).
  if (!rest) {
    return {
      place: ctx.currentPlace || null,
      path: ctx.currentPath || null,
      being,
    };
  }
  // Determine if `rest` includes a place identifier or is just a zone marker.
  // The three zone markers are:
  //   "/"            → place zone (literal slash IS the place)
  //   "/<id>..."     → tree zone (slash followed by space id or full path)
  //   "~" / "~user"  → home zone (shorthand; expands to "/~<user>")
  // A place identifier (e.g. "treeos.ai") never starts with "/" or "~", so a
  // leading slash or tilde means we're already inside the current place.
  if (rest.startsWith("/") || rest.startsWith("~")) {
    return { place: ctx.currentPlace || null, path: parsePath(rest, ctx), being };
  }
  // Otherwise `rest` starts with a place identifier.
  // Find first "/" — that's the place/path boundary.
  const slashIdx = rest.indexOf("/");
  const tildeIdx = rest.indexOf("~");
  let boundary = -1;
  if (slashIdx >= 0 && tildeIdx >= 0) boundary = Math.min(slashIdx, tildeIdx);
  else if (slashIdx >= 0) boundary = slashIdx;
  else if (tildeIdx >= 0) boundary = tildeIdx;
  if (boundary < 0) {
    // No path separator. On the left side of a bridge with no '@', this
    // is the human-user shorthand: `tabor` → place root, embodied as
    // `tabor`. On either side without a path, this can also be a
    // place-only reference (rare).
    if (isLeftSide && !being) {
      return { place: ctx.currentPlace || null, path: "/", being: rest };
    }
    return { place: parsePlace(rest), path: null, being };
  }
  const placePart = rest.slice(0, boundary);
  const pathPart = rest.slice(boundary);
  return { place: parsePlace(placePart), path: parsePath(pathPart, ctx), being };
}

// Find an "@" that's NOT inside a path segment. The grammar puts the
// being AT THE END after place and path, so we find the LAST "@".
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
    throw paError(
      "invalid-being-chars",
      s,
      `Being "${id}" must be lowercase kebab-case starting with a letter`,
    );
  }
  return id;
}

function parsePlace(s) {
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (!isValidPlace(trimmed)) {
    throw paError("invalid-place", trimmed, `Invalid place "${trimmed}"`);
  }
  return trimmed;
}

function parsePath(s, ctx) {
  const trimmed = s.trim();
  if (!trimmed) return null;
  // Home shorthand: "~" or "/~" alone → current user's home.
  if (trimmed === "~" || trimmed === "/~") {
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
  // Place root: "/" stays "/".
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
  if (stance.place) out += stance.place;
  if (stance.path) {
    // "/" at place root with a being renders as "/" + "@xxx".
    // The grammar shows the canonical form as `<place>/@<being>`,
    // i.e. the slash separates place from path. "/" + "@tabor" already
    // does that.
    out += stance.path;
  }
  if (stance.being) {
    if (
      opts.omitDefaultBeing &&
      opts.defaultBeing &&
      stance.being === opts.defaultBeing
    ) {
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
    place: stance.place || ctx.currentPlace || null,
    path: stance.path || ctx.currentPath || null,
    being: stance.being || ctx.defaultBeing || null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Validation primitives
// ─────────────────────────────────────────────────────────────────────

// Lenient: DNS-like, also allows bare identifiers for local places
// ("localhost", "tabor-laptop") and explicit port.
const PLACE_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;

export function isValidPlace(place) {
  return typeof place === "string" && PLACE_RE.test(place);
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
 * the place server uses. See docs/server-protocol.md for the contract.
 *
 * Returns: { url, method: "GET", being }
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
    zone = "place";
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
// are server-only: they pull this place's bare domain from process.env
// and inject it as `currentPlace`. Wire handlers use these so they don't
// have to assemble the parse context themselves.
//
// Browser-side consumers (Portal, 3D) import the parser directly via
// `parse(input, ctx)` and supply their own `currentPlace` from the
// client's address bar or socket bootstrap.
// ─────────────────────────────────────────────────────────────────────

// `IbpError` lives in seed/ibp/protocol.js so the parser doesn't need to
// know about wire-error wrapping. The server helpers import it locally;
// the pure parser throws plain Error objects with .code + .paInput.
import { IbpError, IBP_ERR } from "../ibp/protocol.js";

// Cache the place's bare domain. Derived from process.env.PLACE_DOMAIN
// with a localhost fallback. Stripped of protocol/port because an IBP
// Address Place is just the domain.
let cachedPlaceDomain = null;
export function getPlaceDomain() {
  if (cachedPlaceDomain) return cachedPlaceDomain;
  const raw = process.env.PLACE_DOMAIN || "localhost";
  cachedPlaceDomain = raw
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .replace(/:\d+$/, "");
  return cachedPlaceDomain;
}

// Parse an IBP Address string using a socket's identity context.
// Throws IbpError on parse failure so wire handlers can ack-fail.
//
//   socket.name → currentUser (for ~ shorthand)
//   getPlaceDomain() → currentPlace
export function parseFromSocket(socket, input, extraCtx = {}) {
  const ctx = {
    currentPlace: getPlaceDomain(),
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

// Parse without a socket — HTTP bootstrap path, internal seed callers,
// tests. Same shape; caller supplies any extra context.
export function parseWithContext(input, ctx = {}) {
  const fullCtx = { currentPlace: getPlaceDomain(), ...ctx };
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
 * @property {string|null} place   — e.g. "treeos.ai" (or null when implicit)
 * @property {string|null} path   — e.g. "/~tabor/flappybird" (or null)
 * @property {string|null} being  — e.g. "ruler" (or null)
 *
 * A Stance carries both a Position (place + path) and a Being.
 * When `being` is null, the Stance reduces to a bare Position.
 */


// ─────────────────────────────────────────────────────────────────────────
// CANONICAL STANCE-PAIR ADDRESS (the lane two beings share)
// ─────────────────────────────────────────────────────────────────────────
//
// When two beings exchange moments, every one of those moments belongs
// to the same presence lane. The lane's natural identifier is the IBP
// Address itself in canonical sorted form: `<smaller> :: <larger>`.
// Sorting makes A→B and B→A resolve to the same key — both directions
// group into one lane on the reel.
//
// I store the spaceId-rooted form (`<place>/<spaceId>@<name>`) so a
// saved lane name survives space renames. The address grammar's
// display form (human-readable names) is a separate expression of the
// same grammar — see parse / format above. Act records carry this
// composed string in their `ibpAddress` field; presenceKey lookups
// use it; thread descriptors group by it.

import Being from "../materials/being/being.js";

const STANCE_PAIR_SEPARATOR = " :: ";

/**
 * Compose a stance into its canonical storage string.
 * Accepts:
 *   - string         — pass-through (assumed already formatted)
 *   - { place?, spaceId, name }
 *
 * Output: `<place>/<spaceId>@<name>` (spaceId-rooted path form).
 * Returns null when spaceId or name is missing.
 */
function stanceString(input) {
  if (input == null) return null;
  if (typeof input === "string") return input.length > 0 ? input : null;
  const { place, spaceId, name } = input;
  if (!spaceId || !name) return null;
  const placePart = place || getPlaceDomain();
  return `${placePart}/${spaceId}@${name}`;
}

/**
 * Canonical sorted IBP Address for a stance pair. A→B and B→A produce
 * the same string. Self-addressed (same stance twice) returns the
 * single stance string.
 */
function canonicalStancePair(stanceA, stanceB) {
  const a = stanceString(stanceA);
  const b = stanceString(stanceB);
  if (!a || !b) return null;
  if (a === b) return a;
  return a < b ? `${a}${STANCE_PAIR_SEPARATOR}${b}` : `${b}${STANCE_PAIR_SEPARATOR}${a}`;
}

// Bounded LRU cache for being stance fields. name + homeSpace rarely
// change; renames are explicit (invalidateStanceCache) so stale damage
// is bounded.
const STANCE_CACHE_MAX = 2048;
const stanceCache = new Map();

async function loadBeingStanceFields(beingId) {
  if (!beingId) return null;
  const key = String(beingId);
  if (stanceCache.has(key)) {
    const v = stanceCache.get(key);
    stanceCache.delete(key);
    stanceCache.set(key, v);
    return v;
  }
  let row = null;
  try {
    row = await Being.findById(key).select("name homeSpace").lean();
  } catch {
    row = null;
  }
  if (!row) return null;
  const value = {
    name: row.name,
    homeSpace: row.homeSpace || null,
  };
  if (stanceCache.size >= STANCE_CACHE_MAX) {
    const first = stanceCache.keys().next().value;
    stanceCache.delete(first);
  }
  stanceCache.set(key, value);
  return value;
}

/**
 * Invalidate a being's cached stance fields. Call after rename or
 * home change so the next composition picks up the new values.
 */
export function invalidateStanceCache(beingId) {
  if (!beingId) return;
  stanceCache.delete(String(beingId));
}

async function composeStanceForBeing(beingId, { currentPosition = null, place = null } = {}) {
  if (!beingId) return null;
  const fields = await loadBeingStanceFields(beingId);
  if (!fields) return null;
  const spaceId = currentPosition || fields.homeSpace;
  if (!spaceId || !fields.name) return null;
  return {
    place: place || getPlaceDomain(),
    spaceId: String(spaceId),
    name: fields.name,
  };
}

/**
 * Compose the canonical IBP Address (stance::stance) for a stamp
 * between two beings. Returns null when either side can't be
 * resolved. Called by assign when opening the Act row so each row
 * carries its lane identity for presenceKey lookup, replay, and
 * grouping.
 */
export async function computeIbpStampAddress({
  askerBeingId,
  askerPosition = null,
  addresseeBeingId,
  addresseePosition = null,
  place = null,
}) {
  try {
    const askerStance = await composeStanceForBeing(askerBeingId, {
      currentPosition: askerPosition,
      place,
    });
    const addresseeStance = await composeStanceForBeing(addresseeBeingId, {
      currentPosition: addresseePosition,
      place,
    });
    return canonicalStancePair(askerStance, addresseeStance);
  } catch {
    return null;
  }
}
