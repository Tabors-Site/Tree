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
//   FULL ADDRESS: treeos.ai#3/spaceName@being :: treeos.ai#3/spaceName@being
//                  LEFT STANCE                BRIDGE     RIGHT STANCE
// Left side is always a full stance (position+being). Right side can be a partial stance or full, depending on verb.
//   IbpAddress := Bridge | Stance
//   Bridge     := Stance "::" Stance
//   Stance     := Position "@" Being | Position | Being
//   Position   := Place? Branch? Path?
//   Place       := Domain (":" Port)?
//   Branch     := "#" BranchPath          (omitted = "0" = main)
//   BranchPath := number(letter+number)*  (e.g. "1", "1a", "1a1", "22zb")
//   Path       := "/"                            (place space)
//               | "/" Segment ("/" Segment)*     (space — full chain or leaf-only)
//               | "/~" UserSlug ("/" Segment)*   (home zone)
//               | "~" ...                        (home shorthand; expands to /~<user>)
//   Segment    := space-name | space-id (uuid)
//   Being      := "@" Identifier
//
// Branch (`#<path>`) names which divergent world the stance is in. Main
// is `"0"` and is implicit when omitted. Branches diverge from a parent
// at a chosen past moment; the path alternates number/letter segments,
// with letters rolling over `a..z, za..zz, zza..zzz` (so the 27th branch
// under main is `#1za`, the 27th sub-branch under `#22` is `#22zb`).
// A bridge whose two stances sit on different branches is forbidden —
// different branches are different worlds with no shared fold to bridge.
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
// human user is represented as `<reality>/@<username>` — i.e. a being at
// the place root space. A bare identifier on the left side (e.g. `tabor`) is
// the display shorthand for that. In future, the left side of a bridge
// may carry a deeper path so the request reflects WHERE in the user's
// place they're sending from (more location context for federated
// requests).
//
// The parser accepts shorthands and expands them against an optional
// context (currentReality / currentPath / currentUser / defaultBeing).
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
 * @param {string} [ctx.currentReality]   — e.g. "treeos.ai"
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

  // Cross-branch bridge gate. Different branches are different worlds —
  // their fact-chains never converge, so a bridge across them has no
  // shared fold to authorize against. Reject at parse time before any
  // verb-level dispatch tries to resolve the call. Both sides default to
  // "0" when omitted, so absent-vs-absent never trips this.
  if (left && right) {
    const lb = left.branch || "0";
    const rb = right.branch || "0";
    if (lb !== rb) {
      throw paError(
        "cross-branch-bridge",
        input,
        `Cross-branch bridge forbidden: left is on #${lb}, right is on #${rb}. ` +
          `Bridges must keep both stances on the same branch.`,
      );
    }
  }

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
    if (stance.reality != null && !isValidReality(stance.reality)) {
      errors.push({
        side: label,
        field: "place",
        value: stance.reality,
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
    if (stance.branch != null && !isValidBranch(stance.branch)) {
      errors.push({
        side: label,
        field: "branch",
        value: stance.branch,
        reason: "invalid-branch",
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
      return {
        reality: ctx.currentReality || null,
        branch: null,
        path: "/",
        being: parseBeing(s),
      };
    }
    return {
      reality: ctx.currentReality || null,
      branch: null,
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
  // After stripping being, `rest` is a position (place+branch?+path).
  if (!rest) {
    return {
      reality: ctx.currentReality || null,
      branch: null,
      path: ctx.currentPath || null,
      being,
    };
  }

  // Branch qualifier (`#<branchPath>`) sits between reality and path.
  // Pull it off `rest` first so reality/path detection below stays
  // simple. The qualifier is optional; absence means "0" (main) after
  // expand. Allowed shapes: `treeos.ai#1a/path`, `#1a/path`, `#1a`,
  // `treeos.ai#1a`. Forbidden: more than one `#`, or `#` inside a path
  // segment (path comes after `#`, not before).
  let branch = null;
  const hashIdx = rest.indexOf("#");
  if (hashIdx >= 0) {
    if (rest.indexOf("#", hashIdx + 1) >= 0) {
      throw paError("multiple-branches", input,
        `Only one "#" branch qualifier allowed per stance`);
    }
    const before = rest.slice(0, hashIdx);
    const after = rest.slice(hashIdx + 1);
    // Branch ends at the first "/" or "~" (whichever starts the path).
    const sl = after.indexOf("/");
    const ti = after.indexOf("~");
    let pathStart = -1;
    if (sl >= 0 && ti >= 0) pathStart = Math.min(sl, ti);
    else if (sl >= 0) pathStart = sl;
    else if (ti >= 0) pathStart = ti;
    const branchStr = pathStart >= 0 ? after.slice(0, pathStart) : after;
    if (!branchStr) {
      throw paError("empty-branch", input,
        `Branch qualifier "#" cannot be empty`);
    }
    branch = parseBranch(branchStr);
    const pathPortion = pathStart >= 0 ? after.slice(pathStart) : "";
    rest = before + pathPortion;
  }

  // Determine if `rest` includes a place identifier or is just a zone marker.
  // The three zone markers are:
  //   "/"            → place zone (literal slash IS the place)
  //   "/<id>..."     → tree zone (slash followed by space id or full path)
  //   "~" / "~user"  → home zone (shorthand; expands to "/~<user>")
  // A place identifier (e.g. "treeos.ai") never starts with "/" or "~", so a
  // leading slash or tilde means we're already inside the current place.
  if (!rest) {
    // Pure-branch stance: `#1a` or `#1a@being` — no reality, no path.
    return {
      reality: ctx.currentReality || null,
      branch,
      path: ctx.currentPath || null,
      being,
    };
  }
  if (rest.startsWith("/") || rest.startsWith("~")) {
    return {
      reality: ctx.currentReality || null,
      branch,
      path: parsePath(rest, ctx),
      being,
    };
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
      return {
        reality: ctx.currentReality || null,
        branch,
        path: "/",
        being: rest,
      };
    }
    return { reality: parseReality(rest), branch, path: null, being };
  }
  const realityPart = rest.slice(0, boundary);
  const pathPart = rest.slice(boundary);
  return {
    reality: parseReality(realityPart),
    branch,
    path: parsePath(pathPart, ctx),
    being,
  };
}

// Find an "@" that's NOT inside a path segment. The grammar puts the
// being AT THE END after place and path, so we find the LAST "@".
function findStandaloneAt(s) {
  return s.lastIndexOf("@");
}

function parseBeing(s) {
  if (!s.startsWith("@")) {
    throw paError(
      "invalid-being-prefix",
      s,
      "Being qualifier must start with @",
    );
  }
  const id = s.slice(1).trim();
  if (!id) {
    throw paError("empty-being", s, "Being qualifier is empty");
  }
  // The @qualifier accepts two shapes:
  //   1. A bare being name: lowercase kebab-case (e.g. @cherub, @tabor,
  //      @greeter-12345678).
  //   2. A role-shorthand: `<ext>:<role>` form for namespaced roles
  //      (e.g. @hello-world:greeter). The SUMMON resolver looks up
  //      `qualities.beings.<role>.beingId` on the target space when the
  //      bare-name lookup misses — the same shape extension DO ops and
  //      seeds use throughout the system.
  if (!/^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?$/.test(id)) {
    throw paError(
      "invalid-being-chars",
      s,
      `Being qualifier "${id}" must be lowercase kebab-case (e.g. "@cherub", ` +
        `"@tabor") or an extension role shorthand (e.g. "@hello-world:greeter"). ` +
        `Roles may contain a single ":" separating the extension namespace from ` +
        `the role name; bare being names cannot.`,
    );
  }
  return id;
}

function parseBranch(s) {
  const trimmed = s.trim();
  if (!isValidBranch(trimmed)) {
    throw paError(
      "invalid-branch",
      trimmed,
      `Branch path "${trimmed}" must be "0" (main) or a number/letter chain ` +
        `(e.g. "1", "1a", "22zb"). Alternates number/letter; letters wrap a..z, ` +
        `za..zz, zza..zzz.`,
    );
  }
  return trimmed;
}

function parseReality(s) {
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (!isValidReality(trimmed)) {
    throw paError("invalid-place", trimmed, `Invalid place "${trimmed}"`);
  }
  return trimmed;
}

function parsePath(s, ctx) {
  const trimmed = s.trim();
  if (!trimmed) return null;
  // Home shorthand: "~" alone is sugar for "/~". Both stay literal —
  // no name expansion. Resolution decides whose home (@qualifier wins;
  // else the caller's identity). The wire shape stays "/~" for the
  // self-relative case, which is the honest representation.
  if (trimmed === "~") return "/~";
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
  if (stance.reality) out += stance.reality;
  // Branch qualifier renders only when explicitly non-main. Canonical
  // addresses omit `#0` the way URLs omit default ports — the address
  // bar should stay quiet for the common case. Empty-string branches
  // are treated as absent: never render `#` with nothing after it,
  // because re-parsing that would throw "empty-branch".
  if (typeof stance.branch === "string" && stance.branch && stance.branch !== "0") {
    out += `#${stance.branch}`;
  }
  if (stance.path) {
    // "/" at place root with a being renders as "/" + "@xxx".
    // The grammar shows the canonical form as `<reality>/@<being>`,
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
  // Branch inheritance is keyed off whether the stance already named
  // a reality before expand. The doctrine (locked 2026-06-04 with
  // Tabor): when a typed address pins a reality, the user pinned the
  // whole address — absence of `#` MEANS main, not "stay on whatever
  // branch I happen to be on." Only shorthands that omit the reality
  // (relative paths like `/foo`, `~`, `@bare`) fall through to the
  // ambient branch.
  //
  // This is what makes left-stance follow right-stance automatically:
  // the address bar is the source of truth, so the parser respects
  // exactly what the user typed (or what the URL hash says).
  const realityWasTyped = !!stance.reality;
  const reality = stance.reality || ctx.currentReality || null;
  const branch = stance.branch
    ? stance.branch
    : (realityWasTyped ? "0" : (ctx.currentBranch || "0"));
  return {
    ...stance,
    reality,
    branch,
    path: stance.path || ctx.currentPath || null,
    being: stance.being || ctx.defaultBeing || null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Validation primitives
// ─────────────────────────────────────────────────────────────────────

// Lenient: DNS-like, also allows bare identifiers for local places
// ("localhost", "tabor-laptop") and explicit port.
const REALITY_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;

export function isValidReality(place) {
  return typeof place === "string" && REALITY_RE.test(place);
}

// Optional leading "." for system-segments (`.threads`, `.reel`, `.acts`,
// `.discovery`, `.extensions`, `.tools`, `.roles`, `.operations`,
// `.peers`, `.identity`, `.flow`, `.source`). Without this, the parser
// rejected every dot-prefixed segment and only the pre-parse `.discovery`
// short-circuit in see.js was reachable.
//
// `:` is allowed in the body of a segment so namespaced names —
// `<extension>:<action>` for registered ops (`harmony:place-being`),
// `<extension>:<role>` for role templates (`harmony:dancer-llm`) — are
// addressable through their sync'd seed-space children under
// `<reality>/./operations/<op>` / `./roles/<role>` etc. Cannot lead a
// segment (must start with alphanumeric/underscore/tilde, optionally
// dot-prefixed for system segments).
const SEGMENT_RE = /^\.?[a-z0-9_~][a-z0-9_.:-]*$/i;

export function isValidPath(path) {
  if (typeof path !== "string") return false;
  if (path === "/") return true;
  if (!path.startsWith("/")) return false;
  const segments = path.slice(1).split("/").filter(Boolean);
  if (segments.length === 0) return false;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (i === 0 && seg === "~") {
      // "/~" or "/~/<sub>" — the home shorthand. Bare "~" is the
      // only home segment; "~name" is no longer a thing (the
      // @qualifier names the being, not a path segment).
      continue;
    }
    // The heaven space is named ".". A bare-"." segment is the door
    // into the I-Am's room; all Tier-3 seed spaces live one step
    // deeper at "/./config", "/./tools", etc.
    if (seg === ".") continue;
    if (!SEGMENT_RE.test(seg)) {
      return false;
    }
  }
  return true;
}

const BEING_RE = /^[a-z][a-z0-9-]*$/;

export function isValidBeing(being) {
  return typeof being === "string" && BEING_RE.test(being);
}

// Branch paths alternate number / letter segments. Main is "0". Children
// of main are "1", "2", ... — single number segment. Grandchildren add a
// letter segment ("1a", "1b", ..., "1z", "1za", ...). Great-grandchildren
// add another number, and so on. The grammar is intentionally minimal so
// nesting depth reads off the path at a glance. See
// seed/materials/branch/branchPath.js for the canonical parser used by
// createBranch; this validator just enforces the wire-side shape.
const BRANCH_RE = /^(?:0|\d+(?:[a-z]+\d+)*(?:[a-z]+)?)$/;

export function isValidBranch(branch) {
  return typeof branch === "string" && BRANCH_RE.test(branch);
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
// are server-only: they pull this reality's bare domain from process.env
// and inject it as `currentReality`. Wire handlers use these so they don't
// have to assemble the parse context themselves.
//
// Browser-side consumers (Portal, 3D) import the parser directly via
// `parse(input, ctx)` and supply their own `currentReality` from the
// client's address bar or socket bootstrap.
// ─────────────────────────────────────────────────────────────────────

// `IbpError` lives in seed/ibp/protocol.js so the parser doesn't need to
// know about wire-error wrapping. The server helpers import it locally;
// the pure parser throws plain Error objects with .code + .paInput.
import { IbpError, IBP_ERR } from "../ibp/protocol.js";

// Cache the place's bare domain. Derived from process.env.REALITY_DOMAIN
// with a localhost fallback. Stripped of protocol/port because an IBP
// Address Place is just the domain.
let cachedRealityDomain = null;
export function getRealityDomain() {
  if (cachedRealityDomain) return cachedRealityDomain;
  const raw = process.env.REALITY_DOMAIN || "localhost";
  cachedRealityDomain = raw
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .replace(/:\d+$/, "");
  return cachedRealityDomain;
}

// Parse an IBP Address string using a socket's identity context.
// Throws IbpError on parse failure so wire handlers can ack-fail.
//
//   socket.name → currentUser (for ~ shorthand)
//   getRealityDomain() → currentReality
export function parseFromSocket(socket, input, extraCtx = {}) {
  const ctx = {
    currentReality: getRealityDomain(),
    currentUser:    socket?.name || null,
    // The socket's first-person stance. The address parser fills
    // omitted fields from this ctx, so a client typing `/~` while on
    // `#1/some-place` correctly resolves to `treeos.ai#1/~`, not main.
    currentBranch:  socket?.currentBranch || "0",
    currentPath:    socket?.currentPath   || null,
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
  const fullCtx = { currentReality: getRealityDomain(), ...ctx };
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
 * @property {string|null} reality — e.g. "treeos.ai" (or null when implicit)
 * @property {string|null} branch — e.g. "1a" (or null pre-expand; "0" after expand for main)
 * @property {string|null} path    — e.g. "/~tabor/flappybird" (or null)
 * @property {string|null} being   — e.g. "ruler" (or null)
 *
 * A Stance carries both a Position (reality + branch + path) and a Being.
 * When `being` is null, the Stance reduces to a bare Position. When
 * `branch` is null in a freshly-parsed stance, the caller has not asked
 * for a specific branch and expand() will fill in "0" (main).
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
// I store the spaceId-rooted form (`<reality>/<spaceId>@<name>`) so a
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
 * Output: `<reality>/<spaceId>@<name>` (spaceId-rooted path form).
 * Returns null when spaceId or name is missing.
 */
function stanceString(input) {
  if (input == null) return null;
  if (typeof input === "string") return input.length > 0 ? input : null;
  const { reality, spaceId, name } = input;
  if (!spaceId || !name) return null;
  const realityPart = reality || getRealityDomain();
  return `${realityPart}/${spaceId}@${name}`;
}

/**
 * Canonical sorted IBP Address for a stance pair. An IBP address is
 * always `<stance> :: <stance>` per the doctrine; both halves carry
 * even when they refer to the same stance (a self-summon, e.g. cherub
 * processing register on its own reel). A→B and B→A produce the same
 * canonical string via lexicographic sort; A→A produces `A :: A`.
 *
 * Previous behavior collapsed self-pairs to a single stance, which
 * stored half-formed IBP addresses on the Act row (presence keys, the
 * Act.ibpAddress field, threadsProjection lookups). The full pair
 * form keeps the doctrine intact and the field name honest.
 */
function canonicalStancePair(stanceA, stanceB) {
  const a = stanceString(stanceA);
  const b = stanceString(stanceB);
  if (!a || !b) return null;
  return a < b
    ? `${a}${STANCE_PAIR_SEPARATOR}${b}`
    : `${b}${STANCE_PAIR_SEPARATOR}${a}`;
}

// Bounded LRU cache for being stance fields. name + homeSpace rarely
// change; renames are explicit (invalidateStanceCache) so stale damage
// is bounded.
const STANCE_CACHE_MAX = 2048;
const stanceCache = new Map();

async function loadBeingStanceFields(beingId, branch = "0") {
  if (!beingId) return null;
  // Cache key includes branch so a being's per-branch state
  // (name + homeSpace can both differ across branches) doesn't
  // serve stale data when the wire layer fetches on a non-main branch.
  const key = `${branch}:${String(beingId)}`;
  if (stanceCache.has(key)) {
    const v = stanceCache.get(key);
    stanceCache.delete(key);
    stanceCache.set(key, v);
    return v;
  }
  let row = null;
  try {
    const { loadOrFold } = await import("../materials/projections.js");
    const slot = await loadOrFold("being", String(beingId), branch);
    row = slot ? { name: slot.state?.name, homeSpace: slot.state?.homeSpace } : null;
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

async function composeStanceForBeing(
  beingId,
  { currentPosition = null, place = null, branch = "0" } = {},
) {
  if (!beingId) return null;
  const fields = await loadBeingStanceFields(beingId, branch);
  if (!fields) return null;
  const spaceId = currentPosition || fields.homeSpace;
  if (!spaceId || !fields.name) return null;
  return {
    place: place || getRealityDomain(),
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
