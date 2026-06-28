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
use crate::recover::{recover_act_before_commit, recover_reel_before_commit};
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

    // 0. PAIR-CHECK / SELF-HEAL (no journal, Cor 7.1). A torn prior moment may have left an ORPHAN: a
    //    line whose head never advanced (a fact whose act never committed, or an act whose fact never
    //    landed). Before writing fresh, the recovery drops any orphan tail PAST the committed head of
    //    the act-chain AND every target reel: the crashed moment leaves zero trace. A clean store is
    //    untouched (byte-identical). The seal below re-derives seq/p from these committed heads, so the
    //    fresh fact overwrites the orphan FORWARD. A committed fact is never touched. This must precede
    //    the appends so an orphan can never survive a successful next commit.
    recover_act_before_commit(root, story, history, by)?;
    for s in &specs {
        recover_reel_before_commit(root, s.history, s.kind, s.id)?;
    }

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

/// commit_moment, but SIGNED. The doctrine-correct seal for genesis + the act path: the same act-first
/// stamp as `commit_moment`, with the seal's signature attached to the act BEFORE it lands. The act-sig
/// commits to the act's identity AND the committed factIds, so neither the act nor its facts can be
/// swapped after the seal (`seed/past/act/actSig.js`).
///
/// treestore stays ZERO-CRYPTO: the signing lives entirely in the caller's `sign` closure (treesign is
/// the test crate's dev-dep, never treestore's). `sign(act_opening, fact_ids)` receives the FULLY STAMPED
/// act opening (with its `_id` + chain `p`) and the committed factIds, and returns the `sig` subdoc
/// (`{alg, by, value}`) that rides the act row as a closure field, OUTSIDE `content_of_act` (so it never
/// changes `act._id`). The factIds are passed in seal order; the canonical payload builder sorts them.
///
/// ACT-FIRST ordering, the one invariant that makes the act the moment's anchor:
///   0. PAIR-CHECK / SELF-HEAL (the same recover_*_before_commit as commit_moment).
///   1. SEAL the facts PURELY (seal_moment, no write) to learn their ids, so the signature names them.
///   2. STAMP the act (compute_act_doc), SIGN it (the closure), attach `sig`, write the SIGNED act line,
///      advance the .acthead under CAS. The act carries the signature and lands first.
///   3. WRITE the facts the seal already computed (reusing the SealedFacts, never re-sealed).
/// A run-on (the act fanned across >1 reel) is refused BEFORE the act is written, like commit_moment.
pub fn commit_moment_signed(
    root: &Path,
    act: &Json,
    ord: f64,
    sign: &dyn Fn(&Json, &[String]) -> Json,
) -> Result<Committed, CommitError> {
    let opening = strip_delta(act);
    let specs = delta_specs(act);
    if specs.is_empty() {
        return Err(CommitError::Factless); // there is no factless act: refuse before touching the chain
    }
    let by = sfield(&opening, "by");
    let story = sfield(&opening, "story");
    let history = sfield(&opening, "history");

    // 0. PAIR-CHECK / SELF-HEAL, identical to commit_moment (drop any orphan tail past the committed
    //    act-chain + reel heads, so a torn prior moment leaves zero trace; a clean store is untouched).
    recover_act_before_commit(root, story, history, by)?;
    for s in &specs {
        recover_reel_before_commit(root, s.history, s.kind, s.id)?;
    }

    // 1. SEAL THE FACTS PURELY (no write). seal_moment threads the reel heads + the moment ord and
    //    computes each fact's full doc + id; we read the ids so the act-sig can commit to them. The
    //    fanout (a run-on across >1 reel) is refused HERE, before the chain is touched: same floor as
    //    commit_moment. seal_moment only READS reel heads (via read_reel_head); the recovery above has
    //    already settled those heads, so sealing before the act write sees the same heads the post-act
    //    write would. Nothing is persisted until step 3.
    let seal = seal_moment(&specs, Some(ord), |h, k, i| read_reel_head(root, h, k, i));
    if seal.fanout {
        return Err(CommitError::RunOn(seal.reels.len()));
    }
    let sealed_ids: Vec<String> = seal
        .facts
        .iter()
        .map(|f| match &f.doc {
            Json::Obj(e) => e
                .iter()
                .find(|(k, _)| k == "_id")
                .and_then(|(_, v)| match v {
                    Json::Str(s) => Some(s.clone()),
                    _ => None,
                })
                .unwrap_or_default(),
            _ => String::new(),
        })
        .collect();

    // 2. STAMP + SIGN THE ACT, then write it FIRST. compute_act_doc gives the act its `_id` (off the
    //    chain head) and its chain link `p`; ord rides it post-id (non-digest). The closure signs over
    //    the STAMPED opening (it needs `_id` + `p` for the payload) + the sealed factIds and returns the
    //    `sig` subdoc, which is attached as a closure field (outside content_of_act, so `_id` is
    //    unchanged). The signed line is appended, then the head advances under CAS (a stale author is
    //    refused, the chain can't fork). A settled replay re-runs idempotently.
    let head = read_act_head_file(root, story, history, by);
    let stamped = compute_act_doc(&opening, &head);
    let act_doc = set(&stamped.doc, "ord", Json::Num(ord)); // ord rides the act (non-digest, post-id)
    let sig = sign(&act_doc, &sealed_ids); // the caller's crypto; treestore signs nothing itself
    let signed_act = set(&act_doc, "sig", sig); // closure field; outside the act_id hash
    append_act_line(root, story, history, by, &signed_act)?;
    match advance_act_head_file(root, story, history, by, &stamped.id, &head) {
        Ok(_) => {} // Advanced, or a settled Replay, both fine (the writes below are idempotent)
        Err(AdvanceError::ChainMoved) => return Err(CommitError::ChainMoved),
        Err(AdvanceError::Io(e)) => return Err(CommitError::Io(e)),
    }

    // 3. WRITE THE FACTS the seal already computed (reuse SealedFacts, NEVER re-sealed). The per-reel
    //    seq makes a settled replay a no-op. These are the exact facts the act's sig named in step 2.
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
