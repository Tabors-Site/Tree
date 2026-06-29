// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// credential.rs — the floor see-ops for the credential ops (credentialHost.js): the reset/read
// crypto slice. credential-reset.word + credential-read.word are WORD-SOLE; each control strand
// (resolve the target, the authority gate, the §7 return) is the `.word`; the genuine COMPUTATION
// (the crypto reads/mints) is the host floor this file ports.
//
//   reel-head-of(target)    (credential-reset): the target being's current reel HEAD seq on "0" —
//       the CHAIN POSITION a credential-reset stamps as tokensInvalidBefore (a seq, never a clock —
//       the time-purge's answer to "tokens from before the reset"). A pure SUBSTRATE read: it
//       composes treestore::read_reel_head. REPRODUCIBLE, so it runs in the see verbatim.
//
//   read-credential(target) (credential-read): read the target being's ENCRYPTED credential blob
//       (qualities.auth.credentialPlain) and DECRYPT it to the cleartext (AES-256-GCM over a
//       JWT_SECRET-HKDF key). The READ half (fold the being row, pluck the blob) is substrate; the
//       DECRYPT is non-reproducible crypto (it needs the live JWT_SECRET-derived key, which the Rust
//       spine does not hold). So the SEE returns the SPEC: { has, blob } — the encrypted blob the
//       caller-side seal decrypts (the be:birth credential deferral pattern: the see is INERT, the
//       crypto defers). The .word's `If plaintext, ...` then reads the decrypted value the seal binds.
//
//   mint-credential          (credential-reset): mint a FRESH keypair + ENCRYPT (scrypt password hash
//       + AES-encrypted plaintext + the decrypted cleartext for the return-reveal). NON-REPRODUCIBLE
//       (crypto.randomBytes(32) plaintext + random scrypt salt + random AES IV). Per the be:birth
//       credential deferral, the see does NOT mint — it returns the mint SPEC { deferred:"mint-
//       credential" } and the actual keypair+encryption defers to SEAL. The see stays reproducible.
//
// Composes treestore (reel head + reel read) + treefold (fold the being row) — it reimplements no
// crypto and lays no fact: each is a READ. The non-reproducible crypto is the seal's, never the see's.

use std::path::Path;

use treehash::Json;

use crate::toolkit::{get, get_str, jstr, obj};
use crate::{arg, AuthCtx, HostError};

// ── targetIdOf (_targetShape.js): normalize a {kind,id} / stance / bare-string target to its id ─────
/// The credential ops' `target` is the WORD-SOLE standard trigger, bound as `{kind:"being", id}` (the
/// `.word` runner's identity), but a direct-bridge caller may bind a bare id string. Both normalize to
/// the id the reel reads + the writes key on (the JS `targetIdOf`). null/non-id-shape -> empty (the
/// caller's gate refuses). A stance prefers spaceId then leafId.
pub(crate) fn target_id_of(target: &Json) -> String {
    match target {
        Json::Str(s) => s.clone(),
        Json::Obj(_) => {
            // Stance: chain + (spaceId | leafId).
            let has_chain = matches!(get(target, "chain"), Some(Json::Arr(_)));
            if has_chain {
                if let Some(s) = get_str(target, "spaceId").filter(|s| !s.is_empty()) {
                    return s.to_string();
                }
                if let Some(s) = get_str(target, "leafId").filter(|s| !s.is_empty()) {
                    return s.to_string();
                }
            }
            // Typed identity { kind, id }.
            // Typed identity { kind, id } -> String(id). A being id is always a string (a content
            // hash); a numeric id is normalized the JS `String(n)` way only as a safety net.
            match get(target, "id") {
                Some(Json::Str(s)) => s.clone(),
                Some(Json::Num(n)) if n.fract() == 0.0 => format!("{}", *n as i64),
                Some(Json::Num(n)) => format!("{n}"),
                _ => String::new(),
            }
        }
        _ => String::new(),
    }
}

// ── reel-head-of (credentialHost.js reel-head-of -> reelHeads.js readHead) ──────────────────────────
/// reel-head-of(target) -> the target being's current reel HEAD seq on "0" (a number). The chain
/// position a credential-reset stamps as `tokensInvalidBefore`. Composes treestore::read_reel_head
/// (the `.head` of the being's reel-head pointer; `|| 0` when the reel has no head). PURE SUBSTRATE
/// read — reproducible, so it runs in the see exactly as the JS host did. No clock (the time-purge).
pub fn reel_head_of(
    root: &Path,
    _history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let id = target_id_of(arg(args, 0));
    if id.is_empty() {
        // JS readHead returns 0 for an empty/non-string id.
        return Ok(Json::Num(0.0));
    }
    // The JS host pins "0" (`{ history: "0" }`): the being's reel head lives on main, the revocation
    // axis (verifyTokenStrict reads tokensInvalidBefore against the main head). Never the act history.
    let head = treestore::read_reel_head(root, "0", "being", &id);
    Ok(Json::Num(head.head))
}

// ── read-credential (credentialHost.js read-credential) ─────────────────────────────────────────────
/// read-credential(target) -> { has, blob }: the SPEC of the target being's encrypted credential. The
/// JS host folded the being row, plucked `qualities.auth.credentialPlain`, and DECRYPTED it to the
/// cleartext. The READ half (fold + pluck) is substrate; the DECRYPT is non-reproducible crypto (the
/// AES key is HKDF'd from the live JWT_SECRET the Rust spine does not hold). So the see returns the
/// encrypted BLOB (the read) + `has` (the gate the .word's `If plaintext` keys on); the SEAL decrypts.
///
/// SEE vs SEAL: the see is INERT — it returns { has, blob } (reproducible: it is just the stored
/// ciphertext). The seal decrypts `blob` -> the cleartext the .word's `plaintext` return carries (the
/// dispatcher's audit strips it, rule 7). This is the be:birth credential deferral: the see returns
/// the spec, the crypto effect defers to the seal.
pub fn read_credential(
    root: &Path,
    _history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let id = target_id_of(arg(args, 0));
    if id.is_empty() {
        return Ok(obj(vec![("has", Json::Bool(false)), ("blob", Json::Null)]));
    }
    // The being's credential lives on main ("0"): credentials are story-global, never per-branch (the
    // JS loadTargetRow folds the being; the credential namespace is not branch-shadowed).
    let row = crate::toolkit::load_row(root, "0", "being", &id);
    let blob = get(&row, "qualities")
        .and_then(|q| get(q, "auth"))
        .and_then(|a| get(a, "credentialPlain"))
        .filter(|v| crate::toolkit::is_nonempty_str(v))
        .cloned()
        .unwrap_or(Json::Null);
    let has = !matches!(blob, Json::Null);
    Ok(obj(vec![
        ("has", Json::Bool(has)),
        ("blob", blob),
        // The seal performs `decryptCredential(blob)` to surface the cleartext the .word returns.
        ("deferred", jstr("decrypt-credential")),
    ]))
}

// ── mint-credential (credentialHost.js mint-credential -> mintCredentialSpec + decryptCredential) ────
/// mint-credential -> the mint SPEC (the see does NOT mint). The JS host minted a fresh credential
/// (`mintCredentialSpec(null)`: a 32-byte random plaintext, a scrypt password `hash`, an AES-encrypted
/// `plain` blob) and decrypted it once for the return-reveal. ALL of that is NON-REPRODUCIBLE crypto
/// (crypto.randomBytes(32) plaintext + a random scrypt salt + a random AES IV).
///
/// SEE vs SEAL (the be:birth pattern): a resolver READ must be reproducible, so the see does NOT mint
/// here. It returns the mint SPEC `{ deferred:"mint-credential" }`; the SEAL performs the actual
/// `mintCredentialSpec` (the keypair + encryption) and binds `credential.hash` / `credential.plain` /
/// `credential.plaintext` the .word's three set-being writes + the return-reveal read. The see stays
/// INERT (no random bytes, no key material) — exactly the credential deferral be:birth makes.
pub fn mint_credential(
    _root: &Path,
    _history: &str,
    _args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    // The mint SPEC: the seal performs mintCredentialSpec(null) and binds { hash, plain, plaintext }.
    // The see carries NO secret material (reproducible / inert).
    Ok(obj(vec![("deferred", jstr("mint-credential"))]))
}
