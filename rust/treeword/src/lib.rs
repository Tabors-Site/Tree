// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// treeword — the Word engine port, starting with the PARSER: Word text -> IR node array. This is the
// literal "words -> data shape" front of the pipe; the Rust fold (treefold) + stamp (treestore) carry
// the data the rest of the way. Ports seed/present/word/parser.js's line-based, regex-driven recursive
// descent ONE RULE AT A TIME, each proven byte-identical against the JS parser (tests/parse_vectors.rs).
//
// FIRST SLICE (this file): single-line DECLARATION words — the simple, no-lookahead RULES. parse()
// walks lines, applies the first matching rule's builder, returns the node array. DEFERRED for later
// slices: flow headers + bodies (the `:`/indent nesting), events/start (first pass), the guards, and
// the lookahead rules (Rust's `regex` crate is RE2 — no backtracking/lookahead; those rules need
// `fancy-regex` or hand-rolling, handled when we reach them). The harness only feeds covered forms.

use regex::{Captures, Regex};
use std::collections::HashSet;
use std::sync::LazyLock;

pub mod render; // the INVERSE of parse: a Word IR node -> Word text (the generative / output-Word side)
pub mod vocab; // READ THE DECLARED VERBS from verbs.word (WORD-DRIVEN-PARSER.md) — kills the hardcoded verb list
pub mod reader; // THE WORD-DRIVEN READER (WIP): resolve the verb from the vocab, read the sentence generically
use treehash::Json;

fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn obj(pairs: Vec<(&str, Json)>) -> Json {
    Json::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}
/// `m[i] || null` — the capture if present + non-empty, else null.
fn cap_or_null(c: &Captures, i: usize) -> Json {
    match c.get(i) {
        Some(m) if !m.as_str().is_empty() => jstr(m.as_str()),
        _ => Json::Null,
    }
}
/// `m[i] || fallback`.
fn cap_or(c: &Captures, i: usize, fallback: &str) -> Json {
    match c.get(i) {
        Some(m) if !m.as_str().is_empty() => jstr(m.as_str()),
        _ => jstr(fallback),
    }
}

/// parser.js `verb(v)`: depluralize — strikes->strike, pass stays pass.
fn verb(v: &str) -> String {
    if v.ends_with("ss") {
        v.to_string()
    } else if let Some(stripped) = v.strip_suffix('s') {
        stripped.to_string()
    } else {
        v.to_string()
    }
}

/// parser.js `stripArticle(s)`: trim, then drop a leading `a|an|the` + whitespace.
fn strip_article(s: &str) -> String {
    Regex::new(r"(?i)^(a|an|the)\s+").unwrap().replace(s.trim(), "").to_string()
}

/// parser.js `splitItems(s)`: split on top-level `,` / `, and ` / `, or ` / ` and ` / ` or `, respecting
/// nested `{}` `[]` and `"..."`. Returns the trimmed, non-empty parts.
fn split_items(s: &str) -> Vec<String> {
    let sep = Regex::new(r"(?i)^(?:,\s*and\s+|,\s*or\s+|\s+and\s+|\s+or\s+|,\s*)").unwrap();
    let chars: Vec<char> = s.chars().collect();
    let mut parts: Vec<String> = Vec::new();
    let (mut depth, mut in_str, mut buf, mut i) = (0i32, false, String::new(), 0usize);
    while i < chars.len() {
        let ch = chars[i];
        if in_str {
            buf.push(ch);
            if ch == '"' {
                in_str = false;
            }
            i += 1;
            continue;
        }
        match ch {
            '"' => {
                in_str = true;
                buf.push(ch);
                i += 1;
                continue;
            }
            '{' | '[' => {
                depth += 1;
                buf.push(ch);
                i += 1;
                continue;
            }
            '}' | ']' => {
                depth = (depth - 1).max(0);
                buf.push(ch);
                i += 1;
                continue;
            }
            _ => {}
        }
        if depth == 0 {
            let rest: String = chars[i..].iter().collect();
            if let Some(m) = sep.find(&rest) {
                // the pattern is ^-anchored, so a match always begins at i
                if !buf.trim().is_empty() {
                    parts.push(buf.trim().to_string());
                }
                buf.clear();
                i += rest[..m.end()].chars().count();
                continue;
            }
        }
        buf.push(ch);
        i += 1;
    }
    if !buf.trim().is_empty() {
        parts.push(buf.trim().to_string());
    }
    parts
}

/// `splitItems` as a JSON string array (the `items` field).
fn items(s: &str) -> Json {
    Json::Arr(split_items(s).into_iter().map(Json::Str).collect())
}

type Builder = fn(&Captures) -> Json;

fn rules() -> &'static [(Regex, Builder)] {
    static TABLE: LazyLock<Vec<(Regex, Builder)>> = LazyLock::new(|| vec![
        // A <name> is a space.
        (
            Regex::new(r"(?i)^A ([\w.-]+) is a space\.$").unwrap(),
            |m| obj(vec![("kind", jstr("is")), ("subject", jstr(&m[1])), ("isA", jstr("space"))]),
        ),
        // A <name> is a able for a <scope>.
        (
            Regex::new(r"(?i)^A ([\w.-]+) is a able for a ([\w.-]+)\.$").unwrap(),
            |m| obj(vec![("kind", jstr("is")), ("subject", jstr(&m[1])), ("isA", jstr("able")), ("scope", jstr(&m[2]))]),
        ),
        // An <able> can <verb> [the/a/an <of>].   (An? article; able names may be hyphenated)
        (
            Regex::new(r"(?i)^An? ([\w.-]+) can (\w+)(?: (?:a |an |the )?(.+?))?\.$").unwrap(),
            |m| obj(vec![("kind", jstr("can")), ("able", jstr(&m[1])), ("verb", jstr(&verb(&m[2]))), ("of", cap_or_null(m, 3))]),
        ),
        // A <subject> cannot <verb> [the/a/an <of>].
        (
            Regex::new(r"(?i)^A (\w+) cannot (\w+)(?: (?:a |an |the )?(.+?))?\.$").unwrap(),
            |m| obj(vec![("kind", jstr("cannot")), ("subject", jstr(&m[1])), ("verb", jstr(&verb(&m[2]))), ("of", cap_or_null(m, 3))]),
        ),
        // No <subject> can <verb> [it/the/a/an <of>].  (of defaults to "it")
        (
            Regex::new(r"(?i)^No (\w+) can (\w+)(?: (?:a |an |the |it ?)?(.+?))?\.$").unwrap(),
            |m| obj(vec![("kind", jstr("cannot")), ("subject", jstr(&m[1])), ("verb", jstr(&verb(&m[2]))), ("of", cap_or(m, 3, "it"))]),
        ),
        // the able-noun declaration + its grant-set vocabulary (foldAbleNoun collects these).
        // An <able> is an able.
        (
            Regex::new(r"(?i)^An? ([\w.-]+) is an? able\.$").unwrap(),
            |m| obj(vec![("kind", jstr("is")), ("subject", jstr(&m[1])), ("isA", jstr("able"))]),
        ),
        // An <able> reaches <pattern>.
        (
            Regex::new(r"(?i)^An? ([\w.-]+) reaches (.+?)\.$").unwrap(),
            |m| obj(vec![("kind", jstr("reach")), ("able", jstr(&m[1])), ("to", jstr(&m[2]))]),
        ),
        // An <able> needs <llm|human|scripted> cognition.
        (
            Regex::new(r"(?i)^An? ([\w.-]+) needs (llm|human|scripted) cognition\.$").unwrap(),
            |m| obj(vec![("kind", jstr("cognition")), ("able", jstr(&m[1])), ("mode", jstr(&m[2].to_lowercase()))]),
        ),
        // An <able> never wakes.
        (
            Regex::new(r"(?i)^An? ([\w.-]+) never wakes\.$").unwrap(),
            |m| obj(vec![("kind", jstr("wakes")), ("able", jstr(&m[1])), ("when", Json::Arr(vec![]))]),
        ),
        // <I|Capitalized> own(s) [the/a/an] <of>.   (no /i: matches I or a Capitalized name)
        (
            Regex::new(r"^(I|[A-Z][\w.-]*) owns? (?:the |a |an )?([\w.-]+)\.$").unwrap(),
            |m| obj(vec![("kind", jstr("owns")), ("subject", jstr(&m[1])), ("of", jstr(&m[2]))]),
        ),
        // A <able> extends <parent>.
        (
            Regex::new(r"(?i)^A ([\w.-]+) extends ([\w.-]+)\.$").unwrap(),
            |m| obj(vec![("kind", jstr("extends")), ("able", jstr(&m[1].to_lowercase())), ("parent", jstr(&m[2].to_lowercase()))]),
        ),
        // A <subject> has|may have <property>[, <gloss>].
        (
            Regex::new(r"(?i)^A (\w+) (has|may have) (.+?)(?:, (.+))?\.$").unwrap(),
            |m| obj(vec![
                ("kind", jstr("has")),
                ("subject", jstr(&m[1].to_lowercase())),
                ("optional", Json::Bool(m[2].to_lowercase().contains("may"))),
                ("property", jstr(&strip_article(&m[3]))),
                ("gloss", match m.get(4) {
                    Some(x) if !x.as_str().is_empty() => jstr(x.as_str().trim()),
                    _ => Json::Null,
                }),
            ]),
        ),
        // A <name> contains <items>.   (a list declaration)
        (
            Regex::new(r"(?i)^A ([\w.-]+) contains (.+)\.$").unwrap(),
            |m| obj(vec![("kind", jstr("contains")), ("subject", jstr(&m[1].to_lowercase())), ("items", items(&m[2]))]),
        ),
        // A <name> accepts|carries|claims <items>.   (matter-type registry vocab; kind = the verb)
        (
            Regex::new(r"(?i)^A (\w+) (accepts|carries|claims) (.+)\.$").unwrap(),
            |m| obj(vec![("kind", jstr(&m[2].to_lowercase())), ("subject", jstr(&m[1].to_lowercase())), ("items", items(&m[3]))]),
        ),
        // It accepts|carries|claims <items>.   (same registry vocab; subject = the last-declared kind —
        // null standalone, which is what the per-statement corpus sees. parser.js `lastSubject || null`.)
        (
            Regex::new(r"(?i)^It (accepts|carries|claims) (.+)\.$").unwrap(),
            |m| obj(vec![("kind", jstr(&m[1].to_lowercase())), ("subject", Json::Null), ("items", items(&m[2]))]),
        ),
        // I am "what?" I am.   (the genesis verse) - THE NAME-BEING SPLIT (project_name_being_refactor).
        // The verse is the Name "I" birthing the first being "Am": "(I) am" [be:birth Am] / "(I) what?"
        // [the recall] / "(I) am" [the answer], all SIGNED by the Name I. The conflated single "i-am" name
        // token is REPLACED by the be:birth of the being "Am" (the moment genesis actually plants), carried
        // as the verse with `by:"I"` (the signer) and `verse:true` (so render re-utters the full line and
        // it does NOT collide with a plain `I make Am.` be:birth). This is the parser twin of treegenesis's
        // MOMENT 2 (be:birth id:"Am"); the recall/answer are the verse's spoken frame around that one birth.
        (
            Regex::new(r#"(?i)^I am "what\?" I am\.$"#).unwrap(),
            |_m| obj(vec![
                ("kind", jstr("act")),
                ("verb", jstr("be")),
                ("act", jstr("birth")),
                ("by", jstr("I")),
                ("of", obj(vec![("kind", jstr("being")), ("id", jstr("Am"))])),
                ("verse", Json::Bool(true)),
            ]),
        ),
        // ── `I am <Name> [in <space>]` (birth a being, homed by `in`) IS NOW THE WORD-DRIVEN READER ──
        // reader.rs::read_act resolves `am`->`be` from the vocabulary and reads the sentence generically.
        // The two hardcoded regexes that used to live HERE were DELETED: they were frozen snapshots of what
        // `am` means today (one even crammed name/able/homeSpace/position at birth — the fat-birth drift),
        // and `am`'s meaning must be FOLDED, not frozen, so it can grow. Birth is JUST birth + home (the
        // reducer defaults position from homeSpace). See WORD-DRIVEN-PARSER.md ("A WORD IS FOLDED, NOT
        // FROZEN"). parse() calls the reader BEFORE this table, so `I am …` never reaches these rules.
        // (`My name is <Name>` -> do:set-being (RENAME) is now the WORD-DRIVEN READER — reader.rs,
        // `read_rename`: "My" = first-person possessive, "is" a Be copula from the word. Its regex was DELETED.)
        // (`I make <Capitalized>` for a BEING is DEAD — retired to `I am <Name>` in the word-driven reader;
        // nothing in the .word uses it. Its regex was DELETED.)
        // I make [the] <space> [in [the] <parent>] at <x>, <y>.   -> create a space AT a coord, optionally
        // INSIDE a parent. A child's coord is its spot in the parent (the parent assigns it): coord folds
        // onto the space, `parent` -> position. This is the "I make X in Y" grammar the flat seed flagged.
        (
            Regex::new(r"^I make (?:the )?([a-z][\w.-]*)(?: in (?:the )?([a-z][\w.-]*))? at (-?\d+), ?(-?\d+)\.$").unwrap(),
            |m| {
                let mut params = vec![("coord", obj(vec![
                    ("x", Json::Num(m[3].parse::<f64>().unwrap_or(0.0))),
                    ("y", Json::Num(m[4].parse::<f64>().unwrap_or(0.0))),
                ]))];
                if let Some(p) = m.get(2) {
                    if !p.as_str().is_empty() {
                        params.push(("parent", jstr(p.as_str())));
                    }
                }
                obj(vec![
                    ("kind", jstr("act")), ("verb", jstr("do")), ("act", jstr("create-space")), ("by", jstr("I")),
                    ("of", obj(vec![("kind", jstr("space")), ("id", jstr(&m[1]))])),
                    ("params", obj(params)),
                ])
            },
        ),
        // (`I make <space>` and `I make <space> in <parent>` -> do:create-space are now the WORD-DRIVEN
        // READER — reader.rs, `make` a Do-verb from do.word. `I stand in <space>` is RETIRED: there is no
        // `stand`; it is `I move to <space>` (do:move — the move word). Those regexes were DELETED. Only the
        // coord form (`I make <space> [in <parent>] at <x>, <y>`) stays above — the reader defers it (the
        // coord's comma splits the clause, so read_act returns empty and falls back here). `I make X, <gloss>`
        // is unused in the .word.)
        // (`I give the <matter> to <Receiver>` -> do:give is now the WORD-DRIVEN READER — reader.rs, `give`
        // a Do-verb from do.word, the `to` role the receiver. Its regex was DELETED.)
        // A <name> is a <isA>.   (generic kind — LAST so `is a space` / `is a able for a Y` win first)
        (
            Regex::new(r"(?i)^A ([\w.-]+) is a (.+?)\.$").unwrap(),
            |m| obj(vec![("kind", jstr("is")), ("subject", jstr(&m[1].to_lowercase())), ("isA", jstr(&m[2]))]),
        ),
    ]);
    TABLE.as_slice()
}

// ── flow context + body (parser.js first pass, collectBody, EFFECT_RULES) ────

/// parser.js `capitalize(s)`: first char upper, rest unchanged.
fn capitalize(s: &str) -> String {
    let mut it = s.chars();
    match it.next() {
        Some(f) => f.to_uppercase().collect::<String>() + it.as_str(),
        None => String::new(),
    }
}

/// parser.js `indentOf(raw)`: count of leading whitespace.
fn indent_of(raw: &str) -> usize {
    raw.chars().take_while(|c| c.is_whitespace()).count()
}

// ── the guards (parser.js guardForward + guardCapitals) ──────────────────────
// guardForward trips on INWARD/reasoning words (the forward register declares acts/flows; reasoning is
// the inner fold, not built). guardCapitals (RULE19) trips on a bare-capitalized kind + a law verb (a
// mid-sentence capital is a being/Name-ref, not a kind). They make the parser REJECT malformed words.
// Exposed standalone (returning whether they trip), vector-proven vs the JS guards; wiring them into
// parse() (which makes it fallible) is a later step.

/// guardForward: true if `line` is reasoning language (because / therefore / thus / hence / in order that).
pub fn guard_forward(line: &str) -> bool {
    Regex::new(r"(?i)\b(because|therefore|thus|hence)\b|\bin order that\b").unwrap().is_match(line)
}

/// guardCapitals (RULE19): true if `line` is a bare-capitalized kind + a law verb (lookahead → fancy-regex).
pub fn guard_capitals(line: &str) -> bool {
    fancy_regex::Regex::new(r"^(?!It |I |The |A |An )([A-Z][a-z]\w*) (accepts|carries|claims|has|may have|can|cannot)\b")
        .unwrap()
        .is_match(line)
        .unwrap_or(false)
}

/// The parse context (parser.js `c`): the running state dimension, the declared spaces, and the flow's
/// being (`c.being`, set by a births-flow header; the implicit `through` of its body acts).
pub struct Ctx {
    pub state_var: String,
    pub spaces: HashSet<String>,
    pub being: Option<String>,
}

/// parser.js `objRef(obj, c)`: a declared space is a space, else matter.
fn obj_ref(obj_name: &str, ctx: &Ctx) -> Json {
    let kind = if ctx.spaces.contains(&obj_name.to_lowercase()) { "space" } else { "matter" };
    obj(vec![("kind", jstr(kind)), ("id", jstr(obj_name))])
}

/// stateAct (parser.js): a flow effect — by capitalize(R), act = verb(V), with an optional `of`
/// (a declared space, else matter) and an optional `sets` (the next phase of the state dimension).
fn state_act(ctx: &Ctx, r: &str, v: &str, of_name: Option<&str>, becomes: Option<&str>) -> Json {
    let mut node = vec![
        ("kind", jstr("act")), ("verb", jstr("do")), ("act", jstr(&verb(v))), ("by", jstr(&capitalize(r))),
    ];
    if let Some(o) = of_name {
        node.push(("of", obj_ref(o, ctx)));
    }
    if let Some(y) = becomes {
        node.push(("sets", Json::Obj(vec![(ctx.state_var.clone(), jstr(y))])));
    }
    obj(node)
}

/// First pass: read the state dimension (START line) + declared spaces (is-a-space). Events (DERIVE)
/// are deferred — not needed by the ported effects.
fn first_pass(raw: &[&str]) -> Ctx {
    let start = Regex::new(r"(?i)^The (\w+) begins at (\w+)\.$").unwrap();
    let space = Regex::new(r"(?i)^A (.+?) is a space\.$").unwrap();
    let mut state_var = "sky".to_string();
    let mut spaces = HashSet::new();
    for r in raw {
        let line = r.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some(m) = start.captures(line) {
            state_var = m[1].to_lowercase();
            continue;
        }
        if let Some(m) = space.captures(line) {
            spaces.insert(m[1].to_lowercase());
        }
    }
    Ctx { state_var, spaces, being: None }
}

/// being_act (parser.js): an unqualified flow-body act — by I, THROUGH the flow's being.
fn being_act(ctx: &Ctx, verb_name: &str, op: &str, of: Json, params: Json) -> Json {
    let through = match &ctx.being {
        Some(b) => jstr(b),
        None => Json::Null,
    };
    obj(vec![
        ("kind", jstr("act")), ("verb", jstr(verb_name)), ("act", jstr(op)), ("by", jstr("I")),
        ("through", through), ("of", of), ("params", params),
    ])
}

/// writeAct (parser.js): THE WALL's write side — a substrate write → do:set-<kind> on a bound entity.
fn write_act(ctx: &Ctx, noun: &str, field: &str, value: &str, merge: Option<bool>, reference: &str) -> Json {
    let k = noun.to_lowercase();
    let kind = if k == "space" {
        "space"
    } else if k == "matter" {
        "matter"
    } else {
        "being"
    };
    let fld = match field.strip_prefix('$') {
        Some(rest) => ref_obj(&ref_key(rest)),
        None => jstr(field),
    };
    let v = value.trim();
    let resolved = if v.len() >= 2 && v.starts_with('"') && v.ends_with('"') {
        jstr(&v[1..v.len() - 1])
    } else if v.starts_with('$') {
        jstr(v)
    } else {
        ref_lit(v)
    };
    let mut params = vec![("field", fld), ("value", resolved)];
    if let Some(m) = merge {
        params.push(("merge", Json::Bool(m)));
    }
    let of = obj(vec![("kind", jstr(kind)), ("ref", jstr(&ref_key(reference)))]);
    being_act(ctx, "do", &format!("set-{kind}"), of, obj(params))
}

type EffBuilder = fn(&Captures, &Ctx) -> Json;

/// EFFECT_RULES (this slice: the two state-act forms — parser.js `stateAct`).
fn effect_rules() -> &'static [(Regex, EffBuilder)] {
    static TABLE: LazyLock<Vec<(Regex, EffBuilder)>> = LazyLock::new(|| vec![
        // (`move <direction>` and the WASD keys -> do:move params.direction are now the WORD-DRIVEN READER
        // (deed voice) — reader.rs `read_effect`: `move` a Do-verb from the word, the compass words the
        // vocabulary, WASD the coined keys. parse_effect calls read_effect first. Both regexes were DELETED.)
        // the <able> <verb>, and it becomes <X>.   (a state-wheel act: no `of`, sets the next state)
        (
            Regex::new(r"(?i)^the (\w+) (\w+), and it becomes (\w+)\.$").unwrap(),
            |m, ctx| obj(vec![
                ("kind", jstr("act")), ("verb", jstr("do")), ("act", jstr(&verb(&m[2]))), ("by", jstr(&capitalize(&m[1]))),
                ("sets", Json::Obj(vec![(ctx.state_var.clone(), jstr(&m[3]))])),
            ]),
        ),
        // the <able> <verb> the <obj>.   (an act on a declared space / matter)
        (
            Regex::new(r"(?i)^the (\w+) (\w+) the (\w+)\.$").unwrap(),
            |m, ctx| obj(vec![
                ("kind", jstr("act")), ("verb", jstr("do")), ("act", jstr(&verb(&m[2]))), ("by", jstr(&capitalize(&m[1]))),
                ("of", obj_ref(&m[3], ctx)),
            ]),
        ),
        // see whether <X> has [credential] authority over <Y> as <bind>.   (authority-walk predicate)
        (
            Regex::new(r"(?i)^see whether (.+?) has( credential)? authority over (.+?) as (\w+)\.$").unwrap(),
            |m, _ctx| {
                let mut node = vec![("kind", jstr("see")), ("of", ref_obj(&ref_key(&m[1]))), ("hasAuthorityOver", ref_obj(&ref_key(&m[3])))];
                if m.get(2).is_some() {
                    node.push(("credential", Json::Bool(true)));
                }
                node.push(("bind", jstr(&m[4])));
                obj(node)
            },
        ),
        // see whether <X> is an ancestor of <Y> as <bind>.   (being-tree descent predicate)
        (
            Regex::new(r"(?i)^see whether (.+?) is an ancestor of (.+?) as (\w+)\.$").unwrap(),
            |m, _ctx| obj(vec![
                ("kind", jstr("see")), ("of", ref_obj(&ref_key(&m[2]))),
                ("descendsFrom", ref_obj(&ref_key(&m[1]))), ("bind", jstr(&m[3])),
            ]),
        ),
        // see the <X>'s <field> as <bind>.   (a fresh projection read)
        (
            Regex::new(r"(?i)^see the (.+?)'s (\w+) as (\w+)\.$").unwrap(),
            |m, _ctx| obj(vec![("kind", jstr("see")), ("of", ref_obj(&ref_key(&m[1]))), ("read", jstr(&m[2])), ("fresh", Json::Bool(true)), ("bind", jstr(&m[3]))]),
        ),
        // see the <kind> named <name> as <bind>.   (query beings by name; plural -> list, singular -> one)
        (
            Regex::new(r"(?i)^see the (\w+) named (.+?) as (\w+)\.$").unwrap(),
            |m, _ctx| {
                let plural = Regex::new(r"(?i)s$").unwrap().is_match(&m[1]);
                let of_kind = Regex::new(r"(?i)s$").unwrap().replace(&m[1], "").to_string();
                let name = m[2].trim().trim_matches('"').to_string();
                let mut node = vec![("kind", jstr("see")), ("of", jstr(&of_kind)), ("where", obj(vec![("name", jstr(&name))]))];
                if !plural {
                    node.push(("one", Json::Bool(true)));
                }
                node.push(("bind", jstr(&m[3])));
                obj(node)
            },
        ),
        // (`call <X>, saying <Y>` (quotative) and `call <X> to <Y>[, with <Z>]` (intent) -> a CALL are now
        // the WORD-DRIVEN READER (deed voice) — reader.rs `read_call`: `call` a verb from the word, the role
        // hinges (saying/to/with/as) read there, ref-resolution the shared floor. Both regexes were DELETED.)
        // set the <kind> <ref>'s <field> to <value>.   (THE WALL write -> do:set-<kind>)
        (
            Regex::new(r"(?i)^set the (being|space|matter) ([\w-]+)'s (\$?[\w.]+) to (.+?)\.$").unwrap(),
            |m, ctx| write_act(ctx, &m[1], &m[3], &m[4], None, &m[2]),
        ),
        // replace the <kind> <ref>'s <field> with <value>.   (a non-merge write)
        (
            Regex::new(r"(?i)^replace the (being|space|matter) ([\w-]+)'s (\$?[\w.]+) with (.+?)\.$").unwrap(),
            |m, ctx| write_act(ctx, &m[1], &m[3], &m[4], Some(false), &m[2]),
        ),
        // make a <name> space.   -> do:create-space under the place root (binds the created space's id)
        (
            Regex::new(r"(?i)^make a (\w+) space\.$").unwrap(),
            |m, ctx| {
                let through = match &ctx.being {
                    Some(b) => jstr(b),
                    None => Json::Null,
                };
                obj(vec![
                    ("kind", jstr("act")), ("verb", jstr("do")), ("act", jstr("create-space")), ("by", jstr("I")),
                    ("through", through), ("bind", jstr(&m[1].to_lowercase())),
                    ("of", obj(vec![("kind", jstr("space")), ("ref", jstr("placeRoot"))])),
                    ("params", obj(vec![("name", jstr("$name")), ("type", jstr("home-territory"))])),
                ])
            },
        ),
        // form a being with <{spec}|$ref> [as <bind>].   -> be:form-being (self-stamped)
        (
            Regex::new(r"(?i)^form a being with (\{.*\}|\$[\w.-]+)(?:\s+as\s+([\w-]+))?\.$").unwrap(),
            |m, _ctx| {
                let bind = m.get(2).map(|x| x.as_str()).filter(|s| !s.is_empty()).unwrap_or("child");
                let spec = &m[1];
                let params = if spec.starts_with('{') {
                    parse_object_literal(spec)
                } else {
                    ref_obj(&ref_key(&spec[1..]))
                };
                obj(vec![
                    ("kind", jstr("act")), ("verb", jstr("be")), ("act", jstr("form-being")), ("by", jstr("I")),
                    ("through", jstr("self")), ("bind", jstr(bind)), ("params", params),
                ])
            },
        ),
        // form the being as the new Name's own.   -> be:form-being expressing the arriving Name.
        (
            Regex::new(r"(?i)^form the being as the new Name's own\.$").unwrap(),
            |_m, ctx| {
                let b = ctx.being.clone().map(|x| jstr(&x)).unwrap_or(Json::Null);
                obj(vec![
                    ("kind", jstr("act")), ("verb", jstr("be")), ("act", jstr("form-being")), ("by", jstr("I")),
                    ("through", b.clone()), ("bind", jstr("child")),
                    ("params", obj(vec![
                        ("name", jstr("$name")), ("password", jstr("$password")), ("cognition", jstr("human")),
                        ("defaultAble", jstr("human")), ("parentBeingId", b), ("homeId", jstr("$home")),
                        ("trueName", jstr("$ownerName")),
                    ])),
                ])
            },
        ),
        // make the being the <space>'s owner.   -> do:set-space owner = the new being.
        (
            Regex::new(r"(?i)^make the being the (\w+)'s owner\.$").unwrap(),
            |m, ctx| being_act(ctx, "do", "set-space",
                obj(vec![("kind", jstr("space")), ("ref", jstr(&m[1].to_lowercase()))]),
                obj(vec![("field", jstr("owner")), ("value", jstr("$child"))])),
        ),
        // grant the being the <able> able.   -> do:grant-able (anchored at the place root).
        (
            Regex::new(r"(?i)^grant the being the (\w+) able\.$").unwrap(),
            |m, ctx| being_act(ctx, "do", "grant-able",
                obj(vec![("kind", jstr("being")), ("ref", jstr("child"))]),
                obj(vec![("able", jstr(&m[1])), ("anchorSpaceId", jstr("$placeRoot"))])),
        ),
        // record the being's lineage.   -> do:set-being qualities.lineage (mother = the flow's being).
        (
            Regex::new(r"(?i)^record the being's lineage\.$").unwrap(),
            |_m, ctx| {
                let mother = ctx.being.clone().map(|x| jstr(&x)).unwrap_or(Json::Null);
                being_act(ctx, "do", "set-being",
                    obj(vec![("kind", jstr("being")), ("ref", jstr("child"))]),
                    obj(vec![("field", jstr("qualities.lineage")),
                        ("value", obj(vec![("mother", mother), ("father", jstr("Arrival"))]))]))
            },
        ),
        // host: <fn>(<args>) [as <bind>].   -> a host-escape act (the crypto / session-transport floor).
        (
            Regex::new(r"(?i)^host:\s*(\w+)\(([^)]*)\)\s*(?:as\s+(\w+))?\.?$").unwrap(),
            |m, _ctx| {
                let args: Vec<Json> = arg_list(&m[2], "$").into_iter().map(|r| jstr(&r)).collect();
                let mut node = vec![
                    ("kind", jstr("act")), ("verb", jstr("do")), ("act", jstr(&m[1])), ("host", jstr(&m[1])),
                    ("params", obj(vec![("args", Json::Arr(args))])),
                ];
                if let Some(b) = m.get(3) {
                    if !b.as_str().is_empty() {
                        node.push(("bind", jstr(b.as_str())));
                    }
                }
                obj(node)
            },
        ),
        // the <X> is|are|was|were <Y>.   -> a reflexive state-mark (a flow-local flag a sibling If reads).
        (
            Regex::new(r"(?i)^the ([\w.-]+) (?:is|are|was|were) (\w+)\.$").unwrap(),
            |m, _ctx| {
                let clause = format!("{} {}", &m[1], &m[2]);
                let flag = infer_flag(&clause).unwrap_or_else(|| camel_key(&clause));
                obj(vec![("kind", jstr("mark")), ("flag", jstr(&flag))])
            },
        ),
        // <X> stops the search. / stop.   -> break the nearest foreach.
        (
            Regex::new(r"(?i)\bstops? the search\.$").unwrap(),
            |_m, _ctx| obj(vec![("kind", jstr("break"))]),
        ),
        (
            Regex::new(r"(?i)^stop\.$").unwrap(),
            |_m, _ctx| obj(vec![("kind", jstr("break"))]),
        ),
        // Return <items>.   -> a success terminator; "k: v" items are `extra` kv, bare items `values`.
        (
            Regex::new(r"(?i)^Return (.+)\.$").unwrap(),
            |m, _ctx| {
                let kv = Regex::new(r"^([\w][\w.-]*)\s*:\s*(.+)$").unwrap();
                let (mut values, mut extra): (Vec<Json>, Vec<(String, Json)>) = (Vec::new(), Vec::new());
                for it in split_items(&m[1]) {
                    if let Some(c) = kv.captures(&it) {
                        extra.push((camel_key(&c[1]), ref_lit(c[2].trim())));
                    } else {
                        values.push(jstr(&camel_key(&it)));
                    }
                }
                let mut node = vec![("kind", jstr("return")), ("values", Json::Arr(values))];
                if !extra.is_empty() {
                    node.push(("extra", Json::Obj(extra)));
                }
                obj(node)
            },
        ),
    ]);
    TABLE.as_slice()
}

// ── the do effect (parser.js doOpAct + the do RULES; lookahead → fancy-regex) ────────────────

/// parser.js `splitTopCommas(s)`: comma-split at depth 0, respecting `{}`/`[]`/`"..."`.
fn split_top_commas(s: &str) -> Vec<String> {
    let (mut depth, mut in_str, mut buf, mut out) = (0i32, false, String::new(), Vec::new());
    for ch in s.chars() {
        if in_str {
            buf.push(ch);
            if ch == '"' {
                in_str = false;
            }
            continue;
        }
        match ch {
            '"' => {
                in_str = true;
                buf.push(ch);
            }
            '{' | '[' => {
                depth += 1;
                buf.push(ch);
            }
            '}' | ']' => {
                depth = (depth - 1).max(0);
                buf.push(ch);
            }
            ',' if depth == 0 => {
                if !buf.trim().is_empty() {
                    out.push(buf.trim().to_string());
                }
                buf.clear();
            }
            _ => buf.push(ch),
        }
    }
    if !buf.trim().is_empty() {
        out.push(buf.trim().to_string());
    }
    out
}

/// parser.js `parseObjectLiteral(s)`: `{ k: v, ... }` → object (keys camelCased, values via ref_lit).
fn parse_object_literal(s: &str) -> Json {
    let t = s.trim();
    let t = t.strip_prefix('{').unwrap_or(t);
    let t = t.strip_suffix('}').unwrap_or(t);
    let inner = t.trim();
    let mut o = Vec::new();
    if !inner.is_empty() {
        let kv = Regex::new(r#"^("?[\w][\w.-]*"?)\s*:\s*(.+)$"#).unwrap();
        for it in split_top_commas(inner) {
            if let Some(m) = kv.captures(&it) {
                o.push((camel_key(m[1].trim_matches('"')), ref_lit(m[2].trim())));
            }
        }
    }
    Json::Obj(o)
}

/// parser.js `parseArrayLiteral(s)`: `[ a, b ]` → array (elements via ref_lit).
fn parse_array_literal(s: &str) -> Json {
    let t = s.trim();
    let t = t.strip_prefix('[').unwrap_or(t);
    let t = t.strip_suffix(']').unwrap_or(t);
    let inner = t.trim();
    if inner.is_empty() {
        Json::Arr(vec![])
    } else {
        Json::Arr(split_top_commas(inner).iter().map(|it| ref_lit(it)).collect())
    }
}

/// parser.js `parseDoTarget(s)`: `the <kind> <ref>` → {kind, ref}; else a bare {ref}.
fn parse_do_target(s: &str) -> Json {
    if let Some(km) = Regex::new(r"(?i)^the\s+(being|space|matter)\s+(.+)$").unwrap().captures(s) {
        return obj(vec![("kind", jstr(&km[1].to_lowercase())), ("ref", jstr(&ref_key(&km[2])))]);
    }
    obj(vec![("ref", jstr(&ref_key(s)))])
}

/// parser.js `doOpAct(op, rest, c)`: `do <op> [on <target>] [with <params>] [as <bind>]`.
fn do_op_act(op: &str, rest: &str, _ctx: &Ctx) -> Json {
    let mut node = vec![("kind", jstr("act")), ("verb", jstr("do")), ("act", jstr(op))];
    let mut rest = rest.to_string();
    if let Some(am) = Regex::new(r"(?i)\s+as\s+(\w+)$").unwrap().captures(&rest) {
        node.push(("bind", jstr(&am[1])));
        let end = am.get(0).unwrap().start();
        rest = rest[..end].trim().to_string();
    }
    let mut params_str = String::new();
    if let Some(ow) = Regex::new(r"(?i)^on\s+(.+?)(?:\s+with\s+(.+))?$").unwrap().captures(&rest) {
        node.push(("of", parse_do_target(ow[1].trim())));
        if let Some(p) = ow.get(2) {
            params_str = p.as_str().trim().to_string();
        }
    } else if let Some(w) = Regex::new(r"(?i)^with\s+(.+)$").unwrap().captures(&rest) {
        params_str = w[1].trim().to_string();
    }
    if !params_str.is_empty() {
        let params = if params_str.starts_with('{') && params_str.ends_with('}') {
            parse_object_literal(&params_str)
        } else {
            let kv = Regex::new(r"^([\w][\w.-]*)\s*:\s*(.+)$").unwrap();
            let mut p = Vec::new();
            for it in split_top_commas(&params_str) {
                if let Some(m) = kv.captures(&it) {
                    p.push((camel_key(&m[1]), ref_lit(m[2].trim())));
                }
            }
            Json::Obj(p)
        };
        let empty = matches!(&params, Json::Obj(e) if e.is_empty());
        if !empty {
            node.push(("params", params));
        }
    }
    obj(node)
}

fn fg(m: &fancy_regex::Captures, i: usize) -> String {
    m.get(i).map(|x| x.as_str().to_string()).unwrap_or_default()
}

type FancyEffBuilder = fn(&fancy_regex::Captures, &Ctx) -> Json;

/// The lookahead-bearing EFFECT_RULES (the do forms — `(?!the|a|an)`) — fancy-regex.
fn fancy_effect_rules() -> &'static [(fancy_regex::Regex, FancyEffBuilder)] {
    static TABLE: LazyLock<Vec<(fancy_regex::Regex, FancyEffBuilder)>> = LazyLock::new(|| vec![
        // refuse with "<msg>" [as <code>].   (an error halt; the `(?!If)` so an inline `If …, refuse …`
        // stays the inline-if's, not a bare refuse). `as <code>` -> the SCREAMING_SNAKE IBP error code.
        (
            fancy_regex::Regex::new(r#"(?i)^(?!If\b).*?\brefuses?\b.*?\bwith\s+"([^"]+)"(?:\s+as\s+([\w-]+))?\.?$"#).unwrap(),
            |m, _ctx| {
                let mut node = vec![("kind", jstr("refuse")), ("message", jstr(&fg(m, 1)))];
                if let Some(code) = m.get(2) {
                    if !code.as_str().is_empty() {
                        node.push(("code", jstr(&code.as_str().to_uppercase().replace('-', "_"))));
                    }
                }
                obj(node)
            },
        ),
        // see <op>[(<args>)] as <bind>.   -> a see-op (perception/compute; no fact). (SEE_FLOOR reject-
        // unknown validation deferred — it's a gate, not an IR-shape concern; known ops match exactly.)
        (
            fancy_regex::Regex::new(r"(?i)^see\s+(?!the\b|whether\b)([\w-]+)(?:\(([^)]*)\))?\s+as\s+(\w+)\.?$").unwrap(),
            |m, _ctx| {
                let args: Vec<Json> = match m.get(2) {
                    Some(g) => arg_list(g.as_str(), "$").into_iter().map(|r| jstr(&r)).collect(),
                    None => vec![],
                };
                obj(vec![("kind", jstr("see")), ("act", jstr(&fg(m, 1))), ("args", Json::Arr(args)), ("bind", jstr(&fg(m, 3)))])
            },
        ),
        // do <op>(<args>) [as <bind>].   -> host-escape act
        (
            fancy_regex::Regex::new(r"(?i)^do\s+(?!the\b|a\b|an\b)([\w-]+)\(([^)]*)\)(?:\s+as\s+(\w+))?\.?$").unwrap(),
            |m, _ctx| {
                let op = fg(m, 1);
                let args: Vec<Json> = arg_list(&fg(m, 2), "$").into_iter().map(|r| jstr(&r)).collect();
                let mut node = vec![
                    ("kind", jstr("act")), ("verb", jstr("do")), ("act", jstr(&op)), ("host", jstr(&op)),
                    ("params", obj(vec![("args", Json::Arr(args))])),
                ];
                if let Some(b) = m.get(3) {
                    if !b.as_str().is_empty() {
                        node.push(("bind", jstr(b.as_str())));
                    }
                }
                obj(node)
            },
        ),
        // do <op> [on <target>] [with <params>] [as <bind>].   -> doOpAct dispatch
        (
            fancy_regex::Regex::new(r"(?i)^do\s+(?!the\b|a\b|an\b)([\w-]+)\s*(.*?)\.?$").unwrap(),
            |m, ctx| do_op_act(&fg(m, 1), fg(m, 2).trim(), ctx),
        ),
    ]);
    TABLE.as_slice()
}

/// parser.js `splitInlineIf(inner)`: the HINGE of an inline `If <cond>, <then>` — scanned at
/// paren/brace/bracket/quote depth 0 so a comma inside a see-op's args or a `{ … }` param never reads
/// as the hinge. The hinge is ` then `, `→`/`->`, or a top-level comma NOT followed by `and`/`or`
/// (those join multi-conditions). Returns (cond, then) at the FIRST hinge, or None (malformed).
fn split_inline_if(inner: &str) -> Option<(String, String)> {
    let chars: Vec<char> = inner.chars().collect();
    let (mut depth, mut in_str, mut i) = (0i32, false, 0usize);
    let then_re = Regex::new(r"(?i)^\s+then\s+").unwrap();
    let arrow_re = Regex::new(r"^\s*(?:→|->)\s*").unwrap();
    let andor = Regex::new(r"(?i)^\s*(?:and|or)\b").unwrap();
    while i < chars.len() {
        let ch = chars[i];
        if in_str {
            if ch == '"' {
                in_str = false;
            }
            i += 1;
            continue;
        }
        match ch {
            '"' => {
                in_str = true;
                i += 1;
                continue;
            }
            '(' | '{' | '[' => {
                depth += 1;
                i += 1;
                continue;
            }
            ')' | '}' | ']' => {
                depth = (depth - 1).max(0);
                i += 1;
                continue;
            }
            _ => {}
        }
        if depth != 0 {
            i += 1;
            continue;
        }
        let rest: String = chars[i..].iter().collect();
        if let Some(h) = then_re.find(&rest).or_else(|| arrow_re.find(&rest)) {
            let cond: String = chars[..i].iter().collect();
            let then: String = chars[i + rest[..h.end()].chars().count()..].iter().collect();
            return Some((cond.trim().to_string(), then.trim().to_string()));
        }
        if ch == ',' {
            let after: String = chars[i + 1..].iter().collect();
            if !andor.is_match(&after) {
                let cond: String = chars[..i].iter().collect();
                let then: String = chars[i + 1..].iter().collect();
                return Some((cond.trim().to_string(), then.trim().to_string()));
            }
        }
        i += 1;
    }
    None
}

/// parser.js `splitInlineEffects(s)`: split an inline-then into effects on top-level `,` / `, and ` /
/// ` and `, respecting nested (), {}, [], "..." (a do-param object / op-arg / quoted comma never splits).
fn split_inline_effects(s: &str) -> Vec<String> {
    let sep = Regex::new(r"(?i)^(?:,\s*and\s+|,\s*|\s+and\s+)").unwrap();
    let chars: Vec<char> = s.chars().collect();
    let (mut depth, mut in_str, mut buf, mut out, mut i) = (0i32, false, String::new(), Vec::new(), 0usize);
    while i < chars.len() {
        let ch = chars[i];
        if in_str {
            buf.push(ch);
            if ch == '"' {
                in_str = false;
            }
            i += 1;
            continue;
        }
        match ch {
            '"' => {
                in_str = true;
                buf.push(ch);
                i += 1;
                continue;
            }
            '(' | '{' | '[' => {
                depth += 1;
                buf.push(ch);
                i += 1;
                continue;
            }
            ')' | '}' | ']' => {
                depth = (depth - 1).max(0);
                buf.push(ch);
                i += 1;
                continue;
            }
            _ => {}
        }
        if depth == 0 {
            let rest: String = chars[i..].iter().collect();
            if let Some(m) = sep.find(&rest) {
                if !buf.trim().is_empty() {
                    out.push(buf.trim().to_string());
                }
                buf.clear();
                i += rest[..m.end()].chars().count();
                continue;
            }
        }
        buf.push(ch);
        i += 1;
    }
    if !buf.trim().is_empty() {
        out.push(buf.trim().to_string());
    }
    out
}

/// parser.js `parseInlineThen(rest, c)`: the consequence of an inline If — one-or-more effects. A
/// leading `Return` is ONE effect (its commas are structural kv), else split on the inline separators.
fn parse_inline_then(rest: &str, ctx: &Ctx) -> Vec<Json> {
    let t = rest.trim();
    let as_line = |p: &str| format!("{}.", p.trim_end_matches('.'));
    if Regex::new(r"(?i)^Return\b").unwrap().is_match(t) {
        if let Some(eff) = parse_effect(&as_line(t), ctx) {
            return vec![eff];
        }
    }
    split_inline_effects(t).into_iter().filter_map(|p| parse_effect(&as_line(&p), ctx)).collect()
}

fn parse_effect(line: &str, ctx: &Ctx) -> Option<Json> {
    // THE WORD-DRIVEN READER (deed voice) FIRST (WORD-DRIVEN-PARSER.md): resolve the verb from the declared
    // vocabulary and read the deed generically — the effect peer of parse()'s `read_act` call. Falls back to
    // the effect regex tables below for deeds it does not cover yet (it returns None for those). This one
    // seam covers BOTH flow bodies (collect_body -> parse_effect) and top-level spoken deeds (the fallback).
    if let Some(eff) = reader::read_effect(line, &VOCAB) {
        return Some(eff);
    }
    for (re, build) in effect_rules() {
        if let Some(caps) = re.captures(line) {
            return Some(build(&caps, ctx));
        }
    }
    for (re, build) in fancy_effect_rules() {
        if let Ok(Some(caps)) = re.captures(line) {
            return Some(build(&caps, ctx));
        }
    }
    // inline if: "If <cond>, <then>." -> {kind:if, cond, then:[…]}. The hinge (comma/then/arrow) at
    // depth 0 splits the conditional frame from the consequence (itself one-or-more effects).
    if let Some(m) = Regex::new(r"(?i)^If\s+(.+)\.$").unwrap().captures(line) {
        if let Some((cond, then)) = split_inline_if(&m[1]) {
            return Some(obj(vec![
                ("kind", jstr("if")),
                ("cond", parse_cond(&cond)),
                ("then", Json::Arr(parse_inline_then(&then, ctx))),
            ]));
        }
    }
    None
}

/// parser.js `splitTop(s, re)`: split on `re` at the TOP level only — quoted "..." spans are masked
/// first so a separator inside a quote never splits. Parts trimmed, empties dropped.
fn split_top(s: &str, re: &Regex) -> Vec<String> {
    let mut held: Vec<String> = Vec::new();
    let masked = Regex::new(r#""[^"]*""#)
        .unwrap()
        .replace_all(s, |c: &Captures| {
            held.push(c[0].to_string());
            format!("\u{0}{}\u{0}", held.len() - 1)
        })
        .to_string();
    let restore = Regex::new(r"\x00([0-9]+)\x00").unwrap();
    re.split(&masked)
        .map(|x| restore.replace_all(x, |c: &Captures| held[c[1].parse::<usize>().unwrap_or(0)].clone()).trim().to_string())
        .filter(|x| !x.is_empty())
        .collect()
}

/// parser.js `argList(str, prefix)`: comma-split (top-level) → prefix + ref_key each.
fn arg_list(s: &str, prefix: &str) -> Vec<String> {
    let comma = Regex::new(r",\s*").unwrap();
    split_top(s, &comma).iter().map(|a| format!("{}{}", prefix, ref_key(a))).collect()
}

/// parser.js `parseCond(text, c)` — STRUCTURE only: a host predicate, the and/or connectives (any/all),
/// else a leaf. Recursive over the connectives.
fn parse_cond(text: &str) -> Json {
    let raw = text.trim();
    if let Some(hm) = Regex::new(r"(?i)^host:\s*(\w+)\(([^)]*)\)$").unwrap().captures(raw) {
        let args: Vec<Json> = arg_list(&hm[2], "").iter().map(|r| ref_obj(r)).collect();
        return obj(vec![("resolvedBy", jstr(&hm[1])), ("args", Json::Arr(args))]);
    }
    // drop parenthetical glosses (" (not remote)"), collapse whitespace
    let t = Regex::new(r"\s+\([^)]*\)").unwrap().replace_all(raw, " ").to_string();
    let t = Regex::new(r"\s+").unwrap().replace_all(&t, " ").trim().to_string();
    let ors = split_top(&t, &Regex::new(r"(?i),?\s+or\s+").unwrap());
    if ors.len() > 1 {
        return obj(vec![("any", Json::Arr(ors.iter().map(|p| parse_cond(p)).collect()))]);
    }
    let ands = split_top(&t, &Regex::new(r"(?i),?\s+and\s+").unwrap());
    if ands.len() > 1 {
        return obj(vec![("all", Json::Arr(ands.iter().map(|p| parse_cond(p)).collect()))]);
    }
    parse_leaf(&t)
}

/// parser.js `parseSource(text, c)` — a foreach source: `<ref>` | `<ref> whose <cond>` | a walk.
fn parse_source(text: &str) -> Json {
    if let Some(m) = Regex::new(r"(?i)^(.+?) whose (.+)$").unwrap().captures(text) {
        return obj(vec![("ref", jstr(&ref_key(&m[1]))), ("filter", parse_cond(&m[2]))]);
    }
    if let Some(m) = Regex::new(r"(?i)^the (.+?) up (?:the )?(.+?) to the (.+)$").unwrap().captures(text) {
        return obj(vec![("walk", obj(vec![("from", jstr(&ref_key(&m[2]))), ("to", jstr(&ref_key(&m[3]))), ("direction", jstr("up"))]))]);
    }
    obj(vec![("ref", jstr(&ref_key(text)))])
}

/// A `:`-block opener inside a body.
enum Opener {
    If(Json),
    Else,
    While(Json),
    Foreach { bind: String, source: Json, ordered: bool },
    Match(String),
}

/// parser.js `parseBlockOpener(line, c)`.
fn parse_block_opener(line: &str) -> Option<Opener> {
    if let Some(m) = Regex::new(r"(?i)^If (.+):$").unwrap().captures(line) {
        return Some(Opener::If(parse_cond(&m[1])));
    }
    if Regex::new(r"(?i)^Otherwise:$").unwrap().is_match(line) {
        return Some(Opener::Else);
    }
    if let Some(m) = Regex::new(r"(?i)^While (.+):$").unwrap().captures(line) {
        return Some(Opener::While(parse_cond(&m[1])));
    }
    if let Some(m) = Regex::new(r"(?i)^For each (\w+) in (.+?)(\s+in order)?:$").unwrap().captures(line) {
        return Some(Opener::Foreach { bind: m[1].to_string(), source: parse_source(&m[2]), ordered: m.get(3).is_some() });
    }
    if let Some(m) = Regex::new(r"(?i)^Match (.+):$").unwrap().captures(line) {
        return Some(Opener::Match(ref_key(&m[1])));
    }
    None
}

/// parser.js `matchLabel(s)`: strip a leading article, lowercase.
fn match_label(s: &str) -> String {
    Regex::new(r"(?i)^(a|an|the)\s+").unwrap().replace(s.trim(), "").to_lowercase()
}

/// parser.js `collectCases` — a Match body of `For <label>:` cases + an `Otherwise:` default.
fn collect_cases(raw: &[&str], start_i: usize, parent_indent: usize, ctx: &Ctx) -> (Vec<Json>, usize) {
    let for_label = fancy_regex::Regex::new(r"(?i)^For (?!each\b)(.+?):$").unwrap();
    let otherwise = Regex::new(r"(?i)^Otherwise:$").unwrap();
    let mut cases = Vec::new();
    let mut i = start_i;
    while i + 1 < raw.len() {
        let r = raw[i + 1];
        let line = r.trim();
        if line.is_empty() || line.starts_with('#') {
            i += 1;
            continue;
        }
        if indent_of(r) <= parent_indent {
            break;
        }
        i += 1;
        let block_indent = indent_of(r);
        if let Ok(Some(m)) = for_label.captures(line) {
            let label = match_label(m.get(1).map(|x| x.as_str()).unwrap_or(""));
            let (sub, ni) = collect_body(raw, i, block_indent, ctx);
            i = ni;
            cases.push(obj(vec![("label", jstr(&label)), ("body", Json::Arr(sub))]));
        } else if otherwise.is_match(line) {
            let (sub, ni) = collect_body(raw, i, block_indent, ctx);
            i = ni;
            cases.push(obj(vec![("body", Json::Arr(sub))]));
        } else {
            break; // JS throws ("Match body expects For <label>: / Otherwise:"); deferred
        }
    }
    (cases, i)
}

/// collectBody: gather lines deeper than `parent_indent` — plain effects, OR a `:`-opener that nests
/// (If/While/For each recurse a sub-body; Otherwise attaches to the preceding If's else; Match collects
/// cases). A dedent ends the body; blanks/comments are skipped. Returns (nodes, last_consumed_index).
fn collect_body(raw: &[&str], start_i: usize, parent_indent: usize, ctx: &Ctx) -> (Vec<Json>, usize) {
    let mut out = Vec::new();
    let mut i = start_i;
    while i + 1 < raw.len() {
        let r = raw[i + 1];
        let line = r.trim();
        if line.is_empty() || line.starts_with('#') {
            i += 1;
            continue;
        }
        if indent_of(r) <= parent_indent {
            break;
        }
        i += 1;
        if line.ends_with(':') {
            let block_indent = indent_of(r);
            match parse_block_opener(line) {
                Some(Opener::Match(on)) => {
                    let (cases, ni) = collect_cases(raw, i, block_indent, ctx);
                    i = ni;
                    out.push(obj(vec![("kind", jstr("match")), ("on", jstr(&on)), ("cases", Json::Arr(cases))]));
                }
                Some(Opener::If(cond)) => {
                    let (sub, ni) = collect_body(raw, i, block_indent, ctx);
                    i = ni;
                    out.push(obj(vec![("kind", jstr("if")), ("cond", cond), ("then", Json::Arr(sub))]));
                }
                Some(Opener::While(cond)) => {
                    let (sub, ni) = collect_body(raw, i, block_indent, ctx);
                    i = ni;
                    out.push(obj(vec![("kind", jstr("while")), ("cond", cond), ("body", Json::Arr(sub))]));
                }
                Some(Opener::Foreach { bind, source, ordered }) => {
                    let (sub, ni) = collect_body(raw, i, block_indent, ctx);
                    i = ni;
                    let mut node = vec![("kind", jstr("foreach")), ("bind", jstr(&bind)), ("in", source)];
                    if ordered {
                        node.push(("ordered", Json::Bool(true)));
                    }
                    node.push(("body", Json::Arr(sub)));
                    out.push(obj(node));
                }
                Some(Opener::Else) => {
                    let (sub, ni) = collect_body(raw, i, block_indent, ctx);
                    i = ni;
                    if let Some(Json::Obj(e)) = out.last_mut() {
                        e.push(("else".to_string(), Json::Arr(sub)));
                    }
                }
                None => {} // JS throws "cannot parse block"; deferred
            }
            continue;
        }
        if let Some(eff) = parse_effect(line, ctx) {
            out.push(eff);
        }
    }
    (out, i)
}

/// The single-LINE flow forms (parser.js inline When-flows): a state-wheel phase, a state rider, or a
/// derived-event watch — each wraps exactly ONE effect. (The multi-line `:` headers are parse_header.)
fn parse_single_line_flow(line: &str, ctx: &Ctx) -> Option<Json> {
    let flow = |when: Json, eff: Json| obj(vec![("kind", jstr("flow")), ("when", when), ("effects", Json::Arr(vec![eff]))]);
    let state_when = |x: &str| obj(vec![("state", Json::Obj(vec![(ctx.state_var.clone(), jstr(x))]))]);
    let on_when = |e: &str| obj(vec![("on", jstr(e))]);

    // When it is X, the R V, and it becomes Y.   (wheel phase — rule 12)
    if let Some(m) = Regex::new(r"(?i)^When it is (\w+), the (\w+) (\w+), and it becomes (\w+)\.$").unwrap().captures(line) {
        return Some(flow(state_when(&m[1]), state_act(ctx, &m[2], &m[3], None, Some(&m[4]))));
    }
    // When it is X, the R V the O.   (rider — rule 6)
    if let Some(m) = Regex::new(r"(?i)^When it is (\w+), the (\w+) (\w+) the (\w+)\.$").unwrap().captures(line) {
        return Some(flow(state_when(&m[1]), state_act(ctx, &m[2], &m[3], Some(&m[4]), None)));
    }
    // When a E happens, the R V the O.   (derived-event watch — harmony)
    if let Some(m) = Regex::new(r"(?i)^When a (\w+) happens, the (\w+) (\w+) the (\w+)\.$").unwrap().captures(line) {
        return Some(flow(on_when(&m[1]), state_act(ctx, &m[2], &m[3], Some(&m[4]), None)));
    }
    // When a E happens, the R V.   (derived-event watch, intransitive)
    if let Some(m) = Regex::new(r"(?i)^When a (\w+) happens, the (\w+) (\w+)\.$").unwrap().captures(line) {
        return Some(flow(on_when(&m[1]), state_act(ctx, &m[2], &m[3], None, None)));
    }
    None
}

/// Parse Word source into the IR node array. Two-pass, like parser.js: first pass reads Ctx (the state
/// dimension + spaces), second pass walks raw lines — a `:` header opens a flow (parse_header +
/// collect_body for its body), every other line applies the single-line RULES. (The guards, nested
/// blocks, and lookahead rules are deferred slices; the vector harness only feeds covered forms.)
/// THE DECLARED VOCABULARY the word-driven reader resolves verbs against, read ONCE from the seed `.word`
/// (verbs/do/see/recall.word). This is the parse membrane reading the declared words — the floor. (Later
/// the vocabulary comes from the chain fold, threaded by the reader; today it is read from the `.word`
/// files directly, via `$TREE_SEED_DIR` or the crate-relative seed dir.) Reading the WORDS, not a table.
static VOCAB: LazyLock<vocab::Vocabulary> = LazyLock::new(|| {
    let seed = std::env::var("TREE_SEED_DIR")
        .ok()
        .filter(|d| !d.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../seed")));
    let rd = |n: &str| std::fs::read_to_string(seed.join("store/words").join(n)).unwrap_or_default();
    vocab::read_vocabulary(&rd("verbs.word"), &rd("do.word"), &rd("see.word"), &rd("recall.word"))
});

pub fn parse(source: &str) -> Vec<Json> {
    let raw: Vec<&str> = source.split('\n').collect();
    let ctx = first_pass(&raw);
    let derive = Regex::new(r"(?i)^When the (\w+) (\w+) the (\w+), that is a (\w+)\.$").unwrap();
    let start = Regex::new(r"(?i)^The (\w+) begins at (\w+)\.$").unwrap();
    let rs = rules();
    let mut nodes = Vec::new();
    let mut i = 0;
    while i < raw.len() {
        let line = raw[i].trim();
        if line.is_empty() || line.starts_with('#') || derive.is_match(line) || start.is_match(line) {
            i += 1;
            continue;
        }
        if line.ends_with(':') {
            if let Some(mut header) = parse_header(line, &ctx.state_var) {
                let parent_indent = indent_of(raw[i]);
                // c.being: a births-flow header ("When <X> births a being…") makes <X> the body's
                // implicit `through`; other headers leave it null.
                let being = Regex::new(r"(?i)^When (\w+) births a being").unwrap().captures(line).map(|m| m[1].to_string());
                let flow_ctx = Ctx { state_var: ctx.state_var.clone(), spaces: ctx.spaces.clone(), being };
                let (effects, next_i) = collect_body(&raw, i, parent_indent, &flow_ctx);
                if let Json::Obj(e) = &mut header {
                    e.push(("effects".to_string(), Json::Arr(effects)));
                }
                nodes.push(header);
                i = next_i + 1;
                continue;
            }
        }
        if let Some(flow) = parse_single_line_flow(line, &ctx) {
            nodes.push(flow);
            i += 1;
            continue;
        }
        // THE WORD-DRIVEN READER first (WORD-DRIVEN-PARSER.md): resolve the verb from the declared
        // vocabulary and read the sentence generically. A statement can UNFOLD into several acts (the
        // composite: `I am X in Y, a Z in W` = birth + grant + grant), each its own node -> its own moment.
        // Falls back to the regex table below for forms it does not cover (it returns EMPTY for those).
        let reader_acts = reader::read_act(line, &VOCAB);
        if !reader_acts.is_empty() {
            nodes.extend(reader_acts);
            i += 1;
            continue;
        }
        let mut matched = false;
        for (re, build) in rs {
            if let Some(caps) = re.captures(line) {
                nodes.push(build(&caps));
                matched = true;
                break;
            }
        }
        if !matched {
            // A bare imperative DEED spoken as a standalone statement — the cognition OUTPUT a being
            // utters ("do move.", "see X as Y.", "call …"). Only deeds (act/see/call) lift to top level;
            // flow-control effects (refuse/return/if/foreach/mark/…) stay body-only. The `.word` corpus
            // carries no top-level deed, so this strictly ADDS the spoken-decision form.
            if let Some(eff) = parse_effect(line, &ctx) {
                if matches!(node_kind(&eff), "act" | "see" | "call") {
                    nodes.push(eff);
                }
            }
        }
        i += 1;
    }
    nodes
}

/// The `kind` of an IR node ("" if absent) — used to gate the top-level imperative-deed fallback.
fn node_kind(n: &Json) -> &str {
    match n {
        Json::Obj(e) => e.iter().find(|(k, _)| k == "kind").and_then(|(_, v)| if let Json::Str(s) = v { Some(s.as_str()) } else { None }).unwrap_or(""),
        _ => "",
    }
}

// ── flow headers (the `:` lines) — parser.js parseHeader + parseBinds ────────
// A flow header opens a multi-effect body (collected by collectBody, a later slice). This produces the
// header node `{kind:flow, when, binds}` WITHOUT effects (parse() splices the body in). `state_var` is
// the running state dimension (parser.js `c.stateVar`, default "sky"). The 4 forms, in JS order.

/// parser.js `parseBinds`: split on `,` / ` and `, strip a leading article, drop empties → string array.
fn binds_arr(clause: Option<&str>) -> Json {
    let c = match clause {
        Some(c) if !c.is_empty() => c,
        _ => return Json::Arr(vec![]),
    };
    let sep = Regex::new(r"(?i)\s*,\s*|\s+and\s+").unwrap();
    let art = Regex::new(r"(?i)^(a|an|the)\s+").unwrap();
    let out: Vec<Json> = sep
        .split(c)
        .map(|s| art.replace(s.trim(), "").to_string())
        .filter(|s| !s.is_empty())
        .map(Json::Str)
        .collect();
    Json::Arr(out)
}

/// parser.js `parseHeader(line, c)` — the flow header node, or None if `line` is not a `:` header.
pub fn parse_header(line: &str, state_var: &str) -> Option<Json> {
    // 1. When <being> births a being [for a new Name][, with <binds>]:
    if let Some(m) = Regex::new(r"(?i)^When (\w+) births a being(?: for a new Name)?(?:, with (.+))?:$").unwrap().captures(line) {
        return Some(obj(vec![
            ("kind", jstr("flow")),
            ("when", obj(vec![("summon", obj(vec![("to", jstr(&m[1])), ("intent", jstr("birth")), ("of", obj(vec![("kind", jstr("being"))]))]))])),
            ("binds", binds_arr(m.get(2).map(|x| x.as_str()))),
        ]));
    }
    // 2. When it is <X>:   (a state-watch; the key is the running state dimension)
    if let Some(m) = Regex::new(r"(?i)^When it is (\w+):$").unwrap().captures(line) {
        return Some(obj(vec![
            ("kind", jstr("flow")),
            ("when", Json::Obj(vec![("state".to_string(), Json::Obj(vec![(state_var.to_string(), jstr(&m[1]))]))])),
            ("binds", Json::Arr(vec![])),
        ]));
    }
    // 3. When <clause> with <binds>:
    if let Some(m) = Regex::new(r"(?i)^When (.+?) with (.+):$").unwrap().captures(line) {
        return Some(obj(vec![
            ("kind", jstr("flow")),
            ("when", obj(vec![("op", obj(vec![("clause", jstr(m[1].trim()))]))])),
            ("binds", binds_arr(m.get(2).map(|x| x.as_str()))),
        ]));
    }
    // 4. When <event>:   (catch-all bare event trigger)
    if let Some(m) = Regex::new(r"(?i)^When (.+):$").unwrap().captures(line) {
        return Some(obj(vec![
            ("kind", jstr("flow")),
            ("when", obj(vec![("event", jstr(m[1].trim()))])),
            ("binds", Json::Arr(vec![])),
        ]));
    }
    None
}

// ── condition leaves (parser.js parseLeaf, for parseCond / nested if·while·foreach) ─────────────
// parseLeaf lifts a condition's STRUCTURE (test / flag / resolvedBy / clause); cond.js resolves
// MEANING. This slice ports the helper web (ref_key/oper/operand/ref_lit) + the core forms: negation,
// equals, the 4 compares, the number/string type checks, kind-check, the bareword flag, equality-via-is,
// and the host predicate (with the verbatim-clause fallback). DEFERRED: the inline see-op call (needs
// SEE_FLOOR), there-is / existence (need inferFlag), `{}`/`[]` operands. Vector-proven in isolation.

/// parser.js `refKey(s)`: trim, strip trailing punctuation, a leading article, possessive `'s `→`.`,
/// spaces→`-`.
// FLOOR (reference resolution — shared with the deed-voice reader, reader.rs): normalize a reference
// (strip trailing punctuation + a leading article, `'s `->`.`, spaces->`-`). A parse primitive, not
// per-sentence meaning, so the reader reuses it rather than duplicating.
pub(crate) fn ref_key(s: &str) -> String {
    let t = s.trim();
    let t = Regex::new(r"[,.;:]+$").unwrap().replace(t, "").to_string();
    let t = Regex::new(r"(?i)^(the|a|an)\s+").unwrap().replace(&t, "").to_string();
    let t = Regex::new(r"'s\s+").unwrap().replace_all(&t, ".").to_string();
    Regex::new(r"\s+").unwrap().replace_all(&t, "-").to_string()
}

/// parser.js `camelKey(s)`: ref_key then kebab→camel (`reset-at`→`resetAt`).
fn camel_key(s: &str) -> String {
    Regex::new(r"-(\w)")
        .unwrap()
        .replace_all(&ref_key(s), |c: &Captures| c[1].to_uppercase())
        .to_string()
}

pub(crate) fn ref_obj(r: &str) -> Json {
    obj(vec![("ref", jstr(r))])
}

/// A parsed operand: a binding READ (ref) or a literal VALUE.
enum Oper {
    Ref(String),
    Value(Json),
}

/// parser.js `oper(v)`: the ref/value discriminator. (`{}`/`[]` nested literals deferred this slice.)
fn oper(v: &str) -> Oper {
    let x = v.trim();
    if x.len() >= 2 && x.starts_with('"') && x.ends_with('"') {
        return Oper::Value(jstr(&x[1..x.len() - 1]));
    }
    if let Some(rest) = x.strip_prefix('$') {
        return Oper::Ref(ref_key(rest));
    }
    if x.starts_with('{') && x.ends_with('}') {
        return Oper::Value(parse_object_literal(x));
    }
    if x.starts_with('[') && x.ends_with(']') {
        return Oper::Value(parse_array_literal(x));
    }
    if x.eq_ignore_ascii_case("true") {
        return Oper::Value(Json::Bool(true));
    }
    if x.eq_ignore_ascii_case("false") {
        return Oper::Value(Json::Bool(false));
    }
    if x.eq_ignore_ascii_case("null") {
        return Oper::Value(Json::Null);
    }
    if Regex::new(r"^-?\d+(\.\d+)?$").unwrap().is_match(x) {
        return Oper::Value(Json::Num(x.parse().unwrap_or(0.0)));
    }
    if Regex::new(r"'s\b").unwrap().is_match(x) {
        return Oper::Ref(camel_key(x));
    }
    if Regex::new(r"(?i)^(the|its|his|her|their|a|an)\s+").unwrap().is_match(x) || x.contains('.') {
        return Oper::Ref(ref_key(x));
    }
    Oper::Value(jstr(x))
}

/// parser.js `operand(v)`: `{against:{ref}}` or `{value}` — returns the (key, value) to splice into a test.
fn operand_fields(v: &str) -> (&'static str, Json) {
    match oper(v) {
        Oper::Ref(r) => ("against", ref_obj(&r)),
        Oper::Value(val) => ("value", val),
    }
}

/// parser.js `refLit(v)`: `{ref}` or the bare value. FLOOR — shared with the deed-voice reader.
pub(crate) fn ref_lit(v: &str) -> Json {
    match oper(v) {
        Oper::Ref(r) => ref_obj(&r),
        Oper::Value(val) => val,
    }
}

fn neg(node: Json, negated: bool) -> Json {
    if !negated {
        return node;
    }
    if let Json::Obj(mut e) = node {
        e.push(("negated".to_string(), Json::Bool(true)));
        Json::Obj(e)
    } else {
        node
    }
}

fn flag_node(f: &str, negated: bool) -> Json {
    if negated {
        obj(vec![("negated", Json::Bool(true)), ("flag", jstr(f))])
    } else {
        obj(vec![("flag", jstr(f))])
    }
}

/// parser.js `inferFlag(clause)`: a reflexive state predicate → a deterministic camelCase flag, or None
/// when it isn't state-like (1-3 content words after stripping articles/aux; last word ends -ed/-en or
/// is a known state).
fn infer_flag(clause: &str) -> Option<String> {
    let cleaned = Regex::new(r#"[."]"#).unwrap().replace_all(clause.trim(), "").to_string();
    let flag_art = Regex::new(r"(?i)^(a|an|the|its|his|her|their|that|this)$").unwrap();
    let flag_aux = Regex::new(r"(?i)^(is|are|was|were|be|been|has|have|had)$").unwrap();
    let content: Vec<&str> = cleaned
        .split_whitespace()
        .filter(|w| !flag_art.is_match(w) && !flag_aux.is_match(w))
        .collect();
    if content.is_empty() || content.len() > 3 {
        return None;
    }
    let flag_state: std::collections::HashSet<&str> = [
        "found", "owned", "born", "set", "done", "inhabited", "passed", "live", "sealed", "released",
        "ready", "verified", "ancestor", "asfather", "chosen", "named",
    ]
    .into_iter()
    .collect();
    let last = content[content.len() - 1].to_lowercase();
    let state_like = Regex::new(r"(ed|en)$").unwrap().is_match(&last) || flag_state.contains(last.as_str());
    if !state_like {
        return None;
    }
    Some(
        content
            .iter()
            .enumerate()
            .map(|(i, w)| {
                if i == 0 {
                    w.to_lowercase()
                } else {
                    let mut c = w.chars();
                    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
                }
            })
            .collect::<Vec<_>>()
            .join(""),
    )
}

/// parser.js `parseLeaf(t, c)` — a condition leaf (this slice's ported forms; see the header comment).
pub fn parse_leaf(t: &str) -> Json {
    let mut s = t.to_string();
    let mut negated = false;
    if Regex::new(r"(?i)^no\s+").unwrap().is_match(&s) {
        negated = true;
        s = Regex::new(r"(?i)^no\s+").unwrap().replace(&s, "").to_string();
    } else if Regex::new(r"(?i)\b(is|are|was|were|does|do)\s+not\b|\bisn't\b|\bdoesn't\b").unwrap().is_match(&s) {
        negated = true;
        s = Regex::new(r"(?i)\s+not\b|n't\b").unwrap().replace(&s, "").to_string();
    } else if Regex::new(r"(?i)\bnot\b").unwrap().is_match(&s) {
        negated = true;
        s = Regex::new(r"(?i)\bnot\s*").unwrap().replace(&s, "").to_string();
    }

    // INLINE SEE-OP CALL as a predicate: `<op>(<args>)` -> {seeCall, args}. A live check (no bind, no
    // fact); the as-removal kept the call's args (a gloss has a space before its paren). SEE_FLOOR
    // validation is a gate, not an IR-shape concern, so it's skipped here.
    if let Some(m) = Regex::new(r"(?i)^([a-z][\w-]*)\((.*)\)$").unwrap().captures(&s) {
        let args: Vec<Json> = if m[2].trim().is_empty() {
            vec![]
        } else {
            arg_list(&m[2], "").into_iter().map(|r| ref_obj(&r)).collect()
        };
        return neg(obj(vec![("seeCall", jstr(&m[1])), ("args", Json::Arr(args))]), negated);
    }

    // authority predicate: <X> has [credential] authority over <Y>
    if let Some(m) = Regex::new(r"(?i)^(.+?)\s+has(\s+credential)?\s+authority over\s+(.+)$").unwrap().captures(&s) {
        let resolved = if m.get(2).is_some() { "hasCredentialAuthority" } else { "hasAuthorityOver" };
        return neg(obj(vec![("resolvedBy", jstr(resolved)), ("args", Json::Arr(vec![ref_obj(&ref_key(&m[1])), ref_obj(&ref_key(&m[3]))]))]), negated);
    }
    // one-hop being-parent: <X> is the being-parent of <Y>
    if let Some(m) = Regex::new(r"(?i)^(.+?)\s+is the being-parent of\s+(.+)$").unwrap().captures(&s) {
        return neg(obj(vec![("resolvedBy", jstr("isBeingParentOf")), ("args", Json::Arr(vec![ref_obj(&ref_key(&m[1])), ref_obj(&ref_key(&m[2]))]))]), negated);
    }
    // deixis: there is [no] <X>  (presence/absence)
    if let Some(m) = Regex::new(r"(?i)^there\s+(?:is|are)\s+(no\s+|an?\s+)?(.+)$").unwrap().captures(&s) {
        let absent = Regex::new(r"(?i)^no\b").unwrap().is_match(m.get(1).map(|x| x.as_str()).unwrap_or("").trim());
        let f = infer_flag(&m[2]).unwrap_or_else(|| ref_key(&m[2]));
        return flag_node(&f, absent || negated);
    }
    // existence: <X> exists | present | missing | absent | gone
    if let Some(m) = Regex::new(r"(?i)^(.+?)\s+(?:is\s+|does\s+)?(exists?|present|missing|absent|gone)$").unwrap().captures(&s) {
        let inherently_absent = Regex::new(r"(?i)^(missing|absent|gone)$").unwrap().is_match(&m[2]);
        let final_absent = if negated { !inherently_absent } else { inherently_absent };
        let f = infer_flag(&m[1]).unwrap_or_else(|| ref_key(&m[1]));
        return flag_node(&f, final_absent);
    }
    // equality: <X> equals <Y>
    if let Some(m) = Regex::new(r"(?i)^(.+?)\s+equals\s+(.+)$").unwrap().captures(&s) {
        let (k, val) = operand_fields(&m[2]);
        return neg(obj(vec![("test", obj(vec![("op", jstr("equals")), ("path", jstr(&ref_key(&m[1]))), (k, val)]))]), negated);
    }
    // ordered compares
    for (re, as_) in [
        (r"(?i)^(.+?)\s+is at least\s+(.+)$", "ge"),
        (r"(?i)^(.+?)\s+is at most\s+(.+)$", "le"),
        (r"(?i)^(.+?)\s+is less than\s+(.+)$", "lt"),
        (r"(?i)^(.+?)\s+is greater than\s+(.+)$", "gt"),
    ] {
        if let Some(m) = Regex::new(re).unwrap().captures(&s) {
            return neg(obj(vec![("test", obj(vec![("op", jstr("compare")), ("as", jstr(as_)), ("path", jstr(&ref_key(&m[1]))), ("against", ref_lit(&m[2]))]))]), negated);
        }
    }
    // type checks: number / string|text
    if let Some(m) = Regex::new(r"(?i)^(.+?)\s+(?:is|are)\s+(?:a\s+|an\s+)?(?:finite\s+)?number$").unwrap().captures(&s) {
        return neg(obj(vec![("test", obj(vec![("op", jstr("isFinite")), ("path", jstr(&ref_key(&m[1])))]))]), negated);
    }
    if let Some(m) = Regex::new(r"(?i)^(.+?)\s+(?:is|are)\s+(?:a\s+)?string$").unwrap().captures(&s).or_else(|| Regex::new(r"(?i)^(.+?)\s+(?:is|are)\s+text$").unwrap().captures(&s)) {
        return neg(obj(vec![("test", obj(vec![("op", jstr("isString")), ("path", jstr(&ref_key(&m[1])))]))]), negated);
    }
    // a single bareword flag
    if Regex::new(r"^[A-Za-z]\w*$").unwrap().is_match(s.trim()) {
        return flag_node(s.trim(), negated);
    }
    // an inferred state-predicate flag ("the being is found" -> beingFound)
    if let Some(f) = infer_flag(&s) {
        return flag_node(&f, negated);
    }
    // kind-check: <X>['s kind] is a|an <kind>
    if let Some(m) = Regex::new(r"(?i)^(?:the )?(.+?)(?:'s kind)? (?:is|are) (?:a|an) (\w+)$").unwrap().captures(&s) {
        return neg(obj(vec![("test", obj(vec![("op", jstr("equals")), ("path", jstr(&(ref_key(&m[1]) + ".kind"))), ("value", jstr(&m[2].to_lowercase()))]))]), negated);
    }
    // equality via `is` (quoted or ref RHS only; a bareword RHS falls to the host predicate)
    if let Some(m) = Regex::new(r"(?i)^(.+?)\s+(?:is|are)\s+(.+)$").unwrap().captures(&s) {
        let rhs = m[2].trim();
        if rhs.len() >= 2 && rhs.starts_with('"') && rhs.ends_with('"') {
            return neg(obj(vec![("test", obj(vec![("op", jstr("equals")), ("path", jstr(&ref_key(&m[1]))), ("value", jstr(&rhs[1..rhs.len() - 1]))]))]), negated);
        }
        if let Oper::Ref(r) = oper(rhs) {
            return neg(obj(vec![("test", obj(vec![("op", jstr("equals")), ("path", jstr(&ref_key(&m[1]))), ("against", ref_obj(&r))]))]), negated);
        }
    }
    // host predicate: <X> is <word>
    if let Some(m) = Regex::new(r"(?i)^(.+?)\s+(?:is|are)\s+(\w+)$").unwrap().captures(&s) {
        return neg(obj(vec![("resolvedBy", jstr(&m[2].to_lowercase())), ("args", Json::Arr(vec![ref_obj(&ref_key(&m[1]))]))]), negated);
    }
    // verbatim clause
    neg(obj(vec![("clause", jstr(t.trim()))]), negated)
}

pub use treehash::{canonicalize, parse as parse_json, Json as JsonValue};
