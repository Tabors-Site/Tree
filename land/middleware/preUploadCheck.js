import User from "../db/models/user.js";

// per-tier file size limits in bytes
const MAX_FILE_BYTES = {
  basic: 512 * 1024, // 512 KB
  standard: 1024 * 1024 * 1024, // 1 GB
  premium: 4096 * 1024 * 1024, // 4 GB
  god: Infinity,
};

/**
 * Pre-multer guard: rejects oversized uploads before they hit disk.
 * Energy checking handled by energy extension hooks if installed.
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
        return res.status(401).json({ success: false, error: "User not found" });
      }

      const tier = user.profileType || "basic";
      const limitBytes = MAX_FILE_BYTES[tier] ?? MAX_FILE_BYTES.standard;

      if (contentLength > limitBytes) {
        if (tier === "basic") {
          return res.status(403).json({ success: false, error: "File uploads are not available on the Basic plan" });
        }
        const limitMB = Math.round(limitBytes / (1024 * 1024));
        const limitLabel = limitMB >= 1024 ? `${limitMB / 1024} GB` : `${limitMB} MB`;
        return res.status(413).json({ success: false, error: `File exceeds ${limitLabel} limit for ${tier} plan` });
      }

      next();
    } catch (err) {
      return res.status(500).json({ success: false, error: "Pre-upload check failed" });
    }
  })();
}
