# treesign - NOTES

The crypto, isolated. ALL of TreeOS's crypto lives in this one crate so the
determinism spine (`treehash -> treefold -> treeverify -> treestore -> treeproj`)
stays zero-dependency and the trust surface is one auditable place.

Ported byte-for-byte from the JS:

- `seed/materials/name/keys.js` - the Name keys (a name is a wallet).
- `seed/past/act/actSig.js` - `buildActSigPayload` (what a seal signs).
- `seed/materials/name/mnemonic.js` - the BIP39 paper form of a Name seed
  (`entropyToMnemonic` / `mnemonicToEntropy`), as wired by `seed/ibp/nameOps.js`
  + `seed/materials/name/login.js` (`keypairFromSeed(mnemonicToEntropy(words))`).

The JS is the live system and is **untouched**; this crate is the parallel Rust
path, proven byte-identical by `tests/conformance.rs` **where they share a
definition**, and PURER than the JS where the no-wall-time purge applies.

## NO WALL TIME (the time-purge, `philosophy/crystalized.md`)

TIME is **order** - the chain position `p`, the clock-free `seq`/`ord` - **never
a wall-clock**. So the act-sig payload the Rust **signs and verifies** is
**CLOCK-FREE**: `build_act_sig_payload` carries **NO `time` field**. The old JS
baked the act's wall-clock `at` into the signature payload as `time`; the
going-forward Rust does NOT. The Rust is therefore *purer than the JS by design*
on this one point.

**The pure-vs-legacy split** (the SOLE difference is the `time` field):

- `build_act_sig_payload(act, factIds)` - the **PURE**, going-forward shape.
  CLOCK-FREE. **All new Rust signing uses this.** No `time`.
- `build_act_sig_payload_legacy(act, factIds)` - the **LEGACY** shape: the PURE
  payload PLUS a trailing `time` (the act's `at` as an ISO string, else null).
  Exists for **ONE** reason: to verify **pre-existing JS-signed acts** that baked
  the wall-clock into their sig. **Never sign with this.** Read-old-stores only.
- `verify_act_sig(rawPub, act, factIds, sig)` / `verify_act_sig_by_name(nameId,
  ...)` - the **read path**: try the **PURE** payload first, fall back to the
  **LEGACY** payload only on failure. So reads transparently accept BOTH new pure
  Rust acts AND old JS acts, while **signing stays pure**. A new Rust act verifies
  on the pure attempt and never builds the legacy payload; an old JS act fails
  pure and verifies on the legacy fallback - the one place the wall-clock-bearing
  shape is honored. (Proven: lib unit tests + conformance (b) pure / (c) legacy.)

The Rust STAMP is clock-free too (see `treestore/NOTES.md`): it writes no `at` on
acts, no `date` on facts - only the clock-free `ord` (a global append ordinal,
NOT a wall-clock) and the digest `seq`/`p`. Old stores that HAVE `at`/`date` are
read fine (those fields are inert, outside every canonical id); the Rust just
never writes them.

## What it ports (the public surface, JS -> Rust)

| JS (`keys.js` / `actSig.js`)             | Rust (`treesign`)                                  |
| ---------------------------------------- | -------------------------------------------------- |
| `encodeKeyId(rawPub)`                    | `encode_key_id(&[u8;32]) -> String`                |
| `isKeyId(s)`                             | `is_key_id(&str) -> bool`                           |
| `keyIdToPublicKey(id)` (KeyObject)       | `key_id_to_pubkey(&str) -> Option<[u8;32]>` (raw)  |
| `keypairFromSeed(seed)`                  | `keypair_from_seed(&[u8;32]) -> Keypair`           |
| `signAsName(privPem, payloadObj)`        | `sign_payload(&[u8;32], &str) -> Option<String>`   |
| `verifyNameSig(nameId, obj, sigB64)`     | `verify_name_sig(&str, &str, &str) -> bool`        |
| `verifyWithPublicKeyPem(pem, obj, sig)`  | `verify_with_pubkey(&[u8;32], &str, &str) -> bool` |
| (read path: try PURE then LEGACY)        | `verify_act_sig(&[u8;32], &Json, &[String], &str)` |
| (read path by Name id)                   | `verify_act_sig_by_name(&str, &Json, &[String], &str)` |
| `buildActSigPayload(act, factIds)` (PURE) | `build_act_sig_payload(&Json, &[String]) -> Json` (CLOCK-FREE) |
| (the OLD JS shape WITH `time`)            | `build_act_sig_payload_legacy(&Json, &[String]) -> Json` (read-only) |
| `mnemonicToEntropy(words)`               | `mnemonic_to_seed(&str, Option<&str>) -> Result`   |
| `entropyToMnemonic(entropy)`             | `seed_to_mnemonic(&[u8;32]) -> String`             |
| (`crypto.generateKeyPairSync` paper key) | `generate_mnemonic() -> Result<String>`            |
| `keypairFromSeed(mnemonicToEntropy(w))`  | `keypair_from_mnemonic(&str, Option<&str>)`        |
| (inverse of the PKCS8 wrap on import)    | `seed_from_pkcs8_pem(&str) -> Result<[u8;32]>`     |
| (read `.story/story.key` -> the seed)    | `load_story_seed(&Path) -> Result<[u8;32]>`        |

`Keypair { seed:[u8;32], raw_pub:[u8;32], name_id:String }` is the Rust shape of
`keypairFromSeed`'s return; `name_id` is the byte-identical field (the JS also
returns the PEMs, which Rust does not carry - it works in the raw/seed forms).

`sign_value` / re-exported `canonicalize`, `parse`, `Json` (from `treehash`) let
the seal (Step 3) sign/verify an already-parsed payload over the exact same
serializer the signature bytes are defined against - never a second JSON path.

## The scheme (must stay byte-identical to the JS forever)

- **ed25519 (RFC 8032).** A Name's id IS its public key, encoded as the
  colon-free did:key multibase form:

  ```
  id = "z" + base58btc(0xed01 || raw32)
  ```

  `z` is multibase base58btc; `0xed01` is the multicodec varint for
  ed25519-pub. Colon-free on purpose: ids flow through colon-delimited
  projection / reel / act-head keys. Self-certifying: verify straight from the
  id, no directory.

- **Sign = ed25519 over `treehash::canonicalize(payload)` bytes, NO pre-hash**
  (raw / pure ed25519), then base64. This is exactly Node
  `crypto.sign(null, msg, ed25519key)` - the `null` algorithm means "the curve
  is the algorithm" (PureEdDSA), not "default hash". ed25519 is deterministic,
  so the same seed + same payload yields the same 64 bytes on every host, hence
  the base64 is byte-identical to `signAsName`.

- **The signed payload** (`build_act_sig_payload`, PURE / going-forward):
  `{ actId, by, through, to, story, history, p, factIds(sorted) }` -
  **CLOCK-FREE, NO `time`** (the no-wall-time purge). It commits to the act's
  opening hash (`actId`, which already pins all of `contentOfAct`), the chain
  position (`p`), and the **sorted committed factIds** - so neither the act nor
  its facts can be swapped after the seal. It rides as a closure field
  (`act.sig`), outside `contentOfAct`, so it never changes `act._id`.
  - The **LEGACY** peer `build_act_sig_payload_legacy` is identical PLUS a
    trailing `time` (the act's `at`), the EXACT pre-purge JS shape. It exists
    ONLY to verify old JS-signed acts that carried the wall-clock; new Rust acts
    never use it. `time` is the SOLE field that differs between the two.

- **An ed25519 private key IS a 32-byte seed.** `keypair_from_seed` rebuilds the
  keypair (and the id) deterministically. (In JS the seed is PKCS8-wrapped with
  a fixed 16-byte DER prefix `302e020100300506032b657004220420`; in Rust
  `SigningKey::from_bytes(&seed)` takes the raw seed directly and derives the
  identical key - proven by vector (a).)

- **The mnemonic (BIP39) is the PAPER form of that 32-byte seed, and the raw
  ENTROPY IS THE SEED.** This is the parity trap. `mnemonic.js` says it
  verbatim: *"Deliberately NOT here: PBKDF2 mnemonic-to-seed stretching,
  passphrase salting, BIP32 HD-wallet derivation. The entropy IS the key
  seed."* So `mnemonic_to_seed` is **not** the standard BIP39 mnemonic->seed
  (that PBKDF2-HMAC-SHA512 stretch yields 64 bytes salted by `"mnemonic"+pass`
  and is the WRONG path). It is: 24 words -> 11-bit decode over the canonical
  English list -> 32 entropy bytes -> verify the `sha256(entropy)[0]` (8-bit)
  checksum -> hand those 32 bytes straight to `keypair_from_seed`. We use the
  `bip39` crate ONLY for `to_entropy` / `from_entropy` (its wordlist + checksum
  are byte-identical to `mnemonic.js`, proven by vector (d)) and NEVER its
  `to_seed()`.
  - **Only the 24-word / 256-bit form is supported** (`WORD_COUNT = 24`,
    `ENTROPY_BYTES = 32`), exactly like the JS; 12/15/18/21-word mnemonics are
    rejected even though the crate would take them.
  - **No passphrase.** The JS has no passphrase concept at all. `mnemonic_to_seed`
    takes `Option<&str>` so a caller can thread one through, but `None` / `Some("")`
    is the only valid value; a non-empty passphrase is a hard `PassphraseUnsupported`
    error, NOT a silent salt (silently ignoring it would mint a key the JS never
    makes - a false-confidence parity hole).
  - **Normalization matches `mnemonic.js`'s `trim().toLowerCase().split(/\s+/)`:**
    `mnemonic_to_seed` lower-cases and whitespace-collapses itself, then calls
    `parse_in_normalized` (which does NOT re-normalize), so we match the JS
    preprocessing without pulling the crate's NFKD path (a no-op on the ASCII
    wordlist anyway).

- **I / the story** signs with the **story key**; its id `"i-am"` is NOT a
  pubkey, so verification routes to the raw story public key
  (`verify_with_pubkey`), the analogue of `verifyWithPublicKeyPem`.

## The key-load adapter (`keyfile.rs`, Step 3)

The signers above take a 32-byte **seed**; the on-disk keys are **PEM**. The
adapter bridges them so a Rust seal can sign with the live custodial key.

- `seed_from_pkcs8_pem(pem) -> Result<[u8;32]>` strips the PEM armor,
  base64-decodes the body, and returns the **trailing 32 bytes** of the 48-byte
  PKCS8 DER. An ed25519 PKCS8 key is the fixed 16-byte prefix
  `302e020100300506032b657004220420` followed by the raw 32-byte seed; the
  prefix is **verified** (wrong length or wrong prefix -> `NotPkcs8Ed25519`), so
  an RSA/P-256 key or an SPKI **public** key handed in by mistake is refused
  rather than yielding a bogus seed. This is the exact inverse of the PKCS8
  **wrap** `keys.js` does on import (it prepends that same prefix to a seed to
  build a Node key); here we **unwrap** a Node-written key back to the seed
  `keypair_from_seed` rebuilds from. Total function (no panic).
- `load_story_seed(story_dir) -> Result<[u8;32]>` reads `<dir>/story.key` and
  decodes it. `.story/story.key` is the custodial key **I** (the story) signs
  every act with; loading its seed lets a Rust seal produce the **byte-identical**
  signature the live JS story produces (same seed + same canonical payload =
  same 64 ed25519 bytes), proven by conformance (e).
- **Conformance (e)** (`e_story_key_priv_and_pub_name_one_being`): the seed
  decoded from `.story/story.key` (the PRIVATE PKCS8 PEM) names the SAME being
  as `.story/story.key.pub` (the PUBLIC SPKI PEM, decoded by the existing
  `read_ed25519_spki_pub`). Uses the **live** `.story/` when present (the real
  key), else a freshly generated keypair written both ways, so a checkout
  without a `.story/` still passes. The live story seed `f05578..` derives the
  on-disk pub `d2381d26..` (== the (c) `story pub`), so this and (c) pin the
  same identity from both faces.

This is the seam Step 3's signed seal (`treestore::commit_moment_signed`) uses:
treestore stays **zero-crypto** and takes a `sign` closure; the closure (the
caller's, e.g. genesis / the act path) loads the seed via `load_story_seed`,
builds the payload via `build_act_sig_payload`, and signs via `sign_value`.

## Dependencies (crypto ONLY here)

- `ed25519-dalek = "2.2.0"` - pure-Rust ed25519 (pulls `curve25519-dalek`,
  `sha2`, `signature`, `subtle`, `zeroize`). v2 `SigningKey::from_bytes(&seed)`
  takes the 32-byte seed; `sign()` is raw ed25519 (no pre-hash) = the Node
  null-alg path; `verify_strict()` rejects the same small-order / malleable
  edge cases Node's `crypto.verify` rejects, keeping the accept-set identical.
- `bs58 = "0.5.1"` - base58btc. Its default alphabet IS the Bitcoin/IPFS
  alphabet the hand-rolled `b58encode` in `keys.js` uses, so the two
  encode/decode identically (proven by vector (a): same `nameId`).
- `base64 = "0.22.1"` - standard base64 for the signature value (matches
  `Buffer.toString("base64")`).
- `treehash = { path = "../treehash" }` - the SHARED canonicalizer (zero-dep
  itself). The sig is over `canonicalize(payload)`, so the bytes MUST come from
  the same serializer as the JS signer.
- `bip39 = { version = "2.2.2", default-features = false, features = ["alloc"] }`
  - the BIP39 codebook + checksum for the paper seed form. English is the
    always-on built-in wordlist (it IS `bip39Words.js` byte-for-byte); `alloc`
    enables `from_entropy` / `to_string`. We use ONLY `to_entropy` /
    `from_entropy` (the wordlist + `sha256(entropy)[0]` checksum) and NEVER
    `to_seed()` (the PBKDF2 path the JS deliberately omits). It transitively
    pulls `bitcoin_hashes` (sha256), `unicode-normalization`, and `arrayvec`.
- `getrandom = "0.2.17"` - OS entropy for `generate_mnemonic` (a fresh 32-byte
  seed). Already in the transitive graph; pinned so the fresh-key path stays on
  one crate.

## Pinned conformance vectors

Seed = the 32 bytes `0x00..0x1f`. (a) is deterministic and PINNED from the JS.
(b) is now a self-contained **PURE Rust round-trip** (no JS pin) BY DESIGN: the
going-forward Rust payload is CLOCK-FREE and therefore *purer than the JS*, so
there is no JS signature to match - the JS legacy (with-`time`) shape is proven
instead by (c), reading a real on-disk JS act through `build_act_sig_payload_legacy`.

```
SEED_HEX   = 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
NAME_ID    = z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd
RAW_PUB_HEX= 03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8

# (b) an act ROW (carrying a wall-clock `at`, to prove the PURE builder IGNORES
# it) -> the CLOCK-FREE canonical bytes build_act_sig_payload produces. NO `time`:
ACT     = {"_id":"abc123","by":"z6Mke...gvVd","through":"i-am","to":"i-am",
           "story":"localhost","history":"0","p":"000...000",
           "at":"2026-06-25T13:01:25.361Z"}
PURE    = {"actId":"abc123","by":"z6Mke...gvVd","factIds":["alpha","mid","zeta"],
           "history":"0","p":"000...000","story":"localhost",
           "through":"i-am","to":"i-am"}        # sorted factIds, through kept, NO time
# round-trip: sign_value(SEED, PURE) -> verify_act_sig(rawPub, ACT, factIds, sig) == true
```

(d) The BIP39 mnemonic vectors (`mnref.mjs`, below). `FIXED_MNEMONIC` is the
canonical 24-word form of the SAME entropy `0x00..0x1f` as (a), so its seed IS
that entropy and its nameId IS (a)'s `NAME_ID` - tying the mnemonic path to the
already-proven keypair path. `FIXED_MNEMONIC_B` is entropy `0xff*32`.

```
FIXED_MNEMONIC   = abandon amount liar amount expire adjust cage candy arch gather
                   drum bullet absurd math era live bid rhythm alien crouch range
                   attend journey unaware
  -> seed (entropy) = 000102...1e1f   (== SEED, byte-for-byte; NO PBKDF2)
  -> NAME_ID        = z6MkehRgf7yJbgaGfYsdoAsKdBPE3dj2CYhowQdcjqSJgvVd   (== (a))

FIXED_MNEMONIC_B = zoo (x23) vote        (entropy 0xff*32)
  -> NAME_ID_B      = z6MknSLrJoTcukLrE435hVNQT4JUhbvWLX4kUzqkEStBU8Vi
```

(c) The real act gate reads the live store at the repo root (no pin needed; the
chain IS the fixture). The "am" genesis act on history `0`. This is a **LEGACY JS
act** - it baked the wall-clock in its sig - so it is verified through
`build_act_sig_payload_legacy` (the explicit, marked legacy path), NOT the pure
builder. The test also asserts the PURE builder does NOT verify it (it drops the
wall-clock the JS signed), which is exactly why the legacy helper is required.
New Rust acts do not carry that wall-clock.

```
ACT_ID   = 47f13daacad477b33865c516e29177a2f48931dff1542e3bba5049eb860e43f2
sig.by   = i-am          (the story key, NOT a Name pubkey)
factIds  = ["8d7c12f4f67477019224e14d1374cae47f30de6084e71ad22cade38f6900cc59"]
story pub= d2381d26e35ec37c915220dca280dceb047a435d46096a9318cfd16adfced7f0  (.story/story.key.pub)
verify   = true via build_act_sig_payload_LEGACY (with `time`) + verify_with_pubkey
           false via build_act_sig_payload (PURE, no `time`)  <- proves the split
```

(e) The key-load adapter gate also reads the live `.story/` (no pin; the files
ARE the fixture), or falls back to a generated keypair. The live story key:

```
story.key      = PKCS8 ed25519 PEM  (MC4CAQAwBQYDK2VwBCIEIP...)  48-byte DER
  -> seed         = f05578f0b49013e35ffa1041d39d063314e5866bd7fa24a5555c6d0dc2187bcc  (trailing 32)
  -> raw pub      = d2381d26e35ec37c915220dca280dceb047a435d46096a9318cfd16adfced7f0  (== (c) story pub)
story.key.pub  = SPKI ed25519 PEM   (MCowBQYDK2VwAyEA...)        44-byte DER -> same raw pub
priv name == pub name  (both faces name one being; ties to (c)'s identity)
```

## The node snippet (re-generate the pinned (a) vector + the LEGACY JS shape)

Run from the repo root (`JWT_SECRET=test-0123456789` only if your env demands
it; not needed for keys.js itself). NOTE: the `payload` below carries `time` -
that is the **LEGACY** (pre-purge) JS shape, the one the going-forward Rust no
longer signs. It is kept here only to document what an OLD JS act's sig was over
(the `build_act_sig_payload_legacy` shape that conformance (c) verifies); the
pure Rust round-trip (b) has no JS counterpart by design.

```js
// refvec.mjs
import { keypairFromSeed, signAsName, keyIdToPublicKey } from "./seed/materials/name/keys.js";
import { canonicalize } from "./seed/past/fact/hash.js";

const seed = Buffer.from(Array.from({ length: 32 }, (_, i) => i));   // 0x00..0x1f
const kp = keypairFromSeed(seed);
console.log("NAME_ID    =", kp.nameId);

const jwk = keyIdToPublicKey(kp.nameId).export({ format: "jwk" });
console.log("RAW_PUB_HEX=", Buffer.from(jwk.x, "base64url").toString("hex"));

// LEGACY shape (with `time`) - what an OLD JS act signed; the going-forward Rust
// drops `time`. For the modern PURE bytes, omit the `time` key here.
const payload = {
  actId: "abc123", by: kp.nameId, to: "i-am", story: "localhost",
  history: "0", p: "0".repeat(64),
  factIds: ["zeta", "alpha", "mid"],          // unsorted: tests the raw sign path
  time: "2026-06-25T13:01:25.361Z",
};
console.log("CANON      =", canonicalize(payload));
console.log("SIG_B64    =", signAsName(kp.privateKeyPem, payload));
```

```
JWT_SECRET=test-0123456789 node refvec.mjs
```

And the (d) mnemonic vectors (`mnref.mjs`, run from the repo root):

```js
// mnref.mjs
import { entropyToMnemonic, mnemonicToEntropy } from "./seed/materials/name/mnemonic.js";
import { keypairFromSeed } from "./seed/materials/name/keys.js";

const ent = Buffer.from(Array.from({ length: 32 }, (_, i) => i)); // 0x00..0x1f
const FIXED_MNEMONIC = entropyToMnemonic(ent);
console.log("FIXED_MNEMONIC =", JSON.stringify(FIXED_MNEMONIC));
const back = mnemonicToEntropy(FIXED_MNEMONIC);          // entropy IS the seed
console.log("ENTROPY_HEX    =", back.toString("hex"));   // == 0x00..0x1f
console.log("NAME_ID        =", keypairFromSeed(back).nameId);

const entB = Buffer.alloc(32, 0xff);
const MN_B = entropyToMnemonic(entB);                    // "zoo" x23 + "vote"
console.log("FIXED_MNEMONIC_B =", JSON.stringify(MN_B));
console.log("NAME_ID_B      =", keypairFromSeed(mnemonicToEntropy(MN_B)).nameId);
```

And to regenerate / re-confirm the (c) ground truth (rebuild + verify a real
act exactly as `verifyActSig` does), see `verifyact.mjs` in the scratchpad: it
reads `store/past/acts/localhost/0/i-/i-am.acts` + the matching being reel,
builds the payload with `buildActSigPayload`, and checks `verifyWithPublicKeyPem`
against `.story/story.key.pub`.

## Gotchas (the parity traps)

1. **`through` is the ONE field assigned RAW in `buildActSigPayload`** (no
   `?? null`). So `act.through === undefined` is **dropped** by canonicalize,
   while `act.through === null` is **kept** as `null` on the wire - and the two
   serialize differently. On a sealed act ROW `through` is present (`null` or a
   being id), so it is kept; a 5D name-act has no `through` key, so it is
   dropped. The Rust mirrors this exactly: present-key (even `Json::Null`) is
   copied; absent key is omitted. Every other field uses `?? null`, so it is
   always present as at least `null`. (See `payload.rs` + its unit tests
   `through_null_is_kept` / `through_absent_is_dropped`.)

2. **`raw_pub` for seed `0x00..0x1f` is `03a1...`, NOT `00..`** - the public key
   is the seed run through the ed25519 KDF (SHA-512 of the seed, clamp, scalar *
   basepoint), not the seed itself. If you ever see the seed echoed back as the
   pubkey, the keypair derivation is wrong.

3. **`time` is LEGACY-ONLY, and is the stored `at` ISO string taken verbatim.**
   The going-forward PURE `build_act_sig_payload` has **NO `time`** (no wall
   time). Only `build_act_sig_payload_legacy` emits it, to verify old JS acts. In
   that legacy shape `time` is the stored `at` verbatim - not re-parsed /
   re-formatted: on a sealed JS row `at` already IS the canonical
   `Date.toISOString()` form (`...T..:..:..Z`), so re-deriving it would only risk
   drifting from what the JS signer signed. A row with no/empty `at` -> `null`.
   **Never sign with the legacy builder** - that would re-introduce the wall-clock
   the time-purge removed.

4. **base64 alphabet + padding.** The sig uses STANDARD base64 (`+`/`/`, `=`
   padding), matching `Buffer.toString("base64")`. Do NOT use the URL-safe
   variant.

5. **`verify_strict`, not `verify`.** dalek's `verify_strict` rejects
   non-canonical / small-order points; Node's `crypto.verify` also rejects them,
   so strict keeps the accept-set identical. Plain `verify` would accept a few
   malleable signatures Node rejects - a parity hole.

6. **`is_key_id` is a cheap pre-filter only** (leading `"z"` + len > 1), exactly
   like the JS - it is NOT a full validity check. Full validation (multicodec +
   length + the 64-char DoS cap) is `key_id_to_pubkey`, which returns `None`
   (the Rust analogue of `verifyNameSig`'s try/catch -> false) rather than
   throwing.

7. **The 64-char id cap is a DoS guard.** base58 decode is O(n^2) and
   `is_key_id` only checks the leading `z`, so an oversized `sig.by` on an act
   row would otherwise force quadratic CPU per verification. `key_id_to_pubkey`
   refuses ids > `MAX_KEY_ID_LEN` (64) **before** decoding - same as `keys.js`.

8. **factIds sort.** `[...factIds].map(String).sort()` is JS
   `Array.prototype.sort` = UTF-16 code-unit order. fact ids are content-hash
   hex / ASCII ids, where code-unit order, byte order, and char order all
   coincide, so a plain sort matches; the Rust still sorts by `encode_utf16()`
   to be exact regardless of future id alphabets.

9. **mnemonic = entropy, NOT PBKDF2 to_seed.** The single biggest mnemonic
   parity trap: `bip39::Mnemonic::to_seed()` (the standard BIP39 stretch) gives
   the WRONG 64-byte salted value. The JS uses the raw 32-byte entropy as the
   seed (`mnemonic.js`: "the entropy IS the key seed"), so `mnemonic_to_seed`
   calls `to_entropy`, never `to_seed`. Same wordlist, same `sha256(entropy)[0]`
   checksum, no stretch, no passphrase, no BIP32 - proven by vector (d) landing
   on the exact (a) seed/nameId.

10. **PKCS8 seed = the trailing 32 bytes, prefix VERIFIED.** An ed25519 PKCS8
    private key is exactly `302e020100300506032b657004220420` (16 bytes) ||
    the 32-byte seed (48 bytes total). `seed_from_pkcs8_pem` takes the last 32
    AND checks the fixed prefix, so a wrong-curve key (RSA / P-256) or an SPKI
    PUBLIC key (44-byte DER, the wrong shape) is a hard `NotPkcs8Ed25519`, never
    a silently-wrong seed. This is the inverse of the wrap `keys.js` does on
    import; the public peer (the 12-byte-prefix SPKI) is decoded by the
    conformance test's `read_ed25519_spki_pub`.
```
