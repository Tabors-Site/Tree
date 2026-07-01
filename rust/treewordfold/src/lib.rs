// treewordfold — the WORD-FOLD. The live vocabulary IS the fold of the declare-word facts on chain,
// NOT a code table (can.word, philosophy/word/10.md, GENESIS-FOLD.md). A word resolves from the CHAIN
// FOLD of declare-word facts; nothing is hard-declared.
//
// THE NAME-BEING SPLIT (project_name_being_refactor). The vocabulary lives on the being "Am"'s PUBLIC
// FACT reel, NOT on the Name "I". The Name I's act chain is PRIVATE; the being Am's fact chain is the
// chain every being can see and know of, so the words live there — "all beings fold Am's reel for the
// vocabulary". The SIGNER of every coin is the Name "I" (I signs, I has authority); the reel the coins
// LAND on and fold from is the being "Am" (of:{kind:"being", id:"Am"}, by/through:"I").
//
// A declare-word fact (wordStore.js `bindWord`) is one `do:coin` on the being Am's reel:
//   { verb:"do", act:"coin", of:{kind:"being", id:"Am"}, by:"I", through:"I",
//     params:{ word:<name>, ownerExtension, binding:{ kind, word:{noun,able,idFrom}, factAction, ... } } }
// A `do:retire` on the same `params.word` DISABLES the word (it stays on the chain forever; a later
// re-coin re-enables it). This is the SAME fold getWord / rehydrateWordProjection runs in JS: heaven
// "0" then the branch, each seq-ordered, last-coin-wins, a trailing retire folds to absent.
//
// This crate is STORE logic — it READS facts through the kernel store (treestore::read_reel_file) and
// folds them. It does NOT know word grammar, does NOT run a body, does NOT touch the kernel reducers.
// The runner (treeibp) consults the fold for a word's DESCRIPTOR and decides how to ground it; the
// host (the binary) maps an op's name to its `.word` body on disk (the bottom turtle). So the fold is
// GENERIC over whatever declare-word facts I has read in — it never assumes a fixed genesis set, which
// is exactly what the future "I reads the genesis book word by word" needs.

use std::collections::HashMap;
use std::path::Path;
use treehash::Json;

/// The being "Am" - the VOCABULARY/FOLD reel. The name-being split: the Name "I" is the SIGNER (its
/// act chain is private); the being "Am" is the PUBLIC reel every being folds for the shared vocabulary.
/// The fresh world is born by the Rust genesis, which plants the Name "I" (on the library reel) and the
/// being "Am" (on the being reel). The fold reads Am's reel (reels/<history>/being/Am/Am.reel) because
/// every declare-word `do:coin` lands there (of:{kind:"being", id:"Am"}, by/through:"I"). Every being
/// "knows of that reel and folds those words" - so the fold reel is the being Am, not the Name I.
pub const AM_BEING: &str = "Am";
/// The SIGNER of every coin - the Name "I" (I signs, I has authority). Kept distinct from `AM_BEING`
/// (the reel the coins land on) so the split is explicit: the Name authors, the being holds.
pub const I_NAME: &str = "I";
const COIN: &str = "coin";
const RETIRE: &str = "retire";

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn get_str<'a>(v: &'a Json, k: &str) -> Option<&'a str> {
    match get(v, k) {
        Some(Json::Str(s)) => Some(s.as_str()),
        _ => None,
    }
}

/// One folded word: the descriptor the runner resolves a word against. `kind` (op / concept /
/// composite / type / reducer / nameop / beop / seeop / …) routes the runner; the op-shape fields
/// (`noun`, `able`, `id_from`, `fact_action`, `host_env`) carry what wordStore's `binding.word` /
/// `binding.factAction` held — enough for the runner + the host to find and run the op's `.word`. The
/// raw `binding` is kept verbatim so a caller that wants a field this struct does not name can read it.
#[derive(Debug, Clone)]
pub struct WordDescriptor {
    pub name: String,
    pub kind: Option<String>,
    /// `binding.word.noun` — the fact's target NOUN (being / space / matter / library), the kind the
    /// op's auto-fact lands on. Present only for a word-sourced op (`binding.word` set).
    pub noun: Option<String>,
    /// `binding.word.able` — the able that gates the op (foldAbleNoun key). Optional.
    pub able: Option<String>,
    /// `binding.word.idFrom` — the returned-block key that names the fact's target id (`beingId` …).
    pub id_from: Option<String>,
    /// `binding.factAction` — the act the op's auto-fact records (defaults to the word name).
    pub fact_action: Option<String>,
    /// is `binding.word` present? i.e. a word-sourced op whose body is its co-located `.word`.
    pub word_sourced: bool,
    /// is `binding.do` present? i.e. a handler-ref op (the JS bottom-turtle handler path).
    pub has_do_ref: bool,
    /// the full `binding` object verbatim (every field, for callers wanting an un-named one).
    pub binding: Json,
    pub owner_extension: Option<String>,
}

impl WordDescriptor {
    /// Is this a runnable OP word (kind:"op")? The runner grounds an op by running its `.word` body.
    pub fn is_op(&self) -> bool {
        self.kind.as_deref() == Some("op")
    }
    /// `fact_action`, defaulting to the word name (mirrors the JS `factAction || name`).
    pub fn fact_action_or_name(&self) -> &str {
        self.fact_action.as_deref().unwrap_or(&self.name)
    }
}

fn descriptor_from_binding(name: &str, owner: Option<&str>, binding: &Json) -> WordDescriptor {
    let word = get(binding, "word");
    WordDescriptor {
        name: name.to_string(),
        kind: get_str(binding, "kind").map(str::to_string),
        noun: word.and_then(|w| get_str(w, "noun")).map(str::to_string),
        able: word.and_then(|w| get_str(w, "able")).map(str::to_string),
        id_from: word.and_then(|w| get_str(w, "idFrom")).map(str::to_string),
        fact_action: get_str(binding, "factAction").map(str::to_string),
        word_sourced: word.is_some_and(|w| matches!(w, Json::Obj(_))),
        has_do_ref: get(binding, "do").is_some_and(|d| matches!(d, Json::Obj(_))),
        binding: binding.clone(),
        owner_extension: owner.map(str::to_string),
    }
}

/// The live WORD-SET = the fold of every declare-word fact (do:coin / do:retire) on the being Am's reel,
/// across the heaven "0" reel then (for a branch) the branch reel — each already seq-ordered on disk,
/// so the read order IS the fold order (last coin wins; a trailing retire folds to absent). Generic:
/// it folds WHATEVER `params.word` facts exist, never a fixed set. `dir` is the store root.
///
/// This is `getWord` / `rehydrateWordProjection` (wordStore.js) in Rust, reading through the kernel
/// store (treestore::read_reel_file) — it does not reimplement the reel read, and it stays grammar-free.
/// Reads the being Am's reel (`AM_BEING` == "Am"), the public vocabulary reel every being folds. The
/// SIGNER is the Name "I"; the reel is the being "Am" (the name-being split).
///
/// == THE COIN-FACT SHAPE (the viz coupling - a stable symbol per word) ==
/// A declare-word fact is ONE `do:coin` on the being Am's reel:
///   { verb:"do", act:"coin", of:{kind:"being", id:"Am"}, by:"I", through:"I",
///     params:{ word:<name>, ownerExtension, binding:{ kind, word:{noun,able,idFrom}, factAction, ... } } }
/// The coins are SEQ-ORDERED (the reel's chain order IS the fold order - never the clock), APPEND-ONLY
/// (a coin is never mutated or removed; a `do:retire` on the same `params.word` layers a DISABLE on top,
/// and a later re-coin re-enables), and LAST-COIN-WINS (`set.insert` overwrites by name in read order).
/// So a downstream viz can index a word by its FIRST-coin ordinal: walk the coins in seq order, assign
/// each new `params.word` the next index, and `symbol(word) = ALPHABET[coin_index(word)]` stays STABLE -
/// a word's slot never shifts, because coins only ever append and the ordinal is fixed at first sight.
pub fn fold_word_set(dir: &Path, history: &str) -> HashMap<String, WordDescriptor> {
    let mut set: HashMap<String, WordDescriptor> = HashMap::new();
    fold_being_coins_into(&mut set, dir, history, AM_BEING);
    set
}

/// THE UNION/ACCUMULATE REDUCER (the vocabulary reducer, DISTINCT from the STATE reducer). Fold ONE
/// being's own reel of declare-word facts (do:coin / do:retire) INTO the growing `set`, across the
/// heaven "0" reel then (for a branch) the branch reel — each already seq-ordered on disk, so the read
/// order IS the fold order. This is the UNION reducer the whole vocabulary fold is built on:
///
///   * a `do:coin` INSERTS its word into the set (last-coin-wins PER WORD name, never across words);
///   * a `do:retire` SHADOWS its word (removes it from the resolvable set — union-with-deprecation);
///   * a later re-coin RE-ENABLES a retired word.
///
/// It ACCUMULATES: coining "flower" at ord 50 does NOT drop "tree" at ord 10 — both stay in the set.
/// It NEVER supersedes across distinct words (that is the STATE fold's latest-wins, which vocabulary
/// must NOT use). Called Am-first then per descendant down the mother lineage (`fold_lineage_word_set`),
/// so a descendant coining the SAME word-name SHADOWS/specializes the ancestor's in the projection while
/// the ancestor's coin stays on its own chain (shared, undeleteable). Distinct names pure-accumulate.
fn fold_being_coins_into(set: &mut HashMap<String, WordDescriptor>, dir: &Path, history: &str, being_id: &str) {
    // heaven "0" is inherited by every history; a branch layers its own facts ON TOP (history
    // precedence: "0" < any branch id), exactly getWord's `histories.flatMap`.
    let mut histories: Vec<&str> = vec!["0"];
    if history != "0" {
        histories.push(history);
    }
    for h in histories {
        for f in treestore::read_reel_file(dir, h, "being", being_id, None, None) {
            if get_str(&f, "verb") != Some("do") {
                continue;
            }
            let act = get_str(&f, "act");
            if act != Some(COIN) && act != Some(RETIRE) {
                continue;
            }
            let params = match get(&f, "params") {
                Some(p) => p,
                None => continue,
            };
            let name = match get_str(params, "word") {
                Some(n) if !n.is_empty() => n.to_string(),
                _ => continue,
            };
            if act == Some(RETIRE) {
                set.remove(&name); // disable wins until a later re-declare (union-with-deprecation)
                continue;
            }
            let binding = match get(params, "binding") {
                Some(b) => b,
                None => continue,
            };
            let owner = get_str(params, "ownerExtension");
            set.insert(name.clone(), descriptor_from_binding(&name, owner, binding));
        }
    }
}

/// A being's `parentBeingId` — read off its FOLDED STATE (treefold::reduce_being via `fold`). THIS is
/// the ONE place the STATE reducer touches the vocabulary path, and ONLY for the parent POINTER: it
/// answers "who is the mother?" so we know the next reel to fold up the lineage. The vocabulary CONTENT
/// never folds through reduce_being (that is latest-wins; vocabulary is union — the critical seam). None
/// means a root (no mother) — Am / the I-Am being. Reads the single-history reel like the rest of the
/// being-tree walks (has_authority_over, ancestor_states) do.
fn parent_being_id(dir: &Path, history: &str, being_id: &str) -> Option<String> {
    let facts = treestore::read_reel_file(dir, history, "being", being_id, None, None);
    if facts.is_empty() {
        return None;
    }
    let state = treefold::fold("being", &facts);
    match &state {
        treehash::Json::Obj(e) => e
            .iter()
            .find(|(k, _)| k == "parentBeingId")
            .and_then(|(_, v)| match v {
                treehash::Json::Str(s) if !s.is_empty() => Some(s.clone()),
                _ => None,
            }),
        _ => None,
    }
}

/// THE LINEAGE VOCABULARY FOLD — a being's LIVE vocabulary is the UNION fold of its MOTHER LINEAGE. The
/// being-tree IS the vocabulary tree: walk from `being_id` UP the `parentBeingId` chain to the root, then
/// fold AM FIRST (deepest/root) and each descendant down TO the being, each contributing its OWN reel's
/// coins through the UNION reducer (`fold_being_coins_into`). So:
///
///   * Am's genesis base coins fold first — EVERY being resolves them (universal, shared, undeleteable);
///   * each descendant EXTENDS the set with its own distinct coins (pure accumulate, no supersession);
///   * a descendant coining the SAME word-name SHADOWS/specializes the ancestor's in the projection
///     (genesis-outward order, closer-to-you wins per key), while every coin stays on its own chain;
///   * a `do:retire` on a being's reel shadows that word in the live set (union-with-deprecation).
///
/// This REUSES the state fold's lineage WALK (up parentBeingId, reading each being's folded state for the
/// pointer ONLY via `parent_being_id`) but a DIFFERENT REDUCER: the UNION/accumulate one, NEVER the
/// state latest-wins. The genesis base always folds first because AM_BEING is appended as the deepest
/// root even when the walk terminates before it (a being born off Am reaches Am; a stray root without a
/// parentBeingId still gets Am's universal base). Cycle-guarded + depth-capped like the JS walkUp.
///
/// THE CACHE (projection) = THIS FOLD. The vocabulary projection IS the lineage union fold, computed
/// FRESH from the chain on every call — a pure function of the reels, never a second source of truth.
/// That is the "delete-and-rebuild from the lineage" discipline in its purest form: there is nothing to
/// invalidate because there is no stored cache to drift; a new coin or retire lands on a reel and the
/// very next fold sees it (do_makes_do: "folds FRESH per act, not boot-only"). A memoized snapshot, if
/// ever added for a hot path, must be keyed by (history, being) and DROPPED-then-rebuilt from this fold
/// on any coin/retire — never edited in place, or it becomes the drift this doctrine forbids.
pub fn fold_lineage_word_set(dir: &Path, history: &str, being_id: &str) -> HashMap<String, WordDescriptor> {
    // 1. WALK the mother lineage UP: [being, mother, …, root]. Reuse the parentBeingId pointer read.
    let mut lineage: Vec<String> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut cur = being_id.to_string();
    for _ in 0..256 {
        if !seen.insert(cur.clone()) {
            break; // a cycle in parentBeingId
        }
        lineage.push(cur.clone());
        match parent_being_id(dir, history, &cur) {
            Some(p) => cur = p,
            None => break, // a root (Am / the I-Am being)
        }
    }
    // Am is the UNIVERSAL base — the root every being folds first. Ensure it is the deepest reel even if
    // the walk terminated before reaching it (a root that carries no parentBeingId, or the being IS Am).
    if !lineage.iter().any(|b| b == AM_BEING) {
        lineage.push(AM_BEING.to_string());
    }

    // 2. FOLD Am FIRST (deepest), descendants EXTEND or SHADOW: fold the lineage genesis-outward
    //    (root → … → the being) through the UNION reducer. Reverse the up-walk so the deepest (Am) folds
    //    first and the closest (the being itself) folds LAST — so closer-to-you shadows earlier per key.
    let mut set: HashMap<String, WordDescriptor> = HashMap::new();
    for b in lineage.iter().rev() {
        fold_being_coins_into(&mut set, dir, history, b);
    }
    set
}

/// Resolve ONE word from a being's LINEAGE vocabulary (the actor-lineage resolve seam). None when the
/// word is unbound or shadowed anywhere the lineage did not re-enable it. This is what a being's act
/// resolves words against — its mother-lineage union fold. Mirrors `resolve_word` but lineage-aware.
pub fn resolve_lineage_word(dir: &Path, history: &str, being_id: &str, name: &str) -> Option<WordDescriptor> {
    fold_lineage_word_set(dir, history, being_id).remove(name)
}

/// Resolve ONE word's descriptor from the fold (the runner's per-word lookup). None when the word is
/// unbound or disabled on this history. Folds the whole reel — fine for the per-act resolution the
/// runner does; a hot path can fold once via `fold_word_set` and read the map. Mirrors getWord(name).
pub fn resolve_word(dir: &Path, history: &str, name: &str) -> Option<WordDescriptor> {
    fold_word_set(dir, history).remove(name)
}
