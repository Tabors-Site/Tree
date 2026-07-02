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
// FLAGGED STOPGAP (the drift-test, honestly applied — see WORD-DRIVEN-PARSER.md "Step-0 STATUS"): the
// be-FORM "birth" (which of be's forms a present on a being maps to) is picked in Rust here. be.word ALREADY
// DECLARES the forms in PROSE ("A being is born of a mother" = birth, "connected to when a Name takes it up"
// = connect, …); what is missing is a FOLD that EXTRACTS "present-of-be-on-a-being → birth (+ home as a
// field)" from that definition so the reader can UNFOLD it. `be_act` short-circuits that fold. The be:birth
// PRIMITIVE stays FLOOR (an irreducible op, as be.js was); what should FOLD is `am`'s DEFINITION assembling
// the primitive + the story's redefinitions. Everything else here IS floor: splitting a sentence into words
// + roles, resolving the verb from the vocabulary. This pick is the remaining seam — the crystallization
// keystone — marked so it stays visible; retire it only once the fold proves birth+home (Step-0).

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

/// The prepositional roles a statement carries: `in <space>` (home/parent), `to <space>` (destination),
/// … (extended as forms migrate).
#[derive(Default)]
struct Roles {
    in_space: Option<String>,
    to_space: Option<String>,
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

/// Read a DEED-voice effect — the being's spoken deed, IMPLICIT subject ($caller), NO "I". This is the
/// sibling of `read_act`: `read_act` is the "I" voice (top-level acts), `read_effect` is the deed voice
/// (a flow body's effect, or a bare deed a being utters). Same word-driven reading — resolve the verb from
/// the vocabulary + read roles generically — but the subject is the actor itself, so there is no `of`/`by`
/// unless the deed names one. Returns None for forms not yet migrated; `parse_effect` then falls back to
/// the effect regex tables. (No `ctx` yet — the first migrated deed, `move <direction>`, needs none; deeds
/// that read the flow's state_var/being will take it as they migrate.)
///
/// FIRST DEED: `move <direction>` / WASD -> `do:move` carrying params.direction. The being walks ITSELF
/// (move.word reads `$caller` and authors the do:move on its reel) — the EXISTING move verb, the four
/// compass words the vocabulary. Same do:move as the "I" voice's `I move to <space>`, but a compass step
/// (a direction) rather than a destination space.
pub fn read_effect(clause: &str, vocab: &Vocabulary) -> Option<Json> {
    let s = clause.trim().trim_end_matches('.').trim();
    let tokens: Vec<&str> = s.split_whitespace().collect();
    if tokens.is_empty() {
        return None;
    }
    // WASD: a single coined compass KEY (w/a/s/d) -> the same do:move as `move <dir>` (w=north/forward,
    // a=west/left, s=south/back, d=east/right). STAMP mode sends the bare chord; the `.` is optional.
    if tokens.len() == 1 {
        if let Some(dir) = wasd_direction(tokens[0]) {
            return Some(move_direction_act(dir));
        }
    }
    // DRIFT / STOPGAP, honestly marked (WORD-DRIVEN-PARSER.md tripwire "THE SNEAKY FORM"): the vocab
    // resolves the verb (floor), but the `match verb.present { "move" => …, "call" => … }` below is a
    // PER-VERB ARM emitting a per-verb IR SHAPE — that shape is MEANING (what the deed does), and it is the
    // regex RELOCATED into the reader, not removed. The right shape is GENERIC: emit the verb + object +
    // roles uniformly, and let each verb's `.word` + the word-driven fold decide the op-name / shape / what
    // it does. These arms are frozen mirrors of that fold, kept until the generic reader + fold land (the
    // keystone / joint crystallization). DO NOT add more per-verb arms — that is drift dressed as progress.
    let verb = vocab.verb_by_present(tokens[0])?;
    let rest = &tokens[1..];
    let rest_raw = s[tokens[0].len()..].trim();
    match verb.present.as_str() {
        // `move <direction>` -> do:move params.direction (NO `of` — $caller walks itself). A bare compass
        // direction is the object; `move to <space>` is the "I" voice (read_act), so a non-compass `move`
        // defers to the fallback.
        "move" => {
            let dir = rest.first().map(|d| d.to_lowercase())?;
            if !is_compass(&dir) {
                return None;
            }
            Some(move_direction_act(&dir))
        }
        // `call <X>, saying <Y>` (quotative — talk content) / `call <X> to <Y>[, with <Z>]` (intent —
        // summon-to-act) -> a CALL. The verb came from the word; the roles are read; refs are floor.
        "call" => read_call(rest_raw),
        _ => None, // other deeds not migrated to the reader yet -> parse_effect falls back to the tables
    }
}

/// `call <X>, saying <Y> [as <bind>]` (quotative) OR `call <X> to <Y>[, with <Z>] [as <bind>]` (intent)
/// -> a CALL. Matches the retired call regexes EXACTLY: kind:call, of:ref(X), then saying:lit(Y) | to:
/// <intent>+with:lit(Z); `as <bind>` names the reply binding. `rest` is the clause AFTER `call`. The verb
/// `call` was resolved from the vocabulary; the role hinges (`, saying `/` to `/`, with `/` as `) are read
/// here; reference resolution (ref_key/ref_obj/ref_lit) is the shared FLOOR. None -> parse_effect (but the
/// call regexes are deleted, so None here means a malformed call — the same nothing the regex produced).
fn read_call(rest: &str) -> Option<Json> {
    // peel an optional trailing ` as <bind>` (a bare word at the very end) — shared by both forms. An
    // ` as ` INSIDE a quoted message is NOT the bind (the tail must be a bare word), matching the regex.
    let (body, bind) = peel_as_bind(rest);
    // FORM 1 (quotative): the `, saying ` hinge splits callee X from message Y. Tried FIRST (as the regexes were).
    if let Some((x, y)) = split_once_ci(&body, ", saying ") {
        let mut node = vec![
            ("kind", jstr("call")),
            ("of", crate::ref_obj(&crate::ref_key(x))),
            ("saying", crate::ref_lit(y.trim())),
        ];
        if let Some(b) = &bind {
            node.push(("bind", jstr(b)));
        }
        return Some(obj(node));
    }
    // FORM 2 (intent): the ` to ` hinge splits callee X from the intent word Y; an optional `, with <Z>`.
    if let Some((x, after)) = split_once_ci(&body, " to ") {
        let (to_word, with) = match split_once_ci(after, ", with ") {
            Some((t, z)) => (t.trim(), Some(z.trim())),
            None => (after.trim(), None),
        };
        // the intent is a single word (`[\w-]+`, lowercased) — reject anything else (defer to the fallback).
        if to_word.is_empty() || !to_word.chars().all(|c| c.is_alphanumeric() || c == '-') {
            return None;
        }
        let mut node = vec![
            ("kind", jstr("call")),
            ("of", crate::ref_obj(&crate::ref_key(x))),
            ("to", jstr(&to_word.to_lowercase())),
        ];
        if let Some(z) = with {
            node.push(("with", crate::ref_lit(z)));
        }
        if let Some(b) = &bind {
            node.push(("bind", jstr(b)));
        }
        return Some(obj(node));
    }
    None
}

/// Peel an optional trailing ` as <bind>` (a bare word `[\w-]` at the very end) off a deed body. Returns
/// (body-without-suffix, the bind if present). Because the tail must be a bare word, an ` as ` inside a
/// quoted message is NOT mistaken for the bind — the retired regexes' `(?:\s+as\s+(\w+))?$`.
fn peel_as_bind(s: &str) -> (String, Option<String>) {
    let lower = s.to_lowercase();
    if let Some(pos) = lower.rfind(" as ") {
        let tail = s[pos + 4..].trim();
        if !tail.is_empty() && tail.chars().all(|c| c.is_alphanumeric() || matches!(c, '-' | '_')) {
            return (s[..pos].trim().to_string(), Some(tail.to_string()));
        }
    }
    (s.trim().to_string(), None)
}

/// Case-insensitive `split_once`: the FIRST occurrence of `sep` (compared lowercased), returning the
/// (before, after) slices of the ORIGINAL string so case/quotes in the parts survive. ASCII separators
/// (`, saying `/` to `/…) over ASCII `.word`, so byte positions in the lowercased copy match the original.
fn split_once_ci<'a>(s: &'a str, sep: &str) -> Option<(&'a str, &'a str)> {
    let lower = s.to_lowercase();
    lower.find(&sep.to_lowercase()).map(|pos| (&s[..pos], &s[pos + sep.len()..]))
}

/// `w`/`a`/`s`/`d` -> its compass direction (the coined WASD keys), case-insensitive. None for any other
/// single token (it then falls through to verb resolution / the fallback).
fn wasd_direction(tok: &str) -> Option<&'static str> {
    match tok.to_lowercase().as_str() {
        "w" => Some("north"),
        "a" => Some("west"),
        "s" => Some("south"),
        "d" => Some("east"),
        _ => None,
    }
}

fn is_compass(d: &str) -> bool {
    matches!(d, "north" | "south" | "east" | "west")
}

/// `move <direction>` / WASD -> do:move carrying params.direction. Matches the retired effect regex EXACTLY:
/// kind:act, verb:do, act:move, params:{direction}, and NO `of` (the subject is the actor's own being).
fn move_direction_act(dir: &str) -> Json {
    obj(vec![
        ("kind", jstr("act")),
        ("verb", jstr("do")),
        ("act", jstr("move")),
        ("params", obj(vec![("direction", jstr(dir))])),
    ])
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
    if tokens.len() < 2 {
        return None;
    }
    // `My name is <Name>` -> RENAME the current being (a self `do:set-being` on `name`). First-person
    // POSSESSIVE: "My" = the being you DRIVE, not "I" the signer — so there is NO `of`; the reducer
    // short-circuits a self set-being onto $caller. The copula "is" is resolved from the word (a Be present
    // form). A rename is a self-STATE declared with be, distinct from `I am <Name>` (which BIRTHS a being).
    if tokens[0] == "My" {
        return read_rename(&tokens[1..], vocab);
    }
    if tokens[0] != "I" {
        return None; // only the "I" signer + "My" possessive voices migrated yet (other subjects later)
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
        Some(Family::Do) if verb.present.as_str() == "make" => {
            // a SPACE id is lowercase (`heaven`, `root`) — a Space Name is Capitalized in Word but its id
            // canonicalizes to lowercase ("the id derivation lowercases"). So accept any case here (not
            // the Capitalized `is_name`, which is for beings) and lowercase the id.
            let space = strip_article(&object).to_lowercase();
            if !is_space_id(&space) {
                return None;
            }
            Some((vec![make_space_act(&space, &roles)], space))
        }
        // `I move to <space>` -> do:move to the destination space (move is a Do; verbs.word "Move is a
        // verb"). We already have move words for spaces + coords — there is NO `stand` (Tabor). The `to`
        // role is the destination (its id lowercases).
        Some(Family::Do) if verb.present.as_str() == "move" => {
            let target = roles.to_space.as_ref()?.to_lowercase();
            if !is_space_id(&target) {
                return None;
            }
            Some((vec![move_act(&target)], target))
        }
        // `I give the <matter> to <Receiver>` -> do:give the matter to the receiver being (give is a Do;
        // do.word "to give ... are dos"). The object is the matter (id lowercases); the `to` role is the
        // receiving being (a Capitalized Name, kept as-is).
        Some(Family::Do) if verb.present.as_str() == "give" => {
            let matter = strip_article(&object).to_lowercase();
            let to = roles.to_space.as_ref()?;
            if !is_space_id(&matter) || !is_name(to) {
                return None;
            }
            Some((vec![give_act(&matter, to)], matter))
        }
        _ => None, // other verbs/families not migrated to the reader yet -> parse() falls back to the regex
    }
}

/// `My name is <Name>` -> ([do:set-being name=<Name>], <Name>) — a self RENAME. Matches the retired regex
/// EXACTLY: kind:act, verb:do, act:set-being, params:{field, value}, and NO `by`/`of` (the subject is the
/// actor's own being, resolved to $caller at rasterize). `<Name>` is Capitalized (a Name), per the doctrine.
///
/// FLAGGED STOPGAP (the SAME seam as be_act's birth, honestly marked): "is" is resolved from the word and
/// the sentence is split generically — that is FLOOR. But the MAPPING "a be-copula on a being's field SETS
/// that field" is MEANING (be's own definition), and by the leash it belongs in be.word ("the present of be
/// on a being's <field> is to set that field"), which would also fold birth (be on a being = birth it). It
/// lowers a be-form to a `do:set-being` op just as the able form lowers `be`+article to `do:grant-able` —
/// both bound for the op/be.word pass. Only `name` is migrated (the form that existed); the general
/// `My <field> is <value>` (any field, typed by the reducer's fold — "flat storage, typed fold") awaits it.
fn read_rename(rest: &[&str], vocab: &Vocabulary) -> Option<(Vec<Json>, String)> {
    // shape: `name is <Value>` — field, copula, value (exactly three tokens).
    if rest.len() != 3 || rest[0] != "name" {
        return None;
    }
    let verb = vocab.verb_by_present(rest[1])?; // the copula "is", resolved FROM THE WORD
    if !matches!(verb.family, Some(Family::Be)) {
        return None; // a Be copula (is/am/are) only — "My name <verb> X" for a non-be verb is not a rename
    }
    let value = rest[2];
    if !is_name(value) {
        return None; // the new name is a Name (Capitalized)
    }
    Some((vec![set_being_act("name", value)], value.to_string()))
}

/// A self `do:set-being <field> = <value>` (no `by`/`of` — resolves onto $caller at rasterize). The shape
/// the retired `My name is <Name>` regex laid.
fn set_being_act(field: &str, value: &str) -> Json {
    obj(vec![
        ("kind", jstr("act")),
        ("verb", jstr("do")),
        ("act", jstr("set-being")),
        ("params", obj(vec![("field", jstr(field)), ("value", jstr(value))])),
    ])
}

/// `I give the <matter> to <Receiver>` -> do:give the matter to a receiver being. Matches the retired
/// regex: verb:do, act:give, of:{matter, id}, to:<Receiver>.
fn give_act(matter: &str, to: &str) -> Json {
    obj(vec![
        ("kind", jstr("act")),
        ("verb", jstr("do")),
        ("act", jstr("give")),
        ("by", jstr("I")),
        ("of", obj(vec![("kind", jstr("matter")), ("id", jstr(matter))])),
        ("to", jstr(to)),
    ])
}

/// `I move to <space>` -> do:move to the destination space. (Same shape the retired `I stand in <space>`
/// produced: verb:do, act:move, of:{space, id}. `stand` is gone — move is the word.)
fn move_act(target: &str) -> Json {
    obj(vec![
        ("kind", jstr("act")),
        ("verb", jstr("do")),
        ("act", jstr("move")),
        ("by", jstr("I")),
        ("of", obj(vec![("kind", jstr("space")), ("id", jstr(target))])),
    ])
}

/// A space id: a single lowercase word (letters/digits + `-._`), not an article. (Space Names are
/// Capitalized in Word; the id lowercases — this checks the lowercased id.)
fn is_space_id(s: &str) -> bool {
    !s.is_empty()
        && !is_article(s)
        && s.chars().next().map_or(false, |c| c.is_alphabetic())
        && s.chars().all(|c| c.is_alphanumeric() || matches!(c, '-' | '.' | '_'))
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
        params.push(("parent", jstr(&parent.to_lowercase()))); // a space id lowercases
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
            match prep.as_str() {
                "in" => roles.in_space = Some(arg),
                "to" => roles.to_space = Some(arg),
                _ => {} // (with/at/on roles are read as later forms migrate.)
            }
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

        // `I move to heaven.` -> do:move to heaven (the retired `I stand in` is now move; no `stand`).
        let mv = read_act("I move to heaven.", &v);
        assert_eq!(mv.len(), 1, "one move: {mv:?}");
        assert_eq!(gs(&mv[0], "verb"), Some("do"));
        assert_eq!(gs(&mv[0], "act"), Some("move"));
        assert_eq!(of_id(&mv[0]), Some("heaven"), "the `to` role -> the destination space");

        // `I give the apple to Bob.` -> do:give the matter `apple` to the receiver being `Bob`.
        let g = read_act("I give the apple to Bob.", &v);
        assert_eq!(g.len(), 1, "one give: {g:?}");
        assert_eq!(gs(&g[0], "act"), Some("give"));
        assert_eq!(get(&g[0], "of").and_then(|o| gs(o, "kind")), Some("matter"), "give -> a matter");
        assert_eq!(of_id(&g[0]), Some("apple"));
        assert_eq!(gs(&g[0], "to"), Some("Bob"), "the `to` role -> the receiver being (kept Capitalized)");
    }

    #[test]
    fn reads_my_name_is_as_a_rename() {
        let v = full_vocab();
        // `My name is Bob.` -> a self do:set-being name=Bob (RENAME, not a birth). "My" = first-person
        // possessive; the copula "is" resolves to Be from the word. No `by`/`of` (resolves onto $caller).
        let r = read_act("My name is Bob.", &v);
        assert_eq!(r.len(), 1, "one rename: {r:?}");
        assert_eq!(gs(&r[0], "verb"), Some("do"));
        assert_eq!(gs(&r[0], "act"), Some("set-being"));
        assert_eq!(get(&r[0], "params").and_then(|p| gs(p, "field")), Some("name"), "the name field");
        assert_eq!(get(&r[0], "params").and_then(|p| gs(p, "value")), Some("Bob"), "the new name");
        assert!(get(&r[0], "of").is_none(), "no `of` — a self set-being resolves onto $caller");
        assert!(get(&r[0], "by").is_none(), "no `by` — matches the retired regex shape exactly");
        // `My name is Bob` must NOT be read as a BIRTH of "name" (the `I am <Name>` path) — it is a rename.
        assert_ne!(gs(&r[0], "act"), Some("birth"), "a rename is never a birth");
        // a non-`name` field or a non-Be verb is not this form -> falls back (empty).
        assert!(read_act("My home is heaven.", &v).is_empty(), "only `name` migrated (other fields later)");
    }

    #[test]
    fn reads_move_direction_as_a_deed_off_the_word() {
        let v = full_vocab();
        // `move north.` -> do:move params.direction=north — the DEED voice (no "I"; $caller walks itself).
        let m = read_effect("move north.", &v).expect("move north is a deed");
        assert_eq!(gs(&m, "verb"), Some("do"));
        assert_eq!(gs(&m, "act"), Some("move"));
        assert_eq!(get(&m, "params").and_then(|p| gs(p, "direction")), Some("north"), "the compass direction");
        assert!(get(&m, "of").is_none(), "no `of` — the subject is the actor's own being");
        // the WASD keys -> the same do:move (w=north, a=west, s=south, d=east); bare chord or with a period.
        let dir = |s: &str| read_effect(s, &v).and_then(|n| get(&n, "params").and_then(|p| gs(p, "direction")).map(str::to_string));
        assert_eq!(dir("w").as_deref(), Some("north"));
        assert_eq!(dir("a.").as_deref(), Some("west"));
        assert_eq!(dir("s").as_deref(), Some("south"));
        assert_eq!(dir("d").as_deref(), Some("east"));
        // `move to <space>` is the "I" voice (a destination), NOT a compass deed -> None (defers).
        assert!(read_effect("move to heaven.", &v).is_none(), "move to a space is the I-voice, not a deed");
        // an unmigrated deed (see/the-…) -> None, so parse_effect falls back to the effect tables.
        assert!(read_effect("see the being named Bob as b.", &v).is_none(), "see not migrated -> fallback");
        assert!(read_effect("the cherub forms a being.", &v).is_none(), "a `the …` effect -> fallback");
    }

    #[test]
    fn reads_call_deeds_off_the_word() {
        let v = full_vocab();
        // FORM 1 (quotative): `call <X>, saying <Y>` -> kind:call, of:ref(X), saying:lit(Y).
        let c = read_effect("call the cherub, saying \"hello\".", &v).expect("call…saying is a deed");
        assert_eq!(gs(&c, "kind"), Some("call"));
        assert_eq!(get(&c, "of").and_then(|o| gs(o, "ref")), Some("cherub"), "callee -> ref (article stripped)");
        assert_eq!(gs(&c, "saying"), Some("hello"), "the quoted message -> a literal value");
        assert!(get(&c, "bind").is_none(), "no `as` -> no bind");
        // `as <bind>` names the reply binding, and the message stops before it.
        let cb = read_effect("call Bob, saying hi as reply.", &v).expect("call with bind");
        assert_eq!(gs(&cb, "saying"), Some("hi"), "the message stops before `as <bind>`");
        assert_eq!(gs(&cb, "bind"), Some("reply"), "trailing `as <bind>`");
        // FORM 2 (intent): `call <X> to <Y>, with <Z>` -> kind:call, of:ref(X), to:<intent>, with:lit(Z).
        let i = read_effect("call the birther to birth, with $spec.", &v).expect("call…to is a deed");
        assert_eq!(gs(&i, "kind"), Some("call"));
        assert_eq!(get(&i, "of").and_then(|o| gs(o, "ref")), Some("birther"));
        assert_eq!(gs(&i, "to"), Some("birth"), "the intent verb, lowercased");
        assert_eq!(get(&i, "with").and_then(|w| gs(w, "ref")), Some("spec"), "`with $spec` -> a ref");
        // a bare `call` with neither hinge is malformed -> None (the same nothing the regex gave).
        assert!(read_effect("call nobody.", &v).is_none(), "no saying/to hinge -> None");
    }
}
