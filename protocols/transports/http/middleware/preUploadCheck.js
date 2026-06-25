// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Pre-multer guard for multipart uploads. Three checks run before
// the file reaches multer:
//   1. uploadEnabled    — master switch for the place
//   2. maxUploadBytes   — hard ceiling against memory exhaustion
//   3. allowedMimeTypes — MIME prefix filter; null/empty admits all
//
// Extensions add their own limits (tier gates, storage quotas)
// through the matter hooks.
import { getStoryConfigValue } from "../../../../seed/storyConfig.js";
import { sendError, IBP_ERR } from "../../../../seed/ibp/protocol.js";

export default function preUploadCheck(req, res, next) {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) return next();

  // Master switch
  const enabled = getStoryConfigValue("uploadEnabled");
  if (enabled === false || enabled === "false") {
    return sendError(res, 403, IBP_ERR.UPLOAD_DISABLED, "Uploads are disabled on this story");
  }

  // Size ceiling
  const maxBytes = Number(getStoryConfigValue("maxUploadBytes")) || 104857600;
  const contentLength = parseInt(req.headers["content-length"], 10);
  if (contentLength && contentLength > maxBytes) {
    return sendError(res, 413, IBP_ERR.UPLOAD_TOO_LARGE,
      `Upload exceeds maximum size (${Math.round(maxBytes / 1048576)}MB)`);
  }

  // MIME filter
  const allowed = getStoryConfigValue("allowedMimeTypes");
  if (Array.isArray(allowed) && allowed.length > 0) {
    const mime = contentType.split(";")[0].trim();
    const passes = allowed.some(prefix => mime.startsWith(prefix));
    if (!passes) {
      return sendError(res, 415, IBP_ERR.UPLOAD_MIME_REJECTED,
        `File type not allowed. Accepted: ${allowed.join(", ")}`);
    }
  }

  next();
}
