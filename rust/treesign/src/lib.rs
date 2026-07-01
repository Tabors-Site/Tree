// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// treesign - the crypto, isolated. ALL of TreeOS's crypto lives here so the
// determinism spine (treehash -> treefold -> treeverify -> treestore ->
// treeproj) stays zero-dependency and the trust surface is one auditable place.
// Ported byte-for-byte from the JS:
//   seed/materials/name/keys.js   (the Name keys: a name is a wallet)
//   seed/past/act/actSig.js       (buildActSigPayload: what a seal signs)
//
// THE SCHEME (must stay byte-identical to the JS forever):
//   - ed25519 (RFC 8032). A Name's id IS its public key, encoded as the
//     colon-free did:key multibase form "z" + base58btc(0xed01 || raw32).
//     Self-certifying: verify straight from the id, no directory.
//   - Sign = ed25519-sign over treehash::canonicalize(payload) bytes, with NO
//     pre-hash (raw / pure ed25519), matching Node `crypto.sign(null, msg, key)`.
//     The 64-byte signature is then base64-encoded.
//   - An ed25519 private key IS a 32-byte seed. keypair_from_seed rebuilds the
//     keypair (and the id) from a seed deterministically on any host.
//   - I / the story signs with the story key; its id "i-am" is NOT a pubkey, so
//     verification routes to the raw story public key (verify_with_pubkey).
//
// NO WALL TIME (the time-purge, philosophy/crystalized.md). TIME is ORDER (the
// chain position p, the clock-free seq/ord), NEVER a wall-clock. The act-sig
// payload the Rust SIGNS + VERIFIES is CLOCK-FREE: build_act_sig_payload carries
// NO `time` field. verify_act_sig / verify_act_sig_by_name are the read path;
// they verify this one clock-free shape and nothing else.
//
// Public surface mirrors the JS:
//   encode_key_id(&[u8;32]) -> String           (keys.js encodeKeyId)
//   is_key_id(&str) -> bool                      (keys.js isKeyId)
//   key_id_to_pubkey(&str) -> Option<[u8;32]>    (keys.js keyIdToPublicKey, raw bytes)
//   keypair_from_seed(&[u8;32]) -> Keypair       (keys.js keypairFromSeed)
//   sign_payload(&[u8;32], &str) -> String       (keys.js signAsName, by seed)
//   verify_name_sig(name_id, &str, sig_b64)      (keys.js verifyNameSig)
//   verify_with_pubkey(&[u8;32], &str, sig_b64)  (keys.js verifyWithPublicKeyPem, by raw pub)
//   verify_act_sig(&[u8;32], &Json, &[String], sig)      read path: clock-free payload, by raw pub
//   verify_act_sig_by_name(name_id, &Json, &[String], sig)  the Name-id peer (key from the id)
//   build_act_sig_payload(&Json, &[String])      (actSig.js: NO wall-clock, clock-free)
//   mnemonic_to_seed(mnemonic, passphrase)       (mnemonic.js mnemonicToEntropy: entropy IS the seed)
//   seed_to_mnemonic(&[u8;32]) -> String          (mnemonic.js entropyToMnemonic)
//   generate_mnemonic() -> String                 (a fresh 24-word paper key, OS entropy)
//   keypair_from_mnemonic(mnemonic, passphrase)   (nameOps.js keypairFromSeed(mnemonicToEntropy(..)))
//   seed_from_pkcs8_pem(&str) -> Result<[u8;32]>  (the inverse of keys.js PKCS8 wrap: PEM -> seed)
//   load_story_seed(&Path) -> Result<[u8;32]>     (read .story/story.key, decode to the seed)
//
// THE BIP39 SEED RULE (a parity trap): the JS treats the raw 32-byte BIP39
// ENTROPY as the ed25519 seed DIRECTLY - NO PBKDF2 mnemonic-to-seed, NO
// passphrase salt, NO BIP32. mnemonic_to_seed mirrors this; it uses the bip39
// crate's to_entropy (the wordlist + sha256[0] checksum), NEVER its to_seed().
//
// re-exported from treehash for callers that build/parse the payload here:
//   Json, parse, canonicalize

mod credential;
mod jwt;
mod keyfile;
mod mnemonic;
mod nameid;
mod password_lock;
mod payload;
mod sign;

pub use keyfile::{load_story_seed, seed_from_pkcs8_pem, seed_to_pkcs8_pem, KeyFileError};
pub use mnemonic::{
    generate_mnemonic, keypair_from_mnemonic, mnemonic_to_seed, name_id_from_mnemonic,
    seed_to_mnemonic, MnemonicError,
};
pub use credential::{credential_key, decrypt_credential, encrypt_credential, hash_password, verify_password};
pub use jwt::{decode_jwt, sign_jwt_hs256, verify_jwt_hs256};
pub use nameid::{encode_key_id, is_key_id, key_id_to_pubkey, MAX_KEY_ID_LEN};
pub use password_lock::{decrypt_with_password, encrypt_with_password, is_password_locked};
pub use payload::{build_act_sig_payload, build_moment_proof_payload};
pub use sign::{
    keypair_from_seed, sign_moment_proof, sign_payload, sign_value, verify_act_sig,
    verify_act_sig_by_name, verify_moment_proof, verify_name_sig, verify_with_pubkey, Keypair,
};

// The canonicalizer + Json the sig is defined against. Re-exported so a caller
// (the seal, the conformance test) uses the EXACT same parser/serializer the
// signature bytes were produced over - never a second JSON path.
pub use treehash::{canonicalize, parse, Json};
