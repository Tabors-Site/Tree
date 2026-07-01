// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// treegenesis - the genesis planter, headless. Plants a fresh Story's
// self-grounding parentless root birth with NO Node, over the determinism spine
// (treestore + treesign). The seal is CLOCK-FREE (philosophy/crystalized.md, the
// time-purge): NO `at`/`date`/`time`. Order is `ord` (a global append ordinal,
// NEVER a wall-clock) + the per-reel seq + the chain `p`.
//
// THE GENESIS SHAPE = TWO SEPARATE ONE-WORD MOMENTS. "I" and "am" are TWO acts
// and TWO Words, so they are TWO moments (project_spacebar_moments: one word =
// one fact = one moment). There is NO fusion: genesis is NOT exempt from the
// Spacebar Law. Each moment is one act -> one fact -> one reel, so each passes
// the NORMAL `commit_moment_signed` with NO genesis exemption and NO special
// writer (mirrors seed/sprout.js ensureIAm read as two ordered openings, per
// philosophy/I_AM.md + root.md "the Root is signed, never folded"):
//
//   MOMENT 1 = "I"  -> name:declare -> the LIBRARY reel (of:{kind:"library",
//     id:<storyDomain>}), `ord` 0: I is first a NAME (the root identity,
//     parentNameId=null - a facet of nothing above). The declare lands on the
//     story's library reel keyed by nameId; the Name signs with the STORY key
//     (privateKeyEnc=null, identity keyEnc="story-key"), so verification routes
//     to the story pubkey. This act chains from GENESIS_PREV (the empty chain).
//
//   MOMENT 2 = "am" -> be:birth -> the BEING reel (of:{kind:"being",
//     id:<beingId>}), `ord` 1: the being that expresses the Name (trueName=
//     <I-name>). parentBeingId=null is THE genesis marker - the root of the
//     being-tree, a facet of nothing above. homeSpace=null at birth (heaven does
//     not exist yet). This act chains on the I's act-chain off MOMENT 1's act id.
//
// Both acts ride the SAME act-chain (keyed by the I-name `by`, signed by the same
// I key), so the chain advances 1->2 naturally; each reel's first fact has
// `p = GENESIS_PREV`. The earlier code wrote these as ONE act with two facts on
// two reels (a "lone sanctioned fusion" that bypassed the seal's one-reel /
// run-on refusal). That was a DRIFT from the Spacebar Law and is now REMOVED:
// genesis is two normal moments, sealed by the general path, no exemption.
//
// THE I-NAME IS "I". The I-being's name is "I"; the fresh world is born by this
// Rust genesis and plants "I" on purpose. The sig routes to the story pubkey (the
// literal "I" is not a pubkey id, so verification routes by raw pub, not an
// id-recovered key). treeibp carries `const I_AM = "I"`, treewordfold reads the
// "I" reel, and plant_genesis hard-codes "I" (I_NAME_DEFAULT). See Planted.i_name.
//
// THE I-IMMUTABILITY (project_iam_genesis_immutable: genesis facts are never
// overwritten). The general seal's never-overwrite-committed covers it:
// commit_moment_signed is idempotent by per-reel seq (a re-plant of the SAME
// genesis is a pure no-op, it never rewrites a committed fact #0) and the
// .acthead CAS refuses a stale author. plant_genesis adds the guard at the door
// (an already-planted being reel -> AlreadyPlanted, no second write).

mod keymint;

use std::io;
use std::path::Path;

use treehash::Json;
use treestore::{
    commit_moment_signed, read_reel_file, CommitError, Committed,
};

pub use keymint::{load_or_mint_i_key, KeyMintError, StoryKey};

/// The I-name: the literal `"I"`. The I-being's name IS "I" — the fresh world is
/// born by this Rust genesis and plants "I". The sig routes to the story pubkey
/// (the literal "I" is not a pubkey id, so the story path verifies by raw pub).
/// treeibp carries `const I_AM = "I"` and treewordfold reads the "I" reel; this
/// makes the whole Rust line agree.
pub const I_NAME_DEFAULT: &str = "I";

/// What a planted genesis returns: the two acts' + facts' ids, the reels they
/// landed on, and the I-name ("I").
#[derive(Debug, Clone)]
pub struct Planted {
    /// MOMENT 1's act id ("I" = name:declare, on the I-name's act-chain, ord 0).
    pub name_act_id: String,
    /// MOMENT 2's act id ("am" = be:birth, the next act on the same chain, ord 1).
    pub being_act_id: String,
    /// The name:declare fact's id (on the library reel).
    pub library_fact_id: String,
    /// The be:birth fact's id (on the being reel). The genesis being.
    pub being_fact_id: String,
    /// The I-name used (always `"I"`). Surfaced so the caller can read it back.
    pub i_name: String,
    /// The being id (== the I-name on a fresh install: the I-Am's _id IS the
    /// I-name string, the doctrinal shape - sprout.js ensureIAm).
    pub being_id: String,
    /// The story domain (the library reel id).
    pub story_domain: String,
}

/// plant_genesis can refuse: the being reel already carries genesis (AlreadyPlanted -
/// the I-immutability guard at the door), the act-chain moved under a stale
/// author (ChainMoved - the CAS), or the filesystem failed.
#[derive(Debug)]
pub enum GenesisError {
    /// The being reel already holds a fact: this Story's genesis was already
    /// planted. Genesis facts are never overwritten (project_iam_genesis_immutable);
    /// the caller is re-planting and should not. Idempotent: nothing was written.
    AlreadyPlanted,
    /// The act-chain head moved under a stale author (ACT_CHAIN_MOVED). At
    /// genesis the chain starts empty, so this only fires if a concurrent writer
    /// raced in; the chain can't fork.
    ChainMoved,
    Io(io::Error),
}
impl From<io::Error> for GenesisError {
    fn from(e: io::Error) -> Self {
        GenesisError::Io(e)
    }
}
/// Map the general seal's refusal onto the genesis vocabulary. Factless / RunOn
/// are structurally impossible here (each genesis moment is exactly one act ->
/// one fact -> one reel), so they are defensive: surface them as Io rather than
/// inventing a genesis-only variant the planter can never actually reach.
impl From<CommitError> for GenesisError {
    fn from(e: CommitError) -> Self {
        match e {
            CommitError::ChainMoved => GenesisError::ChainMoved,
            CommitError::Io(io) => GenesisError::Io(io),
            CommitError::Factless => GenesisError::Io(io::Error::new(
                io::ErrorKind::Other,
                "genesis moment laid no fact (impossible: each moment is one act -> one fact)",
            )),
            CommitError::RunOn(reels) => GenesisError::Io(io::Error::new(
                io::ErrorKind::Other,
                format!("genesis moment fanned across {reels} reels (impossible: one act -> one reel)"),
            )),
        }
    }
}
impl std::fmt::Display for GenesisError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GenesisError::AlreadyPlanted => {
                write!(f, "genesis already planted (the being reel is not empty); genesis facts are never overwritten")
            }
            GenesisError::ChainMoved => write!(f, "act-chain moved under a stale author (ACT_CHAIN_MOVED)"),
            GenesisError::Io(e) => write!(f, "genesis io: {e}"),
        }
    }
}
impl std::error::Error for GenesisError {}

// ── tiny Json builders (treegenesis stays dependency-light, like treestore) ───

fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn obj(pairs: Vec<(&str, Json)>) -> Json {
    Json::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

// ── the genesis openings (mirror sprout.js ensureIAm, CLOCK-FREE) ────────────

/// The default qualities for the I-Am being (sprout.js: scripted cognition,
/// code-cognition only - no LLM). The caller may override via `plant_genesis`.
fn default_i_qualities() -> Json {
    obj(vec![(
        "cognition",
        obj(vec![("defaultKind", jstr("scripted"))]),
    )])
}

/// The name:declare fact spec - the LIBRARY reel opening. `through` is the
/// I-name (self-stamping: I declares its own name). of:{kind:"library",
/// id:<storyDomain>}. The spec mirrors sprout.js exactly: parentNameId=null (the
/// root name), privateKeyEnc=null (signs with the story key), identity keyEnc=
/// "story-key", soulType="scripted". CLOCK-FREE (no date). It is the lone entry
/// in MOMENT 1's `deltaF` (one act -> one fact -> one reel).
fn name_declare_fact(i_name: &str, story_domain: &str) -> Json {
    obj(vec![
        ("verb", jstr("name")),
        ("act", jstr("declare")),
        ("through", jstr(i_name)), // self-stamping
        ("of", obj(vec![("kind", jstr("library")), ("id", jstr(story_domain))])),
        (
            "params",
            obj(vec![
                ("nameId", jstr(i_name)),
                (
                    "spec",
                    obj(vec![
                        ("parentNameId", Json::Null), // the root name, a facet of nothing above
                        ("privateKeyEnc", Json::Null), // signs with the story key, not a stored key
                        (
                            "identity",
                            obj(vec![
                                ("alg", jstr("ed25519")),
                                ("keyEnc", jstr("story-key")),
                                ("v", Json::Num(1.0)),
                            ]),
                        ),
                        ("soulType", jstr("scripted")),
                    ]),
                ),
            ]),
        ),
        ("history", jstr("0")),
    ])
}

/// The be:birth fact spec - the BEING reel opening. through=beingId (self-
/// stamping: the not-yet-existing being is its own actor, through I). of:{kind:
/// "being", id:<beingId>}. **parentBeingId=null is THE genesis marker** (the
/// root of the being-tree). name=trueName=<I-name>, ables=[], homeSpace=null
/// (heaven does not exist yet). CLOCK-FREE. It is the lone entry in MOMENT 2's
/// `deltaF` (one act -> one fact -> one reel).
fn be_birth_fact(i_name: &str, being_id: &str, qualities: Json) -> Json {
    obj(vec![
        ("verb", jstr("be")),
        ("act", jstr("birth")),
        ("through", jstr(being_id)), // self-stamping through I
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr(being_id))])),
        (
            "params",
            obj(vec![
                ("name", jstr(i_name)),
                ("ables", Json::Arr(vec![])),
                ("defaultAble", Json::Null),
                ("trueName", jstr(i_name)), // the being expresses the I Name
                ("parentBeingId", Json::Null), // THE genesis marker
                ("homeSpace", Json::Null),     // heaven does not exist yet
                ("position", Json::Null),
                ("qualities", qualities),
            ]),
        ),
        ("history", jstr("0")),
    ])
}

/// A genesis act carrying its lone fact in `deltaF`, ready for
/// `commit_moment_signed` (which strips `deltaF` to the act opening, seals the
/// one fact, and stamps the act on the chain). Mirrors sprout.js withIAmAct's
/// opening, CLOCK-FREE: by/through/to = the I-name, story=<storyDomain>,
/// history="0". by IS the signer (the I-name); the act-chain keys by it. No
/// wall-clock anywhere. `fact` is the single fact this moment lays (its Word).
fn genesis_act(i_name: &str, story_domain: &str, fact: Json) -> Json {
    obj(vec![
        ("by", jstr(i_name)),      // the signer + the act-chain key
        ("through", jstr(i_name)), // I the being expresses I the Name
        ("to", jstr(i_name)),
        ("story", jstr(story_domain)),
        ("history", jstr("0")),
        (
            "startMessage",
            obj(vec![
                ("content", jstr("I am that I am.")),
                ("source", jstr(i_name)),
            ]),
        ),
        // The one fact this moment lays (one word = one fact). commit_moment_signed
        // strips deltaF to the opening for the act_id and seals this fact on its reel.
        ("deltaF", Json::Arr(vec![fact])),
    ])
}

// ── the genesis planter: TWO normal one-word moments (no fusion) ─────────────

/// Plant a fresh Story's genesis: the self-grounding parentless root birth, as
/// TWO separate signed clock-free moments. "I" (name:declare on the library
/// reel) and "am" (be:birth on the being reel) are TWO acts and TWO Words, so
/// they are TWO moments - the Spacebar Law (one word = one fact = one moment)
/// holds at genesis with NO exemption. NO Node.
///
/// - `root`         the store root (where reels/ + acts/ live).
/// - `story_domain` the Story's domain (the library reel id; also act.story).
/// - `story_key`    the I key (the story key) that signs BOTH genesis acts. Load
///                  it with `load_or_mint_i_key`. Its `raw_pub` is what an
///                  I act verifies against (the literal "I" is not a
///                  pubkey id, so the story path verifies by raw pub).
/// - `qualities`    the being's qualities (None -> the scripted-cognition
///                  default from sprout.js).
///
/// TWO NORMAL MOMENTS (each one act -> one fact -> one reel, via the general
/// `commit_moment_signed` - no special writer, no fanout bypass):
///   0. GUARD: the being reel must be empty (else AlreadyPlanted - genesis facts
///      are never overwritten). At genesis everything is empty, so there is no
///      torn-write tail to recover; the guard is the only door check.
///   1. MOMENT 1 = "I" = name:declare, `ord` 0: commit_moment_signed seals the
///      lone library-reel fact and stamps the act off the (empty) chain head
///      (= GENESIS_PREV), signs it with the I key, writes it. The library fact
///      lands at fact #0 (p = GENESIS_PREV).
///   2. MOMENT 2 = "am" = be:birth, `ord` 1: commit_moment_signed seals the lone
///      being-reel fact and stamps the act off MOMENT 1's act id (the chain
///      advanced), signs it with the same I key, writes it. The being fact lands
///      at fact #0 of the being reel (p = GENESIS_PREV).
/// Both acts ride the I's act-chain; each reel's fact #0 is at p = GENESIS_PREV.
pub fn plant_genesis(
    root: &Path,
    story_domain: &str,
    story_key: &StoryKey,
    qualities: Option<Json>,
) -> Result<Planted, GenesisError> {
    let i_name = I_NAME_DEFAULT; // the I-being's name IS "I"
    let being_id = i_name.to_string(); // the I-Am's _id IS the I-name (sprout.js)
    let quals = qualities.unwrap_or_else(default_i_qualities);

    // 0. THE I-IMMUTABILITY GUARD (project_iam_genesis_immutable). If the being
    //    reel already carries a fact, genesis was already planted; refuse rather
    //    than write a second time. (commit_moment_signed is idempotent by seq +
    //    CAS so a re-plant would be a no-op anyway, but the guard makes the
    //    refusal explicit + cheap, and it precedes any write.) At true genesis the
    //    reel is empty, so there is no orphan tail to recover.
    let existing = read_reel_file(root, "0", "being", &being_id, None, None);
    if !existing.is_empty() {
        return Err(GenesisError::AlreadyPlanted);
    }

    // The sign closure: the I key (story key) signs the PURE, clock-free act-sig
    // payload. by = <i_name> (the literal "I" by default; its sig routes to
    // the story pubkey on verify). treegenesis holds the seed; the closure is the
    // exact SHAPE commit_moment_signed's caller passes (it receives the FULLY
    // STAMPED act opening - with _id + p - and the committed fact ids). The SAME
    // I key signs BOTH moments; the differing chain `p` + factIds give each its
    // own distinct, correct signature.
    let seed = story_key.seed;
    let by = i_name.to_string();
    let sign = move |opening: &Json, fids: &[String]| -> Json {
        let payload = treesign::build_act_sig_payload(opening, fids);
        let value = treesign::sign_value(&seed, &payload);
        obj(vec![
            ("alg", jstr("ed25519")),
            ("by", jstr(&by)),
            ("value", jstr(&value)),
        ])
    };

    // 1. MOMENT 1 = "I" = name:declare on the LIBRARY reel, `ord` 0. One act ->
    //    one fact -> one reel: the NORMAL seal accepts it (no fanout). The act
    //    chains from GENESIS_PREV (the empty chain head); the library fact lands
    //    at fact #0 (p = GENESIS_PREV). The act is signed by the I key.
    let lib_fact = name_declare_fact(i_name, story_domain);
    let name_act = genesis_act(i_name, story_domain, lib_fact);
    let Committed { act_id: name_act_id, fact_ids: lib_fact_ids } =
        commit_moment_signed(root, &name_act, 0.0, &sign)?;
    let library_fact_id = lib_fact_ids.into_iter().next().unwrap_or_default();

    // 2. MOMENT 2 = "am" = be:birth on the BEING reel, `ord` 1. One act -> one
    //    fact -> one reel: again the NORMAL seal. The act chains off MOMENT 1's
    //    act id (the chain advanced in step 1), so the two acts form the I's
    //    act-chain in order. The being fact lands at fact #0 of the being reel
    //    (p = GENESIS_PREV). Signed by the SAME I key.
    let be_fact = be_birth_fact(i_name, &being_id, quals);
    let being_act = genesis_act(i_name, story_domain, be_fact);
    let Committed { act_id: being_act_id, fact_ids: be_fact_ids } =
        commit_moment_signed(root, &being_act, 1.0, &sign)?;
    let being_fact_id = be_fact_ids.into_iter().next().unwrap_or_default();

    Ok(Planted {
        name_act_id,
        being_act_id,
        library_fact_id,
        being_fact_id,
        i_name: i_name.to_string(),
        being_id,
        story_domain: story_domain.to_string(),
    })
}

/// THE RAZOR-THIN HOST TURTLE (ignition). The host does the MINIMUM to ignite, then I reads everything
/// else from the book (20.md: a one-time bootstrap seed in the host; after ignition, Word runs Word).
/// This is that one-time seed in ONE call:
///   1. mint (or load) the I key — the story key (`<root>/.story/story.key`), persistent.
///   2. plant the TWO I-Am moments under "I" (the I-being's name):
///      MOMENT 1 = name:declare "I" on the library reel, MOMENT 2 = be:birth "am" (being-id "I",
///      parentBeingId=null — THE genesis marker), each a signed clock-free moment.
///
/// THE MINIMAL IGNITION SEED is EXACTLY these two moments — NOTHING ELSE is host-seeded. The reader can
/// lay a `do:coin` declare-word fact with NO primitive word pre-declared, because coining is a HOST
/// AXIOM (the rasterizer builds the coin fact; authorize bypasses for I; the seal writes it) — none of
/// it consults the word-fold. So the words `word`/`do`/`see`/`coin`/`be`/`name` are what the book
/// DECLARES, not prerequisites to declaring themselves. The turtle stays razor-thin: birth + the key,
/// then I reads word.word through the guarded reader (treebook) to accrue the foundation vocabulary.
///
/// Returns the `Planted` genesis + the `StoryKey` (the caller signs the book's coins with it). `root`
/// is the store root; `story_domain` the library reel id (also act.story). Refuses `AlreadyPlanted` if
/// the being reel already carries genesis (the I-immutability guard).
pub fn plant_and_ignite(
    root: &Path,
    story_domain: &str,
) -> Result<(Planted, StoryKey), GenesisError> {
    // 1. the I key (the story key), under the store's own .story dir — minted on first boot, loaded after.
    let key = load_or_mint_i_key(&root.join(".story")).map_err(|e| match e {
        KeyMintError::Io(io) => GenesisError::Io(io),
        other => GenesisError::Io(io::Error::new(io::ErrorKind::Other, format!("{other}"))),
    })?;
    // 2. plant the TWO I-Am moments under "I" (the minimal ignition seed — nothing else).
    let planted = plant_genesis(root, story_domain, &key, None)?;
    Ok((planted, key))
}
