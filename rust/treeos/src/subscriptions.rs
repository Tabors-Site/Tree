// subscriptions.rs — PRESENT-LOOP Phase 2: ATTENTION, not dispatch. A being's standing assignment of
// attention ("wake me when THIS happens THERE"). When a watched fact lands, the being's prior request is
// what fires — a SELF-WAKE: the asker and the receiver are the same being. Ported from
// seed/present/wakes/subscriptions.js, re-shaped onto the Phase-1 scheduler + the treesecondary folds.
//
// ORD-DRIVEN, CLOCK-FREE BY CONSTRUCTION. A wake fires off the triggering fact's APPEND ORD (a count),
// never a timer, never a clock, never a sleep. There is no `coalesceMs` window here — the JS coalesce
// path was the one wall-clock corner of the model (a `setTimeout(coalesceMs)`); Tabor's rule bars it, so
// every matching emit wakes immediately (one summon per event). The grep proof in the task report shows
// this file holds no `std::time` / `Instant` / `Duration` / `sleep` / `SystemTime` anywhere in code.
//
// THE CHAIN IS THE TRUTH, even for liveness. Every subscribe stamps a `subscription-registered` fact on
// the subscriber's reel; every cancel stamps `subscription-cancelled`. The in-memory registry is a CACHE
// — a projection of those facts. `rehydrate_from_facts` folds a being's reel (or the whole store at boot)
// to rebuild it. Same doctrine as the inbox FIFO: a projection, never the source.
//
// COMPOSE, don't rebuild: the wake routes through `scheduler::wake` (the Phase-1 serial-per-being loop);
// the registry rows fold from the SAME `subscription-*` facts treefold/treestore already store. The only
// NEW host code is this registry + the match + the emit hook.

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use treehash::Json;

use crate::scheduler::Entry;

// ── Json helpers (treehash::Json, the spine's value) ─────────────────────────
fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn get_str<'a>(v: &'a Json, k: &str) -> Option<&'a str> {
    match get(v, k) {
        Some(Json::Str(s)) => Some(s.as_str()),
        _ => None,
    }
}

/// One live subscription — a being's standing attention. `event` is the hook/act name watched; `scope`
/// is WHERE (everywhere, or an exact spaceId); `filter` is a payload-field equality map. `priority` is
/// the SUMMON priority the eventual wake rides (HUMAN/GATEWAY/INTERACTIVE/BACKGROUND), defaulted
/// BACKGROUND, and folded to a numeric rank by treesecondary::priority_rank_of on the drain. NO clock.
#[derive(Debug, Clone)]
pub struct Subscription {
    pub id: String,
    pub being_id: String,
    pub history: String,
    pub event: String,
    pub scope: Scope,
    /// payload-field equality (key -> required value). Empty = match all.
    pub filter: Vec<(String, Json)>,
    pub priority: String,
}

/// WHERE a subscription's attention reaches. `Everywhere` matches any space; `Space(id)` matches an exact
/// spaceId on the triggering fact. `Ancestor(id)` (the JS scope.ancestor) needs an ancestor-chain read —
/// an IMPURE space-lineage walk that is NOT a pure fact-fold — so it is carried verbatim and matched only
/// when the caller supplies the resolved ancestor set (parity with the JS getAncestorChain seam).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Scope {
    Everywhere,
    Space(String),
    Ancestor(String),
}

impl Scope {
    fn from_json(scope: &Json) -> Option<Scope> {
        if matches!(get(scope, "everywhere"), Some(Json::Bool(true))) {
            return Some(Scope::Everywhere);
        }
        if let Some(s) = get_str(scope, "spaceId") {
            return Some(Scope::Space(s.to_string()));
        }
        if let Some(a) = get_str(scope, "ancestor") {
            return Some(Scope::Ancestor(a.to_string()));
        }
        None
    }
}

/// The shared registry — every live subscription by id, behind one Mutex. A projection of the
/// `subscription-*` facts (the chain is the truth); event-time match scans the `by_event` index.
struct Registry {
    /// subscriptionId -> the live entry.
    index: HashMap<String, Subscription>,
    /// event-name -> the set of subscriptionIds watching it (fast event-time lookup).
    by_event: HashMap<String, Vec<String>>,
}

fn registry() -> &'static Mutex<Registry> {
    static R: OnceLock<Mutex<Registry>> = OnceLock::new();
    R.get_or_init(|| {
        Mutex::new(Registry {
            index: HashMap::new(),
            by_event: HashMap::new(),
        })
    })
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ── registry mutation (the projection's update; mirrors _addRegistryEntry/_dropRegistryEntry) ────────

fn add_entry(reg: &mut Registry, sub: Subscription) {
    let id = sub.id.clone();
    let event = sub.event.clone();
    // idempotent re-register: drop any prior index/by_event slot for this id first.
    drop_entry(reg, &id);
    reg.by_event.entry(event).or_default().push(id.clone());
    reg.index.insert(id, sub);
}

fn drop_entry(reg: &mut Registry, id: &str) -> bool {
    let entry = match reg.index.remove(id) {
        Some(e) => e,
        None => return false,
    };
    if let Some(ids) = reg.by_event.get_mut(&entry.event) {
        ids.retain(|x| x != id);
        if ids.is_empty() {
            reg.by_event.remove(&entry.event);
        }
    }
    true
}

/// Drop everything (boot / tests). A pure cache reset, no clock.
pub fn reset_all() {
    let mut reg = lock(registry());
    reg.index.clear();
    reg.by_event.clear();
}

/// A diagnostic count (tests/observability). No clock.
pub fn stats() -> (usize, usize) {
    let reg = lock(registry());
    (reg.index.len(), reg.by_event.len())
}

// ── reading a subscription off a fact ────────────────────────────────────────

/// Build a `Subscription` from a `subscription-registered` fact (the durable record). The fact targets
/// the being's own reel (`of:{kind:"being", id}`), and its `params` carry the subscription shape. Returns
/// None when the fact is not a well-formed registration. Mirrors the JS `_entryFromFact`.
fn subscription_from_fact(fact: &Json) -> Option<Subscription> {
    let params = get(fact, "params")?;
    let id = get_str(params, "subscriptionId")?.to_string();
    // the subscriber being = the fact's object (of:{kind:"being", id}).
    let being_id = match get(fact, "of") {
        Some(of) if get_str(of, "kind") == Some("being") => get_str(of, "id")?.to_string(),
        _ => return None,
    };
    let event = get_str(params, "event")?.to_string();
    let scope = Scope::from_json(get(params, "scope")?)?;
    let filter = match get(params, "filter") {
        Some(Json::Obj(e)) => e.clone(),
        _ => Vec::new(),
    };
    let priority = get_str(params, "priority").unwrap_or("BACKGROUND").to_string();
    let history = get_str(fact, "history").unwrap_or("0").to_string();
    Some(Subscription {
        id,
        being_id,
        history,
        event,
        scope,
        filter,
        priority,
    })
}

/// Is this fact a subscription-registry fact (verb:"do", act in {registered, cancelled})? The registry
/// folds ONLY these; everything else flows past.
fn registry_act(fact: &Json) -> Option<&str> {
    if get_str(fact, "verb") != Some("do") {
        return None;
    }
    match get_str(fact, "act") {
        Some(a @ ("subscription-registered" | "subscription-cancelled")) => Some(a),
        _ => None,
    }
}

/// Apply ONE subscription-registry fact to the live registry (the projection's incremental update). A
/// `subscription-registered` adds/replaces the entry; a `subscription-cancelled` drops it by id. Returns
/// true when the registry changed. Used both by rehydrate (replaying a reel) and by the live emit hook
/// (so a subscribe/cancel that just sealed is visible to the very next emit). CLOCK-FREE.
pub fn apply_fact(fact: &Json) -> bool {
    let act = match registry_act(fact) {
        Some(a) => a,
        None => return false,
    };
    let mut reg = lock(registry());
    match act {
        "subscription-registered" => match subscription_from_fact(fact) {
            Some(sub) => {
                add_entry(&mut reg, sub);
                true
            }
            None => false,
        },
        "subscription-cancelled" => {
            let id = get(fact, "params")
                .and_then(|p| get_str(p, "subscriptionId"))
                .map(|s| s.to_string());
            match id {
                Some(id) => drop_entry(&mut reg, &id),
                None => false,
            }
        }
        _ => false,
    }
}

/// REHYDRATE liveness from a being's reel. Folds the being's `subscription-*` facts in chain order so the
/// last-write-wins (a register then a cancel => gone). The CHAIN IS THE TRUTH; this is its projector. The
/// caller passes the being's facts (read via treestore::read_reel_file) — for boot, sweep every being.
/// Returns the count of live subscriptions restored from this reel. CLOCK-FREE (chain order, no clock).
pub fn rehydrate_from_facts(facts: &[Json]) -> usize {
    let before = lock(registry()).index.len();
    for fact in facts {
        apply_fact(fact);
    }
    let after = lock(registry()).index.len();
    // the net restored for this reel (a count, never negative; a net cancel yields 0).
    after.saturating_sub(before)
}

/// BOOT REHYDRATE: rebuild the whole registry from the store. Sweeps every BEING reel (subscription facts
/// target the being's own reel, `of:{kind:"being", id}`), reads it in chain order, and folds its
/// `subscription-*` facts. The CHAIN IS THE TRUTH; the registry is its boot-time projection. Resets first
/// so a re-boot is idempotent. Returns the count of live subscriptions restored. CLOCK-FREE (chain order).
pub fn rehydrate_at_boot(root: &Path) -> usize {
    reset_all();
    for (history, kind, id) in crate::chain::list_reels(root) {
        if kind != "being" {
            continue;
        }
        let facts = treestore::read_reel_file(root, &history, &kind, &id, None, None);
        for fact in &facts {
            apply_fact(fact);
        }
    }
    lock(registry()).index.len()
}

// ── the EMIT match (event-time dispatch) ─────────────────────────────────────

/// JS-truthy equality for a filter check (string/number/bool compare by value).
fn json_eq(a: &Json, b: &Json) -> bool {
    treehash::canonicalize(a) == treehash::canonicalize(b)
}

/// Does `payload` satisfy a subscription's filter (every key equals, or any-of when the required value is
/// an array)? Mirrors the JS `_matchesFilter`. An empty filter matches everything.
fn matches_filter(filter: &[(String, Json)], payload: &Json) -> bool {
    for (key, expected) in filter {
        let actual = get(payload, key);
        match expected {
            Json::Arr(opts) => {
                let hit = actual.map(|a| opts.iter().any(|o| json_eq(o, a))).unwrap_or(false);
                if !hit {
                    return false;
                }
            }
            _ => match actual {
                Some(a) if json_eq(expected, a) => {}
                _ => return false,
            },
        }
    }
    true
}

/// For an incoming event + its payload, return the matching subscriptions (the wake list). Walks the
/// `by_event` index (O(matches)). `ancestor_set`, when supplied, is the resolved ancestor-chain id set for
/// the payload's space (the IMPURE getAncestorChain read the caller does) — `Scope::Ancestor(a)` matches
/// when `a` is in that set. With no ancestor set, ancestor-scoped subs simply do not match (parity with
/// the JS, which needs the chain to decide). CLOCK-FREE — a pure index scan.
pub fn matching(event: &str, payload: &Json, ancestor_set: Option<&[String]>) -> Vec<Subscription> {
    let reg = lock(registry());
    let ids = match reg.by_event.get(event) {
        Some(v) => v,
        None => return Vec::new(),
    };
    let space = get_str(payload, "spaceId");
    let mut out = Vec::new();
    for id in ids {
        let sub = match reg.index.get(id) {
            Some(s) => s,
            None => continue,
        };
        if !matches_filter(&sub.filter, payload) {
            continue;
        }
        let scope_ok = match &sub.scope {
            Scope::Everywhere => true,
            Scope::Space(sid) => space == Some(sid.as_str()),
            Scope::Ancestor(aid) => ancestor_set
                .map(|set| set.iter().any(|x| x == aid))
                .unwrap_or(false),
        };
        if scope_ok {
            out.push(sub.clone());
        }
    }
    out
}

// ── THE EMIT HOOK (ord-driven wake) ──────────────────────────────────────────

/// The payload a sealed fact presents to subscriptions. The fact's `act` IS the event name (the watched
/// hook); `spaceId` is the affected reel id when the fact targets a space, else the actor's space. The
/// payload fields the JS hook put on (action/value/field/target) ride through so a filter can read them.
/// CLOCK-FREE: no `timestamp` is synthesized (the JS hook minted a wall-clock here; we drop it — the
/// fact's own ord is the order, and a filter never needs a clock).
fn fact_payload(fact: &Json) -> (String, Json) {
    let event = get_str(fact, "act").unwrap_or("").to_string();
    let mut fields: Vec<(String, Json)> = Vec::new();
    // the affected space: a fact whose `of` is a space targets that space directly.
    if let Some(of) = get(fact, "of") {
        if get_str(of, "kind") == Some("space") {
            if let Some(id) = get_str(of, "id") {
                fields.push(("spaceId".to_string(), Json::Str(id.to_string())));
            }
        }
    }
    // the actor (who fired the write) -> actorBeingId, so a self-wake able can tell "I caused this".
    if let Some(t) = get_str(fact, "through") {
        fields.push(("actorBeingId".to_string(), Json::Str(t.to_string())));
    }
    // surface the act + the written field/value (the JS afterQualityWrite inline read) so a filter on a
    // quality/field can match without folding the target.
    fields.push(("action".to_string(), Json::Str(event.clone())));
    if let Some(params) = get(fact, "params") {
        if let Some(field) = get_str(params, "field") {
            fields.push(("field".to_string(), Json::Str(field.to_string())));
        }
        if let Some(value) = get(params, "value") {
            fields.push(("value".to_string(), value.clone()));
        }
    }
    // the triggering fact's append ord — the wake's basis (the moment the subscriber perceives FROM).
    if let Some(Json::Num(o)) = get(fact, "ord") {
        fields.push(("ord".to_string(), Json::Num(*o)));
    }
    (event, Json::Obj(fields))
}

/// THE EMIT HOOK. After an act seals a fact, look up its subscribers and WAKE each — ORD-DRIVEN: the wake
/// fires off the fact's append ord (carried as the entry's `basis`, the staleness origin), NO timer, NO
/// clock, NO sleep. Also folds any `subscription-*` fact into the registry FIRST (so a subscribe that just
/// landed is live for the very next emit, and a same-burst register-then-emit sees itself). Each wake is a
/// SELF-WAKE: the subscribing being is summoned with a synthetic `subscribed` event carrying the trigger
/// payload (its able's `When subscribed:` flow decides whether to act). The original DO actor rides the
/// payload as `actorBeingId`. Returns the count of beings woken.
///
/// `wake` is the scheduler entry (injected so tests can capture wakes without spawning the run-loop). The
/// production path passes `scheduler::wake` (the async serial-per-being loop) — see `emit_facts`.
pub fn emit_for_fact<W: FnMut(&str, Entry)>(fact: &Json, mut wake: W) -> usize {
    // keep the registry current with any subscribe/cancel that this very fact represents.
    apply_fact(fact);

    let (event, payload) = fact_payload(fact);
    if event.is_empty() {
        return 0;
    }
    let basis = match get(&payload, "ord") {
        Some(Json::Num(o)) => Some(*o),
        _ => None,
    };
    let actor = get_str(fact, "through").map(|s| s.to_string());

    // ancestor resolution is the impure space-lineage read; the in-process hook has no ancestor seam yet
    // (everywhere + exact-space cover the runtime cases), so ancestor-scoped subs wait for that wiring.
    let matches = matching(&event, &payload, None);
    let mut woke = 0;
    for sub in matches {
        // SELF-WAKE: the subscriber summons itself. correlation names this exchange (a fresh id per wake
        // so each is its own inbox row). The event clause the able's flow matches is "subscribed"; the
        // trigger payload rides as the entry payload (actorBeingId / spaceId / field / value).
        let correlation = format!("sub:{}:{}", sub.id, basis.map(|b| b as i64).unwrap_or(0));
        let entry = Entry {
            correlation,
            from: actor.clone(),
            able: None,
            space: match &sub.scope {
                Scope::Space(s) => Some(s.clone()),
                _ => get_str(&payload, "spaceId").map(|s| s.to_string()),
            },
            event: Some("subscribed".to_string()),
            payload: Some(payload.clone()),
            // the wake lands on the SUBSCRIPTION's history (its declared lane); the trigger's history is
            // available for cross-lane diagnostics but cross-history waking is not opened here.
            history: sub.history.clone(),
            basis, // ORD-DRIVEN: the wake's basis IS the triggering fact's append ord. NO clock.
            prev: None,
            flows: None,
            // the subscription's declared priority rides the wake; the drain ranks by it (count sort).
            priority: Some(sub.priority.clone()),
        };
        wake(&sub.being_id, entry);
        woke += 1;
    }
    woke
}

/// The production emit: wake each subscriber on the Phase-1 SERIAL-PER-BEING run-loop (async, parallel
/// across beings). Composes `emit_for_fact` over `scheduler::wake`. ORD-DRIVEN, NO clock. Called by the
/// act seam (act.rs) after every sealed fact.
pub fn emit_facts(facts: &[Json], root: &Path) {
    let root_buf = root.to_path_buf();
    for fact in facts {
        emit_for_fact(fact, |being, entry| {
            crate::scheduler::wake(being, entry, &root_buf);
        });
    }
}
