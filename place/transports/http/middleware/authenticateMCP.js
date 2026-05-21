// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// MCP authentication middleware.
//
// MCP tool calls arrive with an `x-internal-token` header carrying a
// JWT signed by this place (generated when the conversation runtime
// spawns a tool round). Verification is decode-only — the token's
// existence/revocation gates already ran when the originating session
// was authenticated; re-checking the being on every tool call would
// be redundant and slow.

import log from "../../../seed/system/log.js";
import { decodeToken } from "../../../seed/place/being/identity.js";
import { sendError, IBP_ERR } from "../../../seed/ibp/protocol.js";

export default function authenticateMCP(req, res, next) {
  const token = req.headers["x-internal-token"];
  if (!token) return sendError(res, 401, IBP_ERR.UNAUTHORIZED, "Missing token");

  const decoded = decodeToken(token);
  if (!decoded) {
    log.error("MCP", "invalid token");
    return sendError(res, 401, IBP_ERR.UNAUTHORIZED, "Invalid token");
  }

  req.beingId         = decoded.beingId;
  req.name            = decoded.name;
  // Reserved. MCP token signers may stamp a clientSessionId so tool
  // calls correlate back to the reach that initiated them; current
  // signers don't, but the field is kept so callers can add it.
  req.clientSessionId = null;
  return next();
}
