// TreeOS — IBP HTTP adapter.
//
// Translates `/ibp/:verb/<encoded-address>` into the same unified IBP
// dispatcher the WebSocket layer uses. Per [[project_ibp_wire_shape]] +
// [[project_protocol_transport_separation]] — the protocol IS the API.
// No `/api/v1` prefix; per-feature route files retire in favor of the
// single auto-translation pattern below.
//
// Wire form (HTTP):
//   POST /ibp/:verb/<encoded-address>
//   GET  /ibp/see/<encoded-address>?...   (convenience; reads only)
//   Headers: Cookie: token=...  OR  Authorization: Bearer <token>  (optional)
//   Body:    { payload: { ... } }   OR  the bare payload object
//
// Response:
//   200  { id, status: "ok", data }                                on success
//   4xx  { id, status: "error", error: { code, message, detail? } } on failure
//
// Identity: JWT from cookie or Authorization header is decoded and
// passed through to the dispatcher as { beingId, username }. BE
// register/claim from unauth clients is intentionally supported.
//
// HTTP routes are DERIVED from IBP. When an extension registers a DO
// operation via core.do.registerOperation("food:log-meal", ...), the
// operation is instantly callable at POST /ibp/do/<addr> body
// `{ payload: { action: "food:log-meal", args: {...} } }` — no
// per-extension route file needed.

import express from "express";
import { dispatchIbp } from "../../../protocols/ibp/protocol.js";
import { verifyIncoming } from "../../../protocols/ibp/canopy/dispatch.js";
import { decodeToken } from "../../../seed/core/identity.js";

const router = express.Router();

/**
 * Optionally extract identity from the request. Returns
 * `{ beingId, name, jwt }` or `null` for missing / invalid tokens.
 * Never throws.
 */
function extractIdentity(req) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : (req.cookies?.token || null);
  if (!token) return null;
  const decoded = decodeToken(token);
  if (!decoded) return null;
  return { beingId: decoded.beingId, name: decoded.name, jwt: token };
}

/**
 * Build the socket-shaped carrier the IBP verb handlers expect. The
 * canonical caller is socket.io, which gives handlers the live socket.
 * HTTP doesn't have a socket; we provide a minimal surface carrying
 * the same fields handlers read (`beingId`, `name`, `handshake`).
 *
 * Methods the WS handlers don't call from inside HTTP context (`emit`,
 * `join`, etc.) are no-ops. SUMMON async-mode handlers DO call emit on
 * the originating socket — but for HTTP we don't deliver async replies
 * over the same connection. Async SUMMON over HTTP returns 202 Accepted
 * with the correlation id; clients poll or open a WS to receive replies.
 */
function makeHttpCarrier(req, identity) {
  return {
    beingId: identity?.beingId || null,
    name:    identity?.name    || null,
    jwt:     identity?.jwt     || null,
    // Set by the verifyIncoming canopy middleware when a verified
    // cross-land request arrives. Empty for local calls. dispatchIbp
    // reads this to skip re-forwarding an already-verified inbound
    // envelope back to its sender. See [[project_canopy_folds_into_ibp]].
    canopyVerifiedSender: req.canopySender || null,
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
 * tail; payload is the request body for POST (either `{ payload: {...} }`
 * or the bare payload object) or query params for GET.
 *
 * Mounted at the root of the express app; URL is `/ibp/<verb>/<address>`
 * with no `/api/v1` prefix.
 */
async function ibpHttpHandler(req, res) {
  const verb = String(req.params.verb || "").toLowerCase();
  // Express captures the wildcard in req.params[0]; URL decoding is
  // automatic for path segments.
  const address = req.params[0] || "";

  // Body shape tolerance: prefer `{payload: {...}}` but accept bare payload.
  // For GET requests, body is empty; payload comes from query params.
  let payload;
  if (req.method === "GET") {
    payload = { ...(req.query || {}) };
    // Normalize "live=true" etc. from query strings.
    if (payload.live === "true")  payload.live = true;
    if (payload.live === "false") payload.live = false;
  } else {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    payload = (body.payload && typeof body.payload === "object")
      ? body.payload
      : body;
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const identity = extractIdentity(req);
  const carrier = makeHttpCarrier(req, identity);

  // Build the unified envelope and dispatch through the shared handler.
  const msg = {
    id:       body.id || req.headers["x-ibp-id"] || null,
    verb,
    address,
    payload,
    identity: identity ? { beingId: identity.beingId, username: identity.name } : null,
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
}

// Capture raw body bytes so the canopy verifier can check the signature
// over what the sender actually signed (not the JSON-roundtripped shape).
const parseJsonCaptureRaw = express.json({
  limit: "1mb",
  verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); },
});

// POST handles every verb. Body carries the payload. Cross-land
// requests carry X-Canopy-Sender + X-Canopy-Signature; verifyIncoming
// authenticates them, then dispatchIbp runs the verb locally.
router.post("/ibp/:verb/*", parseJsonCaptureRaw, verifyIncoming, ibpHttpHandler);

// GET convenience for SEE only — payload from query params. Reads
// should be idempotent and cacheable per HTTP semantics; for the
// other three verbs (DO, SUMMON, BE) clients use POST.
router.get("/ibp/see/*", verifyIncoming, ibpHttpHandler);

export default router;
