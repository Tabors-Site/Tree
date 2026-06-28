# treegenesis - the headless genesis planter

Plants a fresh Story's genesis with **NO Node**, using the signed **CLOCK-FREE**
seal over the determinism spine (`treestore` + `treesign`). Mirrors
`seed/sprout.js` `ensureIAm` (the lone sanctioned 2-fact fusion - the
self-grounding parentless root birth, per `philosophy/I_AM.md` + `root.md` "the
Root is signed, never folded") and `seed/storyIdentity.js` first-boot key mint.

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

// 2. Plant the genesis: the 2-fact/2-reel fusion as ONE signed clock-free moment.
pub fn plant_genesis(
    root: &Path,            // the store root (reels/ + acts/)
    story_domain: &str,     // the library reel id; also act.story
    i_name: &str,           // I_NAME_DEFAULT ("i-am") or I_NAME_RENAMED ("I")
    story_key: &StoryKey,   // from load_or_mint_i_key; signs the genesis act
    qualities: Option<Json>,// None -> sprout.js's scripted-cognition default
) -> Result<Planted, GenesisError>;

pub struct Planted {
    pub act_id: String,          // the genesis act (on the I-name's act-chain)
    pub library_fact_id: String, // name:declare fact (the library reel)
    pub being_fact_id: String,   // be:birth fact (the being reel) - the I-Am
    pub i_name: String,          // the FORK surfaced: "i-am" (default) or "I"
    pub being_id: String,        // == i_name (the I-Am's _id IS the I-name)
    pub story_domain: String,
}

pub const I_NAME_DEFAULT: &str = "i-am"; // on-disk + story-sig compatible
pub const I_NAME_RENAMED: &str = "I";    // the in-flight rename target
```

## The two genesis shapes (mirror `sprout.js` ensureIAm)

- **`name:declare` -> the LIBRARY reel** `(history "0", kind "library", id
  <storyDomain>)`:
  `{verb:"name", act:"declare", through:<I-name>, of:{kind:"library",
  id:<storyDomain>}, params:{nameId:<I-name>, spec:{parentNameId:null,
  privateKeyEnc:null, identity:{alg:"ed25519", keyEnc:"story-key", v:1},
  soulType:"scripted"}}}`. I is first a **Name** (the root identity,
  `parentNameId:null`); it signs with the **story key** (`privateKeyEnc:null`,
  `keyEnc:"story-key"`), so verification routes to the story pubkey.

- **`be:birth` -> the BEING reel** `(history "0", kind "being", id <beingId>)`:
  `{verb:"be", act:"birth", through:<beingId>, of:{kind:"being", id:<beingId>},
  params:{name:<I-name>, ables:[], defaultAble:null, trueName:<I-name>,
  parentBeingId:null, homeSpace:null, position:null, qualities:{...}}}`.
  **`parentBeingId:null` is THE genesis marker** (the root of the being-tree).
  `homeSpace:null` at birth (heaven does not exist yet - the split-birth-from-home
  doctrine).

These **fuse into ONE atomic moment** - the lone exemption to one-word-one-fact.

## How the genesis fusion is handled: a GENESIS-SPECIFIC WRITER (not a flag)

Genesis is **2 facts on 2 reels** (library + being) under **one act**. The strict
`commit_moment` / `commit_moment_signed` **REFUSE** this - `seal.fanout` (the
act fanned across >1 reel) is `RunOn`, the run-on the no-journal floor cannot
tail-truncate (the one-reel law).

I chose the **genesis-specific writer** (`plant_genesis`) over extending
`commit_moment_signed` with an `allow_genesis_fusion` flag. Why this is the
cleaner option (the task offered either):

1. **Genesis is fact #0 of a fresh chain.** No prior, no torn-write tail, no
   concurrent author. The whole recovery / pair-check machinery the general seal
   runs (`recover_*_before_commit`) exists for **existing** chains; at genesis
   every reel + act-chain is empty, so there is nothing to recover. The
   exemption has no need of the general path's safety scaffolding.
2. **Containment.** The fusion is the *lone* exemption to one-word-one-fact and
   it belongs *in the genesis writer*. A flag would thread a genesis concern
   through the general seal (every non-genesis caller would carry a knob it must
   never set), and would mean **editing `treestore`** - which the other agent is
   live-editing and the task says to leave standalone.
3. **Byte-identical bytes, only the refusal bypassed.** `plant_genesis` REUSES
   treestore's stamp building blocks - `seal_moment` (stamps both facts purely,
   threading each reel's head, attaching `ord`), `compute_act_doc` (the act
   identity + chain link), `write_fact_doc` (the idempotent reel append),
   `append_act_line` + `advance_act_head_file` (the act-log + CAS). It bypasses
   ONLY the `seal.fanout` *refusal*; the bytes written are exactly what the seal
   would write. It mirrors `commit_moment_signed`'s **act-first** order:
   seal both facts purely -> stamp + sign the act + write it FIRST -> write both
   facts. Fact #0 of each reel lands at `p = GENESIS_PREV`.

The signature is the same INJECTION seam `commit_moment_signed` uses: treestore
stays zero-crypto; `plant_genesis` builds the `sign` closure itself (it holds the
story seed) and signs the **PURE, clock-free** `treesign::build_act_sig_payload`
over the stamped act opening + the two committed fact ids, attaching
`{alg:"ed25519", by:<i_name>, value}` as a closure field (outside `content_of_act`,
so `_id` is unchanged).

## CLOCK-FREE (the time-purge, `philosophy/crystalized.md`)

NO `at` / `date` / `time` anywhere - proven by the test (it canonicalizes the act
+ both facts + the sig payload and asserts no `"at":` / `"date":` / `time`
substring). Order is `ord` (the **global append ordinal**, genesis = 0, NOT a
wall-clock) + the per-reel `seq` + the chain `p`. The act rides `ord` post-id
(non-digest); the facts get `ord` via `seal_moment(.., Some(ord), ..)`.

## The I-immutability (genesis facts never overwritten)

Covered by the seal's never-overwrite-committed (`project_iam_genesis_immutable`):
`write_fact_doc` is idempotent by per-reel `seq` (a re-plant of the SAME genesis
never rewrites the committed fact #0) and `advance_act_head_file`'s CAS refuses a
stale author. `plant_genesis` adds the guard **at the door**: an already-planted
being reel -> `GenesisError::AlreadyPlanted`, **no second write**. The test
proves a second plant is refused AND fact #0 on both reels + the act stay
byte-for-byte unchanged.

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
            println!("genesis planted: I-name={} being={} act={}", p.i_name, p.being_id, p.act_id);
            println!("  library fact {}  being fact {}", p.library_fact_id, p.being_fact_id);
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
- Genesis is ONE moment: the subcommand plants it once; `AlreadyPlanted` makes a
  re-run safe (the boot guard, like `withGenesisGuard`'s singleton).

## Tests (`cargo test -p treegenesis`)

- `keymint::tests` (4) - PKCS8 PEM round-trips through `treesign::seed_from_pkcs8_pem`;
  SPKI PEM well-formed + carries the right pub; mint-then-reload is seed-stable;
  the private key is 0600.
- `genesis.rs` (3):
  - `plants_folds_verifies_and_signs_genesis` - the full contract: FOLD (library
    names catalog + parentless being projection), VERIFY (both fact-reels + the
    act-chain from GENESIS_PREV), SIGNATURE (`verify_act_sig` against the story
    pubkey, the `"i-am"` path; wrong-key + tampered-factId fail), CLOCK-FREE,
    `parentBeingId:null`.
  - `re_plant_is_refused_and_genesis_is_immutable` - the I-immutability guard.
  - `plants_under_the_renamed_i_name` - the `"I"` fork folds + verifies + signs.
