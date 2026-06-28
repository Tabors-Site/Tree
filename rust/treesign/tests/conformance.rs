// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// conformance.rs - the BYTE-IDENTICAL gate for treesign. Proves the Rust crypto
// matches the live JS where they SHARE a definition, and pins where they now
// DIVERGE BY DESIGN (the NO-WALL-TIME purge: the Rust act-sig is CLOCK-FREE).
//
//   (a) keypair_from_seed(seed).name_id  ==  JS keypairFromSeed(seed).nameId.
//       (Unchanged: the key derivation has no wall-clock; still byte-identical.)
//   (b) a PURE Rust act-sig ROUND-TRIP: build_act_sig_payload (CLOCK-FREE, NO
//       `time`) -> sign_value -> verify_act_sig is TRUE. The old JS-byte-identity
//       no longer applies here BY DESIGN: the JS baked the act's wall-clock `at`
//       into the sig as `time`, and the going-forward Rust does NOT - it is
//       PURER than the JS. So (b) proves the Rust signs+verifies its own pure
//       clock-free shape; the JS legacy shape is proven separately by (c).
//   (c) a REAL signed act from the on-disk genesis store verifies via the
//       EXPLICIT LEGACY PATH: that JS act carried the wall-clock in its sig, so
//       its payload is rebuilt with build_act_sig_payload_legacy (the marked
//       legacy helper, NOT the going-forward pure builder) + the act's committed
//       factIds, and verify_with_pubkey against the story public key (the
//       signer "i-am" is the story key, not a Name pubkey). New Rust acts do NOT
//       carry that wall-clock; this is the read-old-JS-store path only.
//   (d) a FIXED BIP39 mnemonic yields the SAME seed and nameId as the JS.
//   (e) the key-load adapter: the seed decoded from the PRIVATE PKCS8 PEM
//       (.story/story.key) names the SAME being as the PUBLIC SPKI PEM
//       (.story/story.key.pub). The headless-seal gate for Step 3.
//
// The (a) reference values are PINNED from the JS (the node snippet in NOTES.md,
// run with JWT_SECRET=test-0123456789); ed25519 over a fixed seed is
// deterministic, so they are stable. (b) is a self-contained Rust round-trip (no
// JS pin) precisely because the Rust pure shape is now PURER than the JS.

use base64::Engine;
use treesign::{
    build_act_sig_payload, build_act_sig_payload_legacy, canonicalize, encode_key_id,
    generate_mnemonic, keypair_from_mnemonic, keypair_from_seed, load_story_seed, mnemonic_to_seed,
    parse, seed_from_pkcs8_pem, seed_to_mnemonic, sign_payload, sign_value, verify_act_sig,
    verify_name_sig, verify_with_pubkey, Json,
};

// ── pinned JS reference vectors (refvec.mjs; seed = bytes 0..31) ──
const SEED: [u8; 32] = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
    26, 27, 28, 29, 30, 31,
];
// JS keypairFromSeed(seed).nameId
const NAME_ID: &str = "z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd";
// the raw 32-byte ed25519 public key for that seed (cross-check)
const RAW_PUB_HEX: &str = "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8";

// (b) an act ROW (it even carries a wall-clock `at`, to prove the pure builder
// IGNORES it). build_act_sig_payload turns this into the CLOCK-FREE canonical
// payload below - sorted factIds, NO `time`. The going-forward Rust signs THIS.
const ACT_JSON: &str = r#"{"_id":"abc123","by":"z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd","through":"i-am","to":"i-am","story":"localhost","history":"0","p":"0000000000000000000000000000000000000000000000000000000000000000","at":"2026-06-25T13:01:25.361Z"}"#;
// the PURE canonical bytes build_act_sig_payload(act, ["zeta","alpha","mid"])
// produces: factIds SORTED, `through` kept (present on the row), and NO `time`.
const PURE_CANON: &str = r#"{"actId":"abc123","by":"z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd","factIds":["alpha","mid","zeta"],"history":"0","p":"0000000000000000000000000000000000000000000000000000000000000000","story":"localhost","through":"i-am","to":"i-am"}"#;

// ── (c) the real act pinned from the live store (verifyact.mjs) ──
// The "am" genesis act on history "0", signed by the story key ("i-am").
const REAL_ACT_ID: &str = "47f13daacad477b33865c516e29177a2f48931dff1542e3bba5049eb860e43f2";

// ── (d) BIP39 mnemonic vectors pinned from the JS (mnref.mjs) ──
// The JS treats the raw 24-word ENTROPY as the seed directly (NO PBKDF2, NO
// passphrase, NO BIP32). FIXED_MNEMONIC is the canonical 24-word form of entropy
// 0x00..0x1f, so its seed IS SEED above and its nameId IS NAME_ID above - tying
// the mnemonic path to the already-proven keypair path. FIXED_MNEMONIC_B is
// entropy 0xff*32 ("zoo" x23 + "vote").
const FIXED_MNEMONIC: &str = "abandon amount liar amount expire adjust cage candy arch gather drum bullet absurd math era live bid rhythm alien crouch range attend journey unaware";
const FIXED_MNEMONIC_B: &str =
    "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote";
const NAME_ID_B: &str = "z6MknSLrJoTcukLrE435hVNQT4JUhbvWLX4kUzqkEStBU8Vi";

fn hex_to_32(h: &str) -> [u8; 32] {
    assert_eq!(h.len(), 64, "expected 32-byte hex");
    let mut out = [0u8; 32];
    for i in 0..32 {
        out[i] = u8::from_str_radix(&h[i * 2..i * 2 + 2], 16).expect("hex byte");
    }
    out
}

/// (a) name id from a known seed matches the JS.
#[test]
fn a_name_id_matches_js() {
    let kp = keypair_from_seed(&SEED);
    assert_eq!(kp.name_id, NAME_ID, "name_id must equal JS keypairFromSeed().nameId");
    assert_eq!(
        kp.raw_pub,
        hex_to_32(RAW_PUB_HEX),
        "raw pubkey must match the JS-derived ed25519 public key"
    );
}

/// (b) a PURE Rust act-sig ROUND-TRIP (CLOCK-FREE, NO wall-clock).
///
/// NO LONGER a JS-byte-identity, BY DESIGN: the old JS baked the act's wall-clock
/// `at` into the sig payload as `time`; the going-forward Rust does NOT (the
/// no-wall-time purge). The Rust is PURER than the JS here, so there is no JS
/// signature to match - instead we prove the Rust signs+verifies its OWN pure
/// clock-free shape. The JS legacy shape is still honored, but only by (c).
#[test]
fn b_pure_act_sig_round_trip_clock_free() {
    let act = parse(ACT_JSON).expect("act parses");
    let fids = vec!["zeta".to_string(), "alpha".to_string(), "mid".to_string()];

    // build_act_sig_payload is CLOCK-FREE: it sorts factIds and drops the act's
    // wall-clock `at` entirely (no `time`), giving the pinned PURE canonical bytes.
    let pure = build_act_sig_payload(&act, &fids);
    let pure_json = canonicalize(&pure);
    assert_eq!(pure_json, PURE_CANON, "the PURE payload must be clock-free (no `time`) + sorted");
    assert!(!pure_json.contains("time"), "the going-forward payload carries NO wall-clock");

    // sign the pure payload and round-trip it through the read path (PURE first).
    let sig = sign_value(&SEED, &pure);
    assert!(verify_act_sig(&hex_to_32(RAW_PUB_HEX), &act, &fids, &sig), "pure act verifies (pure attempt)");
    let kp = keypair_from_seed(&SEED);
    assert!(verify_name_sig(&kp.name_id, &pure_json, &sig), "pure self-verify by name id");
    assert!(verify_with_pubkey(&kp.raw_pub, &pure_json, &sig), "pure self-verify by raw pub");

    // a tamper anywhere in the pure payload fails.
    let tampered = pure_json.replace("\"history\":\"0\"", "\"history\":\"1\"");
    assert!(!verify_with_pubkey(&kp.raw_pub, &tampered, &sig), "a tampered pure payload fails");
}

/// (c) verify a REAL signed act read from the on-disk genesis store, via the
/// EXPLICIT LEGACY PATH. This is a legacy JS act: it carried the wall-clock in
/// its sig (the old JS baked the act's `at` into the payload as `time`), so its
/// payload is rebuilt with build_act_sig_payload_legacy (the marked legacy
/// helper) - NOT the going-forward pure builder. New Rust acts do NOT carry that
/// wall-clock; this proves the read-old-JS-store path. We also assert the PURE
/// builder does NOT verify this old act (it has no `time`), which is exactly why
/// the legacy helper is required to read it.
#[test]
fn c_real_legacy_js_act_verifies_via_legacy_path() {
    let root = repo_root().expect(
        "could not locate the repo root (a dir with store/past/acts and .story/story.key.pub)",
    );

    // the act's home reel (story=localhost, history=0, by/through=i-am).
    let acts_path = root.join("store/past/acts/localhost/0/i-/i-am.acts");
    let reel_path = root.join("store/past/reels/0/being/i-/i-am.reel");
    let story_pub_pem = root.join(".story/story.key.pub");

    let act = read_act(&acts_path, REAL_ACT_ID);
    let fact_ids = committed_fact_ids(&reel_path, REAL_ACT_ID);

    // the act IS signed, and by the story key "i-am".
    let sig = act_sig_value(&act).expect("the real act carries a sig.value");
    assert_eq!(act_sig_by(&act).as_deref(), Some("i-am"), "this act is story-signed");
    assert!(!fact_ids.is_empty(), "the 'am' act commits exactly one fact");

    // the signer id is "i-am" (not a Name pubkey), so verification routes to the
    // story public key, decoded from the SPKI PEM on disk.
    let story_pub = read_ed25519_spki_pub(&story_pub_pem);

    // LEGACY: this old JS act carried the wall-clock `at` in its sig, so rebuild
    // the OLD payload shape (with `time`) via the explicit legacy helper.
    let legacy_json = canonicalize(&build_act_sig_payload_legacy(&act, &fact_ids));
    assert!(
        verify_with_pubkey(&story_pub, &legacy_json, &sig),
        "the legacy JS act must verify against the story pubkey via the LEGACY (with-`time`) payload"
    );

    // the going-forward PURE builder does NOT verify this old act: it drops the
    // wall-clock the JS signed, so the bytes differ. THIS is why the legacy helper
    // exists - new Rust acts are clock-free, but old JS acts carried the clock.
    let pure_json = canonicalize(&build_act_sig_payload(&act, &fact_ids));
    assert!(
        !verify_with_pubkey(&story_pub, &pure_json, &sig),
        "the PURE payload must NOT verify this legacy act (it baked the wall-clock in)"
    );

    // and the read-path try-both helper transparently accepts it (PURE fails,
    // LEGACY fallback succeeds), so callers need not know which shape it is.
    assert!(
        verify_act_sig(&story_pub, &act, &fact_ids, &sig),
        "verify_act_sig accepts the legacy act via its legacy fallback"
    );

    // negative control: a tampered legacy payload must NOT verify.
    let tampered = legacy_json.replace("\"history\":\"0\"", "\"history\":\"1\"");
    assert!(
        !verify_with_pubkey(&story_pub, &tampered, &sig),
        "a tampered payload must fail verification"
    );
}

/// (d) a FIXED mnemonic yields the SAME seed and the SAME nameId as the JS.
/// This is the headless-genesis gate: the paper key the JS prints recovers the
/// exact same Name in Rust.
#[test]
fn d_mnemonic_matches_js() {
    // FIXED_MNEMONIC is the 24-word form of SEED (0x00..0x1f). The JS
    // mnemonicToEntropy returns that entropy as the seed, byte-for-byte.
    let seed = mnemonic_to_seed(FIXED_MNEMONIC, None).expect("fixed mnemonic decodes");
    assert_eq!(seed, SEED, "mnemonic entropy IS the seed (no PBKDF2 stretch)");

    // -> same keypair -> same nameId as the pinned keypair vector (a).
    let kp = keypair_from_mnemonic(FIXED_MNEMONIC, None).expect("fixed mnemonic -> keypair");
    assert_eq!(kp.name_id, NAME_ID, "fixed mnemonic -> JS nameId");
    assert_eq!(kp.seed, SEED);

    // a second independent JS vector (entropy 0xff*32).
    let kp_b = keypair_from_mnemonic(FIXED_MNEMONIC_B, None).expect("vector B decodes");
    assert_eq!(kp_b.name_id, NAME_ID_B, "vector B -> JS nameId");

    // the inverse direction also matches the JS (entropyToMnemonic).
    assert_eq!(seed_to_mnemonic(&SEED), FIXED_MNEMONIC, "seed -> JS mnemonic");
    assert_eq!(seed_to_mnemonic(&[0xffu8; 32]), FIXED_MNEMONIC_B);

    // the recovered key actually signs/verifies (end-to-end, not just the id).
    let payload = r#"{"hello":"genesis"}"#;
    let sig = sign_payload(&seed, payload).expect("sign");
    assert!(verify_name_sig(&kp.name_id, payload, &sig), "recovered key signs+verifies");
}

/// (d') round-trip stability: a freshly generated mnemonic survives
/// mnemonic -> seed -> mnemonic -> seed unchanged, and is a real 24-word key.
#[test]
fn d_mnemonic_roundtrip_stable() {
    let m = generate_mnemonic().expect("OS entropy");
    assert_eq!(m.split_whitespace().count(), 24, "the JS word count");

    let seed = mnemonic_to_seed(&m, None).expect("fresh mnemonic decodes");
    let m2 = seed_to_mnemonic(&seed);
    assert_eq!(m, m2, "seed -> mnemonic recovers the same words");
    assert_eq!(mnemonic_to_seed(&m2, None).unwrap(), seed, "and back to the same seed");

    // the two skins (seed, mnemonic) name the SAME being.
    let from_seed = keypair_from_seed(&seed);
    let from_words = keypair_from_mnemonic(&m, None).expect("mnemonic -> keypair");
    assert_eq!(from_seed.name_id, from_words.name_id, "seed and paper agree on the nameId");
}

/// (e) the key-load adapter: the seed decoded from the PRIVATE PKCS8 PEM names
/// the SAME being as the PUBLIC SPKI PEM. This is the headless-seal gate: a Rust
/// signer that loads `.story/story.key` signs as the very Name `.story/
/// story.key.pub` verifies, so a Rust-sealed act and the live JS story sign with
/// one identity. Uses the LIVE `.story/` when present (the real custodial key);
/// else a freshly generated keypair written both ways (PKCS8 priv + SPKI pub),
/// so the test stands alone in a checkout without a `.story/`.
#[test]
fn e_story_key_priv_and_pub_name_one_being() {
    match repo_root() {
        Some(root) => {
            // LIVE path: load the real story.key (PKCS8) -> seed -> name id, and
            // derive the name id from story.key.pub (SPKI) the (c) reader's way.
            let story_dir = root.join(".story");
            let seed = load_story_seed(&story_dir).expect("live story.key decodes to a seed");
            let priv_name = keypair_from_seed(&seed).name_id;
            let raw_pub = read_ed25519_spki_pub(&story_dir.join("story.key.pub"));
            let pub_name = encode_key_id(&raw_pub);
            assert_eq!(
                priv_name, pub_name,
                "the decoded story.key seed names the same being as story.key.pub"
            );
        }
        None => {
            // STANDALONE path: mint a keypair, write it both ways, decode back.
            let seed = mnemonic_to_seed(&generate_mnemonic().expect("OS entropy"), None)
                .expect("fresh seed");
            let kp = keypair_from_seed(&seed);
            let priv_pem = pkcs8_ed25519_pem(&seed);
            let pub_pem = spki_ed25519_pem(&kp.raw_pub);

            // the PRIVATE PEM round-trips back to the exact seed.
            let decoded = seed_from_pkcs8_pem(&priv_pem).expect("generated PKCS8 decodes");
            assert_eq!(decoded, seed, "PEM -> seed round-trips");

            // and the two PEMs name one being.
            let priv_name = keypair_from_seed(&decoded).name_id;
            let raw_pub = read_ed25519_spki_pub_from_str(&pub_pem);
            let pub_name = encode_key_id(&raw_pub);
            assert_eq!(priv_name, pub_name, "priv PEM and pub PEM name one being");
            assert_eq!(pub_name, kp.name_id, "and that being is the generated keypair");
        }
    }
}

// ── store-reading helpers (test-local; no crypto, just file IO + the shared parser) ──

/// Wrap a 32-byte ed25519 seed as a PKCS8 PRIVATE KEY PEM (the fixed 16-byte
/// DER prefix + the seed, base64, fenced). The inverse of seed_from_pkcs8_pem,
/// used only by the standalone (e) fallback to mint a key file on the fly.
fn pkcs8_ed25519_pem(seed: &[u8; 32]) -> String {
    let prefix: [u8; 16] = [
        0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04,
        0x20,
    ];
    let mut der = Vec::with_capacity(48);
    der.extend_from_slice(&prefix);
    der.extend_from_slice(seed);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&der);
    format!("-----BEGIN PRIVATE KEY-----\n{b64}\n-----END PRIVATE KEY-----\n")
}

/// Wrap a 32-byte ed25519 public key as an SPKI PUBLIC KEY PEM (the fixed
/// 12-byte DER prefix + the key). The peer of pkcs8_ed25519_pem for the (e)
/// fallback; `read_ed25519_spki_pub_from_str` decodes it back.
fn spki_ed25519_pem(raw_pub: &[u8; 32]) -> String {
    let prefix: [u8; 12] = [
        0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
    ];
    let mut der = Vec::with_capacity(44);
    der.extend_from_slice(&prefix);
    der.extend_from_slice(raw_pub);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&der);
    format!("-----BEGIN PUBLIC KEY-----\n{b64}\n-----END PUBLIC KEY-----\n")
}

/// Walk up from this crate to the repo root: the first ancestor holding both
/// store/past/acts and .story/story.key.pub.
fn repo_root() -> Option<std::path::PathBuf> {
    let mut dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    loop {
        if dir.join("store/past/acts").is_dir() && dir.join(".story/story.key.pub").is_file() {
            return Some(dir);
        }
        if !dir.pop() {
            return None;
        }
    }
}

/// Read the act row with the given _id from a .acts file (one JSON doc per line).
fn read_act(path: &std::path::Path, act_id: &str) -> Json {
    let body = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let doc = parse(line).expect("act line parses");
        if let Some(Json::Str(id)) = obj_get(&doc, "_id") {
            if id == act_id {
                return doc;
            }
        }
    }
    panic!("act {act_id} not found in {}", path.display());
}

/// The committed fact ids for an act: the reel facts whose `actId` matches,
/// their `_id`s. (verifyActSig reads these via getFactsByActId; sorting happens
/// inside build_act_sig_payload, so we return them unsorted here.)
fn committed_fact_ids(reel_path: &std::path::Path, act_id: &str) -> Vec<String> {
    let body = std::fs::read_to_string(reel_path)
        .unwrap_or_else(|e| panic!("read {}: {e}", reel_path.display()));
    let mut out = Vec::new();
    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let doc = parse(line).expect("reel line parses");
        if let Some(Json::Str(a)) = obj_get(&doc, "actId") {
            if a == act_id {
                if let Some(Json::Str(id)) = obj_get(&doc, "_id") {
                    out.push(id.clone());
                }
            }
        }
    }
    out
}

fn obj_get<'a>(v: &'a Json, key: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(k, _)| k == key).map(|(_, val)| val),
        _ => None,
    }
}

fn act_sig_value(act: &Json) -> Option<String> {
    match obj_get(act, "sig").and_then(|s| obj_get(s, "value")) {
        Some(Json::Str(s)) => Some(s.clone()),
        _ => None,
    }
}

fn act_sig_by(act: &Json) -> Option<String> {
    match obj_get(act, "sig").and_then(|s| obj_get(s, "by")) {
        Some(Json::Str(s)) => Some(s.clone()),
        _ => None,
    }
}

/// Decode the raw 32-byte ed25519 public key from an SPKI PEM. An ed25519 SPKI
/// is a fixed 12-byte DER prefix (`MCowBQYDK2VwAyEA` base64) followed by the 32
/// raw key bytes, so we base64-decode the PEM body and take the trailing 32.
fn read_ed25519_spki_pub(path: &std::path::Path) -> [u8; 32] {
    let pem = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    read_ed25519_spki_pub_from_str(&pem)
}

/// The in-memory peer of read_ed25519_spki_pub: decode the raw 32-byte ed25519
/// public key from an SPKI PEM string (used by the (e) standalone fallback).
fn read_ed25519_spki_pub_from_str(pem: &str) -> [u8; 32] {
    let b64: String = pem
        .lines()
        .filter(|l| !l.starts_with("-----"))
        .flat_map(|l| l.chars())
        .filter(|c| !c.is_whitespace())
        .collect();
    let der = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .expect("SPKI base64 decodes");
    assert_eq!(der.len(), 44, "ed25519 SPKI is 12-byte prefix + 32-byte key");
    let mut raw = [0u8; 32];
    raw.copy_from_slice(&der[12..]);
    raw
}
