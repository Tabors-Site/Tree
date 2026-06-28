// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The story key, loaded or minted. The genesis planter needs the I key (the
// story key) to sign the genesis act. On a second boot the key is already on
// disk (`.story/story.key`, a PKCS8 ed25519 PEM); treesign::load_story_seed
// reads it back to the 32-byte seed. On FIRST boot there is no key, so we mint
// one and WRITE it, persistently, the same way seed/storyIdentity.js does:
//   .story/story.key      <- PKCS8 ed25519 PRIVATE KEY PEM (mode 0600)
//   .story/story.key.pub  <- SPKI  ed25519 PUBLIC  KEY PEM (mode 0644)
// so the next boot (Rust OR the live JS story) loads the byte-identical seed.
//
// treesign owns the crypto + the PKCS8->seed DECODE (load_story_seed /
// seed_from_pkcs8_pem). It has no PEM WRITER, so the inverse wrap lives here:
// an ed25519 private key IS a 32-byte seed, PKCS8 wraps it as a fixed 16-byte
// DER prefix || seed (48 bytes), and SPKI wraps the 32-byte public key as a
// fixed 12-byte DER prefix || pub (44 bytes). Both prefixes are the constants
// Node's `crypto.generateKeyPairSync("ed25519")` emits, so a Rust-minted key is
// indistinguishable from a Node-minted one (it decodes through the very
// PKCS8_ED25519_PREFIX check treesign::seed_from_pkcs8_pem enforces).
//
// STORY_KEY_DIR is honored (storyIdentity.js: `process.env.STORY_KEY_DIR ||
// path.join(process.cwd(), ".story")`) so a caller can point the key elsewhere;
// load_or_mint_i_key takes the resolved dir, the caller does the env lookup.

use std::io;
use std::path::Path;

use base64::Engine;

/// The fixed PKCS8 DER prefix for an ed25519 PRIVATE key: SEQUENCE / version /
/// AlgorithmIdentifier(1.3.101.112) / OCTET STRING wrapper. The full DER is
/// these 16 bytes || the 32-byte seed (48 total). This is byte-identical to
/// treesign::keyfile's PKCS8_ED25519_PREFIX (the decode side), so a key we wrap
/// here decodes back through load_story_seed without a NotPkcs8Ed25519 refusal.
const PKCS8_ED25519_PREFIX: [u8; 16] = [
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
];

/// The fixed SPKI DER prefix for an ed25519 PUBLIC key: SEQUENCE /
/// AlgorithmIdentifier(1.3.101.112) / BIT STRING wrapper. The full DER is these
/// 12 bytes || the 32-byte raw public key (44 total) - the exact bytes Node
/// emits for `publicKey.export({type:"spki",format:"der"})` on an ed25519 key.
const SPKI_ED25519_PREFIX: [u8; 12] = [
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
];

/// Wrap base64 body at 64 columns (PEM convention) - matches what Node + OpenSSL
/// emit. A 48-byte (private) or 44-byte (public) ed25519 DER base64s to <=64
/// chars, so this is one line, but the wrapper is here for completeness.
fn pem(label: &str, der: &[u8]) -> String {
    let b64 = base64::engine::general_purpose::STANDARD.encode(der);
    let mut body = String::new();
    for (i, c) in b64.chars().enumerate() {
        if i > 0 && i % 64 == 0 {
            body.push('\n');
        }
        body.push(c);
    }
    format!("-----BEGIN {label}-----\n{body}\n-----END {label}-----\n")
}

/// The PKCS8 ed25519 PRIVATE KEY PEM for a seed (the `.story/story.key` form):
/// the 16-byte prefix || the 32-byte seed, DER, PEM-armored as `PRIVATE KEY`.
/// The inverse of treesign::seed_from_pkcs8_pem.
pub fn pkcs8_pem_from_seed(seed: &[u8; 32]) -> String {
    let mut der = Vec::with_capacity(48);
    der.extend_from_slice(&PKCS8_ED25519_PREFIX);
    der.extend_from_slice(seed);
    pem("PRIVATE KEY", &der)
}

/// The SPKI ed25519 PUBLIC KEY PEM for a raw public key (the
/// `.story/story.key.pub` form): the 12-byte prefix || the 32-byte pub, DER,
/// PEM-armored as `PUBLIC KEY`. Matches the conformance test's SPKI reader.
pub fn spki_pem_from_pub(raw_pub: &[u8; 32]) -> String {
    let mut der = Vec::with_capacity(44);
    der.extend_from_slice(&SPKI_ED25519_PREFIX);
    der.extend_from_slice(raw_pub);
    pem("PUBLIC KEY", &der)
}

/// The minted/loaded story identity the genesis planter signs with.
#[derive(Clone, Debug)]
pub struct StoryKey {
    /// The 32-byte ed25519 seed (the private key proper) - what sign_value takes.
    pub seed: [u8; 32],
    /// The raw 32-byte ed25519 public key - what `verify_act_sig` checks against
    /// for an "i-am" act (the literal "i-am" is NOT a pubkey id, so the story
    /// path verifies by raw pub, not by Name id).
    pub raw_pub: [u8; 32],
    /// True iff this key was freshly minted on this call (no key on disk before).
    pub minted: bool,
}

/// Errors loading or minting the story key. A mnemonic-mint failure is the only
/// crypto-path error; the rest are filesystem.
#[derive(Debug)]
pub enum KeyMintError {
    /// treesign rejected the freshly generated mnemonic (never expected from
    /// generate_mnemonic, which produces a valid 24-word phrase; defensive).
    Mnemonic(String),
    /// The on-disk story.key existed but did not decode to a 32-byte seed.
    BadStoryKey(treesign::KeyFileError),
    Io(io::Error),
}
impl From<io::Error> for KeyMintError {
    fn from(e: io::Error) -> Self {
        KeyMintError::Io(e)
    }
}
impl std::fmt::Display for KeyMintError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            KeyMintError::Mnemonic(m) => write!(f, "mint mnemonic: {m}"),
            KeyMintError::BadStoryKey(e) => write!(f, "on-disk story key: {e}"),
            KeyMintError::Io(e) => write!(f, "story key io: {e}"),
        }
    }
}
impl std::error::Error for KeyMintError {}

/// Load `<story_dir>/story.key` if it exists, else mint a fresh ed25519 keypair
/// and WRITE both PEMs (private 0600, public 0644) so the key persists. Returns
/// the seed + raw pub + whether it minted. Mirrors storyIdentity.js's get-or-
/// create: read on a returning boot, generate + write on first boot.
///
/// The mint uses treesign::generate_mnemonic -> keypair_from_mnemonic (a fresh
/// 24-word paper key, OS entropy; the raw 32-byte BIP39 entropy IS the seed - no
/// PBKDF2, the JS parity rule). The same seed always derives the same key + id,
/// so the written PKCS8 PEM re-loads to the identical seed forever.
pub fn load_or_mint_i_key(story_dir: &Path) -> Result<StoryKey, KeyMintError> {
    let key_path = story_dir.join("story.key");
    let pub_path = story_dir.join("story.key.pub");

    if key_path.exists() {
        // Returning boot: decode the existing PKCS8 PEM to the seed (the same
        // path the live JS story loads), derive the pub for the verify side.
        let seed = treesign::load_story_seed(story_dir).map_err(KeyMintError::BadStoryKey)?;
        let kp = treesign::keypair_from_seed(&seed);
        return Ok(StoryKey { seed, raw_pub: kp.raw_pub, minted: false });
    }

    // First boot: mint. A fresh mnemonic -> the keypair (entropy IS the seed).
    let mnemonic =
        treesign::generate_mnemonic().map_err(|e| KeyMintError::Mnemonic(format!("{e:?}")))?;
    let kp = treesign::keypair_from_mnemonic(&mnemonic, None)
        .map_err(|e| KeyMintError::Mnemonic(format!("{e:?}")))?;

    // WRITE the key (storyIdentity.js's first-boot write). Create the dir, then
    // the PKCS8 private (0600) + the SPKI public (0644). The seed re-loads
    // byte-identically next boot, so this is the I key, persistently.
    std::fs::create_dir_all(story_dir)?;
    let priv_pem = pkcs8_pem_from_seed(&kp.seed);
    let pub_pem = spki_pem_from_pub(&kp.raw_pub);
    write_with_mode(&key_path, &priv_pem, 0o600)?;
    write_with_mode(&pub_path, &pub_pem, 0o644)?;

    Ok(StoryKey { seed: kp.seed, raw_pub: kp.raw_pub, minted: true })
}

/// Write a file with a Unix mode (0600 for the private key, like storyIdentity's
/// `{ mode: 0o600 }`). On non-Unix the mode is dropped (the file is still
/// written) - the seed crate targets Unix, this keeps it compiling elsewhere.
fn write_with_mode(path: &Path, contents: &str, _mode: u32) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .mode(_mode)
            .open(path)?;
        f.write_all(contents.as_bytes())?;
        f.sync_all()?;
        Ok(())
    }
    #[cfg(not(unix))]
    {
        std::fs::write(path, contents)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The same pinned seed treesign's conformance uses (bytes 0x00..0x1f).
    const SEED: [u8; 32] = [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
        25, 26, 27, 28, 29, 30, 31,
    ];

    #[test]
    fn pkcs8_pem_round_trips_through_treesign() {
        // A seed we wrap to a PKCS8 PEM must decode back to the SAME seed via
        // treesign::seed_from_pkcs8_pem - proving the minted key is Node-shaped.
        let pem = pkcs8_pem_from_seed(&SEED);
        let back = treesign::seed_from_pkcs8_pem(&pem).expect("our PEM decodes via treesign");
        assert_eq!(back, SEED, "the wrapped seed round-trips byte-identical");
    }

    #[test]
    fn spki_pem_is_well_formed_and_pub_matches() {
        // The SPKI we emit for a seed's pub must carry the seed's actual pubkey.
        let kp = treesign::keypair_from_seed(&SEED);
        let pem = spki_pem_from_pub(&kp.raw_pub);
        assert!(pem.contains("-----BEGIN PUBLIC KEY-----"), "armored as PUBLIC KEY");
        // decode the body and confirm the trailing 32 bytes are the pubkey.
        let b64: String = pem
            .lines()
            .filter(|l| !l.trim_start().starts_with("-----"))
            .flat_map(|l| l.chars())
            .filter(|c| !c.is_whitespace())
            .collect();
        let der = base64::engine::general_purpose::STANDARD.decode(b64.as_bytes()).unwrap();
        assert_eq!(der.len(), 44, "SPKI ed25519 DER is 44 bytes");
        assert_eq!(&der[12..], &kp.raw_pub, "the SPKI body IS the raw pub");
    }

    #[test]
    fn mint_then_reload_is_stable() {
        // First call mints + writes; the second call READS the same key back, so
        // the seed is identical across boots (the persistence contract).
        let dir = std::env::temp_dir().join("treegenesis-keymint-stable");
        let _ = std::fs::remove_dir_all(&dir);

        let first = load_or_mint_i_key(&dir).expect("mint");
        assert!(first.minted, "first boot mints");
        assert!(dir.join("story.key").exists(), "story.key written");
        assert!(dir.join("story.key.pub").exists(), "story.key.pub written");

        let second = load_or_mint_i_key(&dir).expect("reload");
        assert!(!second.minted, "second boot loads, never re-mints");
        assert_eq!(first.seed, second.seed, "the seed is stable across boots");
        assert_eq!(first.raw_pub, second.raw_pub, "the pub is stable across boots");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn minted_private_key_is_0600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join("treegenesis-keymint-mode");
        let _ = std::fs::remove_dir_all(&dir);
        load_or_mint_i_key(&dir).expect("mint");
        let mode = std::fs::metadata(dir.join("story.key")).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600, "private key is 0600");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
