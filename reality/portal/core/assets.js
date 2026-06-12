// TreeOS Portal . core/assets.js
//
// Asset resolution seam. Today every asset (extension models, sounds,
// manifests, content-store bytes) is fetched from the reality's HTTP
// origin by a root-relative path ("/assets/...", "/api/v1/content/...").
// A future native shell (Tauri, Phase 3+) resolves the same references
// from a local matter store instead — it injects a resolver here and
// every consumer follows without edits. This module is the only place
// that knows how a portal-relative asset path becomes a fetchable URL.

let _resolver = (path) => path;

/**
 * Map a root-relative asset path to a fetchable URL. Identity in the
 * web bundle (same-origin paths work as-is, and the vite dev proxy
 * fronts /api). Absolute URLs pass through untouched.
 */
export function assetUrl(path) {
  if (typeof path !== "string" || !path) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return _resolver(path);
}

/**
 * Install a custom resolver (native shells, tests). Receives the
 * root-relative path, returns the URL/scheme the host can load.
 */
export function setAssetUrlResolver(fn) {
  _resolver = typeof fn === "function" ? fn : (path) => path;
}
