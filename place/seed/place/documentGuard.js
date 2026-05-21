// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The size guard. MongoDB's hard wall, on the substrate's side.
//
// MongoDB caps every BSON document at 16MB. The qualities Map on a
// Space, Being, or Matter grows freely under that ceiling. Without a
// guard, an extension's well-meaning write can be the one that
// crosses it — and from there the whole document is unwritable,
// permanently. I will not let that happen on my place.
//
// Every quality write path the kernel exposes calls checkWriteSize
// (or its strict variant guardQualityWrite) before the write places.
// No exceptions. No direct $set on a qualities namespace without
// checking first.
//
// Default ceiling: 14MB. The 2MB headroom under Mongo's 16MB is
// space for the BSON-vs-JSON overhead and concurrent writes that
// slip in between the check and the write. Configurable via
// maxDocumentSizeBytes in .config.
//
// Pressure signal. At 80% of the ceiling I fire onDocumentPressure
// so extensions can compress, archive, or alert before writes start
// failing. The signal is fire-and-forget; the write still proceeds
// if it fits.
//
// Universal. The qualities Maps on Space, Being, and Matter all
// flow through this guard. Cascade results on .flow partitions flow
// through it too. The file lives directly under place/ rather than
// inside one primitive's subfolder.

import { getPlaceConfigValue } from "../placeConfig.js";
import { hooks } from "../system/hooks.js";
import log from "../system/log.js";

const DEFAULT_MAX_BYTES = 14 * 1024 * 1024; // 14MB
const PRESSURE_THRESHOLD = 0.8; // 80%

/**
 * Get the configured max document size in bytes.
 */
function getMaxBytes() {
  const configured = getPlaceConfigValue("maxDocumentSizeBytes");
  if (configured && typeof configured === "number" && configured > 0) {
    // Floor 1MB, ceiling 16MB (MongoDB hard limit). Below 1MB bricks the system.
    return Math.max(1024 * 1024, Math.min(configured, 16 * 1024 * 1024));
  }
  return DEFAULT_MAX_BYTES;
}

/**
 * Estimate the BSON size of a Mongoose document.
 * Uses JSON serialization as a lower bound (BSON is typically larger
 * due to type headers, but JSON is a safe conservative estimate).
 * For lean() documents, works directly on the plain object.
 */
// BSON overhead factor: BSON encoding adds type headers, key length bytes,
// and 64-bit floats. For Map-heavy documents like spaces with extension qualities,
// BSON can be 20-30% larger than JSON. Factor of 1.3 prevents the 14MB JSON
// estimate from becoming 17MB+ BSON, which would exceed MongoDB's 16MB limit.
const BSON_OVERHEAD_FACTOR = 1.3;

function estimateDocSize(doc) {
  try {
    const obj = doc.toObject ? doc.toObject() : doc;
    const jsonSize = Buffer.byteLength(JSON.stringify(obj), "utf8");
    return Math.ceil(jsonSize * BSON_OVERHEAD_FACTOR);
  } catch {
    // Circular reference or serialization failure. Return high estimate.
    return DEFAULT_MAX_BYTES;
  }
}

/**
 * Check if a write would push a document over the size limit.
 *
 * @param {object} doc - Mongoose document or lean object
 * @param {number} additionalBytes - estimated size of the incoming write
 * @param {object} [opts]
 * @param {string} [opts.documentType] - "being", "space", "matter", or "system"
 * @param {string} [opts.documentId] - the document's _id
 * @returns {{ ok: boolean, currentSize: number, maxSize: number, headroom: number }}
 */
export function checkWriteSize(doc, additionalBytes = 0, opts = {}) {
  const maxSize = getMaxBytes();
  const currentSize = estimateDocSize(doc);
  const projectedSize = currentSize + additionalBytes;
  const headroom = maxSize - projectedSize;

  // Fire pressure hook at 80% (async, fire-and-forget)
  if (projectedSize >= maxSize * PRESSURE_THRESHOLD) {
    const documentType = opts.documentType || "space";
    const documentId =
      opts.documentId || (doc._id ? String(doc._id) : "unknown");
    hooks
      .run("onDocumentPressure", {
        documentType,
        documentId,
        currentSize,
        projectedSize,
        maxSize,
        percent: Math.round((projectedSize / maxSize) * 100),
      })
      .catch((err) =>
        log.debug(
          "DocumentGuard",
          `onDocumentPressure hook error: ${err.message}`,
        ),
      );

    if (projectedSize > maxSize) {
      return {
        ok: false,
        currentSize,
        maxSize,
        headroom: 0,
        projectedSize,
      };
    }
  }

  return {
    ok: true,
    currentSize,
    maxSize,
    headroom,
    projectedSize,
  };
}

/**
 * Estimate the byte size of a value that will be written to qualities.
 * Use this before calling checkWriteSize to get the additionalBytes.
 */
export function estimateWriteSize(data) {
  if (data == null) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(data), "utf8");
  } catch {
    // Circular reference or non-serializable. Return a high estimate so the
    // size check rejects the write rather than allowing a potentially oversized doc.
    return DEFAULT_MAX_BYTES;
  }
}

/**
 * Guard a qualities write. Checks size, rejects if over limit.
 * Returns { ok: true } or throws with DOCUMENT_SIZE_EXCEEDED info.
 *
 * @param {object} doc - the document being written to
 * @param {*} data - the data being written
 * @param {object} [opts] - { documentType, documentId }
 */
export function guardQualityWrite(doc, data, opts = {}) {
  const writeBytes = estimateWriteSize(data);
  const check = checkWriteSize(doc, writeBytes, opts);
  if (!check.ok) {
    const err = new Error(
      `Document size would exceed limit: ${Math.round(check.projectedSize / 1024)}KB projected, ${Math.round(check.maxSize / 1024)}KB max`,
    );
    err.code = "DOCUMENT_SIZE_EXCEEDED";
    err.detail = {
      currentSize: check.currentSize,
      projectedSize: check.projectedSize,
      maxSize: check.maxSize,
    };
    throw err;
  }
  return check;
}
