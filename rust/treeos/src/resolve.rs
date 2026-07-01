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
    let mut facts = read_lineage_facts(root, h, k, id);
    if let Some(cap) = at {
        facts.retain(|f| fact_ord(f).map_or(true, |o| o <= cap));
    }
    if facts.is_empty() {
        return None;
    }
    Some(treefold::fold(k, &facts))
}

/// The lineage view of one reel: the branch's own facts UNIONED with everything inherited from its
/// ancestors up to each fork point (parent's facts ≤ the branch floor, then the branch's own). On main
/// this collapses to the plain own-reel read. This is what makes a branch actually see its parent.
fn read_lineage_facts(root: &Path, history: &str, kind: &str, id: &str) -> Vec<Json> {
    match treestore::lineage_and_floors(root, history, kind, id) {
        Ok((lineage, floors)) => treestore::read_reel_lineage(&lineage, &floors, None, None, |h, a, u| {
            treestore::read_reel_file(root, h, kind, id, a, u)
        }),
        Err(_) => treestore::read_reel_file(root, history, kind, id, None, None),
    }
}

/// The histories a branch reads through: `["0", …ancestors…, history]`. Main (and any resolve failure)
/// falls back to just `["0"]` (∪ the history itself), preserving the old behaviour.
fn lineage_of(root: &Path, history: &str) -> Vec<String> {
    if history == "0" {
        return vec!["0".to_string()];
    }
    treestore::resolve_history_lineage(root, history).unwrap_or_else(|_| vec!["0".to_string(), history.to_string()])
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
    let lineage = lineage_of(root, history);
    let mut seen: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
    for (h, k, id) in list_reels(root) {
        if !lineage.contains(&h) || !seen.insert((k.clone(), id.clone())) {
            continue;
        }
        // the branch's VIEW of the reel (floored) — parent facts past the fork are not "now" here.
        for f in read_lineage_facts(root, history, &k, &id) {
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
    let lineage = lineage_of(root, history);
    // every reel of this kind visible in the lineage, folded through the branch's view. Order MUST stay
    // deterministic (list_reels order) — root-finding does `.find(is_root)`, so a HashSet's random order
    // would pick a different root each run. Dedup by id while preserving that order.
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut out: Vec<(String, Json)> = Vec::new();
    for (h, k, id) in list_reels(root) {
        if k == kind && lineage.contains(&h) && seen.insert(id.clone()) {
            if let Some(s) = state(root, history, kind, &id, at) {
                out.push((id, s));
            }
        }
    }
    out
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
        .map(|(id, s)| {
            let mut node = being_node(&id, &s);
            // fold the being's freshest deed → a speech bubble (the portal shows it only when recent
            // relative to `now_ord`). Clock-free: recency is by ord, not a wall-clock.
            if let Some((phrase, ord)) = being_said(root, &r.history, &id, at) {
                if let Json::Obj(e) = &mut node {
                    e.push(("said".to_string(), jstr(&phrase)));
                    e.push(("saidOrd".to_string(), Json::Num(ord)));
                }
            }
            node
        })
        .collect();

    let matters: Vec<Json> = all_of_kind(root, &r.history, "matter", at)
        .into_iter()
        .filter(|(_, s)| sget(s, "spaceId").as_deref() == Some(&r.space_id))
        .map(|(id, s)| node("matter", &id, &s))
        .collect();

    let path_by_names = format!("/{}", r.chain.iter().skip(1).map(|(n, _)| n.clone()).collect::<Vec<_>>().join("/"));
    Ok(obj(vec![
        ("address", obj(vec![("story", jstr(&crate::config::story_host(root).unwrap_or_else(|| "localhost".to_string()))), ("spaceId", jstr(&r.space_id)), ("history", jstr(&r.history)), ("pathByNames", jstr(&path_by_names))])),
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

// ── TIMELINE: the history's moments (one per act) as dots the portal scrubs through ──────────────────

/// Fold the whole history into a TIMELINE: one entry per act (deduped by actId), each a moment `{ord,
/// phrase}`, sorted by ord. The portal renders these as dots on the history bar; clicking one scrubs the
/// world to that ord. Capped to the most recent N to keep the wire light. CLOCK-FREE — ordered by ord.
pub fn timeline(history: &str, at: Option<f64>, root: &Path) -> Json {
    let mut moments: Vec<(f64, String)> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let lineage = lineage_of(root, history);
    let mut reels: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
    for (h, k, id) in list_reels(root) {
        if !lineage.contains(&h) || !reels.insert((k.clone(), id.clone())) {
            continue;
        }
        for f in &read_lineage_facts(root, history, &k, &id) {
            let ord = match fact_ord(f) {
                Some(o) => o,
                None => continue,
            };
            if at.map_or(false, |cap| ord > cap) {
                continue;
            }
            let act_id = sget(f, "actId").unwrap_or_default();
            let key = if act_id.is_empty() { format!("{k}:{id}:{ord}") } else { act_id };
            if !seen.insert(key) {
                continue; // an act's landings across reels share an actId — one dot per act
            }
            moments.push((ord, past_phrase(f)));
        }
    }
    moments.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    const CAP: usize = 400;
    if moments.len() > CAP {
        moments = moments.split_off(moments.len() - CAP);
    }
    let list: Vec<Json> = moments.into_iter().map(|(o, p)| obj(vec![("ord", Json::Num(o)), ("phrase", jstr(&p))])).collect();
    obj(vec![
        ("kind", jstr("timeline")),
        ("history", jstr(history)),
        ("ord", Json::Num(now_ord(root, history))),
        ("moments", Json::Arr(list)),
    ])
}

// ── BRANCHING: fork a new history, and list the histories (the branch tree) ───────────────────────────

/// List the histories/branches the story has — `main` (path "0", no registry row) plus every live
/// registry row `{path, label, parent}`. The portal draws these as the branch tree/switcher.
pub fn branches(root: &Path) -> Json {
    let mut list = vec![obj(vec![("path", jstr("0")), ("label", jstr("main")), ("parent", Json::Null)])];
    for p in treestore::list_live_histories(root) {
        if p == "0" {
            continue;
        }
        let row = treestore::load_history(root, &p);
        let label = row.as_ref().and_then(|r| sget(r, "label")).filter(|s| !s.is_empty()).unwrap_or_else(|| p.clone());
        // a main-child row stores parent=null; show it as a child of "0" for the tree.
        let parent = row.as_ref().and_then(|r| sget(r, "parent")).filter(|s| !s.is_empty()).unwrap_or_else(|| "0".to_string());
        list.push(obj(vec![("path", jstr(&p)), ("label", jstr(&label)), ("parent", jstr(&parent))]));
    }
    obj(vec![("kind", jstr("branches")), ("histories", Json::Arr(list))])
}

/// Fork a NEW history off MAIN at `at` (None = now). Each main reel's floor is its max seq ≤ `at`; the
/// child inherits everything up to that floor and diverges after. Returns the registry row. (v1: branches
/// off main only — the common "fork the timeline here" case; branch-of-a-branch is a later step.)
pub fn create_branch(label: &str, at: Option<f64>, root: &Path) -> Result<Json, String> {
    let existing = treestore::list_live_histories(root);
    let next = existing.iter().filter_map(|p| p.parse::<u64>().ok()).max().unwrap_or(0) + 1;
    let path = next.to_string();

    // per-reel branch points: each main reel's max seq ≤ `at` — the floor the child inherits up to.
    let mut bp: std::collections::HashMap<String, f64> = std::collections::HashMap::new();
    for (h, k, id) in list_reels(root) {
        if h != "0" {
            continue;
        }
        let floor = treestore::read_reel_file(root, "0", &k, &id, None, None)
            .iter()
            .filter(|f| at.map_or(true, |c| fact_ord(f).map_or(false, |o| o <= c)))
            .filter_map(|f| match get(f, "seq") {
                Some(Json::Num(s)) => Some(*s),
                _ => None,
            })
            .fold(None, |m: Option<f64>, s| Some(m.map_or(s, |x| x.max(s))));
        if let Some(s) = floor {
            bp.insert(format!("{k}:{id}"), s);
        }
    }

    let row = treestore::create_history(
        root,
        &treestore::NewHistory { path: &path, parent: None, branch_point: &bp, created_by: Some("I"), created_at: None, label: Some(label), scope: None },
    )
    .map_err(|e| format!("create_history: {e}"))?;

    // seed each branch reel head at its floor, so the branch's first append links to the parent tip.
    for (key, seq) in &bp {
        if let Some((k, id)) = key.split_once(':') {
            let _ = treestore::fork_reel_fs(root, &path, "0", k, id, *seq);
        }
    }
    Ok(row)
}

// ── NAME LOGIN: fetch a Name's ENCRYPTED key blob for client-side password decrypt (Model B) ─────────

/// Look up a Name (by nameId or by its `name` handle) in the library reel and return its ENCRYPTED key
/// blob so the portal can decrypt it CLIENT-SIDE with the password (the password never touches the wire).
/// The blob is a `pw:…` scrypt+AES-GCM ciphertext — safe to return (useless without the password); this
/// is the one place we do NOT redact it (the whole point of name+password login).
pub fn name_key(who: &str, root: &Path) -> Result<Json, String> {
    let domain = crate::config::story_host(root).unwrap_or_else(|| "localhost".to_string());
    let facts = treestore::read_reel_file(root, "0", "library", &domain, None, None);
    let lib = treefold::fold("library", &facts);
    if let Some(Json::Obj(names)) = get(&lib, "names") {
        for (nid, row) in names {
            let by_id = nid == who;
            let by_name = sget(row, "name").as_deref() == Some(who);
            if by_id || by_name {
                return Ok(obj(vec![
                    ("kind", jstr("name-key")),
                    ("nameId", jstr(nid)),
                    ("name", get(row, "name").cloned().unwrap_or(Json::Null)),
                    ("privateKeyEnc", get(row, "privateKeyEnc").cloned().unwrap_or(Json::Null)),
                ]));
            }
        }
    }
    Err(format!("name '{who}' not found"))
}

// ── STORY: a being's/name's past written as Word (a port of assembleStory's weave) ───────────────────

/// The story render: fold a being's/name's fact-chain into a past-tense Word narrative (one line per
/// act) + the symbol chain (for the Rain side-panel). The past IS the projection — the "story" the
/// Story view paints. Secret-safe: complex values summarize to "…", never dumped.
pub fn story(kind: &str, id: &str, history: &str, at: Option<f64>, lang: &str, root: &Path) -> Result<Json, String> {
    let mut facts = treestore::read_reel_file(root, history, kind, id, None, None);
    if let Some(cap) = at {
        facts.retain(|f| fact_ord(f).map_or(true, |o| o <= cap));
    }
    let vocab = treesymbol::vocabulary(&[]);

    let mut lines: Vec<Json> = Vec::new();
    let mut seen_acts: std::collections::HashSet<String> = std::collections::HashSet::new();
    for f in &facts {
        // one line per act (an act's landings across reels share an actId; render the deed once)
        let act_id = sget(f, "actId").unwrap_or_default();
        if !act_id.is_empty() && !seen_acts.insert(act_id) {
            continue;
        }
        // the past-tense Word line, PROJECTED into the language. `en` is the canonical form; other langs
        // go through translate_line() — the derived seam (LLM/dictionary-activated, no hand-map).
        lines.push(obj(vec![("line", jstr(&translate_line(&past_phrase(f), lang)))]));
    }
    let symbols: Vec<Json> = facts.iter().map(|f| jstr(&fact_symbol(f, &vocab))).collect();
    let name = state(root, history, kind, id, at).and_then(|s| sget(&s, "name"));

    Ok(obj(vec![
        ("kind", jstr("story")),
        ("name", name.map(|n| jstr(&n)).unwrap_or(Json::Null)),
        ("story", Json::Arr(lines)),
        ("symbols", Json::Arr(symbols)),
    ]))
}

/// Project a rendered line into a language. `en` is the canonical form (identity). Other languages are
/// the DERIVED translate seam: an injected LLM/dictionary function fills them automatically (rain.md:
/// "just make a function that does it") — never a hand-maintained map. Until that function is wired, a
/// non-`en` line falls back to the canonical (English) form.
fn translate_line(line: &str, lang: &str) -> String {
    if lang == "en" {
        return line.to_string();
    }
    // TODO(T5): call the injected translate(line, lang) (LLM/dictionary, cached). Fallback = canonical.
    line.to_string()
}

/// One fact → a past-tense Word phrase (the pastPhrase shapes of assemble.js, common ops).
fn past_phrase(f: &Json) -> String {
    let verb = sget(f, "verb").unwrap_or_default();
    let act = sget(f, "act").unwrap_or_default();
    let params = get(f, "params");
    let pstr = |k: &str| value_str(params, k);
    match (verb.as_str(), act.as_str()) {
        ("be", "birth") => format!("was born as {}", pstr("name")),
        ("be", "kill") => "died".to_string(),
        ("be", a) if !a.is_empty() => format!("was {a}"),
        (_, "create-space") => format!("made the space {}", first_nonempty(&[pstr("name"), sget(f, "to").unwrap_or_default()])),
        (_, "form-being") => format!("gave birth to {}", pstr("name")),
        (_, "create-matter") => format!("made {}", pstr("name")),
        (_, "coin") => format!("coined the word \"{}\"", pstr("word")),
        (_, "declare") => "declared a name".to_string(),
        (_, a) if a.starts_with("set-") => {
            let field = pstr("field");
            let value = pstr("value");
            if field.is_empty() {
                format!("did {a}")
            } else {
                format!("set {field} to {value}")
            }
        }
        (_, a) if !a.is_empty() => format!("did {a}"),
        (v, _) if !v.is_empty() => format!("did {v}"),
        _ => "acted".to_string(),
    }
}

/// A param value as a short string — secret-safe: objects/arrays summarize to "…", never dumped.
fn value_str(params: Option<&Json>, k: &str) -> String {
    match params.and_then(|p| get(p, k)) {
        Some(Json::Str(s)) => s.clone(),
        Some(Json::Num(n)) => {
            if n.fract() == 0.0 {
                format!("{}", *n as i64)
            } else {
                n.to_string()
            }
        }
        Some(Json::Bool(b)) => b.to_string(),
        Some(Json::Obj(_)) | Some(Json::Arr(_)) => "…".to_string(),
        _ => String::new(),
    }
}

fn first_nonempty(xs: &[String]) -> String {
    xs.iter().find(|s| !s.is_empty()).cloned().unwrap_or_default()
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

/// The being's most recent utterance/deed, folded from its own reel: the freshest fact's phrase + its
/// ord. The portal renders it as a speech bubble, shown only while it's recent relative to the world's
/// now. CLOCK-FREE — recency is measured in ords, never wall-clock.
fn being_said(root: &Path, history: &str, being_id: &str, at: Option<f64>) -> Option<(String, f64)> {
    let mut facts = treestore::read_reel_file(root, history, "being", being_id, None, None);
    if let Some(cap) = at {
        facts.retain(|f| fact_ord(f).map_or(true, |o| o <= cap));
    }
    let latest = facts.iter().max_by(|a, b| {
        fact_ord(a).unwrap_or(0.0).partial_cmp(&fact_ord(b).unwrap_or(0.0)).unwrap_or(std::cmp::Ordering::Equal)
    })?;
    let ord = fact_ord(latest)?;
    Some((past_phrase(latest), ord))
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
