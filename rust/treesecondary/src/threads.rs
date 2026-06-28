// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// ThreadsProjection - the PURE FOLD of seed/past/projections/threads/
// threadsProjectionFold.js. One row per live coordination root, keyed by
// params.rootCorrelation (falling back to params.correlation). Two events:
//
//   call fact   -> upsert row keyed by rootCorrelation: bump the order key
//                  `ord` (fact.ord ?? params.ord) + the inert lastAct/updatedAt
//                  witnesses; $addToSet the summoner (fact.through) and the
//                  recipient (of.id) into participants; set parentThread when
//                  present; set startedAt/createdAt on first insert.
//   act seal    -> noteActSealOnThread(root, {ord, at}): bump `ord` (the order
//                  key) to the answering act's ord; set lastAct/updatedAt to the
//                  act's inert seal-time witness. No-op when the seal carried
//                  neither (no synthetic fallback).
//
// This whole projection IS a pure fact-fold: (existing_row, fact) -> new_row.
// Unlike inbox/position there is no live cross-reel guard; the upsert just folds
// the touching fact onto the row. So both events port cleanly here, taking the
// PRIOR row (None on first touch) and returning the next row.
//
// PURE / clock-free: `ord` is the order key the thread reader sorts on;
// lastAct/updatedAt/startedAt/createdAt are INERT display witnesses (the fact's
// or act's own seal-time), never sorted/compared/folded.

use crate::value as v;
use crate::value::{Json, RowBuilder};

/// The thread's root key: params.rootCorrelation || params.correlation. None when
/// neither is present (handleSummonForThreads returns early).
pub fn thread_root(fact: &Json) -> Option<String> {
    let params = v::params(fact);
    if let Some(r) = v::str_of(&params, "rootCorrelation") {
        if !r.is_empty() {
            return Some(r.to_string());
        }
    }
    if let Some(c) = v::str_of(&params, "correlation") {
        if !c.is_empty() {
            return Some(c.to_string());
        }
    }
    None
}

/// threads_fold_call: handleSummonForThreads as a PURE (prior_row, fact) -> row.
///
/// Returns Some(row) when `fact` is a `call` carrying a root (rootCorrelation ||
/// correlation); None otherwise (the early returns). `prior` is the existing
/// ThreadsProjection row for this root, or None on first touch (the $setOnInsert
/// path). The returned row's keys follow the JS order: on insert `_id, ord,
/// lastAct, updatedAt, [parentThread], startedAt, createdAt, participants`; on a
/// later touch the prior row's key order is preserved and ord/lastAct/updatedAt
/// (and parentThread when newly present) are overwritten in place, participants
/// extended.
pub fn threads_fold_call(prior: Option<&Json>, fact: &Json) -> Option<Json> {
    if !matches!(v::str_of(fact, "verb"), Some("call")) {
        return None;
    }
    let root = thread_root(fact)?;
    let params = v::params(fact);

    // Participants: summoner (through) + recipient (of.id), in that add order.
    let mut participants: Vec<String> = Vec::new();
    if let Some(t) = v::str_of(fact, "through") {
        participants.push(t.to_string());
    }
    if let Some((kind, id)) = v::of_ref(fact) {
        if kind == "being" {
            participants.push(id);
        }
    }

    // ORDER KEY (clock-free): fact.ord ?? params.ord ?? null.
    let ord = ord_of(fact, &params);
    // INERT display witness only: fact.date ?? null.
    let witness = v::nullish(v::get(fact, "date"), Json::Null);
    let parent_thread = match v::str_of(&params, "parentThread") {
        Some(p) if !p.is_empty() => Some(Json::Str(p.to_string())),
        _ => None,
    };

    match prior {
        None => {
            // First insert: seed _id, then $set keys, then parentThread (only when
            // present), then $setOnInsert (startedAt, createdAt), then $addToSet.
            let row = RowBuilder::new()
                .put("_id", Json::Str(root))
                .put("ord", ord)
                .put("lastAct", witness.clone())
                .put("updatedAt", witness.clone())
                .put_opt("parentThread", parent_thread)
                .put("startedAt", witness.clone())
                .put("createdAt", witness)
                .build();
            let row = v::add_to_set(&row, "participants", &participants);
            Some(row)
        }
        Some(existing) => {
            // Later touch: overwrite ord/lastAct/updatedAt in place; set
            // parentThread when newly carried; extend participants. $setOnInsert
            // keys are NOT touched (only set on insert).
            let mut row = v::obj_set(existing, "ord", ord);
            row = v::obj_set(&row, "lastAct", witness.clone());
            row = v::obj_set(&row, "updatedAt", witness);
            if let Some(pt) = parent_thread {
                row = v::obj_set(&row, "parentThread", pt);
            }
            row = v::add_to_set(&row, "participants", &participants);
            Some(row)
        }
    }
}

/// threads_note_act_seal: noteActSealOnThread(root, {ord, at}) as a PURE
/// (prior_row, ord, at) -> row. The answering act's seal re-activates the thread
/// at its append ordinal: bump `ord` (only when the seal carried one - no
/// synthetic fallback) and set the inert lastAct/updatedAt witnesses (only when
/// the seal carried `at`). Returns None when the prior row is absent (the JS
/// updateOne with no upsert is a no-op on a missing row) OR when neither ord nor
/// at was supplied (the `if Object.keys(set).length === 0 return` short-circuit).
///
/// `ord` / `at` are Json::Null when the seal omitted them.
pub fn threads_note_act_seal(prior: Option<&Json>, ord: &Json, at: &Json) -> Option<Json> {
    let has_ord = !matches!(ord, Json::Null);
    let has_at = !matches!(at, Json::Null);
    if !has_ord && !has_at {
        return None; // empty $set: the JS returns without writing
    }
    let existing = prior?; // no upsert: a missing row is a no-op
    let mut row = existing.clone();
    if has_ord {
        row = v::obj_set(&row, "ord", ord.clone());
    }
    if has_at {
        row = v::obj_set(&row, "lastAct", at.clone());
        row = v::obj_set(&row, "updatedAt", at.clone());
    }
    Some(row)
}

/// `fact.ord ?? params.ord ?? null`.
fn ord_of(fact: &Json, params: &Json) -> Json {
    if let Some(o) = v::get(fact, "ord") {
        if !matches!(o, Json::Null) {
            return o.clone();
        }
    }
    if let Some(o) = v::get(params, "ord") {
        if !matches!(o, Json::Null) {
            return o.clone();
        }
    }
    Json::Null
}
