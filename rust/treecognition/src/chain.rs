// treecognition::chain — the LLM connection-resolution chain. A faithful port of the JS chain.js walk
// (Tabor designed it carefully; all logic preserved), with ONE addition: a NAME level on each side,
// after the space ancestors and before the story root — the Name can hold its own connection too.
//
// The walk picks WHICH llm connection answers an (actor, receiver, able) call, in priority order:
//
//   receiver being (0:slot, 1:default)
//   receiver space + ancestors        (2)
//   receiver NAME                      (2.5)   ← new
//   receiver story root                (3)     [+ story-config back-compat]
//   ── 3.5 boundary gate ── continues to the actor side ONLY if a forceActor fired receiver-side;
//      a forceReceiver caps the chain where it fired; otherwise the chain caps at step 3.
//   actor being                        (4)
//   actor space + ancestors            (5)
//   actor NAME                         (5.5)   ← new
//   actor story root                   (6)     [same-story dedup; cross-story is a stub]
//
// Each container exposes `qualities.llm = { default[], slots{able:[]}, preferOwn, forceActor,
// forceReceiver }` (+ legacy beingLlm/enforced/locked, normalized below). slot list before default
// WITHIN a container; `tried` de-duplicates a connection id across the whole walk.
//
// The container LOADERS (being / space-ancestors / name / story-root / story-config) are I/O, so they
// are injected as the `Containers` seam — the walker itself is PURE + fully testable.

use std::collections::HashSet;
use treehash::Json;

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}

const MAX_CONNECTION_ID_LENGTH: usize = 100;

/// `toIdList`: a string or array-of-strings -> the valid ids (non-empty, <= 100 chars).
fn to_id_list(v: Option<&Json>) -> Vec<String> {
    let items: Vec<&Json> = match v {
        Some(Json::Arr(a)) => a.iter().collect(),
        Some(x) => vec![x],
        None => vec![],
    };
    items
        .into_iter()
        .filter_map(|x| match x {
            Json::Str(s) if !s.is_empty() && s.len() <= MAX_CONNECTION_ID_LENGTH => Some(s.clone()),
            _ => None,
        })
        .collect()
}

fn as_bool(v: Option<&Json>) -> bool {
    matches!(v, Some(Json::Bool(true)))
}

/// `SLOT_NAME_PATTERN` = /^[a-zA-Z][a-zA-Z0-9_-]*$/ — rejects prototype-pollution / invalid able names.
fn slot_name_ok(able: &str) -> bool {
    matches!(able.chars().next(), Some(c) if c.is_ascii_alphabetic())
        && able.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// A container's normalized `qualities.llm`.
#[derive(Default, Debug, Clone)]
pub struct ContainerLlm {
    pub default_list: Vec<String>,
    pub slot_list: Vec<String>,
    pub prefer_own: bool,
    pub force_actor: bool,
    pub force_receiver: bool,
}

/// `readContainerLlm`: a container -> the uniform shape, reading the new `qualities.llm` plus the legacy
/// `beingLlm` / `enforced` / `locked` so pre-rewire data still resolves.
pub fn read_container_llm(container: Option<&Json>, able: &str) -> ContainerLlm {
    let container = match container {
        Some(c) => c,
        None => return ContainerLlm::default(),
    };
    let qualities = get(container, "qualities");
    let llm = qualities.and_then(|q| get(q, "llm"));
    let being_llm = qualities.and_then(|q| get(q, "beingLlm"));

    let default_list = to_id_list(llm.and_then(|l| get(l, "default")));

    // able-slot list — new `llm.slots[able]`, else legacy `beingLlm.slots[able]`.
    let mut slot_list = Vec::new();
    if slot_name_ok(able) {
        if let Some(s) = llm.and_then(|l| get(l, "slots")).and_then(|ns| get(ns, able)) {
            slot_list = to_id_list(Some(s));
        } else if let Some(s) = being_llm.and_then(|b| get(b, "slots")).and_then(|bs| get(bs, able)) {
            slot_list = to_id_list(Some(s));
        }
    }

    let mut prefer_own = as_bool(llm.and_then(|l| get(l, "preferOwn")));
    let mut force_actor = as_bool(llm.and_then(|l| get(l, "forceActor")));
    let mut force_receiver = as_bool(llm.and_then(|l| get(l, "forceReceiver")));

    // legacy translations
    if as_bool(being_llm.and_then(|b| get(b, "preferOwn"))) {
        prefer_own = true;
    }
    if as_bool(llm.and_then(|l| get(l, "enforced"))) || as_bool(being_llm.and_then(|b| get(b, "enforced"))) {
        force_receiver = true;
    }
    let locked = as_bool(being_llm.and_then(|b| get(b, "locked")));
    if locked {
        force_receiver = true;
        slot_list = Vec::new(); // "no LLM under me" — an explicit qualities.llm.default[] still survives
    }

    // mutual exclusion: forceReceiver wins if both somehow set
    if force_actor && force_receiver {
        force_actor = false;
    }
    // lockout: a locked container with no default produces zero candidates here
    if locked && default_list.is_empty() {
        return ContainerLlm { default_list: vec![], slot_list: vec![], prefer_own, force_actor: false, force_receiver: true };
    }

    ContainerLlm { default_list, slot_list, prefer_own, force_actor, force_receiver }
}

/// One side of a call: the being, its space, its Name, its story. An empty string = absent.
#[derive(Default, Debug, Clone)]
pub struct Party {
    pub being_id: String,
    pub space_id: String,
    pub name_id: String,
    pub story_domain: String,
}

/// One picked connection, tagged with the step + source that contributed it (forensics).
#[derive(Debug, Clone, PartialEq)]
pub struct ChainEntry {
    pub step: String,
    pub source: String,
    pub connection_id: String,
}

/// The walk result: the ordered chain + why it capped (a force flag, exhaustion, or the default cap).
#[derive(Debug, Clone)]
pub struct ChainResult {
    pub chain: Vec<ChainEntry>,
    pub reason: Option<String>,
}

/// The injected container loaders — the I/O the walker needs (folded states off the chain). The binary
/// wires these to treestore/treefold; tests supply fakes.
pub trait Containers {
    fn being(&self, being_id: &str) -> Option<Json>;
    fn space_ancestors(&self, space_id: &str) -> Vec<Json>;
    fn name(&self, name_id: &str) -> Option<Json>;
    fn story_root(&self) -> Option<Json>;
    fn story_config(&self, key: &str) -> Option<String>;
}

#[derive(PartialEq)]
enum Boundary {
    DefaultCap,
    ForceActor,
}

/// Append a container's candidates (slot list, then default list) under labeled steps, de-duplicating
/// via `tried`. Returns the normalized llm so the caller can act on the force flags.
fn push_container(chain: &mut Vec<ChainEntry>, tried: &mut HashSet<String>, container: Option<&Json>, able: &str, slot_step: &str, default_step: &str, prefix: &str) -> ContainerLlm {
    let norm = read_container_llm(container, able);
    for id in &norm.slot_list {
        if tried.insert(id.clone()) {
            chain.push(ChainEntry { step: slot_step.to_string(), source: format!("{prefix}:slot"), connection_id: id.clone() });
        }
    }
    for id in &norm.default_list {
        if tried.insert(id.clone()) {
            chain.push(ChainEntry { step: default_step.to_string(), source: format!("{prefix}:default"), connection_id: id.clone() });
        }
    }
    norm
}

fn capped(chain: Vec<ChainEntry>, reason: &str) -> ChainResult {
    ChainResult { chain, reason: Some(reason.to_string()) }
}

/// Build the ordered LLM connection chain for an (actor, receiver, able) triple.
pub fn build_llm_chain(actor: &Party, receiver: &Party, able: &str, c: &dyn Containers) -> ChainResult {
    let mut chain: Vec<ChainEntry> = Vec::new();
    let mut tried: HashSet<String> = HashSet::new();
    let mut boundary = Boundary::DefaultCap;

    // ── RECEIVER SIDE ──
    // step 0/1: receiver being (slot -> "0", default -> "1")
    let rb = c.being(&receiver.being_id);
    if rb.is_some() {
        let norm = push_container(&mut chain, &mut tried, rb.as_ref(), able, "0", "1", "receiver-being");
        if norm.force_receiver {
            return capped(chain, "forceReceiver on receiver being (capped at step 1)");
        }
        if norm.force_actor {
            boundary = Boundary::ForceActor; // skip steps 2/2.5/3, jump to actor side
        }
    }

    // step 2: receiver space + ancestors
    if boundary != Boundary::ForceActor && !receiver.space_id.is_empty() {
        for space in c.space_ancestors(&receiver.space_id) {
            let norm = push_container(&mut chain, &mut tried, Some(&space), able, "2", "2", "receiver-space");
            if norm.force_receiver {
                return capped(chain, "forceReceiver on receiver space (capped at step 2)");
            }
            if norm.force_actor {
                boundary = Boundary::ForceActor;
                break;
            }
        }
    }

    // step 2.5: receiver NAME (new — after space, before story)
    if boundary != Boundary::ForceActor && !receiver.name_id.is_empty() {
        let rn = c.name(&receiver.name_id);
        if rn.is_some() {
            let norm = push_container(&mut chain, &mut tried, rn.as_ref(), able, "2.5", "2.5", "receiver-name");
            if norm.force_receiver {
                return capped(chain, "forceReceiver on receiver name (capped at step 2.5)");
            }
            if norm.force_actor {
                boundary = Boundary::ForceActor;
            }
        }
    }

    // step 3: receiver story root (+ story-config back-compat)
    if boundary != Boundary::ForceActor {
        if let Some(root) = c.story_root() {
            let norm = push_container(&mut chain, &mut tried, Some(&root), able, "3", "3", "receiver-story");
            if norm.slot_list.is_empty() && norm.default_list.is_empty() {
                if let Some(cfg) = c.story_config("storyLlmConnection") {
                    if !cfg.is_empty() && tried.insert(cfg.clone()) {
                        chain.push(ChainEntry { step: "3".to_string(), source: "receiver-story:config".to_string(), connection_id: cfg });
                    }
                }
            }
            if norm.force_receiver {
                return capped(chain, "forceReceiver on receiver story (capped at step 3)");
            }
            if norm.force_actor {
                boundary = Boundary::ForceActor;
            }
        }
    }

    // ── 3.5 GATE ── continue to actor side only on a receiver-side forceActor.
    if boundary != Boundary::ForceActor {
        return capped(
            chain.clone(),
            if chain.is_empty() {
                "no receiver-side candidates and no forceActor — chain empty"
            } else {
                "chain capped at step 3 (default; no forceActor on receiver side)"
            },
        );
    }

    // ── ACTOR SIDE ──
    if actor.being_id.is_empty() && actor.space_id.is_empty() {
        return capped(chain, "forceActor fired but no actor context to walk");
    }

    // step 4: actor being
    let ab = c.being(&actor.being_id);
    if ab.is_some() {
        let norm = push_container(&mut chain, &mut tried, ab.as_ref(), able, "4", "4", "actor-being");
        if norm.force_receiver {
            return capped(chain, "forceReceiver on actor being (caps actor walk at step 4)");
        }
    }

    // step 5: actor space + ancestors
    if !actor.space_id.is_empty() {
        for space in c.space_ancestors(&actor.space_id) {
            let norm = push_container(&mut chain, &mut tried, Some(&space), able, "5", "5", "actor-space");
            if norm.force_receiver {
                return capped(chain, "forceReceiver on actor space (caps actor walk at step 5)");
            }
        }
    }

    // step 5.5: actor NAME (new)
    if !actor.name_id.is_empty() {
        if let Some(an) = c.name(&actor.name_id) {
            let norm = push_container(&mut chain, &mut tried, Some(&an), able, "5.5", "5.5", "actor-name");
            if norm.force_receiver {
                return capped(chain, "forceReceiver on actor name (caps actor walk at step 5.5)");
            }
        }
    }

    // step 6: actor story root (same-story dedup; cross-story is a documented stub)
    if actor.story_domain.is_empty() || actor.story_domain == receiver.story_domain {
        if let Some(root) = c.story_root() {
            push_container(&mut chain, &mut tried, Some(&root), able, "6", "6", "actor-story");
        }
    }

    let reason = if chain.is_empty() { Some("chain exhausted with no candidates anywhere".to_string()) } else { None };
    ChainResult { chain, reason }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jstr(x: &str) -> Json {
        Json::Str(x.to_string())
    }
    fn obj(f: Vec<(&str, Json)>) -> Json {
        Json::Obj(f.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
    }
    fn arr(xs: &[&str]) -> Json {
        Json::Arr(xs.iter().map(|x| jstr(x)).collect())
    }
    /// a container with the given `qualities.llm`
    fn llm_container(llm: Json) -> Json {
        obj(vec![("qualities", obj(vec![("llm", llm)]))])
    }

    #[derive(Default)]
    struct Fake {
        being: std::collections::HashMap<String, Json>,
        ancestors: std::collections::HashMap<String, Vec<Json>>,
        name: std::collections::HashMap<String, Json>,
        story: Option<Json>,
        config: std::collections::HashMap<String, String>,
    }
    impl Containers for Fake {
        fn being(&self, id: &str) -> Option<Json> {
            self.being.get(id).cloned()
        }
        fn space_ancestors(&self, id: &str) -> Vec<Json> {
            self.ancestors.get(id).cloned().unwrap_or_default()
        }
        fn name(&self, id: &str) -> Option<Json> {
            self.name.get(id).cloned()
        }
        fn story_root(&self) -> Option<Json> {
            self.story.clone()
        }
        fn story_config(&self, key: &str) -> Option<String> {
            self.config.get(key).cloned()
        }
    }
    fn party(being: &str) -> Party {
        Party { being_id: being.to_string(), ..Default::default() }
    }
    fn ids(r: &ChainResult) -> Vec<String> {
        r.chain.iter().map(|e| e.connection_id.clone()).collect()
    }

    #[test]
    fn slot_before_default_then_caps_at_step_3() {
        let mut f = Fake::default();
        f.being.insert("rb".into(), llm_container(obj(vec![("slots", obj(vec![("coder", arr(&["s1", "s2"]))])), ("default", arr(&["d1"]))])));
        let r = build_llm_chain(&Party::default(), &party("rb"), "coder", &f);
        assert_eq!(ids(&r), vec!["s1", "s2", "d1"]); // slot list exhausts before default
        assert_eq!(r.chain[0].step, "0"); // slot = step 0
        assert_eq!(r.chain[2].step, "1"); // default = step 1
        assert!(r.reason.as_deref().unwrap().contains("capped at step 3"));
    }

    #[test]
    fn the_name_level_sits_between_space_and_story() {
        let mut f = Fake::default();
        f.being.insert("rb".into(), llm_container(obj(vec![("default", arr(&["being1"]))])));
        f.ancestors.insert("sp".into(), vec![llm_container(obj(vec![("default", arr(&["space1"]))]))]);
        f.name.insert("nm".into(), llm_container(obj(vec![("default", arr(&["name1"]))])));
        f.story = Some(llm_container(obj(vec![("default", arr(&["story1"]))])));
        let receiver = Party { being_id: "rb".into(), space_id: "sp".into(), name_id: "nm".into(), ..Default::default() };
        let r = build_llm_chain(&Party::default(), &receiver, "coder", &f);
        // order: being -> space -> NAME -> story
        assert_eq!(ids(&r), vec!["being1", "space1", "name1", "story1"]);
        assert_eq!(r.chain[2].step, "2.5");
        assert_eq!(r.chain[2].source, "receiver-name:default");
    }

    #[test]
    fn force_actor_jumps_to_the_actor_side_and_dedups() {
        let mut f = Fake::default();
        f.being.insert("rb".into(), llm_container(obj(vec![("default", arr(&["shared"])), ("forceActor", Json::Bool(true))])));
        f.being.insert("ab".into(), llm_container(obj(vec![("default", arr(&["shared", "actor1"]))])));
        let r = build_llm_chain(&party("ab"), &party("rb"), "coder", &f);
        // receiver being contributed "shared"; actor being adds only "actor1" (shared deduped)
        assert_eq!(ids(&r), vec!["shared", "actor1"]);
        assert_eq!(r.chain[1].step, "4");
    }

    #[test]
    fn force_receiver_caps_where_it_fires() {
        let mut f = Fake::default();
        f.being.insert("rb".into(), llm_container(obj(vec![("default", arr(&["only"])), ("forceReceiver", Json::Bool(true))])));
        f.being.insert("ab".into(), llm_container(obj(vec![("default", arr(&["actorone"]))])));
        let r = build_llm_chain(&party("ab"), &party("rb"), "coder", &f);
        assert_eq!(ids(&r), vec!["only"]); // never reaches the actor side
        assert!(r.reason.as_deref().unwrap().contains("forceReceiver on receiver being"));
    }

    #[test]
    fn story_config_backfills_an_empty_story_root() {
        let mut f = Fake::default();
        f.story = Some(llm_container(Json::Obj(vec![]))); // empty llm
        f.config.insert("storyLlmConnection".into(), "cfg-conn".into());
        let r = build_llm_chain(&Party::default(), &Party::default(), "coder", &f);
        assert_eq!(ids(&r), vec!["cfg-conn"]);
        assert_eq!(r.chain[0].source, "receiver-story:config");
    }
}
