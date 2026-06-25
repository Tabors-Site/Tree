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

type Builder = fn(&Captures) -> Json;

fn rules() -> Vec<(Regex, Builder)> {
    vec![
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
        // A <able> can <verb> [the/a/an <of>].
        (
            Regex::new(r"(?i)^A (\w+) can (\w+)(?: (?:a |an |the )?(.+?))?\.$").unwrap(),
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
        // I am "what?" I am.   (the genesis verse)
        (
            Regex::new(r#"(?i)^I am "what\?" I am\.$"#).unwrap(),
            |_m| obj(vec![("kind", jstr("act")), ("verb", jstr("name")), ("act", jstr("i-am")), ("by", jstr("I"))]),
        ),
        // I make <Capitalized>[, <description>].   -> birth a being
        (
            Regex::new(r"^I make ([A-Z][\w.-]*)(?:, (.+?))?\.$").unwrap(),
            |m| {
                let mut params = vec![("able", jstr(&m[1].to_lowercase()))];
                if let Some(d) = m.get(2) {
                    if !d.as_str().is_empty() {
                        params.push(("description", jstr(d.as_str())));
                    }
                }
                obj(vec![
                    ("kind", jstr("act")), ("verb", jstr("be")), ("act", jstr("birth")), ("by", jstr("I")),
                    ("of", obj(vec![("kind", jstr("being")), ("id", jstr(&m[1]))])),
                    ("params", obj(params)),
                ])
            },
        ),
        // I make [the] <lowercase>[, <gloss>].   -> create a space
        (
            Regex::new(r"^I make (?:the )?([a-z][\w.-]*)(?:, (.+?))?\.$").unwrap(),
            |m| {
                let mut o = vec![
                    ("kind", jstr("act")), ("verb", jstr("do")), ("act", jstr("create-space")), ("by", jstr("I")),
                    ("of", obj(vec![("kind", jstr("space")), ("id", jstr(&m[1]))])),
                ];
                if let Some(g) = m.get(2) {
                    if !g.as_str().is_empty() {
                        o.push(("params", obj(vec![("gloss", jstr(g.as_str()))])));
                    }
                }
                obj(o)
            },
        ),
        // A <name> is a <isA>.   (generic kind — LAST so `is a space` / `is a able for a Y` win first)
        (
            Regex::new(r"(?i)^A ([\w.-]+) is a (.+?)\.$").unwrap(),
            |m| obj(vec![("kind", jstr("is")), ("subject", jstr(&m[1].to_lowercase())), ("isA", jstr(&m[2]))]),
        ),
    ]
}

/// Parse Word source into the IR node array (single-line declaration slice). Blank lines + `#` comments
/// are skipped, as in parser.js. A line matching no ported rule is skipped here (parser.js throws); the
/// vector harness only feeds covered forms, so this slice never silently drops a real line in test.
pub fn parse(source: &str) -> Vec<Json> {
    let rs = rules();
    let mut nodes = Vec::new();
    for raw in source.split('\n') {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        for (re, build) in &rs {
            if let Some(caps) = re.captures(line) {
                nodes.push(build(&caps));
                break;
            }
        }
    }
    nodes
}

pub use treehash::{canonicalize, parse as parse_json, Json as JsonValue};
