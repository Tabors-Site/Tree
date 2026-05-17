// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import log from "../log.js";
import jwt from "jsonwebtoken";
import { sendError, ERR } from "../protocol.js";

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required. Run the setup wizard or add it to .env");
const JWT_SECRET = process.env.JWT_SECRET;

export default function authenticateMCP(req, res, next) {
  try {
    const token =
      req.headers["x-internal-token"];

    if (!token) {
      return sendError(res, 401, ERR.UNAUTHORIZED, "Missing token");
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    req.beingId =
      decoded.beingId || decoded.id || decoded._id;

    req.username = decoded.username;
    // Legacy JWTs may still carry aiSessionKey from the pre-Slice-6
    // signing convention. Honored if present so an in-flight token
    // from before the upgrade keeps working; not required.
    req.aiSessionKey = decoded.aiSessionKey || null;

    next();
  } catch (err) {
    log.error("MCP", "invalid token:", err.message);
    return sendError(res, 401, ERR.UNAUTHORIZED, "Invalid token");
  }
}
