// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// treegenesis - the genesis planter, headless. Plants a fresh Story's
// self-grounding parentless root birth with NO Node, over the determinism spine
// (treestore + treesign). The seal is CLOCK-FREE (philosophy/crystalized.md, the
// time-purge): NO `at`/`date`/`time`. Order is `ord` (a global append ordinal,
// NEVER a wall-clock) + the per-reel seq + the chain `p`.
//
// THE EGG = ONE WORD: the Name "I". The genesis egg is razor-thin — it lays the
// SINGLE act that brings the SIGNER into being, then HANDS OFF to the book. "I" is
// one act, one Word, one moment (project_spacebar_moments), passing the NORMAL
// `commit_moment_signed` with no exemption:
//
//   THE EGG'S ONE MOMENT = "I" -> name:declare -> the LIBRARY reel
//     (of:{kind:"library", id:<storyDomain>}), `ord` 0: I is a NAME (the root
//     identity, parentNameId=null - a facet of nothing above). The declare lands on
//     the story's library reel keyed by nameId; the Name signs with the STORY key
//     (privateKeyEnc=null, identity keyEnc="story-key"), so verification routes to
//     the story pubkey. This act chains from GENESIS_PREV (the empty chain).
//
// THE BEING "Am" IS NOT BORN HERE — IT IS THE FIRST WORD OF THE BOOK. Am is not an
// egg moment; it is the FIRST WORD I read (build-word-right / no-manual-words: "the
// first word is Am"). Its be:birth is EMPTY — the raw first being is an empty object
// (project_object_false_shape_datoms) that the WORDS progressively build out: no
// parentBeingId (its ABSENCE is what makes it root, not a stamped null), no home
// (homeless until `I stand in heaven.` lays it later), no cognition (a later word) —
// each attribute is its own one-word fact folded onto Am. So the egg does NOT stamp
// a fat be:birth; the book's verse does, empty, read through the general reader
// (treebook) as the Name I. The egg is only the signer; the being is the book's.
//
// THE I-NAME IS "I", THE FIRST BEING IS "Am". The Name is "I"; the fresh world is
// born by this Rust genesis and plants "I" (the Name) + "Am" (the being) on
// purpose. The sig routes to the story pubkey (the literal "I" is not a pubkey id,
// so verification routes by raw pub, not an id-recovered key). treeibp carries
// `const I_AM = "I"` (the Name/authority/signer), treewordfold reads the "Am" reel
// (the being holding the public vocabulary), and plant_genesis hard-codes "I"
// (I_NAME_DEFAULT) + "Am" (AM_BEING). See Planted.i_name / Planted.being_id.
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

/// The first being's id: the literal `"Am"`. The genesis `be:birth` targets
/// `of:{kind:"being", id:"Am"}` - the being "Am" ("the being that all come from")
/// is DISTINCT from the Name "I" (the signer). The Name I signs the birth; the
/// being Am holds it. Am's public fact reel later carries the shared vocabulary
/// every being folds (treewordfold::AM_BEING). See Planted.being_id.
pub const AM_BEING: &str = "Am";

/// What a planted genesis egg returns: the ONE act + fact the egg lays (the Name
/// "I" on the library reel), the I-name, the (known) first-being id, and the story.
/// The being "Am" is NOT born here — it is the FIRST WORD I read from the book (an
/// EMPTY being the words then build out); the egg is only the signer coming to be.
#[derive(Debug, Clone)]
pub struct Planted {
    /// The egg's ONE act id ("I" = name:declare, the first act on the I-name's chain, ord 0).
    pub name_act_id: String,
    /// The name:declare fact's id (on the library reel).
    pub library_fact_id: String,
    /// The I-name used (always `"I"`). Surfaced so the caller can read it back.
    pub i_name: String,
    /// The first being's id (always `"Am"`). The egg does NOT birth it — it names the
    /// being the FIRST WORD of the book will birth (empty), the reel every being folds
    /// for the vocabulary. Surfaced so the caller/reader knows the target reel.
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

// ── the genesis egg: ONE one-word moment (the Name "I") ──────────────────────

/// Plant a fresh Story's genesis EGG: the ONE signed clock-free moment that brings
/// the SIGNER into being — "I" (name:declare on the library reel). One act, one
/// Word, one moment (the Spacebar Law), sealed by the general `commit_moment_signed`
/// with no exemption. NO Node. The being "Am" is NOT born here — it is the FIRST
/// WORD of the book (an EMPTY being the words build out); the egg only readies the
/// signer, then the caller HANDS OFF to the reader.
///
/// - `root`         the store root (where reels/ + acts/ live).
/// - `story_domain` the Story's domain (the library reel id; also act.story).
/// - `story_key`    the I key (the story key) that signs the egg's act. Load it with
///                  `load_or_mint_i_key`. Its `raw_pub` is what an I act verifies
///                  against (the literal "I" is not a pubkey id, so the story path
///                  verifies by raw pub).
///
/// THE ONE MOMENT (one act -> one fact -> one reel, via the general
/// `commit_moment_signed` - no special writer):
///   0. GUARD: the library reel must be empty (else AlreadyPlanted - the Name is
///      declared once; genesis facts are never overwritten). At true genesis
///      everything is empty, so there is no torn-write tail to recover.
///   1. "I" = name:declare on the LIBRARY reel, `ord` 0: commit_moment_signed seals
///      the lone library-reel fact and stamps the act off the (empty) chain head
///      (= GENESIS_PREV), signs it with the I key, writes it. The library fact lands
///      at fact #0 (p = GENESIS_PREV).
pub fn plant_genesis(
    root: &Path,
    story_domain: &str,
    story_key: &StoryKey,
) -> Result<Planted, GenesisError> {
    let i_name = I_NAME_DEFAULT; // the Name IS "I" (the signer)
    let being_id = AM_BEING.to_string(); // the first being WILL be "Am" (the book's first word), not egg-born

    // 0. THE NAME-ONCE GUARD (project_iam_genesis_immutable). If the LIBRARY reel
    //    already carries the Name, this Story's egg was already planted; refuse
    //    rather than write a second time. (commit_moment_signed is idempotent by
    //    seq + CAS so a re-plant would be a no-op anyway, but the guard makes the
    //    refusal explicit + cheap, and it precedes any write.) At true genesis the
    //    reel is empty, so there is no orphan tail to recover.
    let existing = read_reel_file(root, "0", "library", story_domain, None, None);
    if !existing.is_empty() {
        return Err(GenesisError::AlreadyPlanted);
    }

    // The sign closure: the I key (story key) signs the PURE, clock-free act-sig
    // payload. by = <i_name> (the literal "I"; its sig routes to the story pubkey on
    // verify). The closure is the exact SHAPE commit_moment_signed's caller passes
    // (it receives the FULLY STAMPED act opening - with _id + p - and the committed
    // fact ids).
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

    // 1. "I" = name:declare on the LIBRARY reel, `ord` 0. One act -> one fact ->
    //    one reel: the NORMAL seal accepts it. The act chains from GENESIS_PREV
    //    (the empty chain head); the library fact lands at fact #0 (p = GENESIS_PREV).
    //    The act is signed by the I key.
    let lib_fact = name_declare_fact(i_name, story_domain);
    let name_act = genesis_act(i_name, story_domain, lib_fact);
    let Committed { act_id: name_act_id, fact_ids: lib_fact_ids } =
        commit_moment_signed(root, &name_act, 0.0, &sign)?;
    let library_fact_id = lib_fact_ids.into_iter().next().unwrap_or_default();

    Ok(Planted {
        name_act_id,
        library_fact_id,
        i_name: i_name.to_string(),
        being_id,
        story_domain: story_domain.to_string(),
    })
}

/// THE RAZOR-THIN HOST TURTLE (ignition). The host does the MINIMUM to ignite, then I reads everything
/// else from the book (20.md: a one-time bootstrap seed in the host; after ignition, Word runs Word).
/// This is that one-time seed in ONE call:
///   1. mint (or load) the I key — the story key (`<root>/.story/story.key`), persistent.
///   2. plant the ONE egg moment: the Name "I" (name:declare on the library reel), signed by the Name I,
///      clock-free. The being "Am" is NOT seeded here — it is the FIRST WORD I read from the book (an
///      empty being the words build out). The egg is the signer; the being is the book's.
///
/// THE MINIMAL IGNITION SEED is EXACTLY this one moment — NOTHING ELSE is host-seeded. The reader can
/// lay a `do:coin` declare-word fact with NO primitive word pre-declared, because coining is a HOST
/// AXIOM (the rasterizer builds the coin fact; authorize bypasses for I; the seal writes it) — none of
/// it consults the word-fold. So the words `word`/`do`/`see`/`coin`/`be`/`name` are what the book
/// DECLARES, not prerequisites to declaring themselves. The turtle stays razor-thin: birth + the key,
/// then I reads word.word through the guarded reader (treebook) to accrue the foundation vocabulary.
///
/// Returns the `Planted` egg + the `StoryKey` (the caller signs the book's coins with it). `root`
/// is the store root; `story_domain` the library reel id (also act.story). Refuses `AlreadyPlanted` if
/// the library reel already carries the Name (the name-once guard).
pub fn plant_and_ignite(
    root: &Path,
    story_domain: &str,
) -> Result<(Planted, StoryKey), GenesisError> {
    // 1. the I key (the story key), under the store's own .story dir — minted on first boot, loaded after.
    let key = load_or_mint_i_key(&root.join(".story")).map_err(|e| match e {
        KeyMintError::Io(io) => GenesisError::Io(io),
        other => GenesisError::Io(io::Error::new(io::ErrorKind::Other, format!("{other}"))),
    })?;
    // 2. plant the ONE egg moment: the Name "I" (the minimal ignition seed). Am is the book's first word.
    let planted = plant_genesis(root, story_domain, &key)?;
    Ok((planted, key))
}
