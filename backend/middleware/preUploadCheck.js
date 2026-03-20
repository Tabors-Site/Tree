import User from "../db/models/user.js";
import { calculateFileEnergy, maybeResetEnergy } from "../core/tree/energy.js";

// per-tier file size limits in bytes
const MAX_FILE_BYTES = {
  basic: 512 * 1024, // 512 KB — enough for text-only multipart, blocks real files
  standard: 1024 * 1024 * 1024, // 1 GB
  premium: 4096 * 1024 * 1024, // 4 GB
  god: Infinity,
};

/**
 * Pre-multer guard: rejects oversized uploads before they hit disk.
 * Basic plan limit is 512 KB — text-only multipart posts pass through
 * but any real file upload gets blocked early.
 */
export default function preUploadCheck(req, res, next) {
  const contentLength = parseInt(req.headers["content-length"], 10);
  if (!contentLength || isNaN(contentLength)) return next();

  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) return next();

  (async () => {
    try {
      const user = await User.findById(req.userId);
      if (!user) {
        return res
          .status(401)
          .json({ success: false, error: "User not found" });
      }

      maybeResetEnergy(user);

      const tier = user.profileType || "basic";
      const limitBytes = MAX_FILE_BYTES[tier] ?? MAX_FILE_BYTES.standard;

      if (contentLength > limitBytes) {
        if (tier === "basic") {
          return res.status(403).json({
            success: false,
            error: "File uploads are not available on the Basic plan",
          });
        }
        const limitMB = Math.round(limitBytes / (1024 * 1024));
        const limitLabel =
          limitMB >= 1024 ? `${limitMB / 1024} GB` : `${limitMB} MB`;
        return res.status(413).json({
          success: false,
          error: `File exceeds ${limitLabel} limit for ${tier} plan`,
        });
      }

      // energy check for actual file uploads (skip for small text-only posts)
      const sizeMB = Math.ceil(contentLength / (1024 * 1024));
      if (sizeMB >= 1) {
        const cost = calculateFileEnergy(sizeMB);
        const totalEnergy =
          (user.availableEnergy?.amount || 0) +
          (user.additionalEnergy?.amount || 0);

        if (totalEnergy < cost) {
          return res.status(400).json({
            success: false,
            error: `Not enough energy. This file costs ⚡${cost}, you have ⚡${totalEnergy}`,
          });
        }
      }

      next();
    } catch (err) {
      return res
        .status(500)
        .json({ success: false, error: "Pre-upload check failed" });
    }
  })();
}
