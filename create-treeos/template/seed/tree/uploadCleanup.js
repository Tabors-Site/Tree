// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Periodic cleanup of orphaned upload files.
 * Scans the uploads directory for files not referenced by any model with file content.
 * Runs on a configurable interval (default: every 6 hours).
 * Only deletes files older than a grace period (default: 1 hour) to avoid
 * racing with in-progress uploads.
 *
 * Safety:
 *   - Grace period prevents deleting in-progress uploads
 *   - TOCTOU guard: re-stat before delete rejects files touched between check and delete
 *   - Async I/O throughout (no event loop blocking)
 *   - Per-cycle deletion cap prevents one run from blocking for minutes
 *   - Note query uses lean projection (filename only), not full documents
 */

import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import log from "../log.js";
import Note from "../models/note.js";
import { getLandConfigValue } from "../landConfig.js";
import { CONTENT_TYPE } from "../protocol.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsFolder = process.env.UPLOADS_DIR || path.join(__dirname, "../../uploads");

let cleanupTimer = null;

const DEFAULT_GRACE_MS = 60 * 60 * 1000;    // 1 hour
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
function maxDeletionsPerCycle() { return Math.max(10, Math.min(Number(getLandConfigValue("uploadCleanupBatchSize")) || 1000, 50000)); }

/**
 * Scan uploads directory and remove files not referenced by any Note.
 * Only removes files older than graceMs to avoid deleting in-progress uploads.
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

  // Get all filenames referenced by notes (lean projection, filenames only)
  const referencedFiles = new Set();

  const noteCursor = Note.find({ contentType: CONTENT_TYPE.FILE }).select("content").lean().cursor();
  for await (const note of noteCursor) {
    if (note.content) referencedFiles.add(note.content);
  }

  // Check all registered models for file references. Extensions register models
  // at boot via the loader. We don't import from extensions. We iterate whatever
  // Mongoose has in its global registry. If a model has a contentType field,
  // it might reference uploaded files. This is future-proof: any extension that
  // stores file references will be checked without the seed knowing its name.
  try {
    const mongoose = (await import("mongoose")).default;
    for (const [name, model] of Object.entries(mongoose.models)) {
      if (name === "Note") continue; // already checked above
      const paths = model.schema?.paths || {};
      if (!paths.contentType || !paths.content) continue;
      try {
        const cursor = model.find({ contentType: CONTENT_TYPE.FILE }).select("content").lean().cursor();
        for await (const doc of cursor) {
          if (doc.content) referencedFiles.add(doc.content);
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
