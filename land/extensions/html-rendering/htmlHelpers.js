/**
 * Shared HTML route helpers.
 * Extensions import these to build their own ?html intercept routes.
 */

import { isHtmlEnabled } from "./config.js";

/**
 * Middleware: only proceed if ?html is in the query and HTML rendering is enabled.
 * Otherwise skip to the next route (kernel JSON handler).
 */
export function htmlOnly(req, res, next) {
  if (!("html" in req.query) || !isHtmlEnabled()) {
    return next("route");
  }
  next();
}

/**
 * Build a query string from allowed keys.
 */
export function buildQS(req, allowed = ["token", "html"]) {
  const filtered = Object.entries(req.query)
    .filter(([k]) => allowed.includes(k))
    .map(([k, v]) => (v === "" ? k : `${k}=${encodeURIComponent(v)}`))
    .join("&");
  return filtered ? `?${filtered}` : "";
}

/**
 * Build a token + html query string for redirects.
 */
export function tokenQS(req) {
  const token = req.query.token ?? "";
  return token ? `?token=${encodeURIComponent(token)}&html` : "?html";
}

/**
 * Build an auth-preserving link to another HTML route. Takes the current
 * `req` (for token / html / other allowed params) and merges in `extra`
 * so the caller can override or add params without worrying about
 * double-& bugs or dropping auth. Pass `extra[key] = null` to explicitly
 * remove a param from the merged URL (used when navigating away from a
 * chat focus back to a session view).
 *
 *   buildLink(req, `/api/v1/node/${id}/chats`);
 *   buildLink(req, `/api/v1/node/${id}/chats/chat/${chatId}`);
 *   buildLink(req, `/api/v1/flow/signal/${signalId}`);
 */
export function buildLink(req, path, extra = {}) {
  const allowed = ["token", "html"];
  const merged = { ...req.query, ...extra };
  // Always set html so HTML routing kicks in on the destination.
  if (merged.html == null || merged.html === false) merged.html = "";
  const parts = [];
  for (const [k, v] of Object.entries(merged)) {
    if (!allowed.includes(k)) continue;
    if (v == null || v === false) continue;
    parts.push(v === "" || v === true ? k : `${k}=${encodeURIComponent(v)}`);
  }
  return parts.length ? `${path}?${parts.join("&")}` : path;
}
