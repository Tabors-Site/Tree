// Cross-domain IBP dispatch.
//
// When an IBP envelope's target address resolves to a foreign land, we
// canopy-sign the envelope and POST it to the peer's /ibp/<verb>/<addr>
// endpoint. The peer verifies our signature against our public key
// (which it has cached as a LandPeer) and runs the verb locally.
//
// On the receive side, `verifyIncoming` reads the X-Canopy-Sender +
// X-Canopy-Signature headers, looks up the sender in LandPeer, and
// verifies the signature over the raw body bytes. A verified request
// has `req.canopySender = "<sender-domain>"` set; authorize.js uses
// this to grant cross-land permissions.
//
// See [[project_canopy_folds_into_ibp]].

import log from "../../../seed/core/log.js";
import { getLandDomain } from "../../../seed/addressing/address.js";
import { signData, verifySignedData } from "./identity.js";
import { getPeerByDomain, getPeerBaseUrl } from "./peers.js";

const FORWARD_TIMEOUT_MS = 30 * 1000;

/**
 * Extract the target land from a raw IBP address string. Stance-pair
 * addresses (left :: right) target the right side. Returns the land
 * domain or null.
 */
export function extractTargetLand(address) {
  if (typeof address !== "string" || !address) return null;
  // Stance pair: take the right side (the callee).
  const rhs = address.includes("::") ? address.split("::").pop().trim() : address;
  // Land is everything up to the first slash (or the whole string).
  const land = rhs.split("/")[0].trim();
  return land || null;
}

/**
 * If the envelope's target address points to a foreign land, return the
 * peer domain. Otherwise null.
 */
export function getForeignTargetDomain(address) {
  const local = getLandDomain();
  const target = extractTargetLand(address);
  if (!target || target === local) return null;
  return target;
}

/**
 * Forward an envelope to a peer land. Signs the envelope body with this
 * land's private key, POSTs to https://<peer>/ibp/<verb>/<addr>, returns
 * the peer's ack payload.
 *
 * @param {object} envelope - parsed IBP envelope { id, verb, address, payload, identity? }
 * @returns {Promise<object>} - the peer's ack { id, status, data | error }
 */
export async function forwardToPeer(envelope) {
  const target = getForeignTargetDomain(envelope.address);
  if (!target) {
    return ackError(envelope.id, "INVALID_INPUT", "forwardToPeer called with no foreign target");
  }

  const peer = await getPeerByDomain(target);
  if (!peer) {
    return ackError(envelope.id, "PEER_NOT_FOUND",
      `No peer record for ${target}. Register the peer first.`);
  }
  if (peer.status === "blocked") {
    return ackError(envelope.id, "FORBIDDEN", `Peer ${target} is blocked`);
  }

  const baseUrl = getPeerBaseUrl(peer);
  const encodedAddress = encodeURIComponent(envelope.address);
  const url = `${baseUrl}/ibp/${envelope.verb}/${encodedAddress}`;

  // The wire body is the same shape as local IBP HTTP calls.
  const body = JSON.stringify({
    id:      envelope.id,
    payload: envelope.payload,
  });

  // Sign the raw body bytes. The peer verifies against our public key.
  const signature = signData(body);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type":         "application/json",
        "X-Canopy-Sender":      getLandDomain(),
        "X-Canopy-Signature":   signature,
      },
      body,
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });

    const json = await res.json().catch(() => ({
      id: envelope.id, status: "error",
      error: { code: "INTERNAL", message: `Peer ${target} returned non-JSON (${res.status})` },
    }));
    return json;
  } catch (err) {
    log.error("Canopy", `forward to ${target} failed: ${err.message}`);
    return ackError(envelope.id, "PEER_UNREACHABLE",
      `Could not reach ${target}: ${err.message}`);
  }
}

/**
 * Express middleware. Reads X-Canopy-Sender + X-Canopy-Signature from
 * a cross-land request, verifies against the sender's stored public
 * key, and stamps `req.canopySender = "<domain>"` on success. On
 * failure: 401. Requests without the headers pass through unchanged
 * (local calls don't need canopy auth).
 */
export async function verifyIncoming(req, res, next) {
  const sender = req.headers["x-canopy-sender"];
  const signature = req.headers["x-canopy-signature"];
  if (!sender && !signature) return next();   // not a cross-land call
  if (!sender || !signature) {
    return res.status(401).json({
      status: "error",
      error: { code: "UNAUTHORIZED", message: "incomplete canopy auth headers" },
    });
  }

  const peer = await getPeerByDomain(sender);
  if (!peer || peer.status === "blocked") {
    return res.status(401).json({
      status: "error",
      error: { code: "UNAUTHORIZED", message: `Unknown or blocked peer: ${sender}` },
    });
  }

  // Verify the signature over the raw body bytes. req.rawBody is set by
  // the body-parser when configured; falling back to JSON.stringify(req.body)
  // matches what the sender signed.
  const bodyForVerify = req.rawBody || JSON.stringify(req.body);
  const ok = verifySignedData(bodyForVerify, signature, peer.publicKey);
  if (!ok) {
    return res.status(401).json({
      status: "error",
      error: { code: "UNAUTHORIZED", message: "canopy signature verification failed" },
    });
  }

  req.canopySender = sender;
  return next();
}

function ackError(id, code, message) {
  return { id: id || null, status: "error", error: { code, message } };
}
