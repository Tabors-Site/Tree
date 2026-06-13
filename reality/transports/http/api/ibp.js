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
import {
  SEALED_CONTENT_TYPE, handshakeHandler,
  getInboundSession, openInbound, sealResponse,
} from "../../../protocols/ibp/secureChannel.js";
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
  // Cross-world actor tuple. When the request arrived from a peer
  // reality via canopy (req.canopySender is set), construct the
  // actor's identity tuple — { reality, branch, beingId, actId } —
  // from the trusted canopy sender + envelope fields. The receiving
  // verb handler uses this to seat summonCtx.actorAct so emitFact
  // attaches crossOrigin correctly when stamping facts on local
  // reels. Local calls (no canopySender) get null and the carrier
  // path opens a local Act as normal.
  //
  // Throws on identity-forgery attempts (envelope claims a different
  // actorReality than canopySender) or on incomplete tuples (cross-
  // world envelopes must carry beingId + branch + actId). Both surface
  // as 401 UNAUTHORIZED.
  let crossWorldActor = null;
  if (req.canopySender) {
    try {
      const { actorTupleFromRequest } = await import("../../../protocols/ibp/canopy.js");
      crossWorldActor = actorTupleFromRequest(req);
    } catch (err) {
      return res.status(401).json({
        status: "error",
        error: { code: "UNAUTHORIZED", message: err.message },
      });
    }
  }

  const carrier = makeHttpCarrier(req, {
    jwt: identity?.jwt || null,
    // Set by the verifyIncoming canopy middleware when a verified
    // cross-place request arrives; empty for local calls. dispatchIbp
    // reads this to skip re-forwarding an already-verified inbound
    // envelope back to its sender.
    canopyVerifiedSender: req.canopySender || null,
    // The foreign actor's identity tuple — populated only on cross-
    // reality inbound. Receiving verb handlers consume this to build
    // a synthetic summonCtx.actorAct (the actor's local Act lives on
    // the SENDER's substrate, not here, so we don't open a local Act
    // row; we seat actorAct as a JS object representing the foreign
    // actor and let emitFact stamp crossOrigin from it).
    crossWorldActor,
  });

  // Build the unified envelope and dispatch through the shared handler.
  // Identity flows via the carrier (req.beingId/name set above); the
  // wire verbs read it from there, not from the envelope. The address
  // IS the actor per Diff A doctrine.
  const msg = {
    id:       body.id || req.headers["x-ibp-id"] || null,
    verb,
    address,
    payload,
  };

  const ack = await dispatchAndWait(carrier, msg);
  return sendAck(res, ack);
}

/**
 * Sealed-channel ingress. A peer with a live session POSTs the canopy
 * body as ChaCha20-Poly1305 ciphertext (Content-Type marks it; the
 * X-Canopy-Session header names the session). Decrypt back to the exact
 * plaintext bytes the sender signed, seat them as req.rawBody + req.body,
 * and let verifyIncoming + the handler run unchanged. Plain-JSON
 * requests pass straight through.
 */
function unsealIncoming(req, res, next) {
  if (!req.is(SEALED_CONTENT_TYPE)) return next();
  const session = getInboundSession(req.headers["x-canopy-session"]);
  if (!session) {
    // Distinct code: the sender re-handshakes once on this and resends.
    return res.status(401).json({
      status: "error",
      error: { code: "SESSION_UNKNOWN", message: "sealed session unknown or expired; re-handshake" },
    });
  }
  try {
    const plaintext = openInbound(session, req.body);
    req.rawBody = plaintext;
    req.body = JSON.parse(plaintext);
    req.sealedSession = session;
  } catch (err) {
    return res.status(401).json({
      status: "error",
      error: { code: "SEALED_INVALID", message: `sealed frame failed to open: ${err.message}` },
    });
  }
  // Seal the response too: same session, the peer-bound direction key.
  // Hooking res.json keeps sendAck's status-code mapping intact while
  // every body (acks and errors alike) leaves encrypted.
  res.json = (obj) => {
    try {
      res.set("Content-Type", SEALED_CONTENT_TYPE);
      res.set("X-Canopy-Session", session.id);
      return res.send(sealResponse(session, JSON.stringify(obj)));
    } catch {
      // Fail closed: a sealed session never falls back to a plaintext
      // body. The peer gets an opaque 500; confidentiality outranks
      // the error detail.
      res.status(500);
      res.set("Content-Type", "application/json");
      return res.send("");
    }
  };
  return next();
}

// Capture raw body bytes so the canopy verifier can check the signature
// over what the sender actually signed (not the JSON-roundtripped shape).
const parseJsonCaptureRaw = express.json({
  limit: "1mb",
  verify: (req, _res, buf) => { req.rawBody = buf.toString("utf8"); },
});

// Sealed frames are binary; the global express.json parser ignores their
// content type, so this raw parser is what actually reads them.
const parseSealedRaw = express.raw({ type: SEALED_CONTENT_TYPE, limit: "1mb" });

// Sealed-channel handshake. verifyIncoming authenticates the initiator,
// enforces the freshness window, and dedupes replays of the handshake
// body itself; the handler then derives the session keys. Registered
// before the :verb route on principle (the wildcard pattern would not
// match this path anyway).
router.post("/ibp/handshake", parseJsonCaptureRaw, verifyIncoming, handshakeHandler);

// POST handles every verb. Body carries the payload (sealed or plain).
// Cross-place requests carry X-Canopy-Sender + X-Canopy-Signature;
// unsealIncoming decrypts sealed frames back to the signed plaintext,
// verifyIncoming authenticates it, then dispatchIbp runs the verb
// locally.
router.post("/ibp/:verb/*", parseSealedRaw, unsealIncoming, parseJsonCaptureRaw, verifyIncoming, ibpHttpHandler);

// GET convenience for SEE only — payload from query params. Reads
// should be idempotent and cacheable per HTTP semantics; for the
// other three verbs (DO, SUMMON, BE) clients use POST.
router.get("/ibp/see/*", verifyIncoming, ibpHttpHandler);

export default router;
