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

// Replay-protection window. A canopy envelope older than this is
// refused at the receiver. Captured-and-replayed envelopes (man-in-
// the-middle, log scraping, etc.) lose their window quickly. The
// value is large enough to absorb normal clock skew + slow links,
// small enough to bound the attack surface. Operators with very
// drifty clocks can widen via env var; defaults below.
const REPLAY_WINDOW_MS = Number(
  process.env.CANOPY_REPLAY_WINDOW_MS || 60_000,
);

/**
 * Extract the target place from a raw IBP address string. Stance-pair
 * addresses (left :: right) target the right side. Returns the place
 * domain or null.
 */
export function extractTargetReality(address) {
  if (typeof address !== "string" || !address) return null;
  // Stance pair: take the right side (the callee).
  const rhs = address.includes("::") ? address.split("::").pop().trim() : address;
  // Bare local stances have NO reality prefix:
  //   `@birther`            — local being summon
  //   `/path`               — local position
  //   `/path@being`         — local stance
  //   `~` / `~/inner`       — caller's home shorthand
  //   `.` / `./branches`    — heaven addresses
  //   `#1/path`             — branch-qualified local position
  // Without this guard `extractTargetReality("@birther")` would return
  // `"@birther"`, the dispatcher would compare it against the local
  // domain (mismatch), and route the call through crossRealityDispatch.
  // A reality domain in the address ALWAYS comes before the first `/`
  // or `@`; anything starting with a local sigil is locally rooted.
  if (/^[@/~.#]/.test(rhs)) return null;
  // Place is everything up to the first slash or `@` (or the whole
  // string), then strip any `#<branchPath>` qualifier. Branches are a
  // property of the same reality — without the strip, `localhost#1/`
  // would be misread as the foreign place `localhost#1` and federation
  // would PEER_NOT_FOUND it.
  let realityDomain = rhs.split(/[/@]/)[0].trim();
  const hashIdx = realityDomain.indexOf("#");
  if (hashIdx >= 0) realityDomain = realityDomain.slice(0, hashIdx);
  if (!realityDomain) return null;
  // Bare relative paths (`lab/x`) put a plain segment where a domain
  // would sit. A foreign reality is host-shaped — it carries a dot
  // (treeos.ai) or a port colon (localhost:3000) — or it IS the local
  // domain. A single undotted, unported segment that isn't the local
  // domain is a relative path root, not a peer. (Trade-off: a foreign
  // peer addressed as bare undotted `localhost` with no port won't
  // route — register peers with host:port or a real domain.)
  if (realityDomain !== getRealityDomain() && !/[.:]/.test(realityDomain)) {
    return null;
  }
  return realityDomain;
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
    // Replay-protection. The receiver enforces a freshness window
    // against this timestamp (default 60s). Captured envelopes lose
    // their window quickly. See verifyIncoming's freshness check.
    signedAt:    new Date().toISOString(),
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

  // Replay-protection. The signed body must include a `signedAt` ISO
  // timestamp within REPLAY_WINDOW_MS of now (default 60s). A captured
  // envelope replayed minutes later will have an aged signedAt and
  // refuse here even though the signature is valid. The sender's
  // forwardToPeer populates signedAt at send-time.
  const signedAt = req.body?.signedAt;
  if (typeof signedAt !== "string" || !signedAt.length) {
    return res.status(401).json({
      status: "error",
      error: { code: "UNAUTHORIZED", message: "canopy envelope missing signedAt (replay-window check requires it)" },
    });
  }
  const signedAtMs = Date.parse(signedAt);
  if (Number.isNaN(signedAtMs)) {
    return res.status(401).json({
      status: "error",
      error: { code: "UNAUTHORIZED", message: `canopy signedAt is not a valid ISO timestamp: "${signedAt}"` },
    });
  }
  const ageMs = Math.abs(Date.now() - signedAtMs);
  if (ageMs > REPLAY_WINDOW_MS) {
    return res.status(401).json({
      status: "error",
      error: {
        code: "UNAUTHORIZED",
        message: `canopy envelope outside replay window (age=${Math.round(ageMs / 1000)}s, window=${Math.round(REPLAY_WINDOW_MS / 1000)}s)`,
      },
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
