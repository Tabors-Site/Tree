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
// Custodial: the home story holds the being's private key and signs on
// its behalf. The key lives only in this stack frame, never on the row,
// never logged. A being with no local key (a foreign cross-story
// actor, or a decrypt failure) seals UNSIGNED rather than failing the
// moment. I_AM is the story itself: it signs with the story key
// (storyIdentity), and because its id "i-am" is not a public key,
// verification routes to the story public key.

import { canonicalize } from "../fact/hash.js";
import log from "../../seedStory/log.js";

// The I_AM constant (seed/materials/being/seedBeings.js:26). Inlined to
// keep this past-layer module from importing materials at load time; it
// is a frozen doctrinal value.
const I_AM = "i-am";

function normHistory(b) {
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
    by:       act.by ?? null,       // the actor: the name whose key signs
    through:  act.through,          // the being the name acted through
    to:       act.to ?? null,
    story:  act.story ?? null,
    history:   normHistory(act.history),
    p:        act.p ?? null,
    factIds:  Array.isArray(factIds) ? [...factIds].map(String).sort() : [],
    time:     timeISO(act),
  };
}

/**
 * Load the private key (PEM) that signs for an actor, BEFORE the seal
 * transaction so the txn stays lean. Returns null for any actor with no
 * local key (foreign cross-story, missing/corrupt blob) — the seal
 * then proceeds unsigned. Never throws.
 */
export async function loadSigningKey(nameId, branch) {
  try {
    if (nameId === I_AM) {
      const { getStoryIdentity } = await import("../../storyIdentity.js");
      return getStoryIdentity().privateKey;     // story ed25519 PEM
    }
    const { isKeyId } = await import("../../materials/name/keys.js");
    if (!isKeyId(nameId)) return null;             // not a key-bearing Name
    const { loadProjection } = await import("../../materials/projections.js");
    const slot = await loadProjection("name", nameId, normHistory(branch));
    // The signing-session lock is NOT soul-type-gated — ALL Names are the
    // same (Tabor). It applies to PASSWORD-LOCKED Names, never by soul.
    const enc = slot?.state?.privateKeyEnc;
    if (!enc) return null;
    const { isPasswordLocked } = await import("../../materials/name/passwordKey.js");
    if (isPasswordLocked(enc)) {
      // The server canNOT decrypt a password-locked key; the decrypted PEM
      // lives only in the session (held by login). Not logged in / expired ->
      // null and the act seals UNSIGNED until the next login. real-name +
      // password are optional; the holder may also act with the raw pk.
      const { getSigningKey, touchSigning } =
        await import("../../materials/name/signingSession.js");
      const sessionKey = getSigningKey(nameId);
      if (!sessionKey) return null;
      touchSigning(nameId);
      return sessionKey;
    }
    // System-encrypted: the server holds the key and signs automatically.
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
  if (pem === undefined) pem = await loadSigningKey(actDoc.by, actDoc.history);
  if (!pem) return null;
  try {
    const { signAsName } = await import("../../materials/name/keys.js");
    const value = signAsName(pem, buildActSigPayload(actDoc, factIds));
    return { alg: "ed25519", by: actDoc.by, value };
  } catch (err) {
    log.warn("Stamped", `signing failed for act ${String(actDoc?._id || "").slice(0, 8)}: ${err.message}`);
    return null;
  }
}

/**
 * Verify an act's signature self-certifyingly. Rebuilds the payload from
 * the act row + the committed facts (the single source of truth for the
 * fact set), then checks the signature against the signer's public key,
 * which is the signer id itself for beings (no directory) or the story
 * key for I_AM.
 *
 * @returns {Promise<{ok: boolean, reason: string}>}
 */
export async function verifyActSig(act, { localStory = null } = {}) {
  const sig = act?.sig;
  const by = sig?.by;
  if (!sig?.value) {
    // Unsigned. A LOCAL act by a key-bearing being should be signed; a
    // foreign cross-story act is verified on its home substrate.
    const foreign = localStory != null && act?.story != null && act.story !== localStory;
    return { ok: foreign, reason: foreign ? "foreign-unsigned-ok" : "unsigned" };
  }
  const { default: Fact } = await import("../fact/fact.js");
  const rows = await Fact.find({ actId: String(act._id) }).select("_id").lean();
  const factIds = rows.map((f) => String(f._id)).sort();
  const payload = buildActSigPayload(act, factIds);

  if (by === I_AM) {
    const { getStoryIdentity } = await import("../../storyIdentity.js");
    const { verifyWithPublicKeyPem } = await import("../../materials/name/keys.js");
    return {
      ok: verifyWithPublicKeyPem(getStoryIdentity().publicKey, payload, sig.value),
      reason: "i-am",
    };
  }
  const { isKeyId, verifyNameSig } = await import("../../materials/name/keys.js");
  if (isKeyId(by)) {
    return { ok: verifyNameSig(by, payload, sig.value), reason: "being" };
  }
  return { ok: false, reason: "unknown-signer" };
}

// ── cross-story envelope signature ──
//
// Where the act-sig above proves a being authored an act WITH its facts on
// its home chain, the envelope-sig proves the being authored the cross-
// story REQUEST it sends to a foreign story: exactly this verb, on this
// address, with this payload, tied to its home act. The receiving story
// verifies it self-certifyingly against the actor's beingId (which IS the
// pubkey), with NO callback to the actor's home story. That self-
// certification is what lets a being run its own tiny story, hold its own
// key, and act anywhere: every venue proves it is them without asking home.
//
// The wire body is ALSO signed at the story level (canopy X-Canopy-
// Signature over the raw bytes), so a present-but-absent envelope-sig can't
// be stripped by a man-in-the-middle without breaking the story sig. An
// absent envelope-sig therefore means "the home story vouched but did not
// supply the being's own sig" — accepted in advisory mode for peers that
// don't sign yet; a PRESENT sig that fails is a hard refusal.

/**
 * The canonical bytes a cross-story envelope-sig attests to. `kind`
 * domain-separates it from an act-sig so neither can be replayed as the
 * other. Same serializer both sides use.
 *
 * `time` is the signing moment (ISO). It rides the wire as beingSig.time
 * and is BOUND into the signature, so a captured being-sig cannot be
 * re-wrapped in a fresh canopy body and replayed outside its freshness
 * window. The canopy-level signedAt only proves the WRAPPER is fresh
 * (the peer story signs that); this proves the DEED is fresh (the
 * being signs this).
 */
export function buildEnvelopeSigPayload({ verb, address, payload, nameId, actId, branch, story, time }) {
  return {
    kind:    "cross-story-envelope",
    verb:    verb || null,
    address: address || null,
    payload: payload ?? null,
    // The SIGNER is the NAME (an ed25519 pubkey id), not the being it acts
    // through — so a foreign actor's cross-world deed verifies self-certifyingly
    // against the name it controls. (Was beingId before the Name/Being split.)
    nameId:  nameId || null,
    actId:   actId || null,
    branch:  normHistory(branch),
    story: story || null,
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
 * Sign a cross-story envelope with the actor's preloaded key (from
 * loadSigningKey). Returns { alg, by, value } or null (keyless/anonymous
 * actor — the call still forwards, accepted under the story-level canopy
 * sig). Never throws: an unsignable cross-call must not be blocked.
 *
 * @param {object} env  { verb, address, payload, beingId, actId, branch, story }
 * @param {string|null} pem  the actor's private key PEM (preloaded)
 */
export async function signEnvelopeBeingSig(env, pem) {
  if (pem === undefined) pem = await loadSigningKey(env.nameId, env.branch);
  if (!pem) return null;
  try {
    const { signAsName } = await import("../../materials/name/keys.js");
    const time = new Date().toISOString();
    const value = signAsName(pem, buildEnvelopeSigPayload({ ...env, time }));
    return { alg: "ed25519", by: env.nameId, value, time };
  } catch (err) {
    log.warn("CrossWorld", `envelope signing failed for ${String(env?.nameId || "").slice(0, 10)}: ${err.message}`);
    return null;
  }
}

/**
 * Verify a cross-story envelope-sig self-certifyingly. The actor tuple's
 * NAME (nameId) is the source of truth (it also drives crossOrigin's signer),
 * so the sig is checked against env.nameId, NOT against beingSig.by — the sig
 * must be the actor's own name. nameId IS an ed25519 key id, so the pubkey is
 * recovered straight from it (no directory, no callback home). Returns { ok, reason }:
 *   - no sig         → ok:true  "unsigned-advisory"   (story sig vouched)
 *   - non-key actor  → ok:true  "non-key-signer"      (i-am / anon; story sig vouches)
 *   - key actor      → verified against env.nameId
 * A PRESENT sig that fails is a hard ok:false.
 *
 * @param {object} env       same shape as signEnvelopeBeingSig's env
 * @param {object|null} beingSig  { alg, by, value, time }
 */
export async function verifyEnvelopeBeingSig(env, beingSig) {
  if (!beingSig?.value) return { ok: true, reason: "unsigned-advisory" };
  const { isKeyId, verifyNameSig } = await import("../../materials/name/keys.js");
  const by = env?.nameId;
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
    ok: verifyNameSig(by, buildEnvelopeSigPayload({ ...env, time: beingSig.time }), beingSig.value),
    reason: "being",
  };
}
