// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// commit_moment — the kernel's single stamp entry. The Word (JS, or later Rust) computes ONE act and
// hands it over with its facts inside it (`deltaF`); commit_moment owns the rest: it stamps the act on
// its Name's act-chain AND each fact on its reel, attaches one moment `ord` to all of them, and returns
// the ids. That is the act/fact divide as a single call — `they just send act`. The act's `deltaF` is
// its OUTPUT, not its identity: the act_id is hashed over the opening alone, the facts get their own
// reel ids. Composes the act-log + seal_moment + the reel write; no new storage logic.

use std::path::Path;

use treehash::Json;

use crate::act_log::{
    advance_act_head_file, append_act_line, compute_act_doc, read_act_head_file, AdvanceError,
};
use crate::commit::{seal_moment, FactSpec};
use crate::store::{read_reel_head, write_fact_doc};

/// One stamped moment: the act's id + the ids of the facts it laid. Never empty — there is no factless
/// act. An act IS a word, and a word lays a fact; an act that laid nothing never happened.
#[derive(Debug, Clone)]
pub struct Committed {
    pub act_id: String,
    pub fact_ids: Vec<String>,
}

/// commit_moment can refuse: the act laid no fact (there is no factless act), the act-chain moved under a
/// stale author (ACT_CHAIN_MOVED), the act fanned its facts across >1 reel (a run-on the no-journal floor
/// cannot tail-truncate), or the fs failed.
#[derive(Debug)]
pub enum CommitError {
    /// The act's deltaF was empty. There is no factless act — every act stamps at least one fact (its
    /// word); refuse it before it touches the chain.
    Factless,
    ChainMoved,
    RunOn(usize),
    Io(std::io::Error),
}
impl From<std::io::Error> for CommitError {
    fn from(e: std::io::Error) -> Self {
        CommitError::Io(e)
    }
}

// ── small Json readers/writers (treestore stays dependency-light; no value crate) ───────────────────

fn sfield<'a>(v: &'a Json, key: &str) -> &'a str {
    match v {
        Json::Obj(e) => e
            .iter()
            .find(|(k, _)| k == key)
            .and_then(|(_, x)| match x {
                Json::Str(s) => Some(s.as_str()),
                _ => None,
            })
            .unwrap_or(""),
        _ => "",
    }
}
fn of_field<'a>(v: &'a Json, key: &str) -> &'a str {
    match v {
        Json::Obj(e) => e
            .iter()
            .find(|(k, _)| k == "of")
            .and_then(|(_, o)| match o {
                Json::Obj(oe) => oe.iter().find(|(k, _)| k == key).and_then(|(_, x)| match x {
                    Json::Str(s) => Some(s.as_str()),
                    _ => None,
                }),
                _ => None,
            })
            .unwrap_or(""),
        _ => "",
    }
}
fn set(obj: &Json, key: &str, val: Json) -> Json {
    let mut e: Vec<(String, Json)> = match obj {
        Json::Obj(x) => x.clone(),
        _ => Vec::new(),
    };
    match e.iter_mut().find(|(k, _)| k == key) {
        Some(slot) => slot.1 = val,
        None => e.push((key.to_string(), val)),
    }
    Json::Obj(e)
}
/// The act's identity opening = the act minus its `deltaF` (the facts are output, not the act's name).
fn strip_delta(act: &Json) -> Json {
    match act {
        Json::Obj(e) => Json::Obj(e.iter().filter(|(k, _)| k != "deltaF").cloned().collect()),
        _ => act.clone(),
    }
}
/// The act's `deltaF` as fact specs (borrowing the act). Each fact's reel is (history, of.kind, of.id).
fn delta_specs(act: &Json) -> Vec<FactSpec<'_>> {
    let arr = match act {
        Json::Obj(e) => e.iter().find(|(k, _)| k == "deltaF").and_then(|(_, v)| match v {
            Json::Arr(a) => Some(a),
            _ => None,
        }),
        _ => None,
    };
    match arr {
        Some(a) => a
            .iter()
            .map(|entry| FactSpec {
                history: sfield(entry, "history"),
                kind: of_field(entry, "kind"),
                id: of_field(entry, "id"),
                spec: entry,
            })
            .collect(),
        None => Vec::new(),
    }
}

/// Stamp one act (its opening + the deltaF facts it laid) as one moment under `ord`. Returns the act id
/// and the fact ids. Refuses a factless act (every act lays at least one fact). The act-chain key is the
/// signing Name (`by`); the reels are each fact's (history, of.kind, of.id). A settled replay (the act
/// already at the head) re-runs the writes, which the per-reel seq + the .acthead CAS make no-ops.
pub fn commit_moment(root: &Path, act: &Json, ord: f64) -> Result<Committed, CommitError> {
    let opening = strip_delta(act);
    let specs = delta_specs(act);
    if specs.is_empty() {
        return Err(CommitError::Factless); // there is no factless act — refuse before touching the chain
    }
    let by = sfield(&opening, "by");
    let story = sfield(&opening, "story");
    let history = sfield(&opening, "history");

    // 1. The ACT on its Name's act-chain: content-address it off the chain head, append the line, and
    //    advance the .acthead under CAS (a stale author is refused — the chain can't fork).
    let head = read_act_head_file(root, story, history, by);
    let stamped = compute_act_doc(&opening, &head);
    let act_doc = set(&stamped.doc, "ord", Json::Num(ord)); // ord rides the act (non-digest, post-id)
    append_act_line(root, story, history, by, &act_doc)?;
    match advance_act_head_file(root, story, history, by, &stamped.id, &head) {
        Ok(_) => {} // Advanced, or a settled Replay — both fine (the writes below are idempotent)
        Err(AdvanceError::ChainMoved) => return Err(CommitError::ChainMoved),
        Err(AdvanceError::Io(e)) => return Err(CommitError::Io(e)),
    }

    // 2. The FACTS the act laid (its deltaF): seal_moment threads the reel heads + the moment ord, then
    //    write each. One act = one reel (a fan-out is the run-on the floor refuses).
    let seal = seal_moment(&specs, Some(ord), |h, k, i| read_reel_head(root, h, k, i));
    if seal.fanout {
        return Err(CommitError::RunOn(seal.reels.len()));
    }
    let mut fact_ids = Vec::with_capacity(seal.facts.len());
    for f in &seal.facts {
        let w = write_fact_doc(root, &f.history, &f.kind, &f.id, &f.doc)?;
        fact_ids.push(w.id);
    }

    Ok(Committed {
        act_id: stamped.id,
        fact_ids,
    })
}
