// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The Name-id codec - byte-for-byte with keys.js (encodeKeyId / isKeyId /
// keyIdToPublicKey). A Name's id IS its ed25519 public key, encoded as the
// colon-free did:key multibase form:
//
//     id = "z" + base58btc(0xed01 || raw32)
//
// "z" is multibase base58btc; 0xed01 is the multicodec varint for ed25519-pub.
// Colon-free on purpose: ids flow through colon-delimited projection/reel/
// act-head keys, so a `did:tree:` prefix with colons would corrupt key parsing.
// The hand-rolled b58 in keys.js uses the Bitcoin/IPFS alphabet, which is
// exactly bs58's default alphabet, so the two encode/decode identically.

// multibase base58btc prefix.
const ID_PREFIX: char = 'z';
// multicodec varint of ed25519-pub (0xed) -> the two bytes 0xed 0x01.
const MULTICODEC_ED25519_PUB: [u8; 2] = [0xed, 0x01];

/// A valid id is "z" + base58btc(2-byte multicodec + 32-byte key) ~= 48 chars.
/// Cap before decoding: base58 decode is O(n^2) and is_key_id only checks the
/// leading "z", so an oversized id on an act row would otherwise force quadratic
/// CPU per verification (a cheap DoS). (keys.js MAX_KEY_ID_LEN)
pub const MAX_KEY_ID_LEN: usize = 64;

/// Encode a raw 32-byte ed25519 public key as a name/story id. (encodeKeyId)
pub fn encode_key_id(raw_pub: &[u8; 32]) -> String {
    let mut buf = Vec::with_capacity(2 + 32);
    buf.extend_from_slice(&MULTICODEC_ED25519_PUB);
    buf.extend_from_slice(raw_pub);
    let mut out = String::with_capacity(1 + 48);
    out.push(ID_PREFIX);
    out.push_str(&bs58::encode(buf).into_string());
    out
}

/// True when a string is one of our ed25519 key ids. (isKeyId)
///
/// Only checks the leading "z" and a length > 1, exactly like the JS - it is a
/// cheap pre-filter, NOT a full validity check (that is key_id_to_pubkey's job).
pub fn is_key_id(s: &str) -> bool {
    let mut chars = s.chars();
    chars.next() == Some(ID_PREFIX) && chars.next().is_some()
}

/// Recover the raw 32-byte ed25519 public key from a key id. Self-certifying.
/// Returns None on any decode/shape failure (the JS throws; the Rust callers
/// here want a total function, and verify_name_sig maps None -> false, which is
/// the same observable behavior as verifyNameSig's try/catch -> false).
///
/// (keyIdToPublicKey, returning the raw bytes rather than a KeyObject)
pub fn key_id_to_pubkey(key_id: &str) -> Option<[u8; 32]> {
    if !is_key_id(key_id) {
        return None;
    }
    // Cap BEFORE decoding (the DoS guard); keys.js caps on the full id length.
    if key_id.len() > MAX_KEY_ID_LEN {
        return None;
    }
    // Strip the "z" multibase prefix, then base58btc-decode the rest. `[1..]`
    // is a safe byte slice: ID_PREFIX 'z' is one ASCII byte (a char boundary).
    let body = &key_id[1..];
    let decoded = bs58::decode(body).into_vec().ok()?;
    // multicodec must be ed25519-pub (0xed 0x01), then exactly 32 key bytes.
    if decoded.len() != 2 + 32 || decoded[0] != 0xed || decoded[1] != 0x01 {
        return None;
    }
    let mut raw = [0u8; 32];
    raw.copy_from_slice(&decoded[2..]);
    Some(raw)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_shape() {
        // raw pub for seed 00..1f (the pinned conformance vector).
        let raw: [u8; 32] = [
            0x03, 0xa1, 0x07, 0xbf, 0xf3, 0xce, 0x10, 0xbe, 0x1d, 0x70, 0xdd, 0x18, 0xe7, 0x4b,
            0xc0, 0x99, 0x67, 0xe4, 0xd6, 0x30, 0x9b, 0xa5, 0x0d, 0x5f, 0x1d, 0xdc, 0x86, 0x64,
            0x12, 0x55, 0x31, 0xb8,
        ];
        let id = encode_key_id(&raw);
        assert_eq!(id, "z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd");
        assert!(is_key_id(&id));
        assert_eq!(key_id_to_pubkey(&id), Some(raw));
    }

    #[test]
    fn rejects_non_ids_and_oversize() {
        assert!(!is_key_id(""));
        assert!(!is_key_id("z"));
        assert!(!is_key_id("i-am"));
        assert!(is_key_id("zX")); // cheap pre-filter only, like the JS
        assert_eq!(key_id_to_pubkey("i-am"), None);
        // oversize id: leading "z" + 70 chars -> refused before the O(n^2) decode.
        let big = format!("z{}", "1".repeat(70));
        assert!(big.len() > MAX_KEY_ID_LEN);
        assert_eq!(key_id_to_pubkey(&big), None);
        // valid prefix, wrong multicodec (decodes, but not 0xed01) -> None.
        let not_ed = encode_key_id(&[0u8; 32]);
        assert!(key_id_to_pubkey(&not_ed).is_some()); // 0x00 key is still ed25519-tagged
                                                       // a body that base58-decodes to a non-ed multicodec:
        let wrong = format!("z{}", bs58::encode([0x12u8, 0x00, 1, 2, 3]).into_string());
        assert_eq!(key_id_to_pubkey(&wrong), None);
    }
}
