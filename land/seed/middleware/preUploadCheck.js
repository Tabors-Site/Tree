/**
 * Pre-multer guard: validates multipart upload requests.
 * Three kernel checks before the file reaches multer:
 *   1. uploadEnabled - master switch for the entire land
 *   2. maxUploadBytes - hard ceiling, protects server from memory exhaustion
 *   3. allowedMimeTypes - MIME prefix filter, null means allow all
 * Extensions enforce their own limits (tier gates, storage quotas) via hooks.
 */
import { getLandConfigValue } from "../landConfig.js";
import { sendError, ERR } from "../protocol.js";

export default function preUploadCheck(req, res, next) {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) return next();

  // Master switch
  const enabled = getLandConfigValue("uploadEnabled");
  if (enabled === false || enabled === "false") {
    return sendError(res, 403, ERR.FORBIDDEN, "Uploads are disabled on this land");
  }

  // Size ceiling
  const maxBytes = Number(getLandConfigValue("maxUploadBytes")) || 104857600;
  const contentLength = parseInt(req.headers["content-length"], 10);
  if (contentLength && contentLength > maxBytes) {
    return sendError(res, 413, ERR.INVALID_INPUT,
      `Upload exceeds maximum size (${Math.round(maxBytes / 1048576)}MB)`);
  }

  // MIME filter
  const allowed = getLandConfigValue("allowedMimeTypes");
  if (Array.isArray(allowed) && allowed.length > 0) {
    const mime = contentType.split(";")[0].trim();
    const passes = allowed.some(prefix => mime.startsWith(prefix));
    if (!passes) {
      return sendError(res, 415, ERR.INVALID_INPUT,
        `File type not allowed. Accepted: ${allowed.join(", ")}`);
    }
  }

  next();
}
