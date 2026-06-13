// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// actSig — the signature that proves a being authored an act with
// exactly its facts.
//
// One chokepoint signs every act: sealAct (4-stamped.js). The signature
// commits to the act's identity (actId, which already hashes the whole
// opening), its chain position (p, anti-splice), AND the sorted ids of
// the facts the moment produced, so neither the act nor its facts can be
// swapped after the seal. It rides on the Act row as a CLOSURE field
// (act.sig), outside contentOfAct, so it never changes act._id and
// replay/dedup is unaffected.
//
// Custodial: the home reality holds the being's private key and signs on
// its behalf. The key lives only in this stack frame, never on the row,
// never logged. A being with no local key (a foreign cross-reality
// actor, or a decrypt failure) seals UNSIGNED rather than failing the
// moment. I_AM is the reality itself: it signs with the reality key
// (realityIdentity), and because its id "i-am" is not a public key,
// verification routes to the reality public key.

import { canonicalize } from "../fact/hash.js";
import log from "../../seedReality/log.js";

// The I_AM constant (seed/materials/being/seedBeings.js:26). Inlined to
// keep this past-layer module from importing materials at load time; it
// is a frozen doctrinal value.
const I_AM = "i-am";

function normBranch(b) {
  return typeof b === "string" && b.length ? b : "0";
}

function timeISO(act) {
  const t = act?.endMessage?.time;
  const d = t instanceof Date ? t : (t ? new Date(t) : null);
  return d && !isNaN(d.getTime()) ? d.toISOString() : null;
}

/**
 * The canonical bytes a signature attests to. actId transitively pins
 * the whole opening (contentOfAct); this ADDS what the opening hash does
 * not cover: the committed factIds (the moment's actual ΔF), the chain
 * position p, and the seal time. Same serializer the signer uses.
 */
export function buildActSigPayload(act, factIds) {
  return {
    actId:    String(act._id),
    beingIn:  act.beingIn,
    beingOut: act.beingOut ?? null,
    reality:  act.reality ?? null,
    branch:   normBranch(act.branch),
    p:        act.p ?? null,
    factIds:  Array.isArray(factIds) ? [...factIds].map(String).sort() : [],
    time:     timeISO(act),
  };
}

/**
 * Load the private key (PEM) that signs for an actor, BEFORE the seal
 * transaction so the txn stays lean. Returns null for any actor with no
 * local key (foreign cross-reality, missing/corrupt blob) — the seal
 * then proceeds unsigned. Never throws.
 */
export async function loadSigningKey(beingId, branch) {
  try {
    if (beingId === I_AM) {
      const { getRealityIdentity } = await import("../../realityIdentity.js");
      return getRealityIdentity().privateKey;     // reality ed25519 PEM
    }
    const { isKeyId } = await import("../../materials/being/identity/beingKeys.js");
    if (!isKeyId(beingId)) return null;            // not a local key-bearing being
    const { loadProjection } = await import("../../materials/projections.js");
    const slot = await loadProjection("being", beingId, normBranch(branch));
    // Secondary unlock (IDENTITY.md): a HUMAN's acts are signed only
    // while their signing session is open. Locked human → unsigned
    // seal, visibly so (the portal badges it). Scripted/LLM beings and
    // I_AM are exempt — no hand to type a secret. The TTL slides on
    // every signed seal so active humans stay unlocked. Cognition
    // lives at qualities.cognition.defaultKind (not a schema field).
    const _q = slot?.state?.qualities;
    const _cog = _q instanceof Map ? _q.get("cognition") : _q?.cognition;
    if (_cog?.defaultKind === "human") {
      const { isSigningUnlocked, touchSigning } =
        await import("../../materials/being/identity/signingSession.js");
      if (!isSigningUnlocked(beingId)) return null;
      touchSigning(beingId);
    }
    const q = slot?.state?.qualities;
    const auth = q instanceof Map ? q.get("auth") : q?.auth;
    const enc = auth?.privateKeyEnc;
    if (!enc) return null;
    const { decryptCredential } = await import("../../materials/being/identity/credentials.js");
    return decryptCredential(enc);                 // null on bad blob/key
  } catch {
    return null;
  }
}

/**
 * Sign an act with a preloaded key (from loadSigningKey). Returns the
 * sig subdoc { alg, by, value } or null (unsigned). Never throws — a
 * signing failure must never abort the seal and lose the facts.
 *
 * @param {object} actDoc       the act being sealed
 * @param {string[]} factIds    the committed fact ids (sorted inside)
 * @param {string|null} pem     the signer's private key PEM (preloaded)
 */
export async function signActDoc(actDoc, factIds, pem) {
  if (pem === undefined) pem = await loadSigningKey(actDoc.beingIn, actDoc.branch);
  if (!pem) return null;
  try {
    const { signAsBeing } = await import("../../materials/being/identity/beingKeys.js");
    const value = signAsBeing(pem, buildActSigPayload(actDoc, factIds));
    return { alg: "ed25519", by: actDoc.beingIn, value };
  } catch (err) {
    log.warn("Stamped", `signing failed for act ${String(actDoc?._id || "").slice(0, 8)}: ${err.message}`);
    return null;
  }
}

/**
 * Verify an act's signature self-certifyingly. Rebuilds the payload from
 * the act row + the committed facts (the single source of truth for the
 * fact set), then checks the signature against the signer's public key,
 * which is the signer id itself for beings (no directory) or the reality
 * key for I_AM.
 *
 * @returns {Promise<{ok: boolean, reason: string}>}
 */
export async function verifyActSig(act, { localReality = null } = {}) {
  const sig = act?.sig;
  const by = sig?.by;
  if (!sig?.value) {
    // Unsigned. A LOCAL act by a key-bearing being should be signed; a
    // foreign cross-reality act is verified on its home substrate.
    const foreign = localReality != null && act?.reality != null && act.reality !== localReality;
    return { ok: foreign, reason: foreign ? "foreign-unsigned-ok" : "unsigned" };
  }
  const { default: Fact } = await import("../fact/fact.js");
  const rows = await Fact.find({ actId: String(act._id) }).select("_id").lean();
  const factIds = rows.map((f) => String(f._id)).sort();
  const payload = buildActSigPayload(act, factIds);

  if (by === I_AM) {
    const { getRealityIdentity } = await import("../../realityIdentity.js");
    const { verifyWithPublicKeyPem } = await import("../../materials/being/identity/beingKeys.js");
    return {
      ok: verifyWithPublicKeyPem(getRealityIdentity().publicKey, payload, sig.value),
      reason: "i-am",
    };
  }
  const { isKeyId, verifyBeingSig } = await import("../../materials/being/identity/beingKeys.js");
  if (isKeyId(by)) {
    return { ok: verifyBeingSig(by, payload, sig.value), reason: "being" };
  }
  return { ok: false, reason: "unknown-signer" };
}

// ── cross-reality envelope signature ──
//
// Where the act-sig above proves a being authored an act WITH its facts on
// its home chain, the envelope-sig proves the being authored the cross-
// reality REQUEST it sends to a foreign reality: exactly this verb, on this
// address, with this payload, tied to its home act. The receiving reality
// verifies it self-certifyingly against the actor's beingId (which IS the
// pubkey), with NO callback to the actor's home reality. That self-
// certification is what lets a being run its own tiny reality, hold its own
// key, and act anywhere: every venue proves it is them without asking home.
//
// The wire body is ALSO signed at the reality level (canopy X-Canopy-
// Signature over the raw bytes), so a present-but-absent envelope-sig can't
// be stripped by a man-in-the-middle without breaking the reality sig. An
// absent envelope-sig therefore means "the home reality vouched but did not
// supply the being's own sig" — accepted in advisory mode for peers that
// don't sign yet; a PRESENT sig that fails is a hard refusal.

/**
 * The canonical bytes a cross-reality envelope-sig attests to. `kind`
 * domain-separates it from an act-sig so neither can be replayed as the
 * other. Same serializer both sides use.
 *
 * `time` is the signing moment (ISO). It rides the wire as beingSig.time
 * and is BOUND into the signature, so a captured being-sig cannot be
 * re-wrapped in a fresh canopy body and replayed outside its freshness
 * window. The canopy-level signedAt only proves the WRAPPER is fresh
 * (the peer reality signs that); this proves the DEED is fresh (the
 * being signs this).
 */
export function buildEnvelopeSigPayload({ verb, address, payload, beingId, actId, branch, reality, time }) {
  return {
    kind:    "cross-reality-envelope",
    verb:    verb || null,
    address: address || null,
    payload: payload ?? null,
    beingId: beingId || null,
    actId:   actId || null,
    branch:  normBranch(branch),
    reality: reality || null,
    time:    time || null,
  };
}

/**
 * Freshness window for envelope being-sigs. Wider than the canopy wrapper
 * window (60s) because the being signs at dispatch time and the wrapper
 * may be built or retried later; 5 minutes bounds rewrap-replay while
 * absorbing slow links and clock skew. Read per call so tests can tune it.
 */
function envelopeSigWindowMs() {
  return Number(process.env.CROSS_ENVELOPE_SIG_WINDOW_MS || 5 * 60_000);
}

/**
 * Sign a cross-reality envelope with the actor's preloaded key (from
 * loadSigningKey). Returns { alg, by, value } or null (keyless/anonymous
 * actor — the call still forwards, accepted under the reality-level canopy
 * sig). Never throws: an unsignable cross-call must not be blocked.
 *
 * @param {object} env  { verb, address, payload, beingId, actId, branch, reality }
 * @param {string|null} pem  the actor's private key PEM (preloaded)
 */
export async function signEnvelopeBeingSig(env, pem) {
  if (pem === undefined) pem = await loadSigningKey(env.beingId, env.branch);
  if (!pem) return null;
  try {
    const { signAsBeing } = await import("../../materials/being/identity/beingKeys.js");
    const time = new Date().toISOString();
    const value = signAsBeing(pem, buildEnvelopeSigPayload({ ...env, time }));
    return { alg: "ed25519", by: env.beingId, value, time };
  } catch (err) {
    log.warn("CrossWorld", `envelope signing failed for ${String(env?.beingId || "").slice(0, 10)}: ${err.message}`);
    return null;
  }
}

/**
 * Verify a cross-reality envelope-sig self-certifyingly. The actor tuple's
 * beingId is the source of truth (it also drives crossOrigin), so the sig
 * is checked against env.beingId, NOT against beingSig.by — the sig must be
 * the actor's own. Returns { ok, reason }:
 *   - no sig         → ok:true  "unsigned-advisory"   (reality sig vouched)
 *   - non-key actor  → ok:true  "non-key-signer"      (i-am / anon; reality sig vouches)
 *   - key actor      → verified against env.beingId
 * A PRESENT sig that fails is a hard ok:false.
 *
 * @param {object} env       same shape as signEnvelopeBeingSig's env
 * @param {object|null} beingSig  { alg, by, value, time }
 */
export async function verifyEnvelopeBeingSig(env, beingSig) {
  if (!beingSig?.value) return { ok: true, reason: "unsigned-advisory" };
  const { isKeyId, verifyBeingSig } = await import("../../materials/being/identity/beingKeys.js");
  const by = env?.beingId;
  if (!isKeyId(by)) return { ok: true, reason: "non-key-signer" };
  // Freshness gate. The signing time is part of the signed payload, so a
  // stale or missing time on a PRESENT sig is a hard refusal: without it
  // a compromised peer could replay a captured being-sig forever inside
  // freshly signed canopy wrappers. Sigs minted before this field landed
  // fail here by design; re-dispatch signs fresh.
  const t = Date.parse(beingSig.time || "");
  if (Number.isNaN(t)) return { ok: false, reason: "missing-time" };
  if (Math.abs(Date.now() - t) > envelopeSigWindowMs()) return { ok: false, reason: "stale-sig" };
  return {
    ok: verifyBeingSig(by, buildEnvelopeSigPayload({ ...env, time: beingSig.time }), beingSig.value),
    reason: "being",
  };
}
