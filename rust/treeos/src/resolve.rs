// resolve.rs — address -> scene. THE keystone. treeos perceives by reel (kind/id); this resolves a real
// IBP address (story#history/space/space@being, the path a stack of nested spaces) to a scene the portal
// renders. Ports the core of seed/ibp/resolver.js (walk the space path, history-aware) + a focused scene
// fold: from the folded reels, children = spaces with parent==S, occupants = beings positioned in S,
// matter = matter with spaceId==S. (v1: own-history ∪ main "0"; full branch union deferred per the plan.)

use std::path::Path;

use treehash::Json;

use crate::chain::{get, list_reels};

fn sget(v: &Json, k: &str) -> Option<String> {
    match get(v, k) {
        Some(Json::Str(s)) => Some(s.clone()),
        _ => None,
    }
}
fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn obj(f: Vec<(&str, Json)>) -> Json {
    Json::Obj(f.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

/// Fold a reel to its state — optionally AS OF a past global ord (`at`), for time-travel: only facts
/// with `ord <= at` are folded (facts with no ord — genesis — are always kept).
fn state(root: &Path, h: &str, k: &str, id: &str, at: Option<f64>) -> Option<Json> {
    let mut facts = treestore::read_reel_file(root, h, k, id, None, None);
    if let Some(cap) = at {
        facts.retain(|f| fact_ord(f).map_or(true, |o| o <= cap));
    }
    if facts.is_empty() {
        return None;
    }
    Some(treefold::fold(k, &facts))
}

fn fact_ord(f: &Json) -> Option<f64> {
    match get(f, "ord") {
        Some(Json::Num(n)) => Some(*n),
        _ => None,
    }
}

/// The world's NOW as the timeline's right edge: the max fact ord seen (the `.ord` counter can lag on a
/// legacy store), floored by the counter. This is the scrubber's upper bound; 0..now is the timeline.
fn now_ord(root: &Path, history: &str) -> f64 {
    let mut mx = treestore::read_ord(root);
    for (h, k, id) in list_reels(root) {
        if h != history && h != "0" {
            continue;
        }
        for f in treestore::read_reel_file(root, &h, &k, &id, None, None) {
            if let Some(o) = fact_ord(&f) {
                if o > mx {
                    mx = o;
                }
            }
        }
    }
    mx
}

/// All folded reels of a kind visible on `history` (v1: own-history ∪ main "0"), as of `at` ord.
fn all_of_kind(root: &Path, history: &str, kind: &str, at: Option<f64>) -> Vec<(String, Json)> {
    list_reels(root)
        .into_iter()
        .filter(|(h, k, _)| k == kind && (h == history || h == "0"))
        .filter_map(|(h, k, id)| state(root, &h, &k, &id, at).map(|s| (id, s)))
        .collect()
}

/// A space with no parent is the story root ("My Story").
fn is_root(s: &Json) -> bool {
    match get(s, "parent") {
        None | Some(Json::Null) => true,
        Some(Json::Str(p)) => p.is_empty(),
        _ => false,
    }
}

/// The resolved leaf of an address path.
pub struct Resolved {
    pub space_id: String,
    pub chain: Vec<(String, String)>, // (name, id) from root to leaf
    pub history: String,
    pub being: Option<String>, // resolved beingId for @being, if any
}

/// Resolve an IBP address string to a leaf space (+ chain, history, @being). The path's segments are
/// nested spaces, matched by uuid then name through the (history-aware) children at each level.
pub fn resolve(input: &str, ctx_history: &str, at: Option<f64>, root: &Path) -> Result<Resolved, String> {
    let ctx = treeaddress::Ctx { current_history: Some(ctx_history.to_string()), ..Default::default() };
    let addr = treeaddress::parse(input, &ctx).map_err(|e| format!("bad address: {e:?}"))?;
    let st = treeaddress::expand(&addr, &ctx).right;
    let history = st.history.clone().unwrap_or_else(|| ctx_history.to_string());
    let path = st.path.clone().unwrap_or_else(|| "/".to_string());

    let spaces = all_of_kind(root, &history, "space", at);
    let (root_id, root_state) = spaces.iter().find(|(_, s)| is_root(s)).cloned().ok_or_else(|| "no root space".to_string())?;

    let mut chain_v: Vec<(String, String)> = vec![(sget(&root_state, "name").unwrap_or_default(), root_id.clone())];
    let mut cur = root_id;

    for seg in path.trim_matches('/').split('/').filter(|s| !s.is_empty()) {
        let kids: Vec<&(String, Json)> = spaces.iter().filter(|(_, s)| sget(s, "parent").as_deref() == Some(&cur)).collect();
        let found = kids
            .iter()
            .find(|(id, _)| id == seg)
            .or_else(|| kids.iter().find(|(_, s)| sget(s, "name").as_deref() == Some(seg)));
        match found {
            Some((id, s)) => {
                chain_v.push((sget(s, "name").unwrap_or_default(), id.clone()));
                cur = id.clone();
            }
            None => return Err(format!("segment '{seg}' not found")),
        }
    }

    let being = st.being.as_ref().and_then(|b| resolve_being(root, &history, at, b));
    Ok(Resolved { space_id: cur, chain: chain_v, history, being })
}

/// Resolve an @being NAME to a beingId (a being whose folded name matches), on the history, as of `at`.
fn resolve_being(root: &Path, history: &str, at: Option<f64>, name: &str) -> Option<String> {
    all_of_kind(root, history, "being", at).into_iter().find(|(_, s)| sget(s, "name").as_deref() == Some(name)).map(|(id, _)| id)
}

/// The scene descriptor for a resolved address: the place + its children (spaces), occupants (beings
/// positioned here), and matter. Shaped exactly for the portal's `views/scene.rs` collector.
pub fn scene(input: &str, ctx_history: &str, at: Option<f64>, root: &Path) -> Result<Json, String> {
    let r = resolve(input, ctx_history, at, root)?;
    let spaces = all_of_kind(root, &r.history, "space", at);
    let self_name = spaces.iter().find(|(id, _)| *id == r.space_id).and_then(|(_, s)| sget(s, "name"));

    let children: Vec<Json> = spaces
        .iter()
        .filter(|(_, s)| sget(s, "parent").as_deref() == Some(&r.space_id))
        .map(|(id, s)| node("space", id, s))
        .collect();

    let beings: Vec<Json> = all_of_kind(root, &r.history, "being", at)
        .into_iter()
        .filter(|(_, s)| sget(s, "position").as_deref() == Some(&r.space_id))
        .map(|(id, s)| being_node(&id, &s))
        .collect();

    let matters: Vec<Json> = all_of_kind(root, &r.history, "matter", at)
        .into_iter()
        .filter(|(_, s)| sget(s, "spaceId").as_deref() == Some(&r.space_id))
        .map(|(id, s)| node("matter", &id, &s))
        .collect();

    let path_by_names = format!("/{}", r.chain.iter().skip(1).map(|(n, _)| n.clone()).collect::<Vec<_>>().join("/"));
    Ok(obj(vec![
        ("address", obj(vec![("spaceId", jstr(&r.space_id)), ("history", jstr(&r.history)), ("pathByNames", jstr(&path_by_names))])),
        // the timeline range: `ord` = the world's now; `at` = the past ord this scene was folded at (null
        // = live/now). The portal's history scrubber runs 0..ord and re-perceives with `at`.
        ("ord", Json::Num(now_ord(root, &r.history))),
        ("at", at.map(Json::Num).unwrap_or(Json::Null)),
        ("name", self_name.map(|s| jstr(&s)).unwrap_or(Json::Null)),
        ("being", r.being.map(|b| jstr(&b)).unwrap_or(Json::Null)),
        ("children", Json::Arr(children)),
        ("beings", Json::Arr(beings)),
        ("matters", Json::Arr(matters)),
    ]))
}

// ── RAIN: all of a Name's beings, each as a falling SYMBOL chain (philosophy/wordRain/rain.md) ────────

/// A rain descriptor: the beings a Name owns (or story-wide as I), each with its fact-chain encoded as a
/// chain of one-token symbols (treesymbol) — the projection chains the portal rains down. `@being` names
/// the Name (via its being's trueName); `@I`/story → all beings.
pub fn rain(input: &str, ctx_history: &str, at: Option<f64>, root: &Path) -> Result<Json, String> {
    let ctx = treeaddress::Ctx { current_history: Some(ctx_history.to_string()), ..Default::default() };
    let addr = treeaddress::parse(input, &ctx).map_err(|e| format!("bad address: {e:?}"))?;
    let st = treeaddress::expand(&addr, &ctx).right;
    let history = st.history.clone().unwrap_or_else(|| ctx_history.to_string());

    let beings = all_of_kind(root, &history, "being", at);
    // the Name: the trueName of the @being, unless @I/@story → story-wide (all beings)
    let being_name = st.being.clone().unwrap_or_default();
    let story_wide = being_name.is_empty() || being_name == "I";
    let name_id = if story_wide {
        String::new()
    } else {
        beings
            .iter()
            .find(|(_, s)| sget(s, "name").as_deref() == Some(&being_name))
            .and_then(|(_, s)| sget(s, "trueName"))
            .unwrap_or_default()
    };

    let vocab = treesymbol::vocabulary(&[]); // v1: grammar+concept base (coined-word read = the coupling point)
    let owned: Vec<Json> = beings
        .iter()
        .filter(|(_, s)| story_wide || sget(s, "trueName").as_deref() == Some(&name_id))
        .map(|(id, s)| {
            let chain = being_symbol_chain(root, &history, id, at, &vocab);
            obj(vec![
                ("beingId", jstr(id)),
                ("name", sget(s, "name").map(|n| jstr(&n)).unwrap_or(Json::Null)),
                ("trueName", sget(s, "trueName").map(|n| jstr(&n)).unwrap_or(Json::Null)),
                ("chain", Json::Arr(chain)),
            ])
        })
        .collect();

    Ok(obj(vec![
        ("kind", jstr("rain")),
        ("nameId", jstr(&name_id)),
        ("history", jstr(&history)),
        ("ord", Json::Num(now_ord(root, &history))),
        ("beings", Json::Arr(owned)),
    ]))
}

/// A being's fact-chain as a symbol chain: each fact -> one glyph (a vocabulary Word's symbol if the act
/// names one, else an ord-derived glyph so every fact still rains).
fn being_symbol_chain(root: &Path, history: &str, id: &str, at: Option<f64>, vocab: &[String]) -> Vec<Json> {
    let facts = treestore::read_reel_file(root, history, "being", id, None, None);
    facts
        .iter()
        .filter(|f| at.map_or(true, |cap| fact_ord(f).map_or(true, |o| o <= cap)))
        .map(|f| jstr(&fact_symbol(f, vocab)))
        .collect()
}

fn fact_symbol(f: &Json, vocab: &[String]) -> String {
    // a vocabulary Word named in the act -> its symbol
    let act = sget(f, "act").or_else(|| sget(f, "verb")).unwrap_or_default();
    for part in act.split(['-', ' ', ':']) {
        if let Some(c) = treesymbol::symbol(part, vocab) {
            return c.to_string();
        }
    }
    // fallback: an ord-derived glyph from the same alphabet (deterministic, keeps the rain falling)
    let o = fact_ord(f).unwrap_or(0.0) as usize;
    treesymbol::glyph(o % treesymbol::alphabet_len().max(1)).map(|c| c.to_string()).unwrap_or_else(|| "·".to_string())
}

fn coord_of(s: &Json) -> Json {
    get(s, "coord").cloned().unwrap_or(Json::Null)
}

fn node(kind: &str, id: &str, s: &Json) -> Json {
    obj(vec![
        ("kind", jstr(kind)),
        ("id", jstr(id)),
        ("name", sget(s, "name").map(|n| jstr(&n)).unwrap_or(Json::Null)),
        ("coord", coord_of(s)),
    ])
}

fn being_node(id: &str, s: &Json) -> Json {
    let name = sget(s, "name");
    obj(vec![
        ("kind", jstr("being")),
        ("id", jstr(id)),
        ("being", name.clone().map(|n| jstr(&n)).unwrap_or(Json::Null)),
        ("name", name.map(|n| jstr(&n)).unwrap_or(Json::Null)),
        ("trueName", sget(s, "trueName").map(|n| jstr(&n)).unwrap_or(Json::Null)),
        ("coord", coord_of(s)),
    ])
}
