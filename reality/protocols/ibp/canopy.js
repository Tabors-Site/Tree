// The canopy. This reality's portal to other realities.
//
// A portal is what speaks IBP to a reality. The being-portal is the
// client a human or LLM uses to enter a reality (reality/portal/3d-app/
// is the bundled 3D one). The canopy is the same idea at the other scale:
// it is the portal a REALITY uses to reach another reality. Same
// protocol, different actor on the near side.
//
// Outbound. When an IBP envelope's target resolves to a foreign place,
// the canopy signs the envelope and POSTs it to the peer's
// /ibp/<verb>/<addr> endpoint. The peer verifies the signature against
// our public key (which it has cached as a RealityPeer) and runs the
// verb locally.
//
// Inbound. `verifyIncoming` reads the X-Canopy-Sender and
// X-Canopy-Signature headers, looks up the sender in RealityPeer, and
// verifies the signature over the raw body bytes. A verified request
// has `req.canopySender = "<sender-domain>"` set; authorize.js uses
// this to grant cross-place permissions.
//
// CROSS-WORLD CONTRACT (see seed/CROSS-WORLD.md):
//
// An envelope crossing the canopy carries the actor's identity tuple
// so the receiving substrate can attach crossOrigin to any facts the
// verb produces. The envelope adds two fields beyond the local IBP
// shape:
//
//   actorBranch  — the actor's home branch (their world's branch path)
//   actorActId   — the actor's local Act id (the home-side Stamp the
//                  foreign side will reference in crossOrigin.actId)
//
// The actor's home REALITY is NOT carried in the envelope. The
// receiving side derives it from `req.canopySender`, which is the
// cryptographically vouched authentication value — that's the
// forgery-resistance point: another reality cannot claim to be us
// because they can't sign our body bytes. So crossOrigin.reality
// always comes from canopySender, never from a client-supplied
// envelope field.
//
// The receiving substrate validates: any client-supplied `actorReality`
// in the envelope (if present, for forensics or debugging) must equal
// `req.canopySender`. Mismatch is identity forgery — refuse hard.
//
// The address book the canopy consults lives next door at
// [peers.js](peers.js). The signing keys it uses come from
// [seed/realityIdentity.js](../../seed/realityIdentity.js).

import log from "../../seed/seedReality/log.js";
import { getRealityDomain } from "../../seed/ibp/address.js";
import { signData, verifySignedData } from "../../seed/realityIdentity.js";
import { getPeerByDomain, getPeerBaseUrl } from "./peers.js";

const FORWARD_TIMEOUT_MS = 30 * 1000;

/**
 * Extract the target place from a raw IBP address string. Stance-pair
 * addresses (left :: right) target the right side. Returns the place
 * domain or null.
 */
export function extractTargetReality(address) {
  if (typeof address !== "string" || !address) return null;
  // Stance pair: take the right side (the callee).
  const rhs = address.includes("::") ? address.split("::").pop().trim() : address;
  // Place is everything up to the first slash (or the whole string),
  // then strip any `#<branchPath>` qualifier. Branches are a property of
  // the same reality, not a different reality — without this strip,
  // `localhost#1/` would be misread as the foreign place `localhost#1`
  // and federation would PEER_NOT_FOUND it.
  let realityDomain = rhs.split("/")[0].trim();
  const hashIdx = realityDomain.indexOf("#");
  if (hashIdx >= 0) realityDomain = realityDomain.slice(0, hashIdx);
  return realityDomain || null;
}

/**
 * If the envelope's target address points to a foreign place, return the
 * peer domain. Otherwise null.
 */
export function getForeignTargetDomain(address) {
  const local = getRealityDomain();
  const target = extractTargetReality(address);
  if (!target || target === local) return null;
  return target;
}

/**
 * Forward an envelope to a peer place. Signs the envelope body with this
 * place's private key, POSTs to https://<peer>/ibp/<verb>/<addr>, returns
 * the peer's ack payload.
 *
 * For cross-world calls, the caller passes the actor's identity tuple
 * (actorBranch + actorActId) so the peer can stamp crossOrigin on the
 * facts the verb produces. The actor's REALITY is implicit (this
 * substrate's domain, sent as X-Canopy-Sender and authenticated by
 * signature) — not duplicated in the body.
 *
 * @param {object} envelope
 * @param {string} envelope.id            correlation id
 * @param {string} envelope.verb          "see" | "do" | "summon" | "be"
 * @param {string} envelope.address       full IBP address string
 * @param {object} envelope.payload       verb-specific payload (action,
 *                                        args, message, etc.)
 * @param {object} [envelope.identity]    { beingId, name } — the actor
 * @param {string} [envelope.actorBranch] the actor's home branch
 *                                        (required for write verbs;
 *                                        optional for SEE)
 * @param {string} [envelope.actorActId]  the actor's home Act id (the
 *                                        Stamp the peer references in
 *                                        crossOrigin.actId)
 * @returns {Promise<object>} the peer's ack { id, status, data | error,
 *                                              [innerFace] }
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

  // The wire body extends the local IBP HTTP shape with the actor's
  // cross-world identity fields (when supplied). Receiving substrate
  // reads them under the validated canopySender to construct the
  // crossOrigin block on any facts the verb produces.
  const body = JSON.stringify({
    id:          envelope.id,
    payload:     envelope.payload,
    identity:    envelope.identity || null,
    actorBranch: envelope.actorBranch || null,
    actorActId:  envelope.actorActId  || null,
  });

  // Sign the raw body bytes. The peer verifies against our public key.
  const signature = signData(body);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type":         "application/json",
        "X-Canopy-Sender":      getRealityDomain(),
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
 * a cross-place request, verifies against the sender's stored public
 * key, and stamps `req.canopySender = "<domain>"` on success. On
 * failure: 401. Requests without the headers pass through unchanged
 * (local calls don't need canopy auth).
 */
export async function verifyIncoming(req, res, next) {
  const sender = req.headers["x-canopy-sender"];
  const signature = req.headers["x-canopy-signature"];
  if (!sender && !signature) return next();   // not a cross-place call
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

/**
 * Build the cross-world actor identity tuple from a verified canopy
 * request. Use AFTER verifyIncoming has set `req.canopySender`.
 *
 * The actor's reality is taken from canopySender (the cryptographically
 * vouched value), NOT from any client-supplied field in the body. This
 * is the identity-forgery defense: bing.com cannot claim that the
 * actor's reality is tabors.site because bing.com cannot sign for
 * tabors.site.
 *
 * Returns null when the request is not a cross-world call (no
 * canopySender). Throws when the request IS cross-world but missing
 * the actor's branch + actId — those are required for the receiving
 * Stamper to attach crossOrigin correctly.
 *
 * @param {object} req  Express request, post verifyIncoming
 * @returns {{ reality: string, branch: string, beingId: string, actId: string }|null}
 */
export function actorTupleFromRequest(req) {
  if (!req?.canopySender) return null;
  const body = req.body || {};
  const beingId = body?.identity?.beingId || null;
  const branch  = body?.actorBranch || null;
  const actId   = body?.actorActId  || null;

  // Identity-forgery defense: if the envelope claims an explicit
  // actorReality (which we don't require — canopySender is the
  // canonical source), it must match canopySender. Otherwise the
  // sender is trying to impersonate a different reality.
  if (body?.actorReality && body.actorReality !== req.canopySender) {
    throw new Error(
      `actorTupleFromRequest: envelope claims actorReality="${body.actorReality}" ` +
      `but canopySender="${req.canopySender}". Identity forgery refused.`
    );
  }

  if (!beingId || !branch || !actId) {
    throw new Error(
      "actorTupleFromRequest: cross-world envelope must carry identity.beingId, " +
      "actorBranch, and actorActId. The receiving Stamper needs the full tuple " +
      "to attach crossOrigin."
    );
  }

  return {
    reality: req.canopySender,
    branch,
    beingId,
    actId,
  };
}

function ackError(id, code, message) {
  return { id: id || null, status: "error", error: { code, message } };
}
