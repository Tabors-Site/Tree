// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The key-load adapter - read a PKCS8 ed25519 PEM and recover the 32-byte SEED
// the rest of treesign signs from. The on-disk story key (`.story/story.key`)
// is a PKCS8 ed25519 PRIVATE KEY PEM, the exact form Node
// `crypto.generateKeyPairSync("ed25519").privateKey.export({type:"pkcs8",
// format:"pem"})` writes. ed25519 private material IS a 32-byte seed; PKCS8
// wraps it as a fixed 16-byte DER prefix followed by the raw 32-byte seed
// (the 48-byte DER = `302e020100300506032b657004220420` || seed). So the seed
// is just the trailing 32 bytes of the base64-decoded DER body.
//
// This is the inverse of the PKCS8 IMPORT keys.js does (it wraps a seed in the
// same fixed prefix to hand Node a key); here we UNWRAP a Node-written key back
// to the seed `keypair_from_seed` rebuilds from, so a Rust signer can sign with
// the very key the live JS story signs with - byte-identical, since the seed is
// identical. The public form (`.story/story.key.pub`, an SPKI PEM) is decoded
// by the conformance test's `read_ed25519_spki_pub`; this is its private peer.

use std::path::Path;

use base64::Engine;

/// The fixed PKCS8 DER prefix for an ed25519 private key: the SEQUENCE / version
/// / AlgorithmIdentifier(1.3.101.112 = ed25519) / OCTET STRING wrapper that
/// precedes the 32-byte seed. The full DER is exactly these 16 bytes followed by
/// the 32 seed bytes (48 bytes total). We match the prefix so a malformed or
/// wrong-curve PEM is refused rather than yielding a bogus seed.
const PKCS8_ED25519_PREFIX: [u8; 16] = [
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
];

/// The DER length of a PKCS8 ed25519 private key: the 16-byte prefix + 32 seed.
const PKCS8_ED25519_LEN: usize = 48;

/// Why a PEM could not be turned into a seed. Total-function decode (no panic);
/// the caller decides whether a bad story key is fatal.
#[derive(Debug)]
pub enum KeyFileError {
    /// The PEM body did not base64-decode.
    BadBase64,
    /// The decoded DER was not the 48-byte PKCS8 ed25519 shape (wrong length, or
    /// the fixed ed25519 prefix did not match - e.g. an RSA / P-256 key, or an
    /// SPKI public key handed in by mistake).
    NotPkcs8Ed25519,
    /// The key file could not be read.
    Io(std::io::Error),
}
impl From<std::io::Error> for KeyFileError {
    fn from(e: std::io::Error) -> Self {
        KeyFileError::Io(e)
    }
}
impl std::fmt::Display for KeyFileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            KeyFileError::BadBase64 => write!(f, "key PEM body is not valid base64"),
            KeyFileError::NotPkcs8Ed25519 => {
                write!(f, "not a 48-byte PKCS8 ed25519 private key (wrong length or prefix)")
            }
            KeyFileError::Io(e) => write!(f, "key file io: {e}"),
        }
    }
}
impl std::error::Error for KeyFileError {}

/// Strip the PEM armor, base64-decode the body, and return the 32-byte ed25519
/// seed (the trailing 32 bytes of the 48-byte PKCS8 DER). The fixed 16-byte
/// prefix is verified, so a non-ed25519 / non-PKCS8 PEM is a hard
/// `NotPkcs8Ed25519` rather than a silently-wrong seed.
///
/// Accepts the standard `-----BEGIN PRIVATE KEY-----` armor (and is tolerant of
/// any `-----`-fenced label / surrounding whitespace): every line that is not a
/// `-----` fence is treated as base64 body, mirroring the conformance test's
/// SPKI reader. This is the inverse of the PKCS8 wrap keys.js does on import.
pub fn seed_from_pkcs8_pem(pem: &str) -> Result<[u8; 32], KeyFileError> {
    let b64: String = pem
        .lines()
        .filter(|l| !l.trim_start().starts_with("-----"))
        .flat_map(|l| l.chars())
        .filter(|c| !c.is_whitespace())
        .collect();
    let der = base64::engine::general_purpose::STANDARD
        .decode(b64.as_bytes())
        .map_err(|_| KeyFileError::BadBase64)?;
    if der.len() != PKCS8_ED25519_LEN || der[..16] != PKCS8_ED25519_PREFIX {
        return Err(KeyFileError::NotPkcs8Ed25519);
    }
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&der[16..]);
    Ok(seed)
}

/// The inverse of `seed_from_pkcs8_pem`: wrap a 32-byte ed25519 seed as a PKCS8 `PRIVATE KEY` PEM (the
/// fixed 16-byte prefix || seed, base64'd, armored) — byte-identical to Node's
/// `privateKey.export({type:"pkcs8",format:"pem"})`. The 48-byte DER base64s to exactly 64 chars, so
/// the body is one line (matching the on-disk story key). Use this to render a Name's seed back to the
/// PEM the credential layer stores / `password_lock` locks / `paper_form` reads — no hand-rolled base64.
pub fn seed_to_pkcs8_pem(seed: &[u8; 32]) -> String {
    let mut der = Vec::with_capacity(PKCS8_ED25519_LEN);
    der.extend_from_slice(&PKCS8_ED25519_PREFIX);
    der.extend_from_slice(seed);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&der);
    format!("-----BEGIN PRIVATE KEY-----\n{b64}\n-----END PRIVATE KEY-----\n")
}

/// Read `<story_dir>/story.key` and decode it to the 32-byte ed25519 seed. The
/// story key is the custodial key I (the story) signs every act with; loading
/// its seed lets a Rust seal produce the byte-identical signature the live JS
/// story produces (same seed + same canonical payload = same 64 ed25519 bytes).
pub fn load_story_seed(story_dir: &Path) -> Result<[u8; 32], KeyFileError> {
    let pem = std::fs::read_to_string(story_dir.join("story.key"))?;
    seed_from_pkcs8_pem(&pem)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keypair_from_seed;

    // The live story key, inlined (the same PEM that sits at .story/story.key).
    // Its PKCS8 seed is the trailing 32 bytes of the 48-byte DER.
    const STORY_KEY_PEM: &str = "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIPBVePC0kBPjX/oQQdOdBjMU5YZr1/okpVVcbQ3CGHvM\n-----END PRIVATE KEY-----\n";
    // The seed that decodes to (the trailing 32 bytes of the DER above).
    const STORY_SEED_HEX: &str =
        "f05578f0b49013e35ffa1041d39d063314e5866bd7fa24a5555c6d0dc2187bcc";
    // The raw ed25519 PUBLIC key that seed derives to (== .story/story.key.pub).
    const STORY_PUB_HEX: &str =
        "d2381d26e35ec37c915220dca280dceb047a435d46096a9318cfd16adfced7f0";

    fn hex32(h: &str) -> [u8; 32] {
        let mut out = [0u8; 32];
        for i in 0..32 {
            out[i] = u8::from_str_radix(&h[i * 2..i * 2 + 2], 16).unwrap();
        }
        out
    }

    #[test]
    fn decodes_the_story_key_seed_and_pub() {
        let seed = seed_from_pkcs8_pem(STORY_KEY_PEM).expect("story PEM decodes");
        assert_eq!(seed, hex32(STORY_SEED_HEX), "trailing 32 DER bytes are the seed");
        // and that seed derives the on-disk story public key (the SPKI .pub).
        let kp = keypair_from_seed(&seed);
        assert_eq!(kp.raw_pub, hex32(STORY_PUB_HEX), "seed -> the story pubkey");
    }

    #[test]
    fn seed_to_pem_round_trips_and_byte_matches_node() {
        let seed = hex32(STORY_SEED_HEX);
        // byte-identical to Node's PKCS8 export (the inline story key PEM is Node-written).
        assert_eq!(seed_to_pkcs8_pem(&seed), STORY_KEY_PEM);
        // round-trip: seed -> PEM -> seed for arbitrary seeds.
        let s2 = [7u8; 32];
        assert_eq!(seed_from_pkcs8_pem(&seed_to_pkcs8_pem(&s2)).unwrap(), s2);
    }

    #[test]
    fn rejects_non_pkcs8_ed25519() {
        // an SPKI PUBLIC key PEM (44-byte DER) is the wrong shape -> refused.
        let pub_pem = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA0jgdJuNew3yRUiDcooDc6wR6Q11GCWqTGM/Rat/O1/A=\n-----END PUBLIC KEY-----\n";
        assert!(matches!(seed_from_pkcs8_pem(pub_pem), Err(KeyFileError::NotPkcs8Ed25519)));
        // garbage body -> bad base64.
        assert!(matches!(seed_from_pkcs8_pem("-----BEGIN PRIVATE KEY-----\n!!!!\n-----END PRIVATE KEY-----"), Err(KeyFileError::BadBase64)));
        // right length, wrong prefix (RSA-ish first byte flipped) -> refused.
        let mut der = Vec::from(PKCS8_ED25519_PREFIX);
        der.extend_from_slice(&[0u8; 32]);
        der[5] = 0x06; // corrupt a prefix byte
        let bad = base64::engine::general_purpose::STANDARD.encode(&der);
        let bad_pem = format!("-----BEGIN PRIVATE KEY-----\n{bad}\n-----END PRIVATE KEY-----\n");
        assert!(matches!(seed_from_pkcs8_pem(&bad_pem), Err(KeyFileError::NotPkcs8Ed25519)));
    }
}
