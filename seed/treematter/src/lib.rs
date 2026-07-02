// treematter — matter type classification (port of seed/materials/matter/classify.js). "What matter
// type will this input become?" Claims-driven: every type advertises a `claims` block (mime patterns,
// file extensions, url substrings, schemes), so extension types participate the moment they register.
// PURE scoring (highest wins; claims.priority is a flat tiebreak/override bump):
//
//   mime exact 100 · extension 90 · mime wildcard 80 · url pattern 70 · scheme 60 · seed floor 50 · text base 20
//
// The type REGISTRY folds from the chain (listMatterTypesFolded); this crate takes the folded types as
// input, so it is a pure ranker — the fold + the `classify-matter` SEE op live at the edge.

use regex::Regex;
use std::collections::HashMap;
use std::sync::LazyLock;

// scores
const MIME_EXACT: f64 = 100.0;
const EXTENSION: f64 = 90.0;
const MIME_WILDCARD: f64 = 80.0;
const URL_PATTERN: f64 = 70.0;
const SCHEME: f64 = 60.0;
const FLOOR: f64 = 50.0;
const TEXT_BASE: f64 = 20.0;

/// A type's claims — what inputs it advertises that it can become.
#[derive(Debug, Clone, Default)]
pub struct Claims {
    pub mime_types: Vec<String>,
    pub extensions: Vec<String>,
    pub url_patterns: Vec<String>,
    pub schemes: Vec<String>,
    pub priority: f64,
}

/// A registered matter type (the folded view the classifier scores against).
#[derive(Debug, Clone)]
pub struct TypeDef {
    pub name: String,
    pub content_kinds: Vec<String>, // subset of ["text","binary","none"]
    pub claims: Option<Claims>,
}

/// The classify input — `url` and `ibpa` are DIFFERENT reference worlds (the WWW vs another story), not
/// two spellings of one field.
#[derive(Debug, Clone, Default)]
pub struct ClassifyInput {
    pub mime_type: Option<String>,
    pub file_name: Option<String>,
    pub url: Option<String>,
    pub ibpa: Option<String>,
    pub text: Option<String>,
}

/// One ranked candidate type.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidate {
    pub type_name: String,
    pub score: f64,
    pub reason: String,
}

// the WWW url shape, and the IBPA doorway shape (kept in sync with the address grammar)
static URL_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^([a-z][a-z0-9+.-]*)://(.+)$").unwrap());
static IBPA_SHAPE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^([a-zA-Z0-9.\-_]+(#[^/]+)?|#[^/]+)/.*$").unwrap());

fn bare_mime(mime: &str) -> Option<String> {
    let m = mime.split(';').next().unwrap_or("").trim().to_lowercase();
    if m.is_empty() {
        None
    } else {
        Some(m)
    }
}

fn ext_of(file_name: &str) -> Option<String> {
    let dot = file_name.rfind('.')?;
    if dot == 0 || dot == file_name.len() - 1 {
        return None;
    }
    Some(file_name[dot..].to_lowercase())
}

fn parse_url(url: &str) -> Option<(String, String)> {
    let caps = URL_RE.captures(url)?;
    Some((caps[1].to_lowercase(), caps[2].to_lowercase()))
}

/// "exact" / "wildcard" / None.
fn mime_matches(pattern: &str, mime: &str) -> Option<&'static str> {
    if pattern.is_empty() || mime.is_empty() {
        return None;
    }
    if pattern == mime {
        return Some("exact");
    }
    if pattern == "*/*" {
        return Some("wildcard");
    }
    if let Some(prefix) = pattern.strip_suffix('*') {
        // "image/*" -> prefix "image/"
        if mime.starts_with(prefix) {
            return Some("wildcard");
        }
    }
    None
}

fn has_type(types: &[TypeDef], name: &str) -> bool {
    types.iter().any(|t| t.name == name)
}

fn propose(map: &mut HashMap<String, (f64, String)>, type_name: &str, score: f64, reason: String) {
    match map.get(type_name) {
        Some((cur, _)) if *cur >= score => {} // keep the higher
        _ => {
            map.insert(type_name.to_string(), (score, reason));
        }
    }
}

/// Classify an input into ranked matter-type candidates (best first). Empty only when the input itself
/// is empty.
pub fn classify_matter(input: &ClassifyInput, types: &[TypeDef]) -> Vec<Candidate> {
    let mime = input.mime_type.as_deref().and_then(bare_mime);
    let ext = input.file_name.as_deref().and_then(ext_of);
    let raw_url = input.url.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let parsed_url = raw_url.and_then(parse_url);
    let raw_ibpa = input.ibpa.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let has_text = input.text.as_deref().is_some_and(|t| !t.is_empty());
    let has_file_signal = mime.is_some() || ext.is_some();

    if mime.is_none() && ext.is_none() && raw_url.is_none() && raw_ibpa.is_none() && !has_text {
        return vec![];
    }

    let mut candidates: HashMap<String, (f64, String)> = HashMap::new();

    for def in types {
        if let Some(c) = &def.claims {
            let prio = c.priority;
            if let Some(m) = &mime {
                for pattern in &c.mime_types {
                    match mime_matches(pattern, m) {
                        Some("exact") => propose(&mut candidates, &def.name, MIME_EXACT + prio, format!("mime {m}")),
                        Some("wildcard") => propose(&mut candidates, &def.name, MIME_WILDCARD + prio, format!("mime {pattern}")),
                        _ => {}
                    }
                }
            }
            if let Some(e) = &ext {
                if c.extensions.iter().any(|x| x == e) {
                    propose(&mut candidates, &def.name, EXTENSION + prio, format!("extension {e}"));
                }
            }
            if let Some((scheme, rest)) = &parsed_url {
                for pattern in &c.url_patterns {
                    if !pattern.is_empty() && rest.contains(pattern) {
                        propose(&mut candidates, &def.name, URL_PATTERN + prio, format!("url matches \"{pattern}\""));
                    }
                }
                if c.schemes.iter().any(|s| s == scheme) {
                    propose(&mut candidates, &def.name, SCHEME + prio, format!("scheme {scheme}"));
                }
            }
        }
        // bare text: every text-capable type is a low-base candidate (extensions opt above via priority)
        if has_text && !has_file_signal && raw_url.is_none() && raw_ibpa.is_none() && def.content_kinds.iter().any(|k| k == "text") {
            let prio = def.claims.as_ref().map_or(0.0, |c| c.priority);
            propose(&mut candidates, &def.name, TEXT_BASE + prio, "accepts text".to_string());
        }
    }

    // Seed floor — what nothing claims still becomes something; the FIELD declares the reference world.
    if raw_url.is_some() && has_type(types, "http") {
        propose(&mut candidates, "http", FLOOR, "an http link — website content".to_string());
    }
    if let Some(ibpa) = raw_ibpa {
        if IBPA_SHAPE_RE.is_match(ibpa) && has_type(types, "ibpa") {
            propose(&mut candidates, "ibpa", FLOOR, "an IBP address — a doorway to another world".to_string());
        }
    }
    let is_model = matches!(ext.as_deref(), Some(".glb") | Some(".gltf")) || matches!(mime.as_deref(), Some("model/gltf-binary") | Some("model/gltf+json"));
    if is_model && has_type(types, "model") {
        propose(&mut candidates, "model", FLOOR, "a 3D model".to_string());
    }
    if has_file_signal && raw_url.is_none() && raw_ibpa.is_none() && has_type(types, "file") {
        propose(&mut candidates, "file", FLOOR - 1.0, "bytes of a file".to_string());
    }
    if has_text && !has_file_signal && raw_url.is_none() && raw_ibpa.is_none() && has_type(types, "generic") {
        propose(&mut candidates, "generic", FLOOR, "bare text — a context chunk".to_string());
    }

    let mut out: Vec<Candidate> = candidates.into_iter().map(|(type_name, (score, reason))| Candidate { type_name, score, reason }).collect();
    // best first; ties broken by name (localeCompare)
    out.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal).then(a.type_name.cmp(&b.type_name)));
    out
}

/// Does the type allow this content kind? (typeAllowsContentKind)
pub fn type_allows_content_kind(def: &TypeDef, kind: &str) -> bool {
    def.content_kinds.iter().any(|k| k == kind)
}

/// The kernel-bound matter types — the substrate floor (port of types.js's seed `registerMatterType`
/// set). Extension types fold from the chain ON TOP of these; the live registry is `seed_types()`
/// unioned with the folded extension types.
pub fn seed_types() -> Vec<TypeDef> {
    let cl = |mime: &[&str], ext: &[&str], schemes: &[&str], prio: f64| {
        Some(Claims {
            mime_types: mime.iter().map(|s| s.to_string()).collect(),
            extensions: ext.iter().map(|s| s.to_string()).collect(),
            url_patterns: vec![],
            schemes: schemes.iter().map(|s| s.to_string()).collect(),
            priority: prio,
        })
    };
    let td = |name: &str, kinds: &[&str], claims: Option<Claims>| TypeDef { name: name.to_string(), content_kinds: kinds.iter().map(|s| s.to_string()).collect(), claims };
    vec![
        td("generic", &["text", "none"], cl(&[], &[], &[], -10.0)),
        td("file", &["binary", "text"], cl(&["*/*"], &[], &[], -5.0)),
        td("http", &["none"], cl(&[], &[], &["http", "https"], 0.0)),
        td("model", &["binary"], cl(&["model/gltf-binary", "model/gltf+json"], &[".glb", ".gltf"], &[], 0.0)),
        td("source", &["text", "binary", "none"], None),
        td("ibpa", &["none"], None),
        td("connection", &["none"], None), // never auto-classified (no claims)
        td("wasm", &["binary"], cl(&["application/wasm"], &[".wasm"], &[], 0.0)),
        td("js", &["text"], None),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claims(mime: &[&str], ext: &[&str], schemes: &[&str], prio: f64) -> Claims {
        Claims {
            mime_types: mime.iter().map(|s| s.to_string()).collect(),
            extensions: ext.iter().map(|s| s.to_string()).collect(),
            url_patterns: vec![],
            schemes: schemes.iter().map(|s| s.to_string()).collect(),
            priority: prio,
        }
    }
    fn td(name: &str, kinds: &[&str], claims: Option<Claims>) -> TypeDef {
        TypeDef { name: name.to_string(), content_kinds: kinds.iter().map(|s| s.to_string()).collect(), claims }
    }
    // a representative registry (subset of the seed types)
    fn registry() -> Vec<TypeDef> {
        vec![
            td("generic", &["text", "none"], Some(claims(&[], &[], &[], -10.0))),
            td("file", &["binary", "text"], Some(claims(&["*/*"], &[], &[], -5.0))),
            td("http", &["none"], Some(claims(&[], &[], &["http", "https"], 0.0))),
            td("ibpa", &["none"], None),
            td("model", &["binary"], Some(claims(&["model/gltf-binary"], &[".glb", ".gltf"], &[], 0.0))),
            td("image", &["binary"], Some(claims(&["image/png", "image/*"], &[".png", ".jpg"], &[], 0.0))),
        ]
    }

    #[test]
    fn empty_input_is_empty() {
        assert!(classify_matter(&ClassifyInput::default(), &registry()).is_empty());
    }

    #[test]
    fn mime_exact_beats_wildcard_and_floor() {
        let input = ClassifyInput { mime_type: Some("image/png".into()), file_name: Some("a.png".into()), ..Default::default() };
        let out = classify_matter(&input, &registry());
        // image (mime exact 100 + ext 90 -> max 100) wins over file (*/* wildcard 80-5) and the file floor
        assert_eq!(out[0].type_name, "image");
        assert!(out[0].score >= 100.0);
        assert!(out.iter().any(|c| c.type_name == "file")); // still a candidate via */*
    }

    #[test]
    fn url_takes_the_http_scheme_and_floor() {
        let input = ClassifyInput { url: Some("https://example.com/page".into()), ..Default::default() };
        let out = classify_matter(&input, &registry());
        assert_eq!(out[0].type_name, "http"); // scheme 60 + floor 50 -> http wins
    }

    #[test]
    fn ibpa_doorway_floor() {
        let input = ClassifyInput { ibpa: Some("treeos.ai#1/room@ruler".into()), ..Default::default() };
        let out = classify_matter(&input, &registry());
        assert_eq!(out[0].type_name, "ibpa");
    }

    #[test]
    fn model_extension_floor() {
        let input = ClassifyInput { file_name: Some("scene.glb".into()), ..Default::default() };
        let out = classify_matter(&input, &registry());
        assert_eq!(out[0].type_name, "model"); // ext 90 wins
    }

    #[test]
    fn bare_text_falls_to_generic() {
        let input = ClassifyInput { text: Some("just some words".into()), ..Default::default() };
        let out = classify_matter(&input, &registry());
        // generic floor 50 beats the text-base 20-10 of generic/file
        assert_eq!(out[0].type_name, "generic");
    }

    #[test]
    fn the_kernel_seed_types_classify_the_floor() {
        let t = seed_types();
        let pick = |i: ClassifyInput| classify_matter(&i, &t).first().map(|c| c.type_name.clone()).unwrap_or_default();
        assert_eq!(pick(ClassifyInput { file_name: Some("a.glb".into()), ..Default::default() }), "model");
        assert_eq!(pick(ClassifyInput { url: Some("https://x.com".into()), ..Default::default() }), "http");
        assert_eq!(pick(ClassifyInput { ibpa: Some("treeos.ai/room@x".into()), ..Default::default() }), "ibpa");
        // a png with no `image` extension type in the floor -> file (via */* + floor)
        assert_eq!(pick(ClassifyInput { mime_type: Some("image/png".into()), ..Default::default() }), "file");
        assert_eq!(pick(ClassifyInput { file_name: Some("m.wasm".into()), ..Default::default() }), "wasm");
        assert_eq!(pick(ClassifyInput { text: Some("hi".into()), ..Default::default() }), "generic");
    }
}
