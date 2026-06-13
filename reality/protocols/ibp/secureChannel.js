// TreeOS Canopy, the sealed channel.
//
// End-to-end encryption for reality-to-reality IBP, built from the keys
// the realities already are. No certificate authority, no TLS dependence,
// no new trust root: each side authenticates the handshake with its
// reality ed25519 key (the same key canopy signatures use), and the
// session keys are derived from EPHEMERAL X25519 keypairs so past
// traffic stays sealed even if a reality key leaks later (forward
// secrecy). Compromise recovery is succession, as everywhere else.
//
// Handshake (one POST /ibp/handshake round trip):
//
//   A → B   { kind, from, to, ephPub(A), challenge(A), signedAt }
//           canopy-signed body (X-Canopy-Sender/-Signature), so B's
//           verifyIncoming gives authentication, freshness, and replay
//           dedup for free.
//   B → A   { sessionId, ephPub(B), challenge(B), expiresAt, sig }
//           sig = reality-key signature over the transcript hash + the
//           sessionId. The transcript covers both domains, both
//           ephemerals, and both challenges, so neither side's half can
//           be swapped or replayed (A's challenge is inside what B
//           signs).
//
//   shared    = X25519(ephPriv, theirEphPub)
//   transcript = sha256(canonical handshake fields)
//   key(X→Y)  = HKDF-SHA256(shared, salt=transcript, info="canopy-sealed-v1|X>Y")
//
// Two DISTINCT direction keys and RANDOM 96-bit nonces per message:
// no counters, no per-direction nonce state to corrupt, nothing to
// resynchronize after a crash. At canopy traffic volumes the random
// collision bound is not a real number, and sessions expire hourly
// anyway. Replay of a sealed frame is caught after decryption by the
// canopy layer (signedAt window + seen-signature dedup on the inner
// body), so the channel needs no nonce ledger either.
//
// Message frame (both directions): nonce(12) || ciphertext || tag(16),
// ChaCha20-Poly1305, AAD = sessionId. Content-Type marks the frame
// (application/x-canopy-sealed) so plain-JSON peers are untouched.
//
// Sealing is opportunistic by default: if the peer answers the
// handshake we seal, if it 404s (older seed) we remember that for a
// while and send plain signed JSON exactly as before. Set
// CANOPY_REQUIRE_SEALED=1 to refuse plaintext sending outright.

import crypto from "node:crypto";
import log from "../../seed/seedReality/log.js";
import { getRealityDomain } from "../../seed/ibp/address.js";
import { signData, verifySignedData } from "../../seed/realityIdentity.js";

export const SEALED_CONTENT_TYPE = "application/x-canopy-sealed";
const HANDSHAKE_KIND = "canopy-handshake-v1";
const KEY_INFO_PREFIX = "canopy-sealed-v1|";
const NONCE_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

const SESSION_TTL_MS = Number(process.env.CANOPY_SESSION_TTL_MS || 60 * 60_000);
const REFRESH_MARGIN_MS = 60_000;       // re-handshake when this close to expiry
const FALLBACK_TTL_MS = 10 * 60_000;    // remember "peer can't seal" this long
const FAIL_RETRY_MS = 60_000;           // transient handshake failure backoff
const HANDSHAKE_TIMEOUT_MS = 15_000;
const MAX_INBOUND_SESSIONS = 10_000;

// domain -> { sessionId, sendKey, recvKey, expiresAt }   (we initiated)
const outboundSessions = new Map();
// sessionId -> { id, peer, sendKey, recvKey, expiresAt } (peer initiated)
const inboundSessions = new Map();
// domain -> retry-at ms (peer has no handshake endpoint, or it failed)
const plaintextFallbackUntil = new Map();
// domain -> in-flight handshake promise (dedupe concurrent dispatches)
const pendingHandshakes = new Map();

function requireSealed() {
  return process.env.CANOPY_REQUIRE_SEALED === "1";
}

function sealingDisabled() {
  return process.env.CANOPY_SEAL === "off";
}

function sweep(map) {
  const now = Date.now();
  for (const [k, v] of map) {
    const exp = typeof v === "number" ? v : v.expiresAt;
    if (exp <= now) map.delete(k);
  }
}

/**
 * The transcript both sides hash and B signs. Field order is fixed here;
 * both sides build the exact same string, so the hash binds both domains,
 * both ephemerals, and both challenges into one value.
 */
function transcriptHash({ from, to, ephA, ephB, challengeA, challengeB }) {
  const material = JSON.stringify({ kind: HANDSHAKE_KIND, from, to, ephA, ephB, challengeA, challengeB });
  return crypto.createHash("sha256").update(material, "utf8").digest("hex");
}

// Direction labels are handshake ROLES, not domains: the transcript hash
// in the salt already binds both domains, and role labels keep the two
// direction keys distinct even when a reality loops back to itself.
const DIR_INIT_TO_RESP = "init>resp";
const DIR_RESP_TO_INIT = "resp>init";

function deriveKey(shared, transcriptHex, direction) {
  const raw = crypto.hkdfSync(
    "sha256",
    shared,
    Buffer.from(transcriptHex, "hex"),
    `${KEY_INFO_PREFIX}${direction}`,
    KEY_LEN,
  );
  return Buffer.from(raw);
}

function importX25519Pub(pem) {
  const key = crypto.createPublicKey(pem);
  if (key.asymmetricKeyType !== "x25519") {
    throw new Error(`expected an x25519 public key, got ${key.asymmetricKeyType}`);
  }
  return key;
}

function encryptFrame(key, sessionId, plaintext) {
  const nonce = crypto.randomBytes(NONCE_LEN);
  const cipher = crypto.createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: TAG_LEN });
  cipher.setAAD(Buffer.from(sessionId, "utf8"));
  const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
  return Buffer.concat([nonce, ct, cipher.getAuthTag()]);
}

function decryptFrame(key, sessionId, frame) {
  if (!Buffer.isBuffer(frame) || frame.length < NONCE_LEN + TAG_LEN + 1) {
    throw new Error("sealed frame too short");
  }
  const nonce = frame.subarray(0, NONCE_LEN);
  const tag = frame.subarray(frame.length - TAG_LEN);
  const ct = frame.subarray(NONCE_LEN, frame.length - TAG_LEN);
  const decipher = crypto.createDecipheriv("chacha20-poly1305", key, nonce, { authTagLength: TAG_LEN });
  decipher.setAAD(Buffer.from(sessionId, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// ── sender (initiator) side ─────────────────────────────────────────────

/**
 * A live outbound session for this peer, establishing one if needed.
 * Returns null when sealing is off, the peer can't seal (remembered for
 * FALLBACK_TTL_MS), or the handshake fails (short backoff). The caller
 * falls back to plain signed JSON on null, unless CANOPY_REQUIRE_SEALED.
 */
export async function getOutboundSession(peer, { fetchImpl = fetch } = {}) {
  if (sealingDisabled()) return null;
  const domain = peer?.domain;
  if (!domain) return null;

  const cached = outboundSessions.get(domain);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return cached;
  outboundSessions.delete(domain);

  const retryAt = plaintextFallbackUntil.get(domain);
  if (retryAt && retryAt > Date.now()) return null;

  if (pendingHandshakes.has(domain)) return pendingHandshakes.get(domain);
  const p = runHandshake(peer, fetchImpl).finally(() => pendingHandshakes.delete(domain));
  pendingHandshakes.set(domain, p);
  return p;
}

export function invalidateOutboundSession(domain) {
  outboundSessions.delete(domain);
}

async function runHandshake(peer, fetchImpl) {
  const domain = peer.domain;
  const from = getRealityDomain();
  try {
    const eph = crypto.generateKeyPairSync("x25519");
    const ephPub = eph.publicKey.export({ type: "spki", format: "pem" }).toString();
    const challenge = crypto.randomBytes(32).toString("base64");
    const body = JSON.stringify({
      kind: HANDSHAKE_KIND,
      from,
      to: domain,
      ephPub,
      challenge,
      signedAt: new Date().toISOString(),
    });
    const baseUrl = peer.baseUrl ? peer.baseUrl.replace(/\/+$/, "") : `https://${domain}`;
    const res = await fetchImpl(`${baseUrl}/ibp/handshake`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Canopy-Sender": from,
        "X-Canopy-Signature": signData(body),
      },
      body,
      signal: AbortSignal.timeout(HANDSHAKE_TIMEOUT_MS),
    });

    if (res.status === 404 || res.status === 405) {
      // Older peer with no handshake endpoint. Plain signed JSON it is.
      plaintextFallbackUntil.set(domain, Date.now() + FALLBACK_TTL_MS);
      log.verbose("Canopy", `peer ${domain} does not seal (no handshake endpoint); sending plain signed JSON`);
      return null;
    }
    if (!res.ok) {
      plaintextFallbackUntil.set(domain, Date.now() + FAIL_RETRY_MS);
      log.warn("Canopy", `handshake with ${domain} refused (${res.status}); falling back to plain for a minute`);
      return null;
    }

    const ack = await res.json();
    const { sessionId, ephPub: theirEphPub, challenge: theirChallenge, expiresAt, sig } = ack || {};
    if (!sessionId || !theirEphPub || !theirChallenge || !sig) {
      throw new Error("handshake response missing fields");
    }
    const tHash = transcriptHash({
      from,
      to: domain,
      ephA: ephPub,
      ephB: theirEphPub,
      challengeA: challenge,
      challengeB: theirChallenge,
    });
    // The peer's reality key over transcript+sessionId proves the
    // responder holds the key we registered for it, and the transcript
    // contains OUR fresh challenge, so this response can't be a replay.
    if (!verifySignedData(`${tHash}|${sessionId}`, sig, peer.publicKey)) {
      throw new Error("handshake transcript signature failed verification");
    }
    const shared = crypto.diffieHellman({
      privateKey: eph.privateKey,
      publicKey: importX25519Pub(theirEphPub),
    });
    const session = {
      sessionId,
      sendKey: deriveKey(shared, tHash, DIR_INIT_TO_RESP),
      recvKey: deriveKey(shared, tHash, DIR_RESP_TO_INIT),
      expiresAt: Math.min(Date.now() + SESSION_TTL_MS, Date.parse(expiresAt) || Infinity),
    };
    outboundSessions.set(domain, session);
    log.info("Canopy", `sealed channel up with ${domain} (session ${sessionId.slice(0, 8)}…)`);
    return session;
  } catch (err) {
    plaintextFallbackUntil.set(domain, Date.now() + FAIL_RETRY_MS);
    log.warn("Canopy", `handshake with ${domain} failed: ${err.message}; falling back to plain for a minute`);
    return null;
  }
}

/** Seal an outbound request body with the session's send key. */
export function sealRequest(session, plaintext) {
  return encryptFrame(session.sendKey, session.sessionId, plaintext);
}

/** Open a sealed response with the session's recv key. */
export function openResponse(session, frame) {
  return decryptFrame(session.recvKey, session.sessionId, frame);
}

export function sealedSendRequired() {
  return requireSealed();
}

// ── receiver (responder) side ───────────────────────────────────────────

/**
 * Express handler for POST /ibp/handshake. MUST run after verifyIncoming:
 * authentication, signedAt freshness, and replay dedup of the handshake
 * body all happened there; req.canopySender is the proven initiator.
 */
export function handshakeHandler(req, res) {
  try {
    if (!req.canopySender) {
      return res.status(401).json({
        status: "error",
        error: { code: "UNAUTHORIZED", message: "handshake requires canopy authentication" },
      });
    }
    const { kind, from, to, ephPub, challenge } = req.body || {};
    if (kind !== HANDSHAKE_KIND) {
      return res.status(400).json({
        status: "error",
        error: { code: "INVALID_INPUT", message: `unknown handshake kind "${kind}"` },
      });
    }
    if (from !== req.canopySender) {
      return res.status(401).json({
        status: "error",
        error: { code: "UNAUTHORIZED", message: "handshake 'from' does not match the canopy sender" },
      });
    }
    if (to !== getRealityDomain()) {
      return res.status(400).json({
        status: "error",
        error: { code: "INVALID_INPUT", message: "handshake 'to' is not this reality" },
      });
    }
    if (typeof ephPub !== "string" || typeof challenge !== "string" || !challenge.length) {
      return res.status(400).json({
        status: "error",
        error: { code: "INVALID_INPUT", message: "handshake requires ephPub + challenge" },
      });
    }

    sweep(inboundSessions);
    if (inboundSessions.size >= MAX_INBOUND_SESSIONS) {
      return res.status(503).json({
        status: "error",
        error: { code: "OVERLOADED", message: "session table full; retry later" },
      });
    }

    const theirPub = importX25519Pub(ephPub);
    const eph = crypto.generateKeyPairSync("x25519");
    const myEphPub = eph.publicKey.export({ type: "spki", format: "pem" }).toString();
    const myChallenge = crypto.randomBytes(32).toString("base64");
    const sessionId = crypto.randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

    const tHash = transcriptHash({
      from,
      to,
      ephA: ephPub,
      ephB: myEphPub,
      challengeA: challenge,
      challengeB: myChallenge,
    });
    const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: theirPub });
    inboundSessions.set(sessionId, {
      id: sessionId,
      peer: from,
      recvKey: deriveKey(shared, tHash, DIR_INIT_TO_RESP),   // initiator → us
      sendKey: deriveKey(shared, tHash, DIR_RESP_TO_INIT),   // us → initiator
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    log.info("Canopy", `sealed channel up with ${from} (session ${sessionId.slice(0, 8)}…, inbound)`);

    return res.json({
      sessionId,
      ephPub: myEphPub,
      challenge: myChallenge,
      expiresAt,
      sig: signData(`${tHash}|${sessionId}`),
    });
  } catch (err) {
    return res.status(400).json({
      status: "error",
      error: { code: "INVALID_INPUT", message: `handshake failed: ${err.message}` },
    });
  }
}

export function getInboundSession(sessionId) {
  if (!sessionId) return null;
  const s = inboundSessions.get(String(sessionId));
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    inboundSessions.delete(String(sessionId));
    return null;
  }
  return s;
}

/** Open a sealed inbound request with the session's recv key. */
export function openInbound(session, frame) {
  return decryptFrame(session.recvKey, session.id, frame);
}

/** Seal a response to a sealed inbound request. */
export function sealResponse(session, plaintext) {
  return encryptFrame(session.sendKey, session.id, plaintext);
}

/** Test seam: drop all channel state, as a restart would. */
export function _resetSecureChannel() {
  outboundSessions.clear();
  inboundSessions.clear();
  plaintextFallbackUntil.clear();
  pendingHandshakes.clear();
}
