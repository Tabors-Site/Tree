// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// BIP39 paper-form of a Name seed - byte-for-byte with
// seed/materials/name/mnemonic.js (entropyToMnemonic / mnemonicToEntropy) and
// the key-import path in seed/ibp/nameOps.js + seed/materials/name/login.js
// (keypairFromSeed(mnemonicToEntropy(words))).
//
// THE ONE THING THAT MATTERS FOR PARITY: the JS treats the raw 32-byte BIP39
// ENTROPY as the ed25519 seed DIRECTLY. It does NOT run the standard BIP39
// "mnemonic-to-seed" PBKDF2-HMAC-SHA512 (which would stretch to 64 bytes), it
// does NOT salt with a passphrase, and it does NOT do BIP32/SLIP-0010 HD
// derivation. From mnemonic.js, verbatim:
//
//   "Deliberately NOT here: PBKDF2 mnemonic-to-seed stretching, passphrase
//    salting, BIP32 HD-wallet derivation. The entropy IS the key seed."
//
// So: mnemonic -> 32-byte entropy (the bip39 crate's to_entropy, NOT to_seed)
// -> keypair_from_seed. We use the `bip39` crate ONLY for the wordlist + the
// 11-bit codec + the sha256(entropy)[0] checksum (all byte-identical to the JS,
// proven by the conformance vectors below), and NEVER its to_seed().
//
// Constraints the JS enforces, mirrored here:
//   - Only the 24-word / 256-bit-entropy form is supported (ENTROPY_BYTES = 32,
//     WORD_COUNT = 24). 12/15/18/21-word mnemonics are rejected.
//   - Input is lower-cased and whitespace-collapsed before lookup
//     (JS: mnemonic.trim().toLowerCase().split(/\s+/)).
//   - The checksum (first 8 bits of sha256(entropy)) must verify.

use bip39::{Language, Mnemonic};

use crate::nameid::encode_key_id;
use crate::sign::{keypair_from_seed, Keypair};

/// Only the 24-word form is supported (256 entropy bits + an 8-bit checksum =
/// 264 bits = 24 groups of 11), exactly like mnemonic.js ENTROPY_BYTES = 32.
const ENTROPY_BYTES: usize = 32;
const WORD_COUNT: usize = 24;

/// What went wrong turning a mnemonic into a seed. The JS throws strings; the
/// Rust returns this so callers (headless genesis) can branch without unwinding.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MnemonicError {
    /// Not exactly 24 words (mnemonic.js: "must be exactly 24 words").
    WordCount(usize),
    /// A token is not in the canonical English wordlist.
    UnknownWord,
    /// The sha256(entropy)[0] checksum did not verify ("bad checksum").
    BadChecksum,
    /// The mnemonic decoded, but not to 32 bytes of entropy (defends the
    /// 24-word invariant even if the crate ever widened acceptance).
    BadEntropyLen(usize),
    /// A passphrase was supplied. The JS derivation has NO passphrase concept
    /// (no PBKDF2 salt), so a passphrase cannot change the seed - accepting one
    /// silently would mint a key the JS would never produce. Rejected on
    /// purpose so the asymmetry is loud, not a silent parity hole.
    PassphraseUnsupported,
    /// OS entropy was unavailable for generate_mnemonic.
    Entropy,
}

impl core::fmt::Display for MnemonicError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            MnemonicError::WordCount(n) => {
                write!(f, "mnemonic must be exactly {WORD_COUNT} words, got {n}")
            }
            MnemonicError::UnknownWord => write!(f, "unknown mnemonic word"),
            MnemonicError::BadChecksum => write!(f, "bad checksum"),
            MnemonicError::BadEntropyLen(n) => {
                write!(f, "entropy must be exactly {ENTROPY_BYTES} bytes, got {n}")
            }
            MnemonicError::PassphraseUnsupported => write!(
                f,
                "passphrase unsupported: the TreeOS seed derivation has no PBKDF2 passphrase (the entropy IS the seed)"
            ),
            MnemonicError::Entropy => write!(f, "OS entropy unavailable"),
        }
    }
}

impl std::error::Error for MnemonicError {}

/// Normalize a mnemonic string exactly as the JS does before word lookup:
/// `mnemonic.trim().toLowerCase().split(/\s+/).join(" ")`. The wordlist is pure
/// lowercase ASCII, so `to_lowercase()` and JS `toLowerCase()` agree byte-for-
/// byte on every token that could possibly match; `split_whitespace().join(" ")`
/// collapses runs of whitespace just like `split(/\s+/)` after a trim.
fn normalize(mnemonic: &str) -> String {
    mnemonic
        .trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// 24-word mnemonic -> the 32-byte ed25519 seed (the raw BIP39 entropy), with
/// checksum verification. Byte-for-byte with mnemonicToEntropy in mnemonic.js;
/// the returned bytes are what keypair_from_seed (keypairFromSeed) takes.
///
/// `passphrase` MUST be None or Some("") - the JS derivation has no passphrase
/// (the entropy IS the seed). A non-empty passphrase is an error, not a salt.
pub fn mnemonic_to_seed(
    mnemonic: &str,
    passphrase: Option<&str>,
) -> Result<[u8; 32], MnemonicError> {
    // The JS has no passphrase at all. Treat None / Some("") as "no passphrase"
    // (so callers can thread an Option through), and reject anything else loudly
    // rather than silently ignore it and hand back a key the JS never makes.
    if let Some(p) = passphrase {
        if !p.is_empty() {
            return Err(MnemonicError::PassphraseUnsupported);
        }
    }

    let normalized = normalize(mnemonic);

    // Enforce the JS 24-word rule up front, with the JS's exact word count
    // (the crate would also accept 12/15/18/21; we do not).
    let nb = normalized.split_whitespace().count();
    if nb != WORD_COUNT {
        return Err(MnemonicError::WordCount(nb));
    }

    // parse_in_normalized does the canonical-English 11-bit decode AND the
    // sha256(entropy)[0] checksum check - the same two steps mnemonic.js does.
    // We pass an already-lowercased/whitespace-collapsed string, matching the
    // JS preprocessing without pulling the crate's NFKD unicode-normalization
    // (the ASCII wordlist makes NFKD a no-op on any token that can match).
    let m = Mnemonic::parse_in_normalized(Language::English, &normalized).map_err(map_err)?;

    // Raw ENTROPY (NOT to_seed: no PBKDF2). For a 24-word mnemonic this is the
    // 32 bytes the keypair is built from directly.
    let entropy = m.to_entropy();
    if entropy.len() != ENTROPY_BYTES {
        return Err(MnemonicError::BadEntropyLen(entropy.len()));
    }
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&entropy);
    Ok(seed)
}

/// 32-byte entropy/seed -> its canonical 24-word mnemonic. Byte-for-byte with
/// entropyToMnemonic in mnemonic.js (256 entropy bits + the first 8 bits of
/// sha256(entropy) as the checksum, the canonical English wordlist).
pub fn seed_to_mnemonic(seed: &[u8; 32]) -> String {
    // from_entropy on 32 bytes cannot fail (32 is a valid BIP39 entropy length),
    // but we avoid unwrap-panicking in a library: an impossible Err degrades to
    // an empty string rather than aborting the host. (Never hit in practice.)
    match Mnemonic::from_entropy(seed) {
        Ok(m) => m.to_string(),
        Err(_) => String::new(),
    }
}

/// Mint a fresh 24-word mnemonic from OS entropy (the JS word count). Headless
/// genesis: this is the paper key for a brand-new Name. Round-trips through
/// mnemonic_to_seed back to the same 32 bytes.
pub fn generate_mnemonic() -> Result<String, MnemonicError> {
    let mut entropy = [0u8; 32];
    getrandom::getrandom(&mut entropy).map_err(|_| MnemonicError::Entropy)?;
    Ok(seed_to_mnemonic(&entropy))
}

/// mnemonic -> seed -> the full keypair (and its name id). The headless-genesis
/// entry: `keypair_from_seed(mnemonic_to_seed(mnemonic))`, the Rust of the JS
/// `keypairFromSeed(mnemonicToEntropy(words))` (nameOps.js / login.js).
pub fn keypair_from_mnemonic(
    mnemonic: &str,
    passphrase: Option<&str>,
) -> Result<Keypair, MnemonicError> {
    let seed = mnemonic_to_seed(mnemonic, passphrase)?;
    Ok(keypair_from_seed(&seed))
}

/// Convenience: the name id a mnemonic mints, without carrying the keypair.
/// Same value as `keypair_from_mnemonic(...).name_id`.
pub fn name_id_from_mnemonic(
    mnemonic: &str,
    passphrase: Option<&str>,
) -> Result<String, MnemonicError> {
    let kp = keypair_from_mnemonic(mnemonic, passphrase)?;
    // encode_key_id is already applied inside keypair_from_seed; this just
    // re-states the contract (id == did:key of the pubkey) for readers.
    debug_assert_eq!(kp.name_id, encode_key_id(&kp.raw_pub));
    Ok(kp.name_id)
}

fn map_err(e: bip39::Error) -> MnemonicError {
    match e {
        bip39::Error::BadWordCount(n) => MnemonicError::WordCount(n),
        bip39::Error::UnknownWord(_) => MnemonicError::UnknownWord,
        bip39::Error::InvalidChecksum => MnemonicError::BadChecksum,
        // BadEntropyBitCount / AmbiguousLanguages and any future variants are
        // not reachable on the 24-word English path we gate to, but map them to
        // a definite error rather than panicking.
        _ => MnemonicError::BadChecksum,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Captured from the JS (JWT_SECRET=test-0123456789 node mnref.mjs; see
    // NOTES.md "mnemonic conformance"). FIXED_MNEMONIC is the canonical 24-word
    // form of entropy 0x00..0x1f, so its seed IS that 0x00..0x1f and its name id
    // IS the pinned keys.js vector - tying the mnemonic path to the already-
    // proven keypair path.
    const FIXED_MNEMONIC: &str = "abandon amount liar amount expire adjust cage candy arch gather drum bullet absurd math era live bid rhythm alien crouch range attend journey unaware";
    const FIXED_SEED_HEX: &str =
        "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    const FIXED_NAME_ID: &str = "z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd";

    // A second JS-captured vector: entropy 0xff*32 -> "zoo ...x23 vote".
    const FIXED_MNEMONIC_B: &str =
        "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote";
    const FIXED_NAME_ID_B: &str = "z6MknSLrJoTcukLrE435hVNQT4JUhbvWLX4kUzqkEStBU8Vi";

    fn hex32(s: &str) -> [u8; 32] {
        let mut out = [0u8; 32];
        for (i, b) in out.iter_mut().enumerate() {
            *b = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap();
        }
        out
    }

    #[test]
    fn fixed_mnemonic_to_seed_matches_js() {
        let seed = mnemonic_to_seed(FIXED_MNEMONIC, None).unwrap();
        assert_eq!(seed, hex32(FIXED_SEED_HEX), "entropy IS the seed, no PBKDF2");
    }

    #[test]
    fn fixed_mnemonic_name_id_matches_js() {
        let id = name_id_from_mnemonic(FIXED_MNEMONIC, None).unwrap();
        assert_eq!(id, FIXED_NAME_ID);
        let id_b = name_id_from_mnemonic(FIXED_MNEMONIC_B, None).unwrap();
        assert_eq!(id_b, FIXED_NAME_ID_B);
    }

    #[test]
    fn seed_to_mnemonic_matches_js() {
        assert_eq!(seed_to_mnemonic(&hex32(FIXED_SEED_HEX)), FIXED_MNEMONIC);
        assert_eq!(seed_to_mnemonic(&[0xffu8; 32]), FIXED_MNEMONIC_B);
    }

    #[test]
    fn roundtrip_seed_mnemonic_seed() {
        // Several seeds round-trip seed -> words -> seed unchanged.
        for seed in [[0u8; 32], [0xffu8; 32], hex32(FIXED_SEED_HEX), [0x42u8; 32]] {
            let words = seed_to_mnemonic(&seed);
            let back = mnemonic_to_seed(&words, None).unwrap();
            assert_eq!(back, seed);
        }
    }

    #[test]
    fn generate_then_recover_is_stable() {
        // generate -> seed -> mnemonic again -> same seed (no entropy lost).
        let m = generate_mnemonic().unwrap();
        assert_eq!(m.split_whitespace().count(), WORD_COUNT);
        let seed = mnemonic_to_seed(&m, None).unwrap();
        let m2 = seed_to_mnemonic(&seed);
        assert_eq!(m, m2);
        assert_eq!(mnemonic_to_seed(&m2, None).unwrap(), seed);
        // and it yields a real, self-consistent keypair id.
        let kp = keypair_from_mnemonic(&m, None).unwrap();
        assert_eq!(kp.name_id, encode_key_id(&kp.raw_pub));
    }

    #[test]
    fn normalization_matches_js() {
        // Upper-case + surrounding / internal extra whitespace must decode the
        // same as the canonical form (JS: trim().toLowerCase().split(/\s+/)).
        let messy = format!("   {}   ", FIXED_MNEMONIC.to_uppercase().replace(' ', "  \t "));
        let id = name_id_from_mnemonic(&messy, None).unwrap();
        assert_eq!(id, FIXED_NAME_ID);
    }

    #[test]
    fn empty_passphrase_is_ok_nonempty_is_rejected() {
        assert!(mnemonic_to_seed(FIXED_MNEMONIC, Some("")).is_ok());
        assert_eq!(
            mnemonic_to_seed(FIXED_MNEMONIC, Some("x")),
            Err(MnemonicError::PassphraseUnsupported)
        );
    }

    #[test]
    fn rejects_bad_word_count_and_unknown_and_checksum() {
        // 23 words (one short).
        let short: String = FIXED_MNEMONIC
            .split_whitespace()
            .take(23)
            .collect::<Vec<_>>()
            .join(" ");
        assert_eq!(mnemonic_to_seed(&short, None), Err(MnemonicError::WordCount(23)));

        // Unknown token (not in the wordlist).
        let bad_word = FIXED_MNEMONIC.replacen("abandon", "notaword", 1);
        assert_eq!(mnemonic_to_seed(&bad_word, None), Err(MnemonicError::UnknownWord));

        // Valid words, wrong checksum: swap the last (checksum) word for another
        // valid word so the 11-bit decode succeeds but sha256(entropy)[0] fails.
        let bad_csum = {
            let mut w: Vec<&str> = FIXED_MNEMONIC.split_whitespace().collect();
            // "unaware" -> "zoo" keeps 24 valid words but breaks the checksum.
            *w.last_mut().unwrap() = "zoo";
            w.join(" ")
        };
        assert_eq!(mnemonic_to_seed(&bad_csum, None), Err(MnemonicError::BadChecksum));
    }
}
