// IBP HTTP adapter.
//
// The other door into the same dispatcher. WebSocket is the main
// channel I speak on, but the world also reaches me over HTTP — peer
// places posting cross-place envelopes, browsers without an open
// socket, curl from the operator's terminal. Shape of arrival
// differs (method, URL path, body, headers); the act inside is the
// same act and runs through the same execution. This file is the
// seam.
//
// Wire shape:
//
//   POST /ibp/:verb/<encoded-address>     all four verbs
//   GET  /ibp/see/<encoded-address>?...   SEE convenience; reads only
//   Body:    { payload: { ... } }   OR   the bare payload object
//   Headers: Cookie: token=...      OR   Authorization: Bearer <token>
//                                        (both optional)
//
// Response:
//   200  { id, status: "ok", data }
//   4xx  { id, status: "error", error: { code, message, detail? } }
//
// I fabricate one envelope per request — { id, verb, address,
// payload, identity } — and hand it to dispatchIbp in protocols/ibp/.
// The ack comes back through the shared sendAck helper which derives
// HTTP status from the IBP code via httpStatusFor() in
// seed/ibp/protocol.js. One canonical status mapping; nothing local
// to drift.
//
// Identity is optional. BE register / claim from an unauthenticated
// arrival is intentionally supported — that's how a fresh reality's
// first human comes in.
//
// Every operation an extension registers via reality.do.registerOperation
// is instantly callable here. No per-feature route files. The
// protocol IS the API.

import express from "express";
import { verifyIncoming } from "../../../protocols/ibp/canopy.js";
import { decodeToken } from "../../../seed/materials/being/identity.js";
import { makeHttpCarrier, dispatchAndWait, sendAck } from "../dispatch.js";

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
 * The single IBP HTTP route. Verb is in the URL; address is the wildcard
 * tail; payload is the request body for POST (either `{ payload: {...} }`
 * or the bare payload object) or query params for GET.
 *
 * Mounted at the root of the express app; URL is `/ibp/<verb>/<address>`
 * with no `/api/v1` prefix.
 */
async function ibpHttpHandler(req, res) {
  const verb = String(req.params.verb || "").toLowerCase();
  // Express captures the wildcard tail in req.params[0]; URL
  // decoding for path segments is automatic.
  const address = req.params[0] || "";

  const body = req.body && typeof req.body === "object" ? req.body : {};

  // Payload shape tolerance: prefer `{ payload: {...} }` but accept
  // the bare payload object. GET takes its payload from query
  // params instead.
  let payload;
  if (req.method === "GET") {
    payload = { ...(req.query || {}) };
    if (payload.live === "true")  payload.live = true;
    if (payload.live === "false") payload.live = false;
  } else {
    payload = (body.payload && typeof body.payload === "object")
      ? body.payload
      : body;
  }

  const identity = extractIdentity(req);

  // Apply identity onto req so makeHttpCarrier picks up beingId /
  // name uniformly with the auth-middleware path.
  if (identity) {
    req.beingId = identity.beingId;
    req.name    = identity.name;
  }
  const carrier = makeHttpCarrier(req, {
    jwt: identity?.jwt || null,
    // Set by the verifyIncoming canopy middleware when a verified
    // cross-place request arrives; empty for local calls. dispatchIbp
    // reads this to skip re-forwarding an already-verified inbound
    // envelope back to its sender.
    canopyVerifiedSender: req.canopySender || null,
  });

  // Build the unified envelope and dispatch through the shared handler.
  const msg = {
    id:       body.id || req.headers["x-ibp-id"] || null,
    verb,
    address,
    payload,
    identity: identity ? { beingId: identity.beingId, username: identity.name } : null,
  };

  const ack = await dispatchAndWait(carrier, msg);
  return sendAck(res, ack);
}

// Capture raw body bytes so the canopy verifier can check the signature
// over what the sender actually signed (not the JSON-roundtripped shape).
const parseJsonCaptureRaw = express.json({
  limit: "1mb",
  verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); },
});

// POST handles every verb. Body carries the payload. Cross-place
// requests carry X-Canopy-Sender + X-Canopy-Signature; verifyIncoming
// authenticates them, then dispatchIbp runs the verb locally.
router.post("/ibp/:verb/*", parseJsonCaptureRaw, verifyIncoming, ibpHttpHandler);

// GET convenience for SEE only — payload from query params. Reads
// should be idempotent and cacheable per HTTP semantics; for the
// other three verbs (DO, SUMMON, BE) clients use POST.
router.get("/ibp/see/*", verifyIncoming, ibpHttpHandler);

export default router;
