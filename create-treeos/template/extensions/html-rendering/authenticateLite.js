import log from "../../seed/log.js";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import { resolveHtmlShareAccess } from "./shareAuth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required. Run the setup wizard or add it to .env");
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Lightweight auth for HTML page API calls. Never rejects (always calls next).
 * Sets req.userId if a valid JWT cookie, Bearer token, or share token is present.
 * Share token support lets embedded fetch() calls work when the page was loaded
 * via a share URL (no cookie, no JWT).
 */
export default async function authenticateLite(req, res, next) {
  try {
    // 1. JWT from cookie or Bearer header
    const token =
      req.cookies?.token ||
      req.headers.authorization?.replace("Bearer ", "");

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.userId = decoded.userId || decoded.id || decoded._id;
        req.username = decoded.username;
        req.authType = "jwt";
        return next();
      } catch {
        // Invalid JWT, fall through to share token
      }
    }

    // 2. Share token from query string (?token=...)
    const shareToken = req.query?.token;
    if (shareToken) {
      const userId = req.params?.userId || req.query?.userId || null;
      const nodeId = req.params?.nodeId || req.params?.rootId || req.query?.nodeId || null;

      if (userId || nodeId) {
        const result = await resolveHtmlShareAccess({ userId, nodeId, shareToken });
        if (result.allowed) {
          req.userId = result.matchedUserId;
          req.username = result.matchedUsername;
          req.authType = "share-token";
          req.isHtmlShare = true;
          return next();
        }
      }
    }

    // No auth matched. Continue without userId.
    next();
  } catch (err) {
    log.debug("AuthLite", `Auth failed: ${err.message}`);
    next();
  }
}
