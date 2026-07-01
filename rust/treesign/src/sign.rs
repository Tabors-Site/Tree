// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// ed25519 sign/verify + keypair-from-seed - byte-for-byte with keys.js
// (signAsName / verifyNameSig / verifyWithPublicKeyPem / keypairFromSeed).
//
// The message signed is ALWAYS treehash::canonicalize(payload) as UTF-8 bytes,
// the same serializer facts use, so signer and verifier produce byte-identical
// input. The signature is raw / pure ed25519 (RFC 8032, NO pre-hash), which is
// exactly what Node's `crypto.sign(null, msg, ed25519key)` produces for an
// ed25519 key (the `null` algorithm = "the curve is the algorithm", PureEdDSA).
// ed25519 is deterministic, so the same seed + same payload yields the same 64
// bytes on every host -> the base64 is byte-identical to signAsName's.
//
// An ed25519 private key IS a 32-byte seed. `SigningKey::from_bytes(&seed)`
// derives the keypair from that seed exactly as the PKCS8 import does in JS
// (PKCS8 = the fixed 16-byte DER prefix || the 32-byte seed), so the same seed
// gives the same key and the same name id everywhere.

use base64::Engine;
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};

use crate::nameid::{encode_key_id, key_id_to_pubkey};
use crate::payload::{build_act_sig_payload, build_act_sig_payload_legacy, build_moment_proof_payload};
use treehash::{canonicalize, parse, Json};

/// A name keypair rebuilt from a seed: the 32-byte seed, the raw 32-byte public
/// key, and the name id (the did:key form of the public key). Mirrors the JS
/// keypairFromSeed return ({ publicKeyPem, privateKeyPem, nameId }) but in the
/// raw/seed forms Rust uses; the nameId is the byte-identical field.
#[derive(Clone, Debug)]
pub struct Keypair {
    /// The 32-byte ed25519 seed (the private key proper).
    pub seed: [u8; 32],
    /// The raw 32-byte ed25519 public key.
    pub raw_pub: [u8; 32],
    /// The name id: "z" + base58btc(0xed01 || raw_pub).
    pub name_id: String,
}

/// Rebuild the full keypair (and its id) from a 32-byte seed. Deterministic:
/// same seed -> same key -> same name_id, on any host. (keypairFromSeed)
pub fn keypair_from_seed(seed: &[u8; 32]) -> Keypair {
    let sk = SigningKey::from_bytes(seed);
    let raw_pub = sk.verifying_key().to_bytes();
    let name_id = encode_key_id(&raw_pub);
    Keypair {
        seed: *seed,
        raw_pub,
        name_id,
    }
}

/// Sign a canonical-JSON payload with a name's seed. The payload string is
/// parsed, canonicalized (the shared treehash serializer), and the resulting
/// UTF-8 bytes are signed raw-ed25519; the 64-byte signature is base64-encoded.
/// (signAsName, taking the seed instead of a PEM and the payload as JSON text.)
///
/// Returns None only if `payload_json` is not parseable JSON; the JS takes an
/// already-parsed object, so a well-formed caller never hits the None.
pub fn sign_payload(seed: &[u8; 32], payload_json: &str) -> Option<String> {
    let value = parse(payload_json).ok()?;
    Some(sign_value(seed, &value))
}

/// Sign an already-parsed payload value. The lower-level entry the seal uses
/// when it already holds the Json (no re-parse): canonicalize -> raw-ed25519
/// sign -> base64.
pub fn sign_value(seed: &[u8; 32], payload: &Json) -> String {
    let sk = SigningKey::from_bytes(seed);
    let msg = canonicalize(payload);
    let sig: Signature = sk.sign(msg.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(sig.to_bytes())
}

/// Verify a signature against a name id (which IS the public key). Self-
/// certifying: the key is decoded straight from the id, no directory. Returns
/// false on any decode/verify failure rather than throwing. (verifyNameSig)
pub fn verify_name_sig(name_id: &str, payload_json: &str, sig_b64: &str) -> bool {
    match key_id_to_pubkey(name_id) {
        Some(raw_pub) => verify_with_pubkey_str(&raw_pub, payload_json, sig_b64),
        None => false,
    }
}

/// Verify a signature against a raw 32-byte ed25519 public key, NOT a key id.
/// Used where the signer's id is not its public key: I, whose id is the literal
/// "i-am" and whose key is the story key. Same canonicalizer as sign, so the
/// two are symmetric. (verifyWithPublicKeyPem, taking the raw pub bytes.)
pub fn verify_with_pubkey(raw_pub: &[u8; 32], payload_json: &str, sig_b64: &str) -> bool {
    verify_with_pubkey_str(raw_pub, payload_json, sig_b64)
}

/// Verify an act's signature against a raw public key, TRYING THE PURE PAYLOAD
/// FIRST and falling back to the LEGACY (wall-clock-carrying) payload only if the
/// pure one fails. This is the READ path: it transparently accepts BOTH new pure
/// Rust acts (clock-free, NO `time`) AND pre-existing JS-signed acts (which baked
/// the act's wall-clock `at` into the sig as `time`), while SIGNING is ALWAYS
/// pure (new acts never use the legacy shape). The pure-vs-legacy split is the
/// `time` field alone (see payload.rs).
///
/// `act` + `fact_ids` are rebuilt into the canonical payload here (the caller
/// does not pre-build it): pure via `build_act_sig_payload`, legacy via
/// `build_act_sig_payload_legacy`. `raw_pub` is the signer's 32-byte ed25519 key
/// - for a Name-signed act that is `key_id_to_pubkey(sig.by)`; for a story
/// "i-am" act it is the story public key (resolved by the caller, since "i-am"
/// is not a pubkey id).
///
/// Returns true on the FIRST shape that verifies (pure preferred), false if
/// neither does. A new Rust act verifies on the pure attempt and never builds the
/// legacy payload at all; an old JS act fails pure and verifies on the legacy
/// fallback - the one place the wall-clock-bearing shape is still honored.
pub fn verify_act_sig(
    raw_pub: &[u8; 32],
    act: &Json,
    fact_ids: &[String],
    sig_b64: &str,
) -> bool {
    // PURE first (the going-forward, clock-free shape). New Rust acts land here.
    let pure = build_act_sig_payload(act, fact_ids);
    if verify_value(raw_pub, &pure, sig_b64) {
        return true;
    }
    // LEGACY fallback (the old JS shape with the wall-clock `time`). ONLY old
    // JS-signed acts that baked `at` into the sig reach this; new acts never do.
    let legacy = build_act_sig_payload_legacy(act, fact_ids);
    verify_value(raw_pub, &legacy, sig_b64)
}

/// The Name-id peer of `verify_act_sig`: resolve the signer's public key from a
/// Name id (which IS the public key) and verify the act PURE-then-LEGACY. Returns
/// false if the id does not decode to a key (e.g. the literal "i-am", whose key
/// is the story key, not a pubkey id - use `verify_act_sig` with the story pubkey
/// for that). Same try-both read path as `verify_act_sig`: pure accepted first,
/// legacy only as a fallback for old JS acts.
pub fn verify_act_sig_by_name(
    name_id: &str,
    act: &Json,
    fact_ids: &[String],
    sig_b64: &str,
) -> bool {
    match key_id_to_pubkey(name_id) {
        Some(raw_pub) => verify_act_sig(&raw_pub, act, fact_ids, sig_b64),
        None => false,
    }
}

/// Sign the MOMENT KEY-PROOF: a Name proves its key AT THE MOMENT by signing the moment-request's
/// identity payload with its seed. The portal-side counterpart of `verify_moment_proof`; the returned
/// base64 is what the moment carries as its `proof.value`. (NEW — the auth-at-moment proof, clock-free.)
pub fn sign_moment_proof(seed: &[u8; 32], name_id: &str, req: &Json) -> String {
    sign_value(seed, &build_moment_proof_payload(name_id, req))
}

/// Verify a MOMENT KEY-PROOF: the key is recovered straight from `name_id` (the key IS the id) and the
/// signature is checked over the canonical moment-proof payload rebuilt from `req`. True only when the
/// Name itself signed THIS moment's identity — the auth gate that opens an authenticated session. Returns
/// false on any decode/verify failure (never panics). `I` is NOT a key id, so it never verifies here;
/// the story's custodial path is handled by the edge, not this proof.
pub fn verify_moment_proof(name_id: &str, req: &Json, sig_b64: &str) -> bool {
    match key_id_to_pubkey(name_id) {
        Some(raw_pub) => verify_value(&raw_pub, &build_moment_proof_payload(name_id, req), sig_b64),
        None => false,
    }
}

// ── internals ──

fn verify_with_pubkey_str(raw_pub: &[u8; 32], payload_json: &str, sig_b64: &str) -> bool {
    match parse(payload_json) {
        Ok(value) => verify_value(raw_pub, &value, sig_b64),
        Err(_) => false,
    }
}

fn verify_value(raw_pub: &[u8; 32], payload: &Json, sig_b64: &str) -> bool {
    let vk = match VerifyingKey::from_bytes(raw_pub) {
        Ok(vk) => vk,
        Err(_) => return false, // not a valid curve point
    };
    let sig_bytes = match base64::engine::general_purpose::STANDARD.decode(sig_b64) {
        Ok(b) if b.len() == 64 => b,
        _ => return false,
    };
    let mut arr = [0u8; 64];
    arr.copy_from_slice(&sig_bytes);
    let sig = Signature::from_bytes(&arr);
    let msg = canonicalize(payload);
    // verify_strict rejects the small-order / malleable edge cases Node's
    // crypto.verify also rejects, keeping the accept-set identical.
    vk.verify_strict(msg.as_bytes(), &sig).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    // The pinned JS vectors (refvec.mjs, seed 00..1f). See NOTES.md.
    const SEED: [u8; 32] = [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
        25, 26, 27, 28, 29, 30, 31,
    ];
    const NAME_ID: &str = "z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd";

    #[test]
    fn keypair_id_matches_js() {
        let kp = keypair_from_seed(&SEED);
        assert_eq!(kp.name_id, NAME_ID);
    }

    #[test]
    fn sign_then_verify_roundtrips() {
        let kp = keypair_from_seed(&SEED);
        let payload = r#"{"a":1,"b":"x"}"#;
        let sig = sign_payload(&SEED, payload).unwrap();
        assert!(verify_name_sig(&kp.name_id, payload, &sig));
        // tamper -> false
        assert!(!verify_name_sig(&kp.name_id, r#"{"a":2,"b":"x"}"#, &sig));
        // bad sig -> false (never panics)
        assert!(!verify_name_sig(&kp.name_id, payload, "not-base64!!"));
        assert!(!verify_name_sig("i-am", payload, &sig)); // non-key id
    }

    #[test]
    fn verify_with_raw_pub() {
        let kp = keypair_from_seed(&SEED);
        let payload = r#"{"hello":"world"}"#;
        let sig = sign_payload(&SEED, payload).unwrap();
        assert!(verify_with_pubkey(&kp.raw_pub, payload, &sig));
        assert!(!verify_with_pubkey(&[0u8; 32], payload, &sig));
    }

    // An act carrying a wall-clock `at`. New Rust signing ignores `at` (the PURE
    // payload is clock-free); the legacy shape folds `at` in as `time`.
    fn act_with_at() -> Json {
        parse(r#"{"_id":"abc","by":"i-am","through":"i-am","to":"i-am","story":"localhost","history":"0","p":"0000000000000000000000000000000000000000000000000000000000000000","at":"2026-06-25T13:01:25.361Z"}"#).unwrap()
    }

    #[test]
    fn verify_act_sig_accepts_pure_new_act() {
        // SIGN THE PURE PAYLOAD (the going-forward, clock-free shape) -> the read
        // path verifies it on the FIRST (pure) attempt, never touching legacy.
        let kp = keypair_from_seed(&SEED);
        let act = act_with_at();
        let fids = vec!["zeta".to_string(), "alpha".to_string()];
        let pure = build_act_sig_payload(&act, &fids);
        let sig = sign_value(&SEED, &pure);

        assert!(verify_act_sig(&kp.raw_pub, &act, &fids, &sig), "pure act verifies (pure attempt)");
        assert!(
            verify_act_sig_by_name(&kp.name_id, &act, &fids, &sig),
            "pure act verifies by Name id too"
        );
        // a wrong key fails both attempts.
        assert!(!verify_act_sig(&[0u8; 32], &act, &fids, &sig), "wrong key fails");
        // "i-am" is not a pubkey id, so the by-name peer cannot resolve a key.
        assert!(!verify_act_sig_by_name("i-am", &act, &fids, &sig), "i-am is not a key id");
    }

    #[test]
    fn moment_proof_roundtrips_and_binds_the_name() {
        // A Name signs a moment-request's identity; the edge verifies straight from the Name id.
        let kp = keypair_from_seed(&SEED);
        let req = parse(r#"{"verb":"moment","kind":"being","id":"zX","history":"0","actor":{"nameId":"ignored"}}"#).unwrap();
        let proof = sign_moment_proof(&SEED, &kp.name_id, &req);
        assert!(verify_moment_proof(&kp.name_id, &req, &proof), "the Name's own proof verifies");

        // a DIFFERENT moment (different reel) does NOT verify with the old proof (binds to the moment).
        let other = parse(r#"{"verb":"moment","kind":"being","id":"zY","history":"0"}"#).unwrap();
        assert!(!verify_moment_proof(&kp.name_id, &other, &proof), "proof binds to THIS moment's identity");

        // a proof for one Name cannot be claimed under another Name id (nameId is in the payload).
        let other_kp = keypair_from_seed(&[9u8; 32]);
        assert!(!verify_moment_proof(&other_kp.name_id, &req, &proof), "proof binds to the signing Name");

        // "I" is not a key id -> never verifies (the story uses the custodial edge path, not a proof).
        assert!(!verify_moment_proof("I", &req, &proof), "I is not a moment-proof key id");
        // garbage signature -> false, never panics.
        assert!(!verify_moment_proof(&kp.name_id, &req, "not-base64!!"));
    }

    #[test]
    fn verify_act_sig_accepts_legacy_js_act_via_fallback() {
        // SIGN THE LEGACY PAYLOAD (the OLD JS shape WITH `time`) -> the pure
        // attempt FAILS (no `time`), and the read path verifies it on the LEGACY
        // fallback. This is the one place the wall-clock-bearing shape is honored.
        let kp = keypair_from_seed(&SEED);
        let act = act_with_at();
        let fids = vec!["zeta".to_string(), "alpha".to_string()];
        let legacy = build_act_sig_payload_legacy(&act, &fids);
        let sig = sign_value(&SEED, &legacy);

        // the pure shape alone does NOT verify a legacy sig (proves the fallback is real).
        let pure_json = canonicalize(&build_act_sig_payload(&act, &fids));
        assert!(
            !verify_with_pubkey(&kp.raw_pub, &pure_json, &sig),
            "a legacy sig does NOT verify against the pure payload"
        );
        // but the try-both read path accepts it via the legacy fallback.
        assert!(
            verify_act_sig(&kp.raw_pub, &act, &fids, &sig),
            "legacy JS act verifies via the legacy fallback"
        );
        assert!(
            verify_act_sig_by_name(&kp.name_id, &act, &fids, &sig),
            "legacy act verifies by Name id too"
        );
    }
}
