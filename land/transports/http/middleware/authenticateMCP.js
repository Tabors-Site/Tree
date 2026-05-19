// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import log from "../../../seed/core/log.js";
import jwt from "jsonwebtoken";
import { sendError, ERR } from "../../../seed/core/protocol.js";

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

    req.name = decoded.name;
    // Forward the client session id when JWTs carry one. Honored as
    // a trace label so MCP tool calls correlate back to the reach
    // that initiated them. Optional — current signers don't stamp it,
    // but the field is kept for callers that want correlation.
    req.clientSessionId = decoded.clientSessionId || null;

    next();
  } catch (err) {
    log.error("MCP", "invalid token:", err.message);
    return sendError(res, 401, ERR.UNAUTHORIZED, "Invalid token");
  }
}
