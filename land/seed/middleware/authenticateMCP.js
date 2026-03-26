// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import log from "../log.js";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import { sendError, ERR } from "../protocol.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


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

    req.userId =
      decoded.userId || decoded.id || decoded._id;

    req.username = decoded.username;
    req.visitorId = decoded.visitorId || null;

    next();
  } catch (err) {
    log.error("MCP", "invalid token:", err.message);
    return sendError(res, 401, ERR.UNAUTHORIZED, "Invalid token");
  }
}
