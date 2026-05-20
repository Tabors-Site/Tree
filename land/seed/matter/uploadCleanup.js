// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
/**
 * Periodic cleanup of orphaned upload files.
 * Scans the uploads directory for files not referenced by any artifact
 * (or extension model) with filesystem origin. Runs on a configurable
 * interval (default: every 6 hours). Only deletes files older than a
 * grace period (default: 1 hour) to avoid racing with in-progress uploads.
 *
 * Safety:
 *   - Grace period prevents deleting in-progress uploads
 *   - TOCTOU guard: re-stat before delete rejects files touched between check and delete
 *   - Async I/O throughout (no event loop blocking)
 *   - Per-cycle deletion cap prevents one run from blocking for minutes
 *   - Artifact query uses lean projection (path only), not full documents
 */

import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import log from "../core/log.js";
import Artifact from "../models/artifact.js";
import { getLandConfigValue } from "../landConfig.js";
import { ARTIFACT_ORIGIN } from "../core/protocol.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsFolder = process.env.UPLOADS_DIR || path.join(__dirname, "../../uploads");

let cleanupTimer = null;

const DEFAULT_GRACE_MS = 60 * 60 * 1000;    // 1 hour
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
function maxDeletionsPerCycle() { return Math.max(10, Math.min(Number(getLandConfigValue("uploadCleanupBatchSize")) || 1000, 50000)); }

/**
 * Scan uploads directory and remove files not referenced by any
 * filesystem-origin artifact. Only removes files older than graceMs to
 * avoid deleting in-progress uploads.
 *
 * @param {object} [opts]
 * @param {number} [opts.graceMs] - minimum file age before deletion (default: 1 hour)
 * @returns {{ scanned: number, deleted: number, freedKB: number, capped: boolean }}
 */
export async function cleanOrphanedUploads({ graceMs = DEFAULT_GRACE_MS } = {}) {
  if (!fsSync.existsSync(uploadsFolder)) return { scanned: 0, deleted: 0, freedKB: 0, capped: false };

  let files;
  try {
    files = await fs.readdir(uploadsFolder);
  } catch (err) {
    log.warn("Uploads", `Cannot read uploads directory: ${err.message}`);
    return { scanned: 0, deleted: 0, freedKB: 0, capped: false };
  }

  if (files.length === 0) return { scanned: 0, deleted: 0, freedKB: 0, capped: false };

  // Get all filenames referenced by filesystem-origin artifacts.
  // content for filesystem origin is shaped { path, size, mimeType };
  // the path field holds the basename in the uploads folder.
  const referencedFiles = new Set();

  const artifactCursor = Artifact.find({ origin: ARTIFACT_ORIGIN.FILESYSTEM }).select("content").lean().cursor();
  for await (const artifact of artifactCursor) {
    const p = artifact?.content?.path;
    if (p) referencedFiles.add(p);
  }

  // Check all registered models for filesystem-origin references. Extensions
  // register models at boot via the loader. We don't import from extensions.
  // We iterate whatever Mongoose has in its global registry. If a model has
  // an origin field, it might reference uploaded files. This is future-proof:
  // any extension that stores filesystem-origin artifacts will be checked
  // without the seed knowing its name.
  try {
    const mongoose = (await import("mongoose")).default;
    for (const [name, model] of Object.entries(mongoose.models)) {
      if (name === "Artifact") continue; // already checked above
      const paths = model.schema?.paths || {};
      if (!paths.origin || !paths.content) continue;
      try {
        const cursor = model.find({ origin: ARTIFACT_ORIGIN.FILESYSTEM }).select("content").lean().cursor();
        for await (const doc of cursor) {
          const p = doc?.content?.path;
          if (p) referencedFiles.add(p);
        }
      } catch {}
    }
  } catch {}

  const now = Date.now();
  let deleted = 0;
  let freedKB = 0;
  let capped = false;

  for (const filename of files) {
    if (deleted >= maxDeletionsPerCycle()) {
      capped = true;
      break;
    }

    if (referencedFiles.has(filename)) continue;

    const filePath = path.join(uploadsFolder, filename);

    // Verify path is within uploads folder (path traversal guard)
    if (!filePath.startsWith(uploadsFolder)) continue;

    try {
      const stats = await fs.stat(filePath);
      const ageMs = now - stats.mtimeMs;

      // Skip files younger than grace period (might be in-progress uploads)
      if (ageMs < graceMs) continue;

      // TOCTOU guard: re-stat immediately before delete. If mtime changed
      // since the first stat, another process touched the file. Skip it.
      const recheck = await fs.stat(filePath);
      if (recheck.mtimeMs !== stats.mtimeMs) continue;

      const sizeKB = Math.ceil(stats.size / 1024);
      await fs.unlink(filePath);
      deleted++;
      freedKB += sizeKB;
    } catch (err) {
      if (err.code === "ENOENT") continue; // already gone, not an error
      log.warn("Uploads", `Failed to clean orphan "${filename}": ${err.message}`);
    }
  }

  if (deleted > 0) {
    log.info("Uploads", `Cleaned ${deleted} orphaned file(s), freed ${freedKB} KB${capped ? " (cap reached, more next cycle)" : ""}`);
  }

  return { scanned: files.length, deleted, freedKB, capped };
}

/**
 * Start the periodic cleanup job.
 */
export function startUploadCleanup({
  intervalMs = Number(getLandConfigValue("uploadCleanupInterval")) || DEFAULT_INTERVAL_MS,
  graceMs    = Number(getLandConfigValue("uploadGracePeriodMs"))   || DEFAULT_GRACE_MS,
} = {}) {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = setInterval(() => {
    cleanOrphanedUploads({ graceMs }).catch(err =>
      log.error("Uploads", `Cleanup job error: ${err.message}`),
    );
  }, intervalMs);
  if (cleanupTimer.unref) cleanupTimer.unref();
  log.info("Uploads", `Orphan cleanup started (every ${Math.round(intervalMs / 60000)}m, grace ${Math.round(graceMs / 60000)}m)`);
}

/**
 * Stop the periodic cleanup job.
 */
export function stopUploadCleanup() {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
