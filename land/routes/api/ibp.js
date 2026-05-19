// TreeOS — IBP HTTP adapter.
//
// Translates `POST /api/v1/ibp/:verb/<encoded-address>` into the same
// unified IBP dispatcher the WebSocket layer uses. Per
// [[project_protocol_transport_separation]], transports are thin
// carriers; the protocol handler is shared.
//
// Wire form (HTTP):
//   POST /api/v1/ibp/:verb/<encoded-address>
//   Headers: Cookie: token=...  OR  Authorization: Bearer <token>  (optional)
//   Body: { payload: { ... } }   OR  the bare payload object
//
// Response:
//   200  { id, status: "ok", data }                       on success
//   4xx  { id, status: "error", error: { code, message, detail? } } on failure
//
// The address segment uses URL encoding. `treeos.ai%2Fabc-123%40auth`
// decodes to `treeos.ai/abc-123@auth`. Slash-bearing addresses left
// unencoded also work via the wildcard match.
//
// Identity: JWT from cookie or Authorization header is decoded and
// passed through to the dispatcher as { beingId, username }. BE
// register/claim from unauth clients is intentionally supported.

import express from "express";
import jwt from "jsonwebtoken";
import { dispatchIbp } from "../../ibp/protocol.js";

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required");
const JWT_SECRET = process.env.JWT_SECRET;

const router = express.Router();

/**
 * Optionally extract identity from the request. Returns
 * { beingId, username, jwt? } or null. Never throws on bad/missing tokens.
 */
function extractIdentity(req) {
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  } else if (req.cookies?.token) {
    token = req.cookies.token;
  }
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return {
      beingId:  decoded.beingId,
      username: decoded.username,
      jwt:      token,
    };
  } catch {
    return null;
  }
}

/**
 * Build the socket-shaped carrier the IBP verb handlers expect. The
 * canonical caller is socket.io, which gives handlers the live socket.
 * HTTP doesn't have a socket; we provide a minimal surface carrying
 * the same fields handlers read (`beingId`, `username`, `handshake`).
 *
 * Methods the WS handlers don't call from inside HTTP context (`emit`,
 * `join`, etc.) are no-ops. SUMMON async-mode handlers DO call emit on
 * the originating socket — but for HTTP we don't deliver async replies
 * over the same connection. Async SUMMON over HTTP returns 202 Accepted
 * with the correlation id; clients poll or open a WS to receive replies.
 */
function makeHttpCarrier(req, identity) {
  return {
    beingId:  identity?.beingId || null,
    username: identity?.username || null,
    jwt:      identity?.jwt || null,
    handshake: { headers: req.headers, address: req.ip },
    connected: false,
    emit:    () => {},
    join:    () => {},
    leave:   () => {},
    to:      () => ({ emit: () => {} }),
  };
}

/**
 * Translate an ack-callback-shaped response into an HTTP response.
 *
 * The IBP dispatcher calls `ack({ id, status, data | error })` once.
 * We translate status + error code into the HTTP response shape.
 */
function makeHttpAck(res) {
  let sent = false;
  return function ack(payload) {
    if (sent) return;
    sent = true;
    const status = payload?.status;
    if (status === "ok") {
      return res.status(200).json(payload);
    }
    const code = payload?.error?.code || "INTERNAL";
    const httpStatus = errCodeToHttpStatus(code);
    return res.status(httpStatus).json(payload);
  };
}

const ERR_HTTP_MAP = {
  INVALID_INPUT:       400,
  ACTION_NOT_SUPPORTED:400,
  UNAUTHORIZED:        401,
  FORBIDDEN:           403,
  SESSION_EXPIRED:     403,
  NODE_NOT_FOUND:      404,
  USER_NOT_FOUND:      404,
  ROLE_UNAVAILABLE:    404,
  VERB_NOT_SUPPORTED:  405,
  RESOURCE_CONFLICT:   409,
  RATE_LIMITED:        429,
  TIMEOUT:             500,
  LLM_FAILED:          503,
  INTERNAL:            500,
};
function errCodeToHttpStatus(code) {
  return ERR_HTTP_MAP[code] || 500;
}

/**
 * The single IBP HTTP route. Verb is in the URL; address is the wildcard
 * tail; payload is the request body (either `{ payload: {...} }` or the
 * bare payload object).
 */
router.post("/ibp/:verb/*", express.json({ limit: "1mb" }), async (req, res) => {
  const verb = String(req.params.verb || "").toLowerCase();
  // Express captures the wildcard in req.params[0]; URL decoding is
  // automatic for path segments.
  const address = req.params[0] || "";

  // Body shape tolerance: prefer `{payload: {...}}` but accept bare payload.
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const payload = (body.payload && typeof body.payload === "object")
    ? body.payload
    : body;

  const identity = extractIdentity(req);
  const carrier = makeHttpCarrier(req, identity);

  // Build the unified envelope and dispatch through the shared handler.
  const msg = {
    id:       body.id || req.headers["x-ibp-id"] || null,
    verb,
    address,
    payload,
    identity: identity ? { beingId: identity.beingId, username: identity.username } : null,
  };

  try {
    await dispatchIbp(carrier, msg, makeHttpAck(res));
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        id:     msg.id,
        status: "error",
        error:  { code: "INTERNAL", message: err.message || "Internal portal error" },
      });
    }
  }
});

export default router;
