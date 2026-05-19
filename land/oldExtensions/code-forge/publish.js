/**
 * Forge publish.
 *
 * Packages a forge project and either dry-runs (local validation + returns
 * what WOULD be sent) or POSTs to a Horizon registry. Files are supplied by
 * the caller (code-workspace walks the tree and produces the list) so this
 * module never imports from disk directly.
 */

import { validateExtensionPackage } from "./validate.js";

/**
 * Produce the exact payload Horizon expects from a manifest + file list.
 */
export function buildPublishPayload({ manifest, files, readme, tags, repoUrl, maintainers, releaseNotes }) {
  return {
    manifest,
    files,
    readme: readme || files.find((f) => f.path === "README.md")?.content || "",
    tags: Array.isArray(tags) ? tags : [],
    repoUrl: repoUrl || null,
    maintainers: Array.isArray(maintainers) ? maintainers : [],
    releaseNotes: releaseNotes || "",
  };
}

/**
 * Dry-run publish: runs the local validator against the supplied files and
 * returns a structured summary without hitting the network.
 */
export function publishDryRun({ manifest, files, readme, tags, horizonUrl }) {
  const payload = buildPublishPayload({ manifest, files, readme, tags });
  const { valid, errors, warnings } = validateExtensionPackage(payload);
  const totalBytes = payload.files.reduce((s, f) => s + (f.content?.length || 0), 0);
  return {
    dryRun: true,
    valid,
    errors,
    warnings,
    name: payload.manifest?.name,
    version: payload.manifest?.version,
    fileCount: payload.files.length,
    totalBytes,
    files: payload.files.map((f) => ({ path: f.path, bytes: f.content?.length || 0 })),
    wouldSendTo: horizonUrl || null,
  };
}

/**
 * Live publish. Not used by default. Requires dryRun=false and caller-
 * provided horizonUrl + authHeader.
 */
export async function publishToHorizon({ manifest, files, horizonUrl, authHeader, ...extra }) {
  if (!horizonUrl) throw new Error("horizonUrl required for live publish");
  const payload = buildPublishPayload({ manifest, files, ...extra });
  const validation = validateExtensionPackage(payload);
  if (!validation.valid) {
    const err = new Error(`Validation failed: ${validation.errors.join("; ")}`);
    err.errors = validation.errors;
    throw err;
  }
  const res = await fetch(`${horizonUrl.replace(/\/$/, "")}/extensions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error || `Horizon publish failed with status ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return { dryRun: false, status: res.status, body };
}
