/**
 * Extract the "surface" of a file — the public API / message types /
 * route list that a sibling branch cares about.
 *
 * Used in two places:
 *   - renderContext.js   → smarter per-file headlines in the Sibling
 *                          Branches block. `const http = require(...)`
 *                          becomes `handles: join, flap, gameState`.
 *   - afterBranchComplete → roll up a branch's file surfaces into one
 *                           line on its subPlan entry's summary field.
 *                           Siblings render this at the top of their
 *                           sibling block.
 *
 * Heuristic, not a parser. Regex passes over JS/HTML/JSON. Cheap.
 * Returns { headline, types, routes, exports, jsonMain } — callers
 * format whichever fields they need.
 */

// ---------------------------------------------------------------------------
// per-file extractors
// ---------------------------------------------------------------------------

const CASE_RX = /\bcase\s+["'`]([a-zA-Z_][a-zA-Z0-9_]*)["'`]\s*:/g;
const ROUTE_RX = /\bapp\.(get|post|put|patch|delete|use)\s*\(\s*["'`]([^"'`]+)["'`]/g;
const FETCH_RX = /\bfetch\s*\(\s*["'`]([^"'`]+)["'`]/g;
const EXPORT_FN_RX = /\bexport\s+(?:async\s+)?function\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
const EXPORT_CONST_RX = /\bexport\s+const\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
const EXPORT_DEFAULT_FN_RX = /\bexport\s+default\s+(?:async\s+)?function\s+([a-zA-Z_][a-zA-Z0-9_]*)/g;
const MODULE_EXPORTS_RX = /\bmodule\.exports\s*=\s*\{([^}]+)\}/;
const HTML_TITLE_RX = /<title[^>]*>([^<]{1,80})<\/title>/i;
const HTML_ID_RX = /id\s*=\s*["']([a-zA-Z_][a-zA-Z0-9_-]*)["']/g;

function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

/**
 * Surface of a JavaScript / TypeScript file. Picks up WS handlers,
 * HTTP routes, client-side fetches, and exported names. Returns
 * empty arrays when nothing matches.
 */
function jsSurface(content) {
  const types = uniq([...content.matchAll(CASE_RX)].map((m) => m[1]));
  const routes = uniq(
    [...content.matchAll(ROUTE_RX)]
      .filter((m) => m[1].toLowerCase() !== "use")
      .map((m) => `${m[1].toUpperCase()} ${m[2]}`),
  );
  const fetches = uniq([...content.matchAll(FETCH_RX)].map((m) => m[1]).filter((u) => u.startsWith("/")));
  const exports = uniq([
    ...[...content.matchAll(EXPORT_FN_RX)].map((m) => m[1]),
    ...[...content.matchAll(EXPORT_CONST_RX)].map((m) => m[1]),
    ...[...content.matchAll(EXPORT_DEFAULT_FN_RX)].map((m) => m[1]),
  ]);
  const modExports = [];
  const modMatch = content.match(MODULE_EXPORTS_RX);
  if (modMatch) {
    for (const piece of modMatch[1].split(",")) {
      const name = piece.trim().split(":")[0].trim();
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) modExports.push(name);
    }
  }
  return { types, routes, fetches, exports: uniq([...exports, ...modExports]) };
}

/**
 * Surface of an HTML file. Title + first few meaningful ids (canvas,
 * form, etc.) so a sibling can tell what the UI is.
 */
function htmlSurface(content) {
  const title = (content.match(HTML_TITLE_RX) || [, null])[1] || null;
  const ids = uniq([...content.matchAll(HTML_ID_RX)].map((m) => m[1])).slice(0, 6);
  return { title: title?.trim() || null, ids };
}

/**
 * Surface of a package.json. Name, main, and relevant scripts.
 */
function pkgSurface(content) {
  try {
    const pkg = JSON.parse(content);
    return {
      name: pkg.name || null,
      main: pkg.main || null,
      scripts: pkg.scripts ? Object.keys(pkg.scripts).slice(0, 4) : [],
      deps: pkg.dependencies ? Object.keys(pkg.dependencies) : [],
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/**
 * Produce a one-line headline for a file. Safe to call on any path/content;
 * returns the best signal it can extract, falling back to the first
 * non-trivial line of the file.
 */
export function fileHeadline(filePath, content) {
  if (!content || typeof content !== "string") return null;
  const path = String(filePath || "").toLowerCase();

  if (path.endsWith("package.json")) {
    const pkg = pkgSurface(content);
    if (pkg) {
      const parts = [];
      if (pkg.name) parts.push(`name: ${pkg.name}`);
      if (pkg.main) parts.push(`main: ${pkg.main}`);
      if (pkg.deps.length > 0) parts.push(`deps: ${pkg.deps.slice(0, 4).join(", ")}${pkg.deps.length > 4 ? ", ..." : ""}`);
      if (parts.length > 0) return parts.join("; ");
    }
  }

  if (path.endsWith(".html") || path.endsWith(".htm")) {
    const h = htmlSurface(content);
    const parts = [];
    if (h.title) parts.push(`title: "${h.title}"`);
    if (h.ids.length > 0) parts.push(`ids: ${h.ids.join(", ")}`);
    if (parts.length > 0) return parts.join("; ");
  }

  if (/\.(js|jsx|ts|tsx|mjs|cjs)$/i.test(path)) {
    const s = jsSurface(content);
    const parts = [];
    if (s.types.length > 0) parts.push(`handles: ${s.types.slice(0, 6).join(", ")}${s.types.length > 6 ? "…" : ""}`);
    if (s.routes.length > 0) parts.push(`routes: ${s.routes.slice(0, 4).join(", ")}${s.routes.length > 4 ? "…" : ""}`);
    if (s.fetches.length > 0) parts.push(`fetches: ${s.fetches.slice(0, 4).join(", ")}${s.fetches.length > 4 ? "…" : ""}`);
    if (parts.length === 0 && s.exports.length > 0) {
      parts.push(`exports: ${s.exports.slice(0, 5).join(", ")}${s.exports.length > 5 ? "…" : ""}`);
    }
    if (parts.length > 0) return parts.join("; ");
  }

  return firstMeaningfulLine(content);
}

/**
 * Build a one-line summary describing a whole branch's public surface.
 * Walks the branch's files, merges types/routes/fetches/exports, returns
 * a sentence. Used as the branch's subPlan entry summary so siblings see
 * "backend — WS handles: join, flap, gameState; routes: GET /" in their
 * sibling block.
 */
export function branchSummary(branchName, files) {
  const all = { types: new Set(), routes: new Set(), fetches: new Set(), exports: new Set() };
  let hasHtml = false;
  let htmlTitle = null;
  let pkgName = null;
  for (const f of files || []) {
    const path = String(f.filePath || "").toLowerCase();
    const content = f.content || "";
    if (!content) continue;
    if (path.endsWith("package.json")) {
      const pkg = pkgSurface(content);
      if (pkg?.name) pkgName = pkg.name;
      continue;
    }
    if (path.endsWith(".html") || path.endsWith(".htm")) {
      hasHtml = true;
      const h = htmlSurface(content);
      if (!htmlTitle && h.title) htmlTitle = h.title;
      continue;
    }
    if (/\.(js|jsx|ts|tsx|mjs|cjs)$/i.test(path)) {
      const s = jsSurface(content);
      for (const t of s.types) all.types.add(t);
      for (const r of s.routes) all.routes.add(r);
      for (const u of s.fetches) all.fetches.add(u);
      for (const e of s.exports) all.exports.add(e);
    }
  }

  const parts = [];
  if (all.types.size > 0) parts.push(`WS: ${[...all.types].slice(0, 8).join("/")}${all.types.size > 8 ? "…" : ""}`);
  if (all.routes.size > 0) parts.push(`HTTP: ${[...all.routes].slice(0, 5).join(", ")}${all.routes.size > 5 ? "…" : ""}`);
  if (all.fetches.size > 0) parts.push(`calls: ${[...all.fetches].slice(0, 5).join(", ")}${all.fetches.size > 5 ? "…" : ""}`);
  if (hasHtml) parts.push(`UI: ${htmlTitle ? `"${htmlTitle}"` : "html"}`);
  if (all.exports.size > 0 && parts.length === 0) {
    parts.push(`exports: ${[...all.exports].slice(0, 5).join(", ")}`);
  }
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// fallback: first meaningful line (was the old heuristic's whole job)
// ---------------------------------------------------------------------------

function firstMeaningfulLine(content) {
  if (typeof content !== "string" || !content.trim()) return null;
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("//") || line.startsWith("#") || line.startsWith("/*") || line.startsWith("*")) continue;
    if (line === '"use strict";' || line === "'use strict';") continue;
    if (/^import\b/.test(line)) continue;
    if (/^const\s+\w+\s*=\s*require\b/.test(line)) continue;
    if (/^export\s*\{/.test(line)) continue;
    return line.length > 120 ? line.slice(0, 117) + "…" : line;
  }
  return null;
}
