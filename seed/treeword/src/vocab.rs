// vocab.rs — READING THE DECLARED VERBS FROM THE .word.
//
// ── READ WORD-DRIVEN-PARSER.md FIRST. This module exists to KILL the hardcoded verb list. ──
//
// The principle (Tabor): "the word is the code... Rust should not be defining anything except the
// primitives that relate to one word." Rust does NOT get to know the verbs. `verbs.word` declares them.
// This module reads that declaration into structured data the parser can resolve against — the first
// step of making the grammar come from the .word instead of from a regex pile in lib.rs.
//
// verbs.word says of itself:
//   "A verb is a word. A verb has a present, the shape it takes in an act. A verb has a past, the shape
//    it takes in a fact. A verb forms its past from its present with -ed, unless it declares its own."
//   "Make is a verb. Its past is made."   "Be is a verb. Its past is was. Its past is were, for many."
//
// So a verb declaration is two statement shapes, and NOTHING here is a hardcoded verb — every verb comes
// from the file. Add a verb = add a line to verbs.word, never a line here.

use std::collections::HashMap;

/// A verb's FAMILY — which primitive word it belongs to, read from do.word / see.word / recall.word:
///   do.word:     "To make, to give, to take, to set, to move, to grant, and to drop are dos.
///                 To be is a do on a being; to name is a do on a name."
///   see.word:    "A see is a being's read of the fold, the present."   (makes no fact)
///   recall.word: "A recall is a see of the past."                       (makes no fact)
/// This is how the parser will know `make` stamps a do-fact while `see`/`recall` only read — from the
/// .word, NOT a Rust table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Family {
    /// a do-form (make/give/take/set/move/grant/drop): stamps a fact of the world.
    Do,
    /// be — a do ON A BEING (forms birth/connect/release/switch/kill/truename, be.word).
    Be,
    /// name — a do ON A NAME (declare/connect/sign/release/export/banish, name.word).
    Name,
    /// see — a being's read of the PRESENT fold; makes no fact.
    See,
    /// recall — a see of the PAST; makes no fact.
    Recall,
}

/// A declared verb: its PRESENT shape (the word in an act), its PAST shape (the word in a fact) —
/// exactly verbs.word's "a present, the shape it takes in an act" / "a past, the shape it takes in a
/// fact" — and its FAMILY (do/be/see/name/recall), read from do.word/see.word/recall.word (None until a
/// family file assigns it).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verb {
    pub present: String,
    /// The surface shapes the PRESENT takes (subject-agreement conjugations). For a regular verb this is
    /// just `[present]` (make -> "make"). An irregular verb DECLARES its own in verbs.word ("Be is a verb.
    /// Its present is am, is, and are." -> ["am","is","are"]) — the same way it declares its own past.
    pub present_forms: Vec<String>,
    pub past: String,
    pub family: Option<Family>,
}

/// The declared verb vocabulary, read from verbs.word. Keyed by the present shape (lowercased).
/// (Later steps add the do/be/see/name FAMILY of each verb, read from do.word/be.word/see.word/name.word;
/// this first step is just the verbs + tenses.)
#[derive(Debug, Clone, Default)]
pub struct Vocabulary {
    verbs: HashMap<String, Verb>,
}

impl Vocabulary {
    /// The declared verb whose present shape is `present` (case-insensitive), or None if the vocabulary
    /// never declared it. A word the .word did not declare a verb is NOT a verb — the parser must not
    /// invent one.
    pub fn verb(&self, present: &str) -> Option<&Verb> {
        self.verbs.get(&present.to_lowercase())
    }
    /// Is `w` a declared verb (by present shape)?
    pub fn is_verb(&self, w: &str) -> bool {
        self.verbs.contains_key(&w.to_lowercase())
    }
    /// The declared verb whose PAST shape is `past` (case-insensitive) — for reading facts back to their
    /// verb (a fact's verb is its past; verbs.word: "a past, the shape it takes in a fact").
    pub fn verb_by_past(&self, past: &str) -> Option<&Verb> {
        let p = past.to_lowercase();
        self.verbs.values().find(|v| v.past == p)
    }
    /// The declared verb whose PRESENT shape (any conjugation) is `surface` — "am"/"is"/"are" -> be,
    /// "make" -> make. How the parser resolves the word it reads IN AN ACT back to its verb, from the
    /// words (verbs.word: "a present, the shape it takes in an act").
    pub fn verb_by_present(&self, surface: &str) -> Option<&Verb> {
        let s = surface.to_lowercase();
        self.verbs.values().find(|v| v.present_forms.iter().any(|f| f == &s))
    }
    /// The declared FAMILY of the verb (do/be/see/name/recall), or None if no family file assigned one.
    pub fn family(&self, present: &str) -> Option<Family> {
        self.verbs.get(&present.to_lowercase()).and_then(|v| v.family)
    }
    pub fn len(&self) -> usize {
        self.verbs.len()
    }
    pub fn is_empty(&self) -> bool {
        self.verbs.is_empty()
    }
}

/// verbs.word: "A verb forms its past from its present with -ed, unless it declares its own." The default
/// used when a verb declares no explicit past (a `-e` verb takes just `-d`, matching English).
fn default_past(present: &str) -> String {
    if present.ends_with('e') {
        format!("{present}d")
    } else {
        format!("{present}ed")
    }
}

/// Read the declared verbs from verbs.word text. Two statement shapes drive it, nothing else:
///   "<Verb> is a verb."   -> declare the verb (present = <verb>, past = the -ed default until overridden).
///   "Its past is <word>."  -> set the PRECEDING verb's past (its declared-own past). "Its past is <word>,
///                             for many." is the PLURAL past (verbs.word: "were, for many") — the singular
///                             past is the verb's shape, so the ", for many." line is read-but-not-stored.
/// Comment/blank lines and every other statement (the CONCEPT declarations "A verb is a word.", "A verb
/// has a present.") are skipped — they describe the concept, they do not declare a verb.
pub fn read_verbs(verbs_word: &str) -> Vocabulary {
    let mut vocab = Vocabulary::default();
    let mut last: Option<String> = None; // the verb a following "Its past is …" attaches to
    for raw in verbs_word.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        // "<X> is a verb."  — but NOT the concept line "A verb is a word." (that ends "is a word.").
        if let Some(name) = line.strip_suffix(" is a verb.") {
            let present = name.trim().to_lowercase();
            // guard: a real verb name is one word; skip a stray "A verb is a verb"-style line.
            if !present.is_empty() && !present.contains(' ') && present != "a verb" {
                let past = default_past(&present);
                vocab.verbs.insert(
                    present.clone(),
                    Verb { present: present.clone(), present_forms: vec![present.clone()], past, family: None },
                );
                last = Some(present);
            }
            continue;
        }
        // "Its present is <a>, <b>, and <c>."  — the preceding verb's irregular present conjugations
        // (replacing the default `[present]`). Only irregular-present verbs (be) declare this.
        if let Some(rest) = line.strip_prefix("Its present is ") {
            let forms = split_word_list(rest.trim_end_matches('.'));
            if !forms.is_empty() {
                if let Some(v) = last.as_ref().and_then(|l| vocab.verbs.get_mut(l)) {
                    v.present_forms = forms;
                }
            }
            continue;
        }
        // "Its past is <word>[, for many]."  — set the preceding verb's own past (singular only).
        if let Some(rest) = line.strip_prefix("Its past is ") {
            if rest.contains("for many") {
                continue; // the plural past; the singular past already set is the verb's shape
            }
            let word = rest.trim_end_matches('.').trim().to_lowercase();
            if !word.is_empty() {
                if let Some(v) = last.as_ref().and_then(|l| vocab.verbs.get_mut(l)) {
                    v.past = word;
                }
            }
            continue;
        }
    }
    vocab
}

/// Split an English word list ("am, is, and are") into its words ([am, is, are]) — commas + a trailing
/// "and"/"or" join them.
fn split_word_list(list: &str) -> Vec<String> {
    list.split(',')
        .flat_map(|p| p.split(" and "))
        .flat_map(|p| p.split(" or "))
        .map(|p| p.trim().to_lowercase())
        .filter(|p| !p.is_empty())
        .collect()
}

/// Split a do.word form list ("To make, to give, ... and to drop") into the bare forms
/// (make, give, ... drop). Each item is a `to <form>`; commas + a trailing "and" join them.
fn split_to_forms(list: &str) -> Vec<String> {
    list.split(',')
        .flat_map(|p| p.split(" and "))
        .map(|p| p.trim().trim_start_matches("To ").trim_start_matches("to ").trim().to_lowercase())
        .filter(|p| !p.is_empty())
        .collect()
}

/// Set the family of a verb ALREADY declared in the vocabulary (from verbs.word). A form the family
/// files list but verbs.word never declared as a verb (e.g. do.word lists "drop", verbs.word doesn't)
/// is a `.word` GAP — silently no-op here, NOT invented as a Rust default. (Such gaps are cleanup items:
/// declare the missing verb in verbs.word.)
fn set_family(vocab: &mut Vocabulary, present: &str, fam: Family) {
    if let Some(v) = vocab.verbs.get_mut(&present.to_lowercase()) {
        v.family = Some(fam);
    }
}

/// Read each verb's FAMILY from the primitive .word and assign it onto the vocabulary:
///   do.word:     "To make, to give, ... are dos."          -> each listed form is a `Do`.
///                "To be is a do on a being; to name is a do on a name." -> be = `Be`, name = `Name`.
///   see.word:    "A see is a being's read of the fold ..." -> see = `See`  (a read, no fact).
///   recall.word: "A recall is a see of the past."          -> recall = `Recall`. recall is NOT in
///                verbs.word, so it is ADDED here (present=recall, past=the -ed default).
/// A verb the family files don't mention keeps family=None — a `.word` gap, never a Rust guess.
pub fn assign_families(vocab: &mut Vocabulary, do_word: &str, see_word: &str, recall_word: &str) {
    for line in do_word.lines() {
        if let Some(list) = line.trim().strip_suffix(" are dos.") {
            // the form list is the LAST sentence-fragment of the line ("A do has many forms. To make, …"
            // -> "To make, …"): drop any leading sentence before it.
            let list = list.rsplit(". ").next().unwrap_or(list);
            for form in split_to_forms(list) {
                set_family(vocab, &form, Family::Do);
            }
        }
    }
    if do_word.contains("To be is a do on a being") {
        set_family(vocab, "be", Family::Be);
    }
    if do_word.contains("to name is a do on a name") {
        set_family(vocab, "name", Family::Name);
    }
    if see_word.contains("A see is a being's read") {
        set_family(vocab, "see", Family::See);
    }
    if recall_word.contains("A recall is a see of the past") {
        let present = "recall".to_string();
        vocab.verbs.entry(present.clone()).or_insert_with(|| Verb {
            present: present.clone(),
            present_forms: vec![present.clone()],
            past: default_past(&present),
            family: None,
        });
        set_family(vocab, "recall", Family::Recall);
    }
}

/// Read the WHOLE declared vocabulary: the verbs + tenses (verbs.word) then each verb's family
/// (do.word/see.word/recall.word). The one entry point the parser will resolve verbs against.
pub fn read_vocabulary(verbs_word: &str, do_word: &str, see_word: &str, recall_word: &str) -> Vocabulary {
    let mut v = read_verbs(verbs_word);
    assign_families(&mut v, do_word, see_word, recall_word);
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A real seed `.word` file (the genuine artifact), or under `$TREE_SEED_DIR`.
    fn word_file(name: &str) -> String {
        let seed = match std::env::var("TREE_SEED_DIR") {
            Ok(d) if !d.is_empty() => PathBuf::from(d),
            _ => PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../seed")),
        };
        let p = seed.join("store/words").join(name);
        std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {}: {e}", p.display()))
    }
    fn verbs_word() -> String {
        word_file("verbs.word")
    }

    #[test]
    fn reads_the_declared_verbs_from_the_real_verbs_word() {
        let v = read_verbs(&verbs_word());
        // the vocabulary came ENTIRELY from the file — a healthy count of verbs was declared.
        assert!(v.len() >= 20, "read the declared verbs (got {})", v.len());

        // the irregular pasts are read from the file, NOT hardcoded here.
        assert_eq!(v.verb("make").map(|x| x.past.as_str()), Some("made"), "Make's past is made");
        assert_eq!(v.verb("give").map(|x| x.past.as_str()), Some("gave"), "Give's past is gave");
        assert_eq!(v.verb("be").map(|x| x.past.as_str()), Some("was"), "Be's past is was (singular)");
        assert_eq!(v.verb("do").map(|x| x.past.as_str()), Some("did"), "Do's past is did");
        assert_eq!(v.verb("see").map(|x| x.past.as_str()), Some("saw"), "See's past is saw");
        assert_eq!(v.verb("take").map(|x| x.past.as_str()), Some("took"), "Take's past is took");

        // the -ed default fires for a verb that declares no own past (Declare / Call / Move / Grant).
        assert_eq!(v.verb("declare").map(|x| x.past.as_str()), Some("declared"), "-ed default (e -> d)");
        assert_eq!(v.verb("call").map(|x| x.past.as_str()), Some("called"), "-ed default");
        assert_eq!(v.verb("grant").map(|x| x.past.as_str()), Some("granted"), "-ed default");

        // reading a fact back: a past shape resolves to its verb.
        assert_eq!(v.verb_by_past("made").map(|x| x.present.as_str()), Some("make"), "made -> make");
        assert_eq!(v.verb_by_past("was").map(|x| x.present.as_str()), Some("be"), "was -> be");

        // a word the file never declared is NOT a verb (no invented verbs).
        assert!(!v.is_verb("frobnicate"), "an undeclared word is not a verb");
    }

    #[test]
    fn resolves_the_present_conjugations_from_the_word() {
        let v = read_verbs(&verbs_word());
        // be's irregular present is DECLARED ("Its present is am, is, and are.") and read from the file:
        // each of am/is/are resolves to the verb `be` — NOT hardcoded here.
        for surface in ["am", "is", "are"] {
            assert_eq!(
                v.verb_by_present(surface).map(|x| x.present.as_str()),
                Some("be"),
                "`{surface}` is a present shape of be (verbs.word)"
            );
        }
        // a regular verb's present is just its name (default `[present]`).
        assert_eq!(v.verb_by_present("make").map(|x| x.present.as_str()), Some("make"), "make -> make");
        assert_eq!(v.verb_by_present("give").map(|x| x.present.as_str()), Some("give"), "give -> give");
        // a word that is no verb's present resolves to nothing.
        assert!(v.verb_by_present("was").is_none(), "`was` is be's PAST, not a present shape");
    }

    #[test]
    fn reads_each_verbs_family_from_the_real_do_see_recall_word() {
        let v = read_vocabulary(
            &verbs_word(),
            &word_file("do.word"),
            &word_file("see.word"),
            &word_file("recall.word"),
        );
        // do.word: "To make, to give, to take, to set, to move, to grant, and to drop are dos."
        for do_form in ["make", "give", "take", "set", "move", "grant"] {
            assert_eq!(v.family(do_form), Some(Family::Do), "`{do_form}` is a do (do.word)");
        }
        // do.word: "To be is a do on a being; to name is a do on a name."
        assert_eq!(v.family("be"), Some(Family::Be), "be is a do on a being");
        assert_eq!(v.family("name"), Some(Family::Name), "name is a do on a name");
        // see.word / recall.word: the reads (make no fact).
        assert_eq!(v.family("see"), Some(Family::See), "see is a read of the present");
        assert_eq!(v.family("recall"), Some(Family::Recall), "recall is a see of the past");
        // recall was ADDED from recall.word (it is not in verbs.word).
        assert!(v.is_verb("recall"), "recall is a verb (declared in recall.word, added to the vocab)");
        // a verb with no family declaration stays None — a .word gap, not a Rust guess. (`speak` has no
        // family file line yet.)
        assert_eq!(v.family("speak"), None, "an unassigned verb has no invented family");
    }
}
