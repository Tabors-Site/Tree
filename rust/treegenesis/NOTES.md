# treegenesis - the headless genesis planter

Plants a fresh Story's genesis with **NO Node**, using the signed **CLOCK-FREE**
seal over the determinism spine (`treestore` + `treesign`). Mirrors
`seed/sprout.js` `ensureIAm` (the self-grounding parentless root birth, per
`philosophy/I_AM.md` + `root.md` "the Root is signed, never folded") and
`seed/storyIdentity.js` first-boot key mint.

**THE CORRECTION (genesis is TWO moments, not a fusion).** Genesis is **TWO
separate one-word moments**: `name:declare` ("I") then `be:birth` ("am"). "I" and
"am" are TWO acts and TWO Words, so they are TWO moments
(`project_spacebar_moments`: one word = one fact = one moment). An earlier version
of this crate wrote them as **ONE act with two facts on two reels** - a "lone
sanctioned fusion" that bypassed the seal's one-reel / run-on refusal. That was a
**stale-doc DRIFT** from the Spacebar Law (per Tabor), and it is now **REMOVED**:
each moment is one act -> one fact -> one reel, sealed by the **general**
`commit_moment_signed`, with **NO genesis exemption** and **NO special writer**.
The Spacebar Law holds at genesis too.

This is **Step 4** of the Rust port. STANDALONE: it is NOT wired into `treeos`
(the boot binary). See "the treeos handoff" below for the `genesis` subcommand.

## The API

```rust
// 1. Load or mint the I key (the story key). First boot mints + writes
//    .story/story.key (PKCS8 PEM, 0600) + .story/story.key.pub (SPKI PEM, 0644);
//    a returning boot reads them back. Honors STORY_KEY_DIR (the CALLER resolves
//    the env; pass the dir).
pub fn load_or_mint_i_key(story_dir: &Path) -> Result<StoryKey, KeyMintError>;
pub struct StoryKey { pub seed: [u8;32], pub raw_pub: [u8;32], pub minted: bool }

// 2. Plant the genesis: TWO separate signed clock-free moments (name:declare
//    "I", then be:birth "am"), each one act -> one fact -> one reel via the
//    general commit_moment_signed. No fusion, no exemption.
pub fn plant_genesis(
    root: &Path,            // the store root (reels/ + acts/)
    story_domain: &str,     // the library reel id; also act.story
    i_name: &str,           // I_NAME_DEFAULT ("i-am") or I_NAME_RENAMED ("I")
    story_key: &StoryKey,   // from load_or_mint_i_key; signs BOTH genesis acts
    qualities: Option<Json>,// None -> sprout.js's scripted-cognition default
) -> Result<Planted, GenesisError>;

pub struct Planted {
    pub name_act_id: String,     // MOMENT 1 "I" = name:declare (act #0, ord 0)
    pub being_act_id: String,    // MOMENT 2 "am" = be:birth (act #1, ord 1)
    pub library_fact_id: String, // name:declare fact (the library reel)
    pub being_fact_id: String,   // be:birth fact (the being reel) - the I-Am
    pub i_name: String,          // the FORK surfaced: "i-am" (default) or "I"
    pub being_id: String,        // == i_name (the I-Am's _id IS the I-name)
    pub story_domain: String,
}

pub const I_NAME_DEFAULT: &str = "i-am"; // on-disk + story-sig compatible
pub const I_NAME_RENAMED: &str = "I";    // the in-flight rename target
```

## The two genesis moments (mirror `sprout.js` ensureIAm, read as TWO Words)

Genesis is **TWO separate one-word moments**, in order. Each is one act -> one
fact -> one reel.

- **MOMENT 1 = "I" = `name:declare` -> the LIBRARY reel** `(history "0", kind
  "library", id <storyDomain>)`, `ord` 0:
  `{verb:"name", act:"declare", through:<I-name>, of:{kind:"library",
  id:<storyDomain>}, params:{nameId:<I-name>, spec:{parentNameId:null,
  privateKeyEnc:null, identity:{alg:"ed25519", keyEnc:"story-key", v:1},
  soulType:"scripted"}}}`. I is first a **Name** (the root identity,
  `parentNameId:null`); it signs with the **story key** (`privateKeyEnc:null`,
  `keyEnc:"story-key"`), so verification routes to the story pubkey. The act
  chains from `GENESIS_PREV` (the empty chain); the library fact is fact #0
  (`p = GENESIS_PREV`).

- **MOMENT 2 = "am" = `be:birth` -> the BEING reel** `(history "0", kind "being",
  id <beingId>)`, `ord` 1:
  `{verb:"be", act:"birth", through:<beingId>, of:{kind:"being", id:<beingId>},
  params:{name:<I-name>, ables:[], defaultAble:null, trueName:<I-name>,
  parentBeingId:null, homeSpace:null, position:null, qualities:{...}}}`.
  **`parentBeingId:null` is THE genesis marker** (the root of the being-tree).
  `homeSpace:null` at birth (heaven does not exist yet - the split-birth-from-home
  doctrine). The act chains off **MOMENT 1's act id** (the I's act-chain, in
  order); the being fact is fact #0 of the being reel (`p = GENESIS_PREV`).

These are **TWO moments**, NOT a fusion. Both acts ride the **same** act-chain
(keyed by the I-name `by`, signed by the **same** I key), so the chain advances
1 -> 2 naturally.

## How genesis is sealed: the GENERAL path, TWICE (no special writer, no fusion)

`plant_genesis` makes **two ordinary `commit_moment_signed` calls** - the same
seal every non-genesis act uses. There is **no genesis-specific writer** and **no
fanout bypass**: each moment is one act -> one fact -> one reel, so the seal's
one-reel / run-on refusal (`seal.fanout` -> `RunOn`) never even fires. The earlier
"lone exemption" that hand-wrote 2 facts under 1 act (bypassing the refusal) was a
**DRIFT** from the Spacebar Law and has been **deleted**; the general seal does
the whole job at genesis.

Why this is correct (and why the fusion was wrong):

1. **One word = one fact = one moment** (`project_spacebar_moments`). "I"
   (`name:declare`) and "am" (`be:birth`) are two Words, hence two acts, hence two
   moments. Writing them as one act with two facts collapsed two Words into one
   moment - the exact run-on the Spacebar Law forbids. Genesis is **not** exempt.
2. **No exemption to maintain.** The fusion needed a genesis-only writer that
   bypassed `seal.fanout`, plus prose justifying why the lone exemption was safe.
   Two normal moments need none of that: the general `commit_moment_signed` is the
   only path, so the drift cannot persist in the codebase.
3. **The chain carries the order.** MOMENT 1 stamps off the empty chain head
   (`GENESIS_PREV`) and advances it; MOMENT 2 stamps off MOMENT 1's act id. The
   `p`-chain *is* the "I then am" order - no fusion needed to keep them together.

The signature is the same INJECTION seam `commit_moment_signed` uses: treestore
stays zero-crypto; `plant_genesis` builds **one** `sign` closure (it holds the
story seed) and passes it to **both** calls. The closure signs the **PURE,
clock-free** `treesign::build_act_sig_payload` over the stamped act opening + that
moment's committed fact id, attaching `{alg:"ed25519", by:<i_name>, value}` as a
closure field (outside `content_of_act`, so `_id` is unchanged). The two moments'
signatures differ (each commits to its own chain `p` + its own `factId`).

## CLOCK-FREE (the time-purge, `philosophy/crystalized.md`)

NO `at` / `date` / `time` anywhere - proven by the test (it canonicalizes BOTH
acts + both facts + both sig payloads and asserts no `"at":` / `"date":` / `time`
substring). Order is `ord` (the **global append ordinal**, genesis MOMENT 1 = 0,
MOMENT 2 = 1, NOT a wall-clock) + the per-reel `seq` + the chain `p`. Each act
rides `ord` post-id (non-digest); each fact gets `ord` via the `commit_moment_signed`
call's `ord` argument (which threads it through `seal_moment`).

## The I-immutability (genesis facts never overwritten)

Covered by the general seal's never-overwrite-committed
(`project_iam_genesis_immutable`): `commit_moment_signed` is idempotent by per-reel
`seq` (a re-plant of the SAME genesis never rewrites a committed fact #0) and the
`.acthead` CAS refuses a stale author. `plant_genesis` adds the guard **at the
door**: an already-planted being reel -> `GenesisError::AlreadyPlanted`, **no
second write** (so the second `commit_moment_signed` is never even reached). The
test proves a second plant is refused AND fact #0 on both reels + **both** genesis
acts stay byte-for-byte unchanged.

## THE `i-am` vs `I` FORK - recommendation

There is an **in-flight rename `i-am` -> `I`**. The state of the fork TODAY:

- **`treeibp`** already uses `const I_AM = "I"` (and accepts `"I"`, `"i-am"`,
  `"I"` as the I-Am - `treeibp/src/lib.rs:224`).
- **The on-disk store + `treesign`'s verify path** expect the **literal
  `"i-am"`**: an `"i-am"` sig is NOT a pubkey id, so it routes to the story
  pubkey (`verify_with_pubkey` / the story-key path), not an id-recovered key.
  `seed/sprout.js` + `seed/storyIdentity.js` still mint + sign as `"i-am"`.

**Recommendation: default to `"i-am"`, parameterize to `"I"`, do NOT hardcode.**
`plant_genesis` takes `i_name` and surfaces it on `Planted.i_name`; the consts
`I_NAME_DEFAULT` ("i-am") and `I_NAME_RENAMED` ("I") name both sides. New Stories
should be planted under **`I_NAME_DEFAULT`** until the rename lands **everywhere**
(the store reel keys, `treesign`'s `"i-am"`-special-case verify routing, and
`seed/sprout.js`/`storyIdentity.js`) - otherwise a Story planted under `"I"` would
have a `names["I"]` catalog + a `"I"`-keyed act-chain that the live JS story (which
looks for `"i-am"`) would not recognize as its own root. The fork is one string
value, fully isolated to the `i_name` argument; flip the default to
`I_NAME_RENAMED` in ONE place the day the verify + store + seed paths all follow.
(The test `plants_under_the_renamed_i_name` proves the `"I"` side folds + verifies
+ signs identically, so the planter is ready the instant the rest is.)

## THE TREEOS HANDOFF - how `treeos` calls `treegenesis` as a `genesis` subcommand

`treeos` is the standalone boot binary (read + fold + verify the on-disk chain).
Today its `main.rs` is being live-edited by the other agent, so this crate does
**NOT** touch it. When ready, add a `genesis` subcommand. The sketch (drop into
`treeos/main.rs`'s arg dispatch; add `treegenesis = { path = "../treegenesis" }`
to `treeos/Cargo.toml`):

```rust
// `treeos genesis [--root <dir>] [--story <domain>] [--name i-am|I]`
// Plant a fresh Story's genesis headless, then (optionally) fold + verify it.
fn cmd_genesis(root: &Path, story_domain: &str, i_name: &str) -> Result<(), Box<dyn Error>> {
    // STORY_KEY_DIR honored, defaulting to <root>/.story (storyIdentity.js's
    // `process.env.STORY_KEY_DIR || path.join(cwd, ".story")`).
    let key_dir = std::env::var_os("STORY_KEY_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join(".story"));
    let key = treegenesis::load_or_mint_i_key(&key_dir)?;
    if key.minted {
        eprintln!("minted a fresh story key at {}", key_dir.display());
    }
    match treegenesis::plant_genesis(root, story_domain, i_name, &key, None) {
        Ok(p) => {
            println!("genesis planted: I-name={} being={}", p.i_name, p.being_id);
            println!("  MOMENT 1 name:declare act {}  library fact {}", p.name_act_id, p.library_fact_id);
            println!("  MOMENT 2 be:birth     act {}  being   fact {}", p.being_act_id, p.being_fact_id);
        }
        Err(treegenesis::GenesisError::AlreadyPlanted) => {
            // idempotent: a re-run on a planted Story is a no-op (NOT an error to
            // the operator - genesis ran once; the boot continues).
            eprintln!("genesis already planted (idempotent no-op)");
        }
        Err(e) => return Err(Box::new(e)),
    }
    // OPTIONAL: treeos's existing read+fold+verify path can now run against the
    // freshly-planted reels (reels/0/library/<domain> + reels/0/being/<i_name>)
    // to confirm the boot sees a whole, foldable chain.
    Ok(())
}
```

Notes for the wiring agent:
- The `story_domain` should come from the same source the JS uses
  (`process.env.STORY_DOMAIN`, cleaned of protocol/port - `cleanDomain` in
  `storyIdentity.js`), defaulting to `"localhost"`.
- The `--name` flag picks the fork; default `I_NAME_DEFAULT`. Do NOT expose `"I"`
  as the default until the verify + store + seed paths follow the rename (above).
- `plant_genesis` is the FULL genesis-of-self (name + being). The rest of the JS
  genesis sequence (`ensureSpaceRoot`, heaven, tier-3 spaces, delegates) is the
  Word-driven scaffold that follows - a later step, on top of this root.
- Genesis is TWO moments ("I" then "am") that `plant_genesis` plants together;
  the subcommand runs it once, and `AlreadyPlanted` makes a re-run safe (the boot
  guard, like `withGenesisGuard`'s singleton).

## Tests (`cargo test -p treegenesis`)

- `keymint::tests` (4) - PKCS8 PEM round-trips through `treesign::seed_from_pkcs8_pem`;
  SPKI PEM well-formed + carries the right pub; mint-then-reload is seed-stable;
  the private key is 0600.
- `genesis.rs` (3):
  - `plants_folds_verifies_and_signs_genesis` - the full TWO-moment contract: FOLD
    (library names catalog + parentless being projection), the I's act-chain holds
    **TWO acts in order** (name:declare from GENESIS_PREV, then be:birth chained
    off it), VERIFY (both fact-reels + the two-act act-chain from GENESIS_PREV),
    SIGNATURE (**both** acts `verify_act_sig` against the story pubkey, the
    `"i-am"` path; wrong-key + tampered-factId + cross-bound-factId all fail),
    CLOCK-FREE, `parentBeingId:null`.
  - `re_plant_is_refused_and_genesis_is_immutable` - the I-immutability guard (both
    acts + both facts stay byte-for-byte unchanged on a refused re-plant).
  - `plants_under_the_renamed_i_name` - the `"I"` fork: two moments fold + verify +
    both sigs.
