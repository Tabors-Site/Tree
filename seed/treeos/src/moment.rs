// moment.rs — the FOUR-BEAT MOMENT CONDUCTOR (Phase 1 of the present-loop runtime). One moment = one
// being perceiving, deciding a Word, and (maybe) sealing it. The conductor NEVER throws: every rail
// failure becomes a `Cognition::Failure`, so the run-loop that drives it can always advance to the next
// inbox entry. It is CLOCK-FREE end to end — nothing here reads a wall-clock to decide anything; the
// only ord it touches is the world's APPEND ord (a count, the act's causal basis), never seconds.
//
// The four beats (the JS conductor's shape, re-folded at moment-time — NO projection-cache dependency):
//
//   1. ASSIGN  — read the being + its space from the reels (treestore::read_reel_file + treefold::fold),
//                resolve the being's ACTIVE able, and MINT the moment's actId (treehash::act_id over the
//                act opening, the same content_of_act the chain hashes). The actId names this perception.
//   2. FOLD    — mount the inner-FACE the being decides over: its folded being-state, its space-state, the
//                summon's event/payload (so a scripted `When event:` trigger can fire), and the active
//                able. The face is opaque Json the deciders read by cond-path only.
//   3. MOMENTUM— hand the face to `treecognition::cognize::decide` -> a `Cognition` (Act / See / Failure).
//                The deciders live in treecognition (pure); we only supply the seams (host, transport).
//   4. SEAL    — if Act: stamp the ONE decided Word through the same act path /word uses (act::run_word
//                -> treeibp::act -> treestore::commit_moment), one fact, the being's reel advances. If
//                See or Failure: NO act row, NO trace — the moment ran to completion and the inbox closes.
//
// COMPOSE, don't rebuild: treecognition (decide), treeibp (act/fold_word_able), treefold (fold),
// treestore (read_reel_file/read_ord). The only NEW host code in the runtime is this conductor + the
// scheduler shell; the decisions and the acts they drive are Word.

use std::path::Path;

use treecognition::cognize::{self, Mode};
use treecognition::{Cognition, FailShape};
use treehash::Json;

use crate::scheduler::Entry;

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
fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn obj(f: Vec<(&str, Json)>) -> Json {
    Json::Obj(f.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

/// What one moment produced. `decision` is the cognition outcome (Act/See/Failure); `act_id` names the
/// perception; `facts` are the rows the SEAL stamped (one for an Act, none for See/Failure). The
/// run-loop logs this and moves to the next inbox entry; nothing here is time-stamped.
#[derive(Debug)]
pub struct MomentReport {
    pub being_id: String,
    pub act_id: String,
    pub mode: String,
    pub decision: Cognition,
    /// the stamped fact rows (act outcomes serialized), empty unless the being acted.
    pub facts: Vec<Json>,
}

impl MomentReport {
    pub fn acted(&self) -> bool {
        matches!(self.decision, Cognition::Act { .. })
    }
    /// A compact wire/log view of the moment (no wall-clock anywhere).
    pub fn view(&self) -> Json {
        let mut fields: Vec<(String, Json)> = vec![
            ("being".to_string(), jstr(&self.being_id)),
            ("actId".to_string(), jstr(&self.act_id)),
            ("mode".to_string(), jstr(&self.mode)),
        ];
        match &self.decision {
            Cognition::Act { content } => {
                fields.push(("decided".to_string(), jstr("act")));
                fields.push(("word".to_string(), jstr(content)));
            }
            Cognition::See => fields.push(("decided".to_string(), jstr("see"))),
            Cognition::Failure { shape, reason } => {
                fields.push(("decided".to_string(), jstr("failure")));
                fields.push(("shape".to_string(), jstr(&format!("{shape:?}").to_lowercase())));
                fields.push(("reason".to_string(), jstr(reason)));
            }
        }
        if self.acted() {
            fields.push(("facts".to_string(), Json::Arr(self.facts.clone())));
        }
        Json::Obj(fields)
    }
}

/// Run ONE moment for a being, the four-beat conductor. NEVER panics: a missing reel, an unresolvable
/// able, a bad face — each lands as a `Cognition::Failure`, never an unwind. `entry` is the summon that
/// woke the being (it carries the event/payload that the face exposes to the deciders).
pub fn run_moment(being_id: &str, entry: &Entry, root: &Path) -> MomentReport {
    let ables_dir = crate::config::ables_dir();
    let ables_dir = ables_dir.as_path();

    // ── 1. ASSIGN ────────────────────────────────────────────────────────────
    // Re-fold the being + its space AT MOMENT-TIME from the reels (no projection-cache dependency).
    let being_state = read_fold(root, &entry.history, "being", being_id);
    // the being's ACTIVE able names which `.word` cognition vocabulary decides this moment.
    let able = entry
        .able
        .clone()
        .or_else(|| active_able(&being_state))
        .unwrap_or_else(|| "default".to_string());
    let space_id = entry
        .space
        .clone()
        .or_else(|| space_of(&being_state))
        .unwrap_or_default();
    let space_state = if space_id.is_empty() {
        Json::Null
    } else {
        read_fold(root, &entry.history, "space", &space_id)
    };

    // the actor identity (the LEFT Name that acts) — the being signs its own acts client-side; here the
    // actor is the being id (only `I` is custodially signed at the edge, in act::run_word).
    let actor = obj(vec![("beingId", jstr(being_id)), ("nameId", jstr(being_id))]);

    // MINT the actId: hash the act opening (treehash::content_of_act over through/activeAble/history),
    // the SAME content the chain hashes for an act. prev = the being's last act-chain head if known,
    // else genesis "0" (the actId NAMES the perception; the sealed fact mints its own chain id).
    let opening = obj(vec![
        ("through", jstr(being_id)),
        ("activeAble", jstr(&able)),
        ("history", jstr(&entry.history)),
    ]);
    let act_id = treehash::act_id(entry.prev.as_deref().unwrap_or("0"), &opening);

    // ── 2. FOLD (mount the inner-face) ──────────────────────────────────────
    // the able's folded SPEC (cognition mode + granted vocabulary) and its parsed `.word` flows.
    let spec = treeibp::fold_word_able(&able, ables_dir).unwrap_or(Json::Null);
    // the able's flows: supplied on the entry (an embedder/test seam) else parsed from its `.word` file.
    // The override is a convenience seam (a test can inject a pre-built decision); the FILE path is the
    // real one — treeword now round-trips a parameterized flow deed (`do makespace on the space <ref>
    // with { name, type }`), so a being's own `.word` flow decides AND seals end to end. The four beats +
    // the real `cognize::decide` + the real `act::run_word` SEAL are identical for both.
    let flows = entry.flows.clone().unwrap_or_else(|| {
        std::fs::read_to_string(ables_dir.join(format!("{able}.word")))
            .map(|t| treeword::parse(&t))
            .unwrap_or_default()
    });
    let mode = format!("{:?}", cognize::mode_of(&spec)).to_lowercase();

    let face = build_face(being_id, &being_state, &space_state, &able, entry);
    let identity = build_identity(being_id, &able, &space_id);

    // ── 3. MOMENTUM (decide) ────────────────────────────────────────────────
    // fail-closed domain predicates (the scripted see-op host is a later wiring); the LLM transport is
    // refused in the loop for Phase 1 (no native HTTPS here) — a Default/Scripted being decides without
    // either. Both seams stay so an LLM being routes cleanly to a clean Failure, never a panic.
    let host = |_: &str, _: &[Json]| false;
    let transport = |_: &str| -> Result<String, (FailShape, String)> {
        Err((
            FailShape::Internal,
            "llm mode is not wired into the Phase-1 present-loop (no native transport in the runtime yet)".to_string(),
        ))
    };

    // Default mode has no autonomous decider (the act arrives from the wire) — surface that plainly so a
    // summoned Default being is a clean See, not a silent no-op.
    let decision = if cognize::mode_of(&spec) == Mode::Default && able == "default" {
        Cognition::See
    } else {
        cognize::decide(&spec, &flows, &face, &identity, &host, &transport)
    };

    // ── 4. SEAL ─────────────────────────────────────────────────────────────
    // on Act -> stamp the ONE Word through the act path (act::run_word -> treeibp::act_via_fold ->
    // treestore::commit_moment), one fact, the being's reel advances. run_word wires the SAME op-word
    // loader genesis uses (op_word_file + op_word_via_fold) AND derive_trigger's literal-ref recovery, so
    // a scripted flow deed `do <op> on the <noun> <ref> with {...}` (a bare name-ref, no resolved id)
    // RESOLVES its op-word + its `{ref}` target and stamps the ENRICHED fact — not just a render. on
    // See/Failure -> no row, no trace. A seal RAIL failure (the decision was sound, the chain refused)
    // downgrades to a Failure — still never a panic.
    let (decision, facts) = match &decision {
        Cognition::Act { content } => {
            let outcomes = crate::act::run_word(content, &actor, root, &entry.history, entry.basis);
            let denied: Vec<String> = outcomes
                .iter()
                .filter_map(|o| match o {
                    treeibp::Outcome::Denied(r) => Some(r.clone()),
                    _ => None,
                })
                .collect();
            let rows: Vec<Json> = outcomes.iter().map(crate::act::outcome_json).collect();
            if outcomes.is_empty() || !denied.is_empty() {
                // the Word produced nothing, or a deed was denied -> the seal rail refused.
                (
                    Cognition::Failure {
                        shape: FailShape::Internal,
                        reason: if denied.is_empty() {
                            format!("the decided Word stamped no fact: {content}")
                        } else {
                            format!("act denied: {}", denied.join("; "))
                        },
                    },
                    rows,
                )
            } else {
                (decision.clone(), rows)
            }
        }
        // See / Failure pass through untouched — nothing to seal.
        other => ((*other).clone(), Vec::new()),
    };

    MomentReport {
        being_id: being_id.to_string(),
        act_id,
        mode,
        decision,
        facts,
    }
}

/// Read a reel + fold it AT MOMENT-TIME (no .proj cache). A missing/empty reel folds to whatever the
/// kind's reducer yields for no facts (never panics).
fn read_fold(root: &Path, history: &str, kind: &str, id: &str) -> Json {
    let facts = treestore::read_reel_file(root, history, kind, id, None, None);
    treefold::fold(kind, &facts)
}

/// The being's active able from its folded state (`qualities.activeAble`), if any.
fn active_able(being_state: &Json) -> Option<String> {
    get(being_state, "qualities")
        .and_then(|q| get_str(q, "activeAble"))
        .map(|s| s.to_string())
}

/// The being's space (its current position's space) from its folded state, if any.
fn space_of(being_state: &Json) -> Option<String> {
    // position may carry spaceId directly, or qualities.position.spaceId
    if let Some(p) = get(being_state, "position") {
        if let Some(sp) = get_str(p, "spaceId") {
            return Some(sp.to_string());
        }
    }
    get(being_state, "qualities")
        .and_then(|q| get(q, "position"))
        .and_then(|p| get_str(p, "spaceId"))
        .map(|s| s.to_string())
}

/// Mount the inner-FACE the deciders read. Opaque Json, read by cond-PATH only — and the cond resolver's
/// `get_path` resolves a head under `state` / `bindings` / `beings`, so the scripted decision dimensions
/// (the summon's EVENT, the being's running qualities) live under `state`. The folded being/space states
/// ride alongside for richer faces. The summon's EVENT/PAYLOAD make a `When event:` scripted trigger fire
/// on the wake. NO wall-clock anywhere in the face.
fn build_face(being_id: &str, being: &Json, space: &Json, able: &str, entry: &Entry) -> Json {
    // `state` = the dimensions the scripted When-triggers read (get_path looks here). Seed it with the
    // being's folded qualities (its running state) so a `When it is X` flow can read a quality, then add
    // the summon's event clause so a `When <event>:` flow fires.
    let mut state_fields: Vec<(String, Json)> = match get(being, "qualities") {
        Some(Json::Obj(q)) => q.clone(),
        _ => Vec::new(),
    };
    if let Some(ev) = &entry.event {
        state_fields.push(("event".to_string(), jstr(ev)));
    }
    let state = Json::Obj(state_fields);

    let mut fields = vec![
        ("state", state),
        ("being", being.clone()),
        ("space", space.clone()),
        ("able", jstr(able)),
        ("position", obj(vec![("name", jstr(being_id))])),
    ];
    if let Some(p) = &entry.payload {
        fields.push(("payload", p.clone()));
    }
    if let Some(from) = &entry.from {
        fields.push(("summonedBy", jstr(from)));
    }
    obj(fields)
}

/// The llm prompt identity `{name, able, space}` (only consulted in llm mode; harmless otherwise).
fn build_identity(being_id: &str, able: &str, space_id: &str) -> Json {
    obj(vec![
        ("name", jstr(being_id)),
        ("able", jstr(able)),
        ("space", jstr(space_id)),
    ])
}
