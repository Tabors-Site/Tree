// treeaddress — the IBP Address grammar (port of seed/ibp/address.js). How a moment/act names what it
// acts on. THE single source of truth for the grammar, shared by the wire and the act layer:
//
//   Position    = story / path                (where)
//   Stance      = story / path @being         (where + as what being — one side of a bridge)
//   IBP Address = stance :: stance            (the full bridged form — one being addressing another)
//
//   IbpAddress := Bridge | Stance
//   Bridge     := Stance "::" Stance
//   Stance     := Position "@" Being | Position | Being
//   Position   := story? Branch? Path?    Branch := "#" HistoryPath (omitted = "0" = main)
//
// PURE: parse / format / expand / validate / canonical + the canonical stance-pair lane key. The async
// resolution in the JS (resolveBeingIds / resolveHistoryPointers / computeIbpStampAddress) loads
// being/history projections — that stays at the edge; this crate is just the deterministic grammar.

use regex::Regex;
use std::sync::LazyLock;

pub mod history;

/// A Stance: a Position (story + history + path) and a Being. Any field may be absent (an implicit
/// shorthand the caller expands against a context). `history_pointer` rides alongside `history`: the
/// parser sets exactly one when a `#` qualifier is present (canonical -> history, named -> pointer).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Stance {
    pub story: Option<String>,
    pub history: Option<String>,
    pub history_pointer: Option<String>,
    pub path: Option<String>,
    pub being: Option<String>,
    pub being_id: Option<String>,
}

/// A parsed IBP Address: an optional left stance, a required right stance (a bare stance has no left).
#[derive(Debug, Clone, PartialEq)]
pub struct Address {
    pub left: Option<Stance>,
    pub right: Stance,
}

/// Parse/expand context — the ambient story/path/user/history the shorthands resolve against.
#[derive(Debug, Clone, Default)]
pub struct Ctx {
    pub current_story: Option<String>,
    pub current_path: Option<String>,
    pub current_user: Option<String>,
    pub current_history: Option<String>,
    pub default_being: Option<String>,
}

/// A structured parse error: a stable `code` (so a UI can highlight the bad segment) + a message + the
/// offending input.
#[derive(Debug, Clone, PartialEq)]
pub struct AddrError {
    pub code: &'static str,
    pub message: String,
    pub input: String,
}

fn pa_error(code: &'static str, input: &str, message: impl Into<String>) -> AddrError {
    AddrError { code, message: format!("IbpAddress: {}", message.into()), input: input.to_string() }
}

// ── grammar regexes (compiled once) ──────────────────────────────────────────
static STORY_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$").unwrap());
static SEGMENT_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^\.?[a-z0-9_~][a-z0-9_.:-]*$").unwrap());
static BEING_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z][a-z0-9-]*$").unwrap());
static BRANCH_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^(?:0|\d+([a-z]+\d+)*([a-z]+)?)$").unwrap());
static POINTER_NAME_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z]([a-z0-9]|-[a-z0-9])*$").unwrap());
static BEING_QUALIFIER_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)?$").unwrap());

const POINTER_NAME_MAX_LENGTH: usize = 64;

// ── validation primitives ────────────────────────────────────────────────────
pub fn is_valid_story(s: &str) -> bool {
    STORY_RE.is_match(s)
}
pub fn is_valid_being(s: &str) -> bool {
    BEING_RE.is_match(s)
}
pub fn is_valid_history(s: &str) -> bool {
    BRANCH_RE.is_match(s)
}
pub fn is_valid_path(path: &str) -> bool {
    if path == "/" {
        return true;
    }
    if !path.starts_with('/') {
        return false;
    }
    let segments: Vec<&str> = path[1..].split('/').filter(|s| !s.is_empty()).collect();
    if segments.is_empty() {
        return false;
    }
    for (i, seg) in segments.iter().enumerate() {
        if i == 0 && *seg == "~" {
            continue; // the home shorthand "/~"
        }
        if *seg == "." {
            continue; // the heaven door
        }
        if !SEGMENT_RE.is_match(seg) {
            return false;
        }
    }
    true
}

// ── public API ────────────────────────────────────────────────────────────────

/// Parse an IBP Address string into `{ left, right }`.
pub fn parse(input: &str, ctx: &Ctx) -> Result<Address, AddrError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(pa_error("empty-input", input, "IBP address cannot be empty"));
    }
    let (left_str, right_str) = match trimmed.find("::") {
        Some(idx) => {
            let l = trimmed[..idx].trim();
            let r = trimmed[idx + 2..].trim();
            if l.is_empty() {
                return Err(pa_error("empty-left", input, "Bridge has empty left stance"));
            }
            if r.is_empty() {
                return Err(pa_error("empty-right", input, "Bridge has empty right stance"));
            }
            if r.contains("::") {
                return Err(pa_error("multiple-bridges", input, "Only one '::' separator allowed"));
            }
            (Some(l), r)
        }
        None => (None, trimmed),
    };

    let right = parse_stance(right_str, ctx, false)?;
    let left = match left_str {
        Some(l) => Some(parse_stance(l, ctx, true)?),
        None => None,
    };

    // Cross-history bridge gate (early half): only TYPED canonical branches can be compared honestly.
    if let (Some(l), r) = (&left, &right) {
        if let (Some(lb), Some(rb)) = (&l.history, &r.history) {
            if lb != rb {
                return Err(cross_history_bridge_error(input, lb, rb));
            }
        }
    }
    Ok(Address { left, right })
}

fn cross_history_bridge_error(input: &str, lb: &str, rb: &str) -> AddrError {
    pa_error(
        "cross-history-bridge",
        input,
        format!("Cross-history bridge forbidden: left is on #{lb}, right is on #{rb}. Bridges must keep both stances on the same history."),
    )
}

/// Format a parsed address back to its canonical string form (inverse of parse).
pub fn format(pa: &Address) -> String {
    let right = format_stance(&pa.right);
    match &pa.left {
        Some(l) => format!("{} :: {}", format_stance(l), right),
        None => right,
    }
}

/// Expand shorthands against a context — fills story / history(-pointer) / path / being on each stance.
pub fn expand(pa: &Address, ctx: &Ctx) -> Address {
    Address {
        left: pa.left.as_ref().map(|s| expand_stance(s, ctx)),
        right: expand_stance(&pa.right, ctx),
    }
}

/// parse -> expand -> format: the most explicit canonical form the address can take.
pub fn canonical(input: &str, ctx: &Ctx) -> Result<String, AddrError> {
    Ok(format(&expand(&parse(input, ctx)?, ctx)))
}

/// A field-level validation report for an (expanded) address.
#[derive(Debug, Clone, PartialEq)]
pub struct FieldError {
    pub side: &'static str,
    pub field: &'static str,
    pub value: String,
    pub reason: &'static str,
}

/// Validate a parsed address; returns the list of malformed fields (empty = ok).
pub fn validate(pa: &Address) -> Vec<FieldError> {
    let mut errors = Vec::new();
    let mut check = |stance: &Option<Stance>, side: &'static str| {
        let s = match stance {
            Some(s) => s,
            None => return,
        };
        if let Some(v) = &s.story {
            if !is_valid_story(v) {
                errors.push(FieldError { side, field: "story", value: v.clone(), reason: "invalid-story" });
            }
        }
        if let Some(v) = &s.path {
            if !is_valid_path(v) {
                errors.push(FieldError { side, field: "path", value: v.clone(), reason: "invalid-path" });
            }
        }
        if let Some(v) = &s.history {
            if !is_valid_history(v) {
                errors.push(FieldError { side, field: "history", value: v.clone(), reason: "invalid-history" });
            }
        }
        if let Some(v) = &s.being {
            if !is_valid_being(v) {
                errors.push(FieldError { side, field: "being", value: v.clone(), reason: "invalid-being" });
            }
        }
    };
    check(&pa.left, "left");
    check(&Some(pa.right.clone()), "right");
    errors
}

// ── stance parsing ────────────────────────────────────────────────────────────

enum HistoryOrPointer {
    Canonical(String),
    Pointer(String),
}

fn parse_history_or_pointer(s: &str, input: &str) -> Result<HistoryOrPointer, AddrError> {
    let trimmed = s.trim();
    if is_valid_history(trimmed) {
        return Ok(HistoryOrPointer::Canonical(trimmed.to_string()));
    }
    if trimmed.len() > POINTER_NAME_MAX_LENGTH {
        return Err(pa_error("invalid-history", input, format!("History qualifier exceeds max pointer length ({POINTER_NAME_MAX_LENGTH} chars).")));
    }
    if POINTER_NAME_RE.is_match(trimmed) {
        return Ok(HistoryOrPointer::Pointer(trimmed.to_lowercase()));
    }
    Err(pa_error(
        "invalid-history",
        input,
        format!("History qualifier \"{trimmed}\" is neither a canonical path (\"0\", \"1\", \"1a2\", ...) nor a valid pointer name."),
    ))
}

fn parse_being(s: &str, input: &str) -> Result<String, AddrError> {
    let id = s.strip_prefix('@').ok_or_else(|| pa_error("invalid-being-prefix", input, "Being qualifier must start with @"))?.trim();
    if id.is_empty() {
        return Err(pa_error("empty-being", input, "Being qualifier is empty"));
    }
    if !BEING_QUALIFIER_RE.is_match(id) {
        return Err(pa_error("invalid-being-chars", input, format!("Being qualifier \"{id}\" must be lowercase kebab-case (e.g. \"@cherub\") or an extension able shorthand (e.g. \"@hello-world:greeter\").")));
    }
    Ok(id.to_string())
}

fn parse_story(s: &str, input: &str) -> Result<Option<String>, AddrError> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if !is_valid_story(trimmed) {
        return Err(pa_error("invalid-place", input, format!("Invalid place \"{trimmed}\"")));
    }
    Ok(Some(trimmed.to_string()))
}

fn parse_path(s: &str, input: &str) -> Result<Option<String>, AddrError> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed == "~" {
        return Ok(Some("/~".to_string())); // home shorthand
    }
    if trimmed == "/" {
        return Ok(Some("/".to_string()));
    }
    if !trimmed.starts_with('/') {
        return Err(pa_error("invalid-path", input, format!("Path \"{trimmed}\" must start with \"/\" or \"~\"")));
    }
    if !is_valid_path(trimmed) {
        return Err(pa_error("invalid-path-segments", input, format!("Path \"{trimmed}\" contains invalid segments")));
    }
    Ok(Some(trimmed.to_string()))
}

/// the first index of any of the path-start chars (`/` or `~`), JS `Math.min` of the two `indexOf`s.
fn first_of(s: &str, a: char, b: char) -> Option<usize> {
    match (s.find(a), s.find(b)) {
        (Some(x), Some(y)) => Some(x.min(y)),
        (Some(x), None) => Some(x),
        (None, Some(y)) => Some(y),
        (None, None) => None,
    }
}

fn parse_stance(input: &str, ctx: &Ctx, is_left_side: bool) -> Result<Stance, AddrError> {
    let s = input.trim();
    if s.is_empty() {
        return Err(pa_error("empty-stance", input, "Stance cannot be empty"));
    }
    // Bare being: "@ruler"
    if let Some(stripped) = s.strip_prefix('@') {
        let _ = stripped;
        let being = parse_being(s, input)?;
        return Ok(Stance {
            story: ctx.current_story.clone(),
            history: None,
            history_pointer: None,
            path: if is_left_side { Some("/".to_string()) } else { ctx.current_path.clone() },
            being: Some(being),
            being_id: None,
        });
    }

    // Split the being off the tail (the LAST "@").
    let mut being: Option<String> = None;
    let mut rest = s.to_string();
    if let Some(at_idx) = s.rfind('@') {
        being = Some(parse_being(&s[at_idx..], input)?);
        rest = s[..at_idx].to_string();
    }

    if rest.is_empty() {
        return Ok(Stance {
            story: None,
            history: None,
            history_pointer: None,
            path: ctx.current_path.clone(),
            being,
            being_id: None,
        });
    }

    // History qualifier `#<path>` between story and path.
    let mut history: Option<String> = None;
    let mut history_pointer: Option<String> = None;
    if let Some(hash_idx) = rest.find('#') {
        if rest[hash_idx + 1..].contains('#') {
            return Err(pa_error("multiple-histories", input, "Only one \"#\" history qualifier allowed per stance"));
        }
        let before = rest[..hash_idx].to_string();
        let after = &rest[hash_idx + 1..];
        let path_start = first_of(after, '/', '~');
        let history_str = match path_start {
            Some(i) => &after[..i],
            None => after,
        };
        if history_str.is_empty() {
            return Err(pa_error("empty-history", input, "History qualifier \"#\" cannot be empty"));
        }
        match parse_history_or_pointer(history_str, input)? {
            HistoryOrPointer::Canonical(v) => history = Some(v),
            HistoryOrPointer::Pointer(v) => history_pointer = Some(v),
        }
        let path_portion = match path_start {
            Some(i) => &after[i..],
            None => "",
        };
        rest = before + path_portion;
    }

    if rest.is_empty() {
        // Pure-history stance: `#1a` / `#1a@being`.
        return Ok(Stance { story: None, history, history_pointer, path: ctx.current_path.clone(), being, being_id: None });
    }
    if rest.starts_with('/') || rest.starts_with('~') {
        // Relative path; story stays NULL (inherited, not typed).
        return Ok(Stance { story: None, history, history_pointer, path: parse_path(&rest, input)?, being, being_id: None });
    }
    // `rest` starts with a story identifier; the first `/` or `~` is the story/path boundary.
    match first_of(&rest, '/', '~') {
        None => {
            // No path separator. Left side with no '@' = the human-user shorthand `tabor`.
            if is_left_side && being.is_none() {
                Ok(Stance { story: None, history, history_pointer, path: Some("/".to_string()), being: Some(rest), being_id: None })
            } else {
                Ok(Stance { story: parse_story(&rest, input)?, history, history_pointer, path: None, being, being_id: None })
            }
        }
        Some(boundary) => {
            let story_part = &rest[..boundary];
            let path_part = &rest[boundary..];
            Ok(Stance { story: parse_story(story_part, input)?, history, history_pointer, path: parse_path(path_part, input)?, being, being_id: None })
        }
    }
}

// ── formatting ────────────────────────────────────────────────────────────────

fn format_stance(stance: &Stance) -> String {
    let mut out = String::new();
    if let Some(story) = &stance.story {
        out.push_str(story);
    }
    // history renders only when explicitly non-main (URLs omit default ports).
    if let Some(h) = &stance.history {
        if !h.is_empty() && h != "0" {
            out.push_str(&format!("#{h}"));
        }
    }
    if let Some(p) = &stance.path {
        out.push_str(p);
    }
    if let Some(b) = &stance.being {
        out.push_str(&format!("@{b}"));
    }
    out
}

fn expand_stance(stance: &Stance, ctx: &Ctx) -> Stance {
    let story_was_typed = stance.story.is_some();
    let story = stance.story.clone().or_else(|| ctx.current_story.clone());

    let mut history: Option<String> = None;
    let mut history_pointer = stance.history_pointer.clone();
    if let Some(h) = &stance.history {
        history = Some(h.clone()); // canonical typed
    } else if history_pointer.is_some() {
        // pointer typed; leave history null for resolveHistoryPointers (the edge)
    } else if story_was_typed {
        history_pointer = Some("main".to_string()); // typed story, no # -> the #main pointer
    } else if let Some(ch) = &ctx.current_history {
        history = Some(ch.clone()); // relative with ambient history
    } else {
        history_pointer = Some("main".to_string()); // relative, no ambient -> #main
    }

    Stance {
        story,
        history,
        history_pointer,
        path: stance.path.clone().or_else(|| ctx.current_path.clone()),
        being: stance.being.clone().or_else(|| ctx.default_being.clone()),
        being_id: stance.being_id.clone(),
    }
}

// ── canonical stance-pair (the lane key two beings share) ─────────────────────

/// The spaceId-rooted stance string `<story>#<history>/<spaceId>@<name>` (history `0`/absent omits the
/// `#`). Returns None when spaceId or name is missing.
pub fn stance_string(story: Option<&str>, history: Option<&str>, space_id: &str, name: &str, default_story: &str) -> Option<String> {
    if space_id.is_empty() || name.is_empty() {
        return None;
    }
    let story_part = story.unwrap_or(default_story);
    let history_part = match history {
        Some(h) if !h.is_empty() => format!("#{h}"),
        _ => String::new(),
    };
    Some(format!("{story_part}{history_part}/{space_id}@{name}"))
}

/// The canonical sorted lane key `<smaller> :: <larger>` for a stance pair — A->B and B->A map to the
/// same key; A->A yields `A :: A`. Returns None when either side is missing.
pub fn canonical_stance_pair(a: Option<&str>, b: Option<&str>) -> Option<String> {
    let (a, b) = (a?, b?);
    if a.is_empty() || b.is_empty() {
        return None;
    }
    Some(if a < b { format!("{a} :: {b}") } else { format!("{b} :: {a}") })
}

// ── HTTP route shape ──────────────────────────────────────────────────────────

/// The HTTP route a position maps to: `{ url, being }` (method is always GET).
pub fn to_http_route(stance: &Stance) -> Result<(String, Option<String>), AddrError> {
    let path = stance.path.as_deref().ok_or_else(|| pa_error("missing-path-for-route", "", "Cannot derive route without a path"))?;
    let (zone, tail): (&str, String) = if path == "/" {
        ("place", String::new())
    } else if let Some(rest) = path.strip_prefix("/~") {
        ("home", rest.split('/').filter(|s| !s.is_empty()).collect::<Vec<_>>().join("/"))
    } else {
        ("tree", path[1..].split('/').filter(|s| !s.is_empty()).collect::<Vec<_>>().join("/"))
    };
    let base = format!("/api/v1/position/{zone}{}", if tail.is_empty() { "/".to_string() } else { format!("/{tail}") });
    let url = match &stance.being {
        Some(b) => format!("{base}?being={b}"),
        None => base,
    };
    Ok((url, stance.being.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> Ctx {
        Ctx { current_story: Some("treeos.ai".to_string()), ..Default::default() }
    }

    #[test]
    fn parses_a_full_bridge() {
        let a = parse("treeos.ai#3/spaceName@ruler :: treeos.ai#3/other@guest", &Ctx::default()).unwrap();
        let l = a.left.unwrap();
        assert_eq!(l.story.as_deref(), Some("treeos.ai"));
        assert_eq!(l.history.as_deref(), Some("3"));
        assert_eq!(l.path.as_deref(), Some("/spaceName"));
        assert_eq!(l.being.as_deref(), Some("ruler"));
        assert_eq!(a.right.being.as_deref(), Some("guest"));
    }

    #[test]
    fn cross_history_bridge_is_refused() {
        let e = parse("treeos.ai#1/a@x :: treeos.ai#2/b@y", &Ctx::default()).unwrap_err();
        assert_eq!(e.code, "cross-history-bridge");
    }

    #[test]
    fn bare_being_and_relative_path_and_pure_history() {
        // bare being
        let a = parse("@ruler", &ctx()).unwrap();
        assert_eq!(a.right.being.as_deref(), Some("ruler"));
        assert_eq!(a.right.story.as_deref(), Some("treeos.ai"));
        // relative path keeps story implicit (null) so expand inherits, not "typed = main"
        let a = parse("/~tabor/flappybird", &Ctx::default()).unwrap();
        assert_eq!(a.right.story, None);
        assert_eq!(a.right.path.as_deref(), Some("/~tabor/flappybird"));
        // pure-history stance
        let a = parse("#1a@being", &Ctx::default()).unwrap();
        assert_eq!(a.right.history.as_deref(), Some("1a"));
        assert_eq!(a.right.being.as_deref(), Some("being"));
    }

    #[test]
    fn left_human_shorthand() {
        let a = parse("tabor :: treeos.ai/room@ruler", &Ctx::default()).unwrap();
        let l = a.left.unwrap();
        assert_eq!(l.being.as_deref(), Some("tabor")); // human at story root
        assert_eq!(l.path.as_deref(), Some("/"));
    }

    #[test]
    fn pointer_vs_canonical_history() {
        // a named pointer rides on history_pointer, history stays null
        let a = parse("treeos.ai#main/room@x", &Ctx::default()).unwrap();
        assert_eq!(a.right.history, None);
        assert_eq!(a.right.history_pointer.as_deref(), Some("main"));
        // canonical history sets history
        let a = parse("treeos.ai#1a/room@x", &Ctx::default()).unwrap();
        assert_eq!(a.right.history.as_deref(), Some("1a"));
    }

    #[test]
    fn format_round_trips_and_omits_main() {
        // #0 / #main-default is omitted in the formatted form, like a default port
        let a = parse("treeos.ai/room@ruler", &Ctx::default()).unwrap();
        assert_eq!(format(&a), "treeos.ai/room@ruler");
        let a = parse("treeos.ai#5/room@ruler", &Ctx::default()).unwrap();
        assert_eq!(format(&a), "treeos.ai#5/room@ruler");
        // round-trip a bridge
        let s = "treeos.ai#2/a@x :: treeos.ai#2/b@y";
        assert_eq!(format(&parse(s, &Ctx::default()).unwrap()), s);
    }

    #[test]
    fn expand_fills_story_and_main_pointer() {
        // a typed story with no # expands to the #main pointer (operators can re-point main)
        let a = expand(&parse("treeos.ai/room@x", &Ctx::default()).unwrap(), &Ctx::default());
        assert_eq!(a.right.history_pointer.as_deref(), Some("main"));
        // a relative address inherits the ambient story + history
        let c = Ctx { current_story: Some("treeos.ai".into()), current_history: Some("1a".into()), ..Default::default() };
        let a = expand(&parse("/room@x", &c).unwrap(), &c);
        assert_eq!(a.right.story.as_deref(), Some("treeos.ai"));
        assert_eq!(a.right.history.as_deref(), Some("1a"));
    }

    #[test]
    fn history_grammar_validation() {
        for ok in ["0", "1", "1a", "22zb", "1a1", "1za"] {
            assert!(is_valid_history(ok), "{ok} should be valid");
        }
        for bad in ["a", "1a1a-", "", "-1"] {
            assert!(!is_valid_history(bad), "{bad} should be invalid");
        }
    }

    #[test]
    fn canonical_stance_pair_sorts_and_self_pairs() {
        let a = stance_string(None, Some("0"), "sp1", "alice", "treeos.ai").unwrap();
        let b = stance_string(None, Some("0"), "sp2", "bob", "treeos.ai").unwrap();
        // the lane KEY keeps the history (a #0 lane and a #1 lane are different worlds), unlike the
        // display formatter which omits #0.
        assert_eq!(a, "treeos.ai#0/sp1@alice");
        // A::B and B::A produce the same key
        assert_eq!(canonical_stance_pair(Some(&a), Some(&b)), canonical_stance_pair(Some(&b), Some(&a)));
        // self pair stays A :: A
        assert_eq!(canonical_stance_pair(Some(&a), Some(&a)), Some(format!("{a} :: {a}")));
    }

    #[test]
    fn http_route_zones() {
        let place = parse("treeos.ai/@x", &Ctx::default()).unwrap();
        assert_eq!(to_http_route(&place.right).unwrap().0, "/api/v1/position/place/?being=x");
        let home = parse("treeos.ai/~tabor/game@x", &Ctx::default()).unwrap();
        assert_eq!(to_http_route(&home.right).unwrap().0, "/api/v1/position/home/tabor/game?being=x");
    }
}
