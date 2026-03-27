// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Document Size Guard
 *
 * Protects every MongoDB document from hitting the 16MB BSON limit.
 * Every metadata write path in the kernel calls checkWriteSize before
 * writing. No exceptions. No direct $set or $push on metadata without
 * size checking first.
 *
 * Default ceiling: 14MB (2MB headroom under MongoDB's 16MB limit).
 * Configurable via maxDocumentSizeBytes in .config.
 *
 * Fires onDocumentPressure hook at 80% capacity so extensions can
 * react (compress, archive, alert) before writes start failing.
 */

import { getLandConfigValue } from "../landConfig.js";
import { hooks } from "../hooks.js";
import log from "../log.js";

const DEFAULT_MAX_BYTES = 14 * 1024 * 1024; // 14MB
const PRESSURE_THRESHOLD = 0.8; // 80%

/**
 * Get the configured max document size in bytes.
 */
function getMaxBytes() {
  const configured = getLandConfigValue("maxDocumentSizeBytes");
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
// and 64-bit floats. For Map-heavy documents like nodes with extension metadata,
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
 * @param {string} [opts.documentType] - "node", "user", or "system"
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
    const documentType = opts.documentType || "node";
    const documentId = opts.documentId || (doc._id ? String(doc._id) : "unknown");
    hooks.run("onDocumentPressure", {
      documentType,
      documentId,
      currentSize,
      projectedSize,
      maxSize,
      percent: Math.round((projectedSize / maxSize) * 100),
    }).catch(err => log.debug("DocumentGuard", `onDocumentPressure hook error: ${err.message}`));

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
 * Estimate the byte size of a value that will be written to metadata.
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
 * Guard a metadata write. Checks size, rejects if over limit.
 * Returns { ok: true } or throws with DOCUMENT_SIZE_EXCEEDED info.
 *
 * @param {object} doc - the document being written to
 * @param {*} data - the data being written
 * @param {object} [opts] - { documentType, documentId }
 */
export function guardMetadataWrite(doc, data, opts = {}) {
  const writeBytes = estimateWriteSize(data);
  const check = checkWriteSize(doc, writeBytes, opts);
  if (!check.ok) {
    const err = new Error(
      `Document size would exceed limit: ${Math.round(check.projectedSize / 1024)}KB projected, ${Math.round(check.maxSize / 1024)}KB max`
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
