// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Orphaned uploads. The other side of filesystem-origin Matter.
//
// Filesystem-origin Matter bridges a Matter row to a file on disk
// in the land's uploads/ directory. When that Matter row is deleted
// (or never finishes writing), the bytes on disk outlive the row.
// Without a sweeper, the directory grows forever.
//
// This file runs the sweeper. Every interval it lists what's on
// disk, asks the Matter collection (and any extension model with the
// same origin-shape) what files are still referenced, and removes
// the orphans older than the grace period. Younger files are spared
// in case they belong to an upload in flight.
//
// Safety:
//   - Grace period spares in-progress uploads.
//   - TOCTOU guard: re-stat before unlink, abort if mtime changed
//     between the two stats.
//   - Per-cycle deletion cap so one run cannot block for minutes.
//   - Matter query uses lean projection (path only).

import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import log from "../../system/log.js";
import Matter from "../../models/matter.js";
import { getLandConfigValue } from "../../landConfig.js";
import { MATTER_ORIGIN } from "./origins.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// __dirname is seed/land/matter/. Three ups reach the land/ root where
// the uploads/ folder sits beside seed/.
const uploadsFolder = process.env.UPLOADS_DIR || path.join(__dirname, "../../../uploads");

let cleanupTimer = null;

const DEFAULT_GRACE_MS = 60 * 60 * 1000;    // 1 hour
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
function maxDeletionsPerCycle() { return Math.max(10, Math.min(Number(getLandConfigValue("uploadCleanupBatchSize")) || 1000, 50000)); }

/**
 * Scan uploads directory and remove files not referenced by any
 * filesystem-origin Matter. Only removes files older than graceMs to
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

  // Collect every filename a filesystem-origin Matter still names.
  // content for filesystem origin is shaped { path, size, mimeType };
  // the path field holds the basename in the uploads folder.
  const referencedFiles = new Set();

  const matterCursor = Matter.find({ origin: MATTER_ORIGIN.FILESYSTEM }).select("content").lean().cursor();
  for await (const matter of matterCursor) {
    const p = matter?.content?.path;
    if (p) referencedFiles.add(p);
  }

  // Check every registered model for filesystem-origin references.
  // Extensions register models at boot via the loader; I do not import
  // from them. I walk Mongoose's global registry instead. If a model
  // has an origin field, its rows might reference uploaded files.
  // Future-proof: any extension that stores filesystem-origin matter
  // gets checked without me having to know its name.
  try {
    const mongoose = (await import("mongoose")).default;
    for (const [name, model] of Object.entries(mongoose.models)) {
      if (name === "Matter") continue; // already checked above
      const paths = model.schema?.paths || {};
      if (!paths.origin || !paths.content) continue;
      try {
        const cursor = model.find({ origin: MATTER_ORIGIN.FILESYSTEM }).select("content").lean().cursor();
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
