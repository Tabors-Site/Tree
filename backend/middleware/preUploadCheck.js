import User from "../db/models/user.js";
import { calculateFileEnergy, maybeResetEnergy } from "../core/energy.js";

// per-tier file size limits (matches energy.js rules)
const MAX_FILE_MB = {
  basic: 0, // no file uploads
  standard: 1024, // 1 GB
  premium: 4096, // 4 GB
  god: Infinity,
};

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

      // basic plan: no file uploads
      if (tier === "basic") {
        return res.status(403).json({
          success: false,
          error: "File uploads are not available on the Basic plan",
        });
      }

      // per-tier size limit
      const sizeMB = Math.ceil(contentLength / (1024 * 1024));
      const limitMB = MAX_FILE_MB[tier] ?? MAX_FILE_MB.standard;

      if (sizeMB > limitMB) {
        const limitLabel =
          limitMB >= 1024 ? `${limitMB / 1024} GB` : `${limitMB} MB`;
        return res.status(413).json({
          success: false,
          error: `File exceeds ${limitLabel} limit for ${tier} plan`,
        });
      }

      // energy check
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

      next();
    } catch (err) {
      return res
        .status(500)
        .json({ success: false, error: "Pre-upload check failed" });
    }
  })();
}
