// treewordfold — the WORD-FOLD. The live vocabulary IS the fold of the declare-word facts on chain,
// NOT a code table (can.word, philosophy/word/10.md, GENESIS-FOLD.md). A word resolves from the CHAIN
// FOLD of declare-word facts; nothing is hard-declared.
//
// A declare-word fact (wordStore.js `bindWord`) is one `do:coin` on the Named being I's reel:
//   { verb:"do", act:"coin", of:{kind:"being", id:"I"},
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

/// The Named being I — the seed vocabulary is I's words, declared on I's being reel. The I-being's
/// name IS "I" (the fresh world is born by the Rust genesis, which plants "I"). The fold reads I's reel
/// (reels/<history>/being/I/I.reel) because every declare-word fact lands there (bindWord's actor = I,
/// of = the I being). A fresh Rust-planted Story keys this reel by "I".
pub const I_BEING: &str = "I";
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

/// The live WORD-SET = the fold of every declare-word fact (do:coin / do:retire) on the I being reel,
/// across the heaven "0" reel then (for a branch) the branch reel — each already seq-ordered on disk,
/// so the read order IS the fold order (last coin wins; a trailing retire folds to absent). Generic:
/// it folds WHATEVER `params.word` facts exist, never a fixed set. `dir` is the store root.
///
/// This is `getWord` / `rehydrateWordProjection` (wordStore.js) in Rust, reading through the kernel
/// store (treestore::read_reel_file) — it does not reimplement the reel read, and it stays grammar-free.
/// Reads the runtime I being reel (`I_BEING` == "I"), where the Rust genesis plants the I being.
pub fn fold_word_set(dir: &Path, history: &str) -> HashMap<String, WordDescriptor> {
    // heaven "0" is inherited by every history; a branch layers its own facts ON TOP (history
    // precedence: "0" < any branch id), exactly getWord's `histories.flatMap`.
    let mut histories: Vec<&str> = vec!["0"];
    if history != "0" {
        histories.push(history);
    }
    let mut set: HashMap<String, WordDescriptor> = HashMap::new();
    for h in histories {
        for f in treestore::read_reel_file(dir, h, "being", I_BEING, None, None) {
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
                set.remove(&name); // disable wins until a later re-declare
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
    set
}

/// Resolve ONE word's descriptor from the fold (the runner's per-word lookup). None when the word is
/// unbound or disabled on this history. Folds the whole reel — fine for the per-act resolution the
/// runner does; a hot path can fold once via `fold_word_set` and read the map. Mirrors getWord(name).
pub fn resolve_word(dir: &Path, history: &str, name: &str) -> Option<WordDescriptor> {
    fold_word_set(dir, history).remove(name)
}
