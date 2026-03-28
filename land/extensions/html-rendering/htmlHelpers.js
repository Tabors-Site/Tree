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
