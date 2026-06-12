// TreeOS Portal . core/config.js
//
// "Where is the reality, and how do I reach it?" — one answer, read by
// every other module. The web build of the portal infers this from
// window.location; the dev build wires through Vite's proxy; a future
// standalone shell (Tauri, Electron, native) will inject explicit
// values. This module is the single seam — change how lookup works
// here and the rest of the portal keeps working.
//
// Returned shape:
//   {
//     placeUrl:  string   absolute origin of the reality server
//     useProxy:  boolean  true when the runtime should let the dev
//                         proxy (vite) front the WS/HTTP target
//                         instead of dialing it directly
//   }
//
// Lookup precedence (first hit wins):
//   1. explicit override     resolvePlaceConfig({ placeUrl, useProxy })
//   2. session-stored value  sessionStorage["portal:placeUrl"]
//   3. query string          ?place=<url>
//   4. window.location       same-origin web bundle (default for the
//                            production deploy where the portal is
//                            served by the reality itself)
//   5. fallback              http://localhost:3000  (dev safety net)
//
// useProxy defaults to true for any localhost / 127.0.0.1 URL because
// vite dev runs the portal on :5176 and proxies /socket.io, /api,
// /.well-known to the place on :3000 — the dial-direct path would CORS
// itself. Production same-origin doesn't need the proxy.

const FALLBACK_PLACE_URL = "http://localhost:3000";
const STORAGE_KEY = "portal:placeUrl";

function isLocalUrl(url) {
  if (!url) return false;
  return url.includes("localhost") || url.includes("127.0.0.1");
}

function readFromQueryString() {
  if (typeof window === "undefined" || !window.location) return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const place = params.get("place");
    return place && place.length > 0 ? place : null;
  } catch {
    return null;
  }
}

function readFromSessionStorage() {
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

function readFromLocation() {
  if (typeof window === "undefined" || !window.location) return null;
  const { protocol, host } = window.location;
  if (!protocol || !host) return null;
  // Skip file:// — that's a standalone shell loading the bundle off
  // disk; lookup falls through to the explicit override / fallback.
  if (protocol === "file:") return null;
  return `${protocol}//${host}`;
}

/**
 * Resolve the portal's place configuration once. Cheap (no I/O); call
 * at boot, pass the result to every consumer that used to call
 * `defaultPlaceUrl()` / `shouldUseProxy()`.
 *
 * @param {object} [overrides]
 * @param {string} [overrides.placeUrl]
 * @param {boolean} [overrides.useProxy]
 * @returns {{placeUrl: string, useProxy: boolean}}
 */
export function resolvePlaceConfig(overrides = {}) {
  const placeUrl =
    overrides.placeUrl ||
    readFromSessionStorage() ||
    readFromQueryString() ||
    readFromLocation() ||
    FALLBACK_PLACE_URL;
  const useProxy = typeof overrides.useProxy === "boolean"
    ? overrides.useProxy
    : isLocalUrl(placeUrl);
  return { placeUrl, useProxy };
}

/**
 * Back-compat shim so existing call sites that used
 * `defaultPlaceUrl()` keep working while they migrate. Reads the
 * resolved config; the override form is the forward path.
 */
export function defaultPlaceUrl() {
  return resolvePlaceConfig().placeUrl;
}

/**
 * Back-compat shim for `shouldUseProxy(url)`. Same predicate the
 * resolver uses; exposed so existing callers don't have to thread a
 * resolved config through immediately.
 */
export function shouldUseProxy(placeUrl) {
  return isLocalUrl(placeUrl);
}

/**
 * Persist a place URL across reloads in the same tab. Useful when a
 * user signs in to a non-default reality and we want the next reload
 * to land them at the same server. Idempotent; tolerates absent
 * sessionStorage (file://, sandboxed contexts).
 */
export function rememberPlaceUrl(placeUrl) {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    if (placeUrl) window.sessionStorage.setItem(STORAGE_KEY, placeUrl);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode / sandboxed; silent */
  }
}
