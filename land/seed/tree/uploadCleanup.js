// seed/tree/uploadCleanup.js
// Periodic cleanup of orphaned upload files.
// Scans the uploads directory for files not referenced by any Note or RawIdea.
// Runs on a configurable interval (default: every 6 hours).
// Only deletes files older than a grace period (default: 1 hour) to avoid
// racing with in-progress uploads.

import fs from "fs";
import path from "path";
import log from "../log.js";
import Note from "../models/note.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsFolder = path.join(__dirname, "../../uploads");

let cleanupTimer = null;

// Default: 1 hour grace period, 6 hour interval
const DEFAULT_GRACE_MS = 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Scan uploads directory and remove files not referenced by any Note.
 * Only removes files older than graceMs to avoid deleting in-progress uploads.
 *
 * @param {object} [opts]
 * @param {number} [opts.graceMs] - minimum file age before deletion (default: 1 hour)
 * @returns {{ scanned: number, deleted: number, freedKB: number }}
 */
export async function cleanOrphanedUploads({ graceMs = DEFAULT_GRACE_MS } = {}) {
  if (!fs.existsSync(uploadsFolder)) return { scanned: 0, deleted: 0, freedKB: 0 };

  const files = fs.readdirSync(uploadsFolder);
  if (files.length === 0) return { scanned: 0, deleted: 0, freedKB: 0 };

  // Get all filenames referenced by notes
  const referencedFiles = new Set();

  const notes = await Note.find({ contentType: "file" }).select("content").lean();
  for (const note of notes) {
    if (note.content) referencedFiles.add(note.content);
  }

  // Also check RawIdea if the model exists (extension may not be loaded)
  try {
    const mongoose = (await import("mongoose")).default;
    const RawIdea = mongoose.models.RawIdea;
    if (RawIdea) {
      const rawIdeas = await RawIdea.find({ contentType: "file" }).select("content").lean();
      for (const ri of rawIdeas) {
        if (ri.content) referencedFiles.add(ri.content);
      }
    }
  } catch {}

  const now = Date.now();
  let deleted = 0;
  let freedKB = 0;

  for (const filename of files) {
    if (referencedFiles.has(filename)) continue;

    const filePath = path.join(uploadsFolder, filename);
    try {
      const stats = fs.statSync(filePath);
      const ageMs = now - stats.mtimeMs;

      // Skip files younger than grace period (might be in-progress uploads)
      if (ageMs < graceMs) continue;

      const sizeKB = Math.ceil(stats.size / 1024);
      fs.unlinkSync(filePath);
      deleted++;
      freedKB += sizeKB;
    } catch (err) {
      log.warn("Uploads", `Failed to clean orphan "${filename}": ${err.message}`);
    }
  }

  if (deleted > 0) {
    log.info("Uploads", `Cleaned ${deleted} orphaned file(s), freed ${freedKB} KB`);
  }

  return { scanned: files.length, deleted, freedKB };
}

/**
 * Start the periodic cleanup job.
 *
 * @param {object} [opts]
 * @param {number} [opts.intervalMs] - how often to run (default: 6 hours)
 * @param {number} [opts.graceMs] - minimum file age before deletion (default: 1 hour)
 */
export function startUploadCleanup({ intervalMs = DEFAULT_INTERVAL_MS, graceMs = DEFAULT_GRACE_MS } = {}) {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = setInterval(() => {
    cleanOrphanedUploads({ graceMs }).catch((err) =>
      log.error("Uploads", "Cleanup job error:", err.message),
    );
  }, intervalMs);
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
