// reader.rs — THE WORD-DRIVEN READER (work in progress). See WORD-DRIVEN-PARSER.md.
//
// Reads a Word statement into an IR act by RESOLVING THE VERB FROM THE DECLARED VOCABULARY (verbs.word
// etc.) and reading the sentence generically — subject / verb / object / prepositional-roles — NOT a
// per-sentence regex. This is the replacement for the regex pile in lib.rs's `rules()`.
//
// It runs ALONGSIDE the regex tables: parse() will try this reader FIRST and fall back to the tables for
// forms not yet migrated. Each form this covers off the .word lets its regex be deleted.
//
// FIRST FORM: `I am <Name> [in <space>]` — birth a being, homed by `in` — the shape genesis-delegates.word
// now uses ("I am Arrival in root."). The VERB (am -> be) is resolved FROM THE WORD (vocab::verb_by_present).
//
// FLAGGED STOPGAP (the drift-test, honestly applied): the be-FORM "birth" — which of be's forms a present
// on a being maps to — is MEANING, and by the leash it belongs in be.word, not here. It is picked in Rust
// for now and is the NEXT thing to move to the .word (be.word should say "the present of be on a being is
// to birth it"). Everything else here is floor: splitting a sentence into words + roles, and resolving the
// verb from the vocabulary. This one pick is the remaining seam, and it is marked so it stays visible.

use crate::vocab::{Family, Vocabulary};
use treehash::Json;

fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn obj(pairs: Vec<(&str, Json)>) -> Json {
    Json::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

/// The generic role-marking prepositions (a role, not part of the object). `in` = location/home, `to` =
/// receiver, `with` = params, `at` = coord, `on` = target. Generic across every verb — not per-sentence.
const PREPS: &[&str] = &["in", "to", "with", "at", "on"];

fn is_article(w: &str) -> bool {
    matches!(w.to_lowercase().as_str(), "the" | "a" | "an")
}

/// A being's Name as an object: a single CAPITALIZED token (word chars + `-._`). Inside Word, all being
/// names are capitalized (Tabor, Bob) — a proper noun. NOT multi-word, quoted, or lowercase — those are
/// other forms (the verse `I am "what?" I am`, the able form `I am a judge`) the reader leaves to the
/// fallback. The signing Name/key is never said directly (only "I" when signing, "Name" as the concept).
fn is_name(s: &str) -> bool {
    let mut chars = s.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_uppercase())
        && s.chars().all(|c| c.is_alphanumeric() || matches!(c, '-' | '.' | '_'))
}

/// The prepositional roles a statement carries: `in <space>` (home), etc. (extended as forms migrate).
#[derive(Default)]
struct Roles {
    in_space: Option<String>,
}

/// Read a Word statement into its IR act(s), resolving verbs from `vocab`. Returns EMPTY if the statement
/// isn't a form this reader covers yet — parse() then falls back to the regex table.
///
/// A statement is a BASE clause + optional trailing clauses (comma / " and " joined), and each clause is
/// its OWN act = its OWN moment — the composite unfold (WORD-DRIVEN-PARSER.md "A WORD IS FOLDED"): the
/// utterance is one word, its unfolding is many single-fact moments, grouped by the entailment test.
/// `I am Cherub in root, a cherub in root, an angel in heaven` = [ be:birth Cherub (home root),
/// grant cherub@root, grant angel@heaven ] — THREE moments from one sentence. The trailing able-clauses
/// attach to the being the base clause named (Cherub).
pub fn read_act(statement: &str, vocab: &Vocabulary) -> Vec<Json> {
    let s = statement.trim().trim_end_matches('.').trim();
    let clauses = split_clauses(s);
    if clauses.is_empty() {
        return vec![];
    }
    // CLAUSE 0 = the BASE act; it also names the SUBJECT BEING the trailing able-clauses attach to.
    let (mut acts, subject) = match read_base(&clauses[0], vocab) {
        Some(x) => x,
        None => return vec![], // not a form the reader covers -> fall back to the regex table
    };
    // TRAILING CLAUSES = `a/an/the <able> in <space>` -> grant that able to the subject being (each its own
    // moment). An unrecognized trailing clause aborts the WHOLE read (never half-parse) -> fall back.
    for clause in &clauses[1..] {
        match read_able_clause(clause, &subject) {
            Some(grant) => acts.push(grant),
            None => return vec![],
        }
    }
    acts
}

/// Split a statement into its clauses on top-level `,` and ` and ` (a `,`/`and` inside `"..."` does NOT
/// split — the verse `I am "what?" I am`). Clause 0 is the base; the rest specialize it.
fn split_clauses(s: &str) -> Vec<String> {
    let chars: Vec<char> = s.chars().collect();
    let (mut out, mut buf, mut in_str, mut i) = (Vec::new(), String::new(), false, 0usize);
    while i < chars.len() {
        let c = chars[i];
        if c == '"' {
            in_str = !in_str;
            buf.push(c);
            i += 1;
        } else if !in_str && c == ',' {
            out.push(std::mem::take(&mut buf));
            i += 1;
        } else if !in_str
            && c == ' '
            && i + 5 <= chars.len()
            && chars[i..i + 5].iter().collect::<String>().eq_ignore_ascii_case(" and ")
        {
            out.push(std::mem::take(&mut buf));
            i += 5;
        } else {
            buf.push(c);
            i += 1;
        }
    }
    out.push(buf);
    out.into_iter().map(|c| c.trim().to_string()).filter(|c| !c.is_empty()).collect()
}

/// Read the BASE clause into its act(s) + the SUBJECT BEING the trailing able-clauses attach to.
/// `I am <Name> [in <space>]` -> ([be:birth], <Name>). An article-led / multi-word object (the able form
/// `I am a judge`, the verse `I am "what?" I am`) is NOT a birth base -> None (parse() falls back).
fn read_base(clause: &str, vocab: &Vocabulary) -> Option<(Vec<Json>, String)> {
    let tokens: Vec<&str> = clause.split_whitespace().collect();
    if tokens.len() < 2 || tokens[0] != "I" {
        return None; // only the signer "I" voice migrated yet (other subjects later)
    }
    // resolve the verb FROM THE WORD: the surface present shape -> its verb (am -> be, make -> make).
    let verb = vocab.verb_by_present(tokens[1])?;
    // object = tokens after the verb up to the first preposition; the rest are prep-roles.
    let rest = &tokens[2..];
    let obj_end = rest.iter().position(|t| PREPS.contains(&t.to_lowercase().as_str())).unwrap_or(rest.len());
    let object = rest[..obj_end].join(" ");
    let roles = read_roles(&rest[obj_end..]);
    // the FAMILY (from do.word/be.word) decides the act; the VERB decides being-vs-space (be -> a being,
    // make -> a space — do.word: "to make ... are dos ... Each form, and the thing it acts on, takes its
    // name where that thing is").
    match verb.family {
        // `I am <Name> [in <space>]` -> be:birth the being (home from `in`). The being IS the object.
        Some(Family::Be) => {
            let birth = be_act(&object, &roles)?;
            Some((vec![birth], object))
        }
        // `I make <space> [in <parent>]` -> do:create-space (make is a Do form). The op name "create-space"
        // is DRIFTED (flagged for the op-alignment pass — the word is "make"); the object is a SPACE.
        Some(Family::Do) if verb.present == "make" => {
            let space = strip_article(&object);
            if !is_name(&space) {
                return None;
            }
            Some((vec![make_space_act(&space, &roles)], space))
        }
        _ => None, // other verbs/families not migrated to the reader yet -> parse() falls back to the regex
    }
}

/// Drop a leading article (a/an/the) from an object — `the root` -> `root`. (`I make the root` names the
/// space `root`.)
fn strip_article(s: &str) -> String {
    let t = s.trim();
    for a in ["the ", "an ", "a "] {
        if let Some(r) = t.strip_prefix(a) {
            return r.trim().to_string();
        }
    }
    t.to_string()
}

/// `I make <space> [in <parent>]` -> do:create-space. For `make`, the `in <space>` role is the PARENT
/// (where the child space sits), NOT a home. STOPGAP: the op name `create-space` is drifted (bound for the
/// op-alignment pass — the word is "make").
fn make_space_act(space: &str, roles: &Roles) -> Json {
    let mut params: Vec<(&str, Json)> = vec![];
    if let Some(parent) = &roles.in_space {
        params.push(("parent", jstr(parent)));
    }
    obj(vec![
        ("kind", jstr("act")),
        ("verb", jstr("do")),
        ("act", jstr("create-space")), // STOPGAP op name (the word is "make")
        ("by", jstr("I")),
        ("of", obj(vec![("kind", jstr("space")), ("id", jstr(space))])),
        ("params", obj(params)),
    ])
}

/// Read a trailing able-clause `a/an/the <able> [in <space>]` -> a GRANT of that able to `subject`,
/// anchored by `in <space>`. The WORD is `be`+article (an able is SAID, not "granted"); it lowers to the
/// `do:grant-able` op the reducer already folds (renaming that op is a later pass). A separate moment.
fn read_able_clause(clause: &str, subject: &str) -> Option<Json> {
    let tokens: Vec<&str> = clause.split_whitespace().collect();
    // an able clause STARTS with an article (a/an/the) — the article is what makes it an able, not a name.
    if tokens.is_empty() || !is_article(tokens[0]) {
        return None;
    }
    let rest = &tokens[1..];
    let obj_end = rest.iter().position(|t| PREPS.contains(&t.to_lowercase().as_str())).unwrap_or(rest.len());
    let able = rest[..obj_end].join(" ");
    if able.is_empty() {
        return None;
    }
    let roles = read_roles(&rest[obj_end..]);
    let anchor = roles.in_space?; // an able needs an anchor (the reducer requires one)
    Some(grant_act(subject, &able, &anchor))
}

/// A grant of `able` to being `subject`, anchored at space `anchor`, THROUGH I (the granter). Matches the
/// reducer (`apply_able_grants`): verb:do, act:grant-able, of:{being,subject}, through:I (-> grantedBy),
/// params:{able, anchorSpaceId}.
fn grant_act(subject: &str, able: &str, anchor: &str) -> Json {
    obj(vec![
        ("kind", jstr("act")),
        ("verb", jstr("do")),
        ("act", jstr("grant-able")),
        ("by", jstr("I")),
        ("through", jstr("I")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr(subject))])),
        ("params", obj(vec![("able", jstr(able)), ("anchorSpaceId", jstr(anchor))])),
    ])
}

/// Read the prepositional roles from the tokens after the object (each `<prep> [article] <arg>`).
fn read_roles(rest: &[&str]) -> Roles {
    let mut roles = Roles::default();
    let mut i = 0;
    while i < rest.len() {
        let prep = rest[i].to_lowercase();
        let mut j = i + 1;
        while j < rest.len() && is_article(rest[j]) {
            j += 1;
        }
        if j < rest.len() {
            let arg = rest[j].to_string();
            if prep == "in" {
                roles.in_space = Some(arg);
            }
            // (to/with/at/on roles are read as later forms migrate.)
        }
        i = j + 1;
    }
    roles
}

/// `I am <Name> [in <space>]` -> be:birth the being (create-or-switch), homed by `in`. The be-FORM
/// "birth" is the flagged stopgap (see the module header): meaning bound for be.word.
fn be_act(object: &str, roles: &Roles) -> Option<Json> {
    // the being is a single Name TOKEN — case-insensitive (`Tabor` or `tabor`; the id canonicalizes). A
    // MULTI-WORD / quoted / article-led object (the verse `I am "what?" I am`, or the able form `I am a
    // judge`) fails the single-word test -> None, so parse() falls back (the verse rule, the able form, …).
    if !is_name(object) {
        return None;
    }
    // `I am <Name>` = JUST birth (Tabor: "the first am is just being birth thats it") — an EMPTY being
    // that becomes itself through later words. `in <space>` adds the being's HOME (be.word: "a being has
    // a home that is a space"); the reducer DEFAULTS `position` from `homeSpace`, so you are born AT your
    // home — no explicit position needed. Nothing else at birth: NO able (that is `I am a <role>`), NO
    // handle/name/position crammed in. As `am` is later redefined, saying it invokes a TREE (connect-if-
    // exists, auto-home-from-location, ...) one act at a time — but the bare/genesis `am` is one act: birth.
    let mut params: Vec<(&str, Json)> = vec![];
    if let Some(home) = &roles.in_space {
        params.push(("homeSpace", jstr(home)));
    }
    Some(obj(vec![
        ("kind", jstr("act")),
        ("verb", jstr("be")),
        ("act", jstr("birth")), // STOPGAP: the be-form belongs in be.word (the present of be on a being is to birth it)
        ("by", jstr("I")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr(object))])),
        ("params", obj(params)),
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vocab;
    use std::path::PathBuf;

    fn wf(name: &str) -> String {
        let seed = match std::env::var("TREE_SEED_DIR") {
            Ok(d) if !d.is_empty() => PathBuf::from(d),
            _ => PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../seed")),
        };
        std::fs::read_to_string(seed.join("store/words").join(name)).unwrap_or_else(|e| panic!("{e}"))
    }
    fn full_vocab() -> Vocabulary {
        vocab::read_vocabulary(&wf("verbs.word"), &wf("do.word"), &wf("see.word"), &wf("recall.word"))
    }
    fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
        if let Json::Obj(e) = v {
            e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x)
        } else {
            None
        }
    }
    fn gs<'a>(v: &'a Json, k: &str) -> Option<&'a str> {
        match get(v, k) {
            Some(Json::Str(s)) => Some(s.as_str()),
            _ => None,
        }
    }
    fn of_id<'a>(v: &'a Json) -> Option<&'a str> {
        get(v, "of").and_then(|o| gs(o, "id"))
    }
    fn home<'a>(v: &'a Json) -> Option<&'a str> {
        get(v, "params").and_then(|p| gs(p, "homeSpace"))
    }

    #[test]
    fn reads_i_am_name_in_space_off_the_word() {
        let v = full_vocab();
        // the exact genesis-delegates form: birth + home, the VERB coming from the word. One clause -> one act.
        let acts = read_act("I am Arrival in root.", &v);
        assert_eq!(acts.len(), 1, "one clause -> one act: {acts:?}");
        let n = &acts[0];
        assert_eq!(gs(n, "verb"), Some("be"), "am resolved to be (from verbs.word)");
        assert_eq!(gs(n, "act"), Some("birth"), "be on a being -> birth");
        assert_eq!(gs(n, "by"), Some("I"), "signed by I");
        assert_eq!(of_id(n), Some("Arrival"), "the being is the object");
        assert_eq!(home(n), Some("root"), "the `in` role -> homeSpace (position defaults from it)");
        assert!(get(n, "params").and_then(|p| gs(p, "able")).is_none(), "no able at a bare birth");

        // home optional; `I am Cherub.` still births, no home. Case does not matter (`I am cherub.` too).
        assert_eq!(of_id(&read_act("I am Cherub.", &v)[0]), Some("Cherub"));
        assert!(home(&read_act("I am Cherub.", &v)[0]).is_none(), "no `in` -> no home");
        assert_eq!(of_id(&read_act("I am Http-server in host.", &v)[0]), Some("Http-server"));
        assert_eq!(home(&read_act("I am Http-server in host.", &v)[0]), Some("host"));

        // a non-"I" subject / a declaration are not this reader's -> EMPTY (regex fallback).
        assert!(read_act("A word is a word.", &v).is_empty(), "a declaration is not a subject-verb act here");
        // the genesis verse is NOT this form (quoted, multi-word) -> empty (falls back to the verse rule).
        assert!(read_act("I am \"what?\" I am.", &v).is_empty(), "the verse falls back, not birthed");
    }

    #[test]
    fn reads_trailing_able_clauses_as_separate_grant_moments() {
        let v = full_vocab();
        // `I am Cherub in root, a cherub in root, an angel in heaven` = birth + TWO grants = THREE moments.
        let acts = read_act("I am Cherub in root, a cherub in root, an angel in heaven.", &v);
        assert_eq!(acts.len(), 3, "one sentence unfolds into three moments: {acts:?}");
        // moment 0: the BARE birth (home root, no able).
        assert_eq!(gs(&acts[0], "act"), Some("birth"));
        assert_eq!(of_id(&acts[0]), Some("Cherub"));
        assert_eq!(home(&acts[0]), Some("root"));
        assert!(get(&acts[0], "params").and_then(|p| gs(p, "able")).is_none());
        // moment 1: grant the `cherub` able @root TO Cherub (the being the base named).
        assert_eq!(gs(&acts[1], "act"), Some("grant-able"));
        assert_eq!(of_id(&acts[1]), Some("Cherub"), "the able grants to the being the base named");
        assert_eq!(get(&acts[1], "params").and_then(|p| gs(p, "able")), Some("cherub"));
        assert_eq!(get(&acts[1], "params").and_then(|p| gs(p, "anchorSpaceId")), Some("root"), "the `in` anchor");
        assert_eq!(gs(&acts[1], "through"), Some("I"), "granted through I (-> grantedBy)");
        // moment 2: grant the `angel` able @heaven.
        assert_eq!(get(&acts[2], "params").and_then(|p| gs(p, "able")), Some("angel"));
        assert_eq!(get(&acts[2], "params").and_then(|p| gs(p, "anchorSpaceId")), Some("heaven"));

        // a bare Public birth (no ables) is a SINGLE moment.
        assert_eq!(read_act("I am Public in root.", &v).len(), 1, "no trailing clauses -> one moment");
    }

    #[test]
    fn reads_i_make_space_off_the_word() {
        let v = full_vocab();
        // DEBUG: pinpoint the resolve.
        assert!(v.verb_by_present("make").is_some(), "DEBUG: make resolves as a verb");
        assert_eq!(v.verb_by_present("make").and_then(|x| x.family), Some(Family::Do), "DEBUG: make is a Do");
        assert_eq!(v.verb_by_present("make").map(|x| x.present.as_str()), Some("make"), "DEBUG: present is make");
        // `I make heaven in root.` -> do:create-space heaven, parent root. `make` is a Do verb (do.word);
        // the verb decides being-vs-space -> a SPACE (not a being).
        let acts = read_act("I make heaven in root.", &v);
        assert_eq!(acts.len(), 1, "one space made: {acts:?}");
        assert_eq!(gs(&acts[0], "verb"), Some("do"));
        assert_eq!(gs(&acts[0], "act"), Some("create-space"));
        assert_eq!(get(&acts[0], "of").and_then(|o| gs(o, "kind")), Some("space"), "make -> a space");
        assert_eq!(of_id(&acts[0]), Some("heaven"));
        assert_eq!(get(&acts[0], "params").and_then(|p| gs(p, "parent")), Some("root"), "the `in` role -> parent");
        // `I make the root.` -> create-space root, no parent (leading article stripped).
        let r = read_act("I make the root.", &v);
        assert_eq!(of_id(&r[0]), Some("root"));
        assert!(get(&r[0], "params").and_then(|p| gs(p, "parent")).is_none(), "no `in` -> no parent");
    }
}
