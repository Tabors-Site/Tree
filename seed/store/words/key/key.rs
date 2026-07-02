// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// key.rs — the floor see-ops for key.word's key-export slice (keyHost.js). key-export is WORD-SOLE:
// key.word IS the op; the CONTROL strand (resolve the Name off the being target, the DOUBLE GATE, the
// §7 return) is the `.word`; the genuine COMPUTATION (the crypto reads) is the host floor here.
//
//   load-key(owner)        (keyHost.js load-key -> actSig.loadSigningKey): THE authoritative key
//       reader, the SAME one the seal signs with. For `i-am` it is the STORY private key (read from
//       .story/story.key — substrate, reproducible). For a password-LOCKED Name it is the in-session
//       decrypted PEM (held ONLY in the live signing session from the login unlock — the server cannot
//       decrypt it; null when not connected). For a SYSTEM-encrypted Name it is decryptCredential(enc)
//       (non-reproducible AES over the live JWT_SECRET key). So:
//         - the SUBSTRATE half is the read of the Name's `privateKeyEnc` from the library catalog
//           (is the Name key-bearing at all? is it password-locked?);
//         - the non-reproducible half (the in-session PEM / the AES decrypt / the story key load) is
//           DEFERRED to the seal — the see returns the load SPEC, never the raw private key.
//       SEE vs SEAL: the see returns { nameId, isI, locked, hasEnc, deferred:"load-key" } — a
//       reproducible read of the key's SHAPE; the seal binds the actual `privateKey` PEM. The .word's
//       `If privateKey, the key is found.` reads the seal's value. (The be:birth credential deferral.)
//
//   paper-form(privateKey)  (keyHost.js paper-form -> entropyToMnemonic(seedFromPrivateKeyPem(pem))):
//       the key's 32-byte seed as 24 BIP39 words. DETERMINISTIC from a PEM (treesign::seed_from_pkcs8_
//       pem -> seed_to_mnemonic, byte-identical: the 24-word entropy IS the 32-byte seed, never
//       to_seed()). BUT its INPUT is `privateKey` — the load-key value that DEFERS to the seal — so the
//       PEM is not in the see's hand. paper-form therefore also DEFERS: the see returns
//       { deferred:"paper-form" } and the seal runs the deterministic mnemonic derivation once the key
//       is loaded. The derivation itself is reproducible (composed via treesign); only its INPUT is the
//       deferred private key, so the split is INPUT-driven, not crypto-secrecy-driven.
//
// Composes the toolkit name catalog (the privateKeyEnc read) + treesign (the deterministic mnemonic,
// for the seal) — it reimplements no crypto and lays no fact: each is a READ.

use std::path::Path;

use treehash::Json;

use crate::toolkit::{get, get_str, is_i_name, jstr, load_name_entry, obj};
use crate::{arg, AuthCtx, HostError};

// ── isPasswordLocked (name/passwordKey.js): a `privateKeyEnc` that is the password-locked sentinel ──
/// The JS `isPasswordLocked(enc)`: a password-locked key blob is the tagged form the server CANNOT
/// decrypt (the PEM lives only in the session). The blob carries the `password` scheme tag; a system-
/// encrypted blob does not. The bridge reads the tag SHAPE (the substrate discriminator); the actual
/// decrypt/session-load is the seal's. An object with `{ scheme:"password" }` / a string with the
/// `password:` prefix is locked.
fn is_password_locked(enc: &Json) -> bool {
    match enc {
        Json::Obj(_) => matches!(get_str(enc, "scheme"), Some("password")),
        Json::Str(s) => s.starts_with("password:") || s.starts_with("scrypt$"),
        _ => false,
    }
}

// ── load-key (keyHost.js load-key) ──────────────────────────────────────────────────────────────────
/// load-key(owner) -> the load SPEC (the see does NOT load the raw key). Reads the substrate SHAPE of
/// the owner Name's signing key and DEFERS the non-reproducible load (the in-session PEM / the AES
/// decrypt / the story key) to the seal.
///
/// The SUBSTRATE read:
///   - `i-am` / "I" -> the story key (isI:true; the seal reads .story/story.key);
///   - a key-bearing Name -> the library catalog entry's `privateKeyEnc` (hasEnc), and whether it is
///     password-LOCKED (locked: the server cannot decrypt -> the seal reads the live session).
/// REPRODUCIBLE: it returns only the shape, no key material. The seal binds the actual `privateKey`.
pub fn load_key(
    root: &Path,
    _history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let owner = match arg(args, 0) {
        Json::Str(s) if !s.is_empty() => s.as_str(),
        // No owner -> the .word already refused upstream ("no Name to export"); inert spec.
        _ => return Ok(load_spec(false, false, false)),
    };

    if is_i_name(owner) {
        // The story (I) key. (key.word's DOUBLE GATE refuses exporting it THROUGH a being before this,
        // but load-key still classifies it; the seal would read the story key.)
        return Ok(obj(vec![
            ("nameId", jstr(owner)),
            ("isI", Json::Bool(true)),
            ("locked", Json::Bool(false)),
            ("hasEnc", Json::Bool(true)),
            ("deferred", jstr("load-key")),
        ]));
    }

    // A key-bearing Name: read its catalog entry's privateKeyEnc (the encrypted private key at rest).
    let entry = load_name_entry(root, owner);
    let enc = get(&entry, "privateKeyEnc")
        .filter(|v| !matches!(v, Json::Null))
        .cloned()
        .unwrap_or(Json::Null);
    let has_enc = !matches!(enc, Json::Null);
    let locked = has_enc && is_password_locked(&enc);
    Ok(obj(vec![
        ("nameId", jstr(owner)),
        ("isI", Json::Bool(false)),
        ("locked", Json::Bool(locked)),
        ("hasEnc", Json::Bool(has_enc)),
        ("deferred", jstr("load-key")),
    ]))
}

/// The inert load spec (no Name / no key) — hasEnc false, the .word's `If privateKey` fails.
fn load_spec(is_i: bool, locked: bool, has_enc: bool) -> Json {
    obj(vec![
        ("nameId", Json::Null),
        ("isI", Json::Bool(is_i)),
        ("locked", Json::Bool(locked)),
        ("hasEnc", Json::Bool(has_enc)),
        ("deferred", jstr("load-key")),
    ])
}

// ── paper-form (keyHost.js paper-form) ──────────────────────────────────────────────────────────────
/// paper-form(privateKey) -> the mnemonic SPEC (DEFERRED). The derivation is deterministic
/// (treesign::seed_from_pkcs8_pem -> seed_to_mnemonic: the 24-word entropy IS the 32-byte seed), but
/// its INPUT `privateKey` is the load-key value that DEFERS to the seal, so the PEM is not in the see's
/// hand. The see returns { deferred:"paper-form" }; the seal runs the deterministic derivation once the
/// key is loaded (PEM-only / non-seed-derivable keys yield null, matching the JS try/catch-to-null).
///
/// (If a future wiring threads the resolved PEM into the see directly — a reproducible value — this
/// resolver can compose treesign verbatim: `seed_to_mnemonic(&seed_from_pkcs8_pem(pem)?)`. Today the
/// PEM is a seal-deferred secret, so the split is INPUT-driven.)
pub fn paper_form(
    _root: &Path,
    _history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    // If the caller DID thread a real PEM string (a direct-bridge reproducible call), derive it now —
    // the derivation is pure (treesign). Else return the deferred spec (the wired path: the PEM is the
    // seal's load-key value, not in hand here).
    match arg(args, 0) {
        Json::Str(pem) if pem.contains("PRIVATE KEY") => {
            match treesign::seed_from_pkcs8_pem(pem) {
                Ok(seed) => Ok(jstr(&treesign::seed_to_mnemonic(&seed))),
                Err(_) => Ok(Json::Null), // PEM-only / not seed-derivable (JS try/catch -> null).
            }
        }
        _ => Ok(obj(vec![("deferred", jstr("paper-form"))])),
    }
}
