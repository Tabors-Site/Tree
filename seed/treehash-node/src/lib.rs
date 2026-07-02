// treehash-node — the napi FFI wrapper around the zero-dep treehash crate (Tier 1). Each function is a
// thin marshal: JSON in (a stringified JS value), the treehash primitive, a string out. seed/past/
// fact/hash.js + actHash.js delegate to these so the hottest path (every stamp's content-hash) runs in
// Rust, in-process, with NO change to the 9 callers above hash.js. The golden vectors already prove
// these match JS byte-for-byte; this just makes that the running path.
//
// #[napi] exports become camelCase in JS: compute_hash -> computeHash, etc. The treehash primitives are
// called fully-qualified (treehash::compute_hash) so the wrapper fns can share their names.

use napi_derive::napi;
use treehash::{parse, Json, GENESIS_PREV};

fn parse_arg(json: &str) -> napi::Result<Json> {
    parse(json).map_err(|e| napi::Error::from_reason(format!("treehash parse: {e}")))
}

/// `GENESIS_PREV` — the 64-zero chain root.
#[napi]
pub fn genesis_prev() -> String {
    GENESIS_PREV.to_string()
}

/// `computeHash(prev, content)` — sha256(prev + canonicalize(content)). `content` arrives as JSON text
/// (the caller's `JSON.stringify`); canonicalize sorts keys, so the stringify order is irrelevant.
#[napi]
pub fn compute_hash(prev: String, content_json: String) -> napi::Result<String> {
    Ok(treehash::compute_hash(&prev, &parse_arg(&content_json)?))
}

/// `canonicalize(value)` — the canonical-JSON twin (sorted keys, empty-object drop, ES number format).
#[napi]
pub fn canonicalize(value_json: String) -> napi::Result<String> {
    Ok(treehash::canonicalize(&parse_arg(&value_json)?))
}

/// `contentOf(fact)` — the hashable fact projection, returned as JSON text for the caller to `JSON.parse`.
#[napi]
pub fn content_of(fact_json: String) -> napi::Result<String> {
    Ok(treehash::stringify(&treehash::content_of(&parse_arg(&fact_json)?)))
}

/// `contentOfAct(act)` — the hashable act opening, returned as JSON text.
#[napi]
pub fn content_of_act(act_json: String) -> napi::Result<String> {
    Ok(treehash::stringify(&treehash::content_of_act(&parse_arg(&act_json)?)))
}

/// `computeHash(prev, contentOf(fact))` in one call — the fact's content-hash identity from a raw row.
#[napi]
pub fn fact_id(prev: String, fact_json: String) -> napi::Result<String> {
    Ok(treehash::fact_id(&prev, &parse_arg(&fact_json)?))
}

/// `computeActId(prev, act)` — the act's content-hash identity from a raw opening.
#[napi]
pub fn act_id(prev: String, act_json: String) -> napi::Result<String> {
    Ok(treehash::act_id(&prev, &parse_arg(&act_json)?))
}

/// `verifyFactChain(facts)` (Tier 3) — re-hash each fact and walk the p-links over an oldest-first
/// reel slice. `facts_json` is the caller's `JSON.stringify` of the materialized fact array; the
/// verdict comes back as JSON text for `JSON.parse`. Byte-identical to the retired verifyReel.js walk.
#[napi]
pub fn verify_fact_chain(facts_json: String) -> napi::Result<String> {
    let facts = match parse_arg(&facts_json)? {
        Json::Arr(items) => items,
        _ => return Err(napi::Error::from_reason("verifyFactChain: facts must be a JSON array")),
    };
    Ok(treehash::stringify(&treeverify::verify_fact_chain(&facts)))
}

/// `verifyFactChainFrom(facts, anchorPrev, fromSeq)` (Tier 3) — verifyReelFrom.js's anchored sibling:
/// the same fact-chain walk seeded at a DECLARED anchor (`anchorPrev`, `fromSeq`) instead of genesis,
/// for a contiguous reel SUFFIX (a partial graft). Degenerate at `(GENESIS_PREV, 1)` this equals
/// `verifyFactChain`. Verdict shape unchanged.
#[napi]
pub fn verify_fact_chain_from(facts_json: String, anchor_prev: String, from_seq: f64) -> napi::Result<String> {
    let facts = match parse_arg(&facts_json)? {
        Json::Arr(items) => items,
        _ => return Err(napi::Error::from_reason("verifyFactChainFrom: facts must be a JSON array")),
    };
    Ok(treehash::stringify(&treeverify::verify_fact_chain_from(&facts, &anchor_prev, from_seq)))
}

/// `verifyActChain(acts)` (Tier 3) — the act-chain twin: re-hash each act opening and walk the
/// p-links over an oldest-first materialized list. The head-walk I/O stays in JS; this is the pure
/// rehash verdict, byte-identical to actHash.js's retired verifyActChain walk.
#[napi]
pub fn verify_act_chain(acts_json: String) -> napi::Result<String> {
    let acts = match parse_arg(&acts_json)? {
        Json::Arr(items) => items,
        _ => return Err(napi::Error::from_reason("verifyActChain: acts must be a JSON array")),
    };
    Ok(treehash::stringify(&treeverify::verify_act_chain(&acts)))
}

/// `verifyActChainFrom(acts, anchorPrev)` (Tier 3) — verifyActChainFrom.js's anchored sibling: the
/// act-chain walk seeded at a DECLARED anchor (`anchorPrev` = the act before the segment, absent in a
/// partial graft) instead of genesis. The segment's oldest act carries `p = anchorPrev`. Degenerate at
/// `GENESIS_PREV` this equals `verifyActChain`. Verdict shape unchanged.
#[napi]
pub fn verify_act_chain_from(acts_json: String, anchor_prev: String) -> napi::Result<String> {
    let acts = match parse_arg(&acts_json)? {
        Json::Arr(items) => items,
        _ => return Err(napi::Error::from_reason("verifyActChainFrom: acts must be a JSON array")),
    };
    Ok(treehash::stringify(&treeverify::verify_act_chain_from(&acts, &anchor_prev)))
}

/// `foldFrom(kind, state, facts)` (Tier 2) — the foldEngine's pure reduce core: seed the kind's
/// reducer with `state` (the cached projection slot, or `{}` for a cold rebuild) and reduce across
/// the `facts` tail in seq order. ONE marshal per fold (state in, facts array in, folded state out),
/// not one per fact. `treefold::Json` IS `treehash::Json`, so the folded value stringifies directly.
/// Byte-identical to the retired JS `reducer.reduce`-loop (proven by the fold golden vectors + the
/// live-chain boot "world IDENTICAL" parity).
#[napi]
pub fn fold_from(kind: String, state_json: String, facts_json: String) -> napi::Result<String> {
    let state = parse_arg(&state_json)?;
    let facts = match parse_arg(&facts_json)? {
        Json::Arr(items) => items,
        _ => return Err(napi::Error::from_reason("foldFrom: facts must be a JSON array")),
    };
    Ok(treehash::stringify(&treefold::fold_from(&kind, &state, &facts)))
}

// ── Tier 4: the PROJECTION CACHE (the .proj snapshot + derived index + find* reads) ──────────────
// Unlike the pure-compute Tiers above, these ops DO FILE I/O in Rust: the `treeproj` crate reads and
// writes the SAME on-disk format the JS fileStore wrote — `reels/<history>/<kind>/<shard>/<id>.proj`
// and `index/<history>/<kind>.<facet>.json` (byte wire-compatible, ordering-preserving). EACH op
// takes the store ROOT as its first arg (the JS passes fileStore's exact root, so the files land in
// the same place) and converts it to a `Path`. A nullable slot returns `Option<String>` (napi maps
// `None` -> the JS `null`, `Some(text)` -> the JSON text the caller `JSON.parse`s). An I/O error is a
// HARD napi error (no JS fallback, exactly like the hash addon: TreeOS runs on Rust). The query LOGIC
// (lineage inheritance, tombstone shadowing, branchPoint gating, name deconfliction) stays in
// projections.js; these are the LEAF storage calls it routes to.

fn io_err(what: &str, e: std::io::Error) -> napi::Error {
    napi::Error::from_reason(format!("treeproj {what}: {e}"))
}

/// `projLoadSnapshot(root, history, kind, id)` -> the slot JSON text, or null when the snapshot is
/// absent/corrupt (fileStore.loadSnapshot). The folded-state CACHE for one (history, kind, id).
#[napi]
pub fn proj_load_snapshot(root: String, history: String, kind: String, id: String) -> Option<String> {
    treeproj::load_snapshot(std::path::Path::new(&root), &history, &kind, &id)
        .map(|slot| treehash::stringify(&slot))
}

/// `projSaveSnapshot(root, history, kind, id, slot, expectedFoldedSeq?)` -> true when written. The
/// CAS-guarded durable write (fileStore.saveSnapshot): when `expected_folded_seq` is Some it only
/// advances if the on-disk foldedSeq matches (a stale fold returns false and loses). `undefined` /
/// absent on the JS side arrives as None (no CAS — the unconditional upsert initSnapshot uses). It
/// ALSO re-buckets the derived index off the slot (save_snapshot calls update_index_from_slot), so
/// one call keeps the .proj + every facet index consistent.
#[napi]
pub fn proj_save_snapshot(
    root: String,
    history: String,
    kind: String,
    id: String,
    slot_json: String,
    expected_folded_seq: Option<f64>,
) -> napi::Result<bool> {
    let slot = parse_arg(&slot_json)?;
    treeproj::save_snapshot(
        std::path::Path::new(&root),
        &history,
        &kind,
        &id,
        &slot,
        expected_folded_seq,
    )
    .map_err(|e| io_err("projSaveSnapshot", e))
}

/// `projRefold(root, history, kind, id)` -> the slot JSON text. The cold rebuild: read the whole
/// reel, fold it to the projection state, derive {state, foldedSeq, position, tombstoned}, save the
/// snapshot (unconditional) and re-bucket the index. Rebuildable from the reel (the truth).
#[napi]
pub fn proj_refold(root: String, history: String, kind: String, id: String) -> napi::Result<String> {
    let slot = treeproj::refold(std::path::Path::new(&root), &history, &kind, &id)
        .map_err(|e| io_err("projRefold", e))?;
    Ok(treehash::stringify(&slot))
}

/// `projFindByName(root, history, kind, name, scope)` -> the live slot (merged with its id) JSON
/// text, or null. Probes the scoped key, then the bare name, then (non-being) the parent-agnostic
/// NUL-trailing-segment scan. `scope` is a JSON object carrying the optional disambiguating fields
/// (parent / spaceId / parentMatterId); pass `{}` for a bare-name lookup. Tombstoned slots return
/// null (fileStore.findByName).
#[napi]
pub fn proj_find_by_name(
    root: String,
    history: String,
    kind: String,
    name: String,
    scope_json: String,
) -> napi::Result<Option<String>> {
    let scope = parse_arg(&scope_json)?;
    Ok(
        treeproj::find_by_name(std::path::Path::new(&root), &history, &kind, &name, &scope)
            .map(|slot| treehash::stringify(&slot)),
    )
}

/// `projFindByPosition(root, history, spaceId)` -> a JSON array of the live occupants (across
/// being/space/matter) at that space, each `{ kind, id, ...slot }` (fileStore.findByPosition).
#[napi]
pub fn proj_find_by_position(root: String, history: String, space_id: String) -> String {
    let occupants = treeproj::find_by_position(std::path::Path::new(&root), &history, &space_id);
    treehash::stringify(&Json::Arr(occupants))
}

/// `projFindByParent(root, history, parentId, kind)` -> a JSON array of the live children of
/// parentId in this kind, each `{ kind, id, ...slot }` (fileStore.findByParent).
#[napi]
pub fn proj_find_by_parent(root: String, history: String, parent_id: String, kind: String) -> String {
    let children = treeproj::find_by_parent(std::path::Path::new(&root), &history, &parent_id, &kind);
    treehash::stringify(&Json::Arr(children))
}

/// `projListByType(root, history, kind)` -> a JSON array of the live ids of this kind (tombstoned
/// excluded — they fell off the type index at cease) (fileStore.listByType).
#[napi]
pub fn proj_list_by_type(root: String, history: String, kind: String) -> String {
    let ids = treeproj::list_by_type(std::path::Path::new(&root), &history, &kind);
    let arr = ids.into_iter().map(Json::Str).collect();
    treehash::stringify(&Json::Arr(arr))
}

/// `projFindByHeavenSpace(root, history, heavenKind)` -> the singleton seed-space slot (merged with
/// its id) JSON text, or null. The marker is the `state.heavenSpace` value (config/heaven/threads/
/// ...); always a `space` kind (fileStore.findByHeavenSpace).
#[napi]
pub fn proj_find_by_heaven_space(root: String, history: String, heaven_kind: String) -> Option<String> {
    treeproj::find_by_heaven_space(std::path::Path::new(&root), &history, &heaven_kind)
        .map(|slot| treehash::stringify(&slot))
}

// ── Tier 4: the TRUTH — the append-only reel/.acts WRITE PATH + the reel READS (treestore) ─────────
// This is the irreducible chain (the stamp). Like the proj ops, these DO FILE I/O in Rust over the
// SAME on-disk reel/.acts/.acthead format the JS fileStore wrote (byte wire-compatible — a single
// wrong byte breaks the hash chain, so PARITY IS MANDATORY: proven by the boot "world IDENTICAL" gate
// + the step-B byte-level commit diff). EACH op takes the store ROOT first (the JS passes
// fileStore.storeRoot()). An I/O error is a HARD napi error (no JS fallback). The JS keeps only the
// commit mutex + the clock-free `ord` allocation (a number passed in) + building the act/fact docs to
// hand over; the reel/.acts BYTES are produced here.

fn store_io(what: &str, e: std::io::Error) -> napi::Error {
    napi::Error::from_reason(format!("treestore {what}: {e}"))
}

/// `storeReadReel(root, history, kind, id, after?, until?)` -> the reel's facts with `after < seq <=
/// until`, seq-ascending, as a JSON array (empty when the reel is absent). The own-history read
/// (fileStore.readReel); the fold's readReelBetween + the verify walkers call it.
#[napi]
pub fn store_read_reel(
    root: String,
    history: String,
    kind: String,
    id: String,
    after: Option<f64>,
    until: Option<f64>,
) -> String {
    let facts = treestore::read_reel_file(std::path::Path::new(&root), &history, &kind, &id, after, until);
    treehash::stringify(&Json::Arr(facts))
}

/// `storeReadReelLineage(root, lineageJson, floorsJson, kind, id, after?, until?)` -> a branch's
/// unioned reel across its lineage (parent prefix up to each branchPoint + the branch's own tail),
/// seq-ascending, as a JSON array. `lineage` is the main->leaf history-id array (e.g. ["0","1","1a"]);
/// `floors` is the history->fork-seq map (floors["0"]=0). The per-history range read is bound to the
/// fs (treestore::read_reel_file). Mirrors fileStore.readReelLineage's OR-of-ranges exactly.
#[napi]
pub fn store_read_reel_lineage(
    root: String,
    lineage_json: String,
    floors_json: String,
    kind: String,
    id: String,
    after: Option<f64>,
    until: Option<f64>,
) -> napi::Result<String> {
    let lineage: Vec<String> = match parse_arg(&lineage_json)? {
        Json::Arr(items) => items
            .into_iter()
            .map(|v| match v {
                Json::Str(s) => s,
                other => treehash::stringify(&other),
            })
            .collect(),
        _ => return Err(napi::Error::from_reason("storeReadReelLineage: lineage must be a JSON array")),
    };
    let floors = floors_map(&parse_arg(&floors_json)?);
    let root_path = std::path::Path::new(&root);
    let facts = treestore::read_reel_lineage(&lineage, &floors, after, until, |h, a, u| {
        treestore::read_reel_file(root_path, h, &kind, &id, a, u)
    });
    Ok(treehash::stringify(&Json::Arr(facts)))
}

/// `storeReadReelHead(root, history, kind, id)` -> `{head, headHash}` for the reel (head 0 + GENESIS
/// when absent). The DERIVED seq counter + chain root (fileStore.readReelHead); reelHeads.js
/// (allocSeq/readHead/ensureHeadAtLeast) + chainRoots read it.
#[napi]
pub fn store_read_reel_head(root: String, history: String, kind: String, id: String) -> String {
    let h = treestore::read_reel_head(std::path::Path::new(&root), &history, &kind, &id);
    let obj = Json::Obj(vec![
        ("head".to_string(), Json::Num(h.head)),
        ("headHash".to_string(), Json::Str(h.head_hash)),
    ]);
    treehash::stringify(&obj)
}

/// Read a `{ "<history>": <seq>, ... }` JSON object into the `HashMap<String, f64>` the lineage range
/// math wants (non-finite / non-number values are dropped, matching the JS `Number.isFinite` guard).
fn floors_map(v: &Json) -> std::collections::HashMap<String, f64> {
    let mut m = std::collections::HashMap::new();
    if let Json::Obj(entries) = v {
        for (k, val) in entries {
            if let Json::Num(n) = val {
                if n.is_finite() {
                    m.insert(k.clone(), *n);
                }
            }
        }
    }
    m
}

// ── STEP B: the WRITE + the act-log (the stamp) ──────────────────────────────────────────────────

/// `storeCommitMoment(root, recordJson, ord)` -> `{factIds, actId}` JSON. The FACTS half of the stamp,
/// byte-identical to fileStore.commitMoment's applyRecord: `record.facts` is `[{history, kind, id,
/// spec}]`; seal each fact ONCE (thread the per-reel heads, attach the moment `ord`), REFUSE a run-on
/// (an act fanning facts across >1 reel — the no-journal floor can't tail-truncate it), then write each
/// to its reel (the fsync'd append = the stamp, idempotent by per-reel seq). The act-log is NOT touched
/// here — exactly like the JS commitMoment, which writes facts only; the signed act lands separately via
/// storeAppendActLine. `actId` echoes record.actId / record.act._id (a thin witness; null when absent).
#[napi]
pub fn store_commit_moment(root: String, record_json: String, ord: f64) -> napi::Result<String> {
    use treestore::FactSpec;
    let record = parse_arg(&record_json)?;
    let root_path = std::path::Path::new(&root);

    // record.facts = [{ history, kind, id, spec }]
    let entries: Vec<Json> = match obj_get(&record, "facts") {
        Some(Json::Arr(a)) => a.clone(),
        _ => Vec::new(),
    };
    let specs: Vec<FactSpec<'_>> = entries
        .iter()
        .map(|e| FactSpec {
            history: obj_str(e, "history"),
            kind: obj_str(e, "kind"),
            id: obj_str(e, "id"),
            spec: obj_get(e, "spec").unwrap_or(e),
        })
        .collect();

    let seal = treestore::seal_moment(&specs, Some(ord), |h, k, i| {
        treestore::read_reel_head(root_path, h, k, i)
    });
    if seal.fanout {
        // RUN-ON BANNED: one act = one do = one fact = one reel (the floor's truncation recovery rests
        // on it). Matches commitMoment's `reels.size > 1` throw.
        return Err(napi::Error::from_reason(format!(
            "storeCommitMoment: RUN-ON BANNED — act lays facts on {} reels ({}). One act = one do = one fact = one reel.",
            seal.reels.len(),
            seal.reels.join(", "),
        )));
    }
    let mut fact_ids: Vec<Json> = Vec::with_capacity(seal.facts.len());
    for f in &seal.facts {
        let w = treestore::write_fact_doc(root_path, &f.history, &f.kind, &f.id, &f.doc)
            .map_err(|e| store_io("storeCommitMoment", e))?;
        fact_ids.push(Json::Str(w.id));
    }

    // actId echo: record.actId, else record.act._id (a witness for the caller; the act write is separate).
    let act_id = match obj_get(&record, "actId") {
        Some(Json::Str(s)) => Json::Str(s.clone()),
        _ => match obj_get(&record, "act").and_then(|a| obj_get(a, "_id")) {
            Some(Json::Str(s)) => Json::Str(s.clone()),
            _ => Json::Null,
        },
    };
    let out = Json::Obj(vec![
        ("factIds".to_string(), Json::Arr(fact_ids)),
        ("actId".to_string(), act_id),
    ]);
    Ok(treehash::stringify(&out))
}

/// `storeCommitVerbatim(root, factsJson)` -> `{factIds}` JSON. A graft/book transplant: each fact in
/// `factsJson` (`[{history, kind, id, doc}]`) carries its ORIGINAL pre-built identity (_id/seq/p) and
/// lands BYTE-FOR-BYTE (re-deriving would re-home the chain). The one-reel rule does NOT apply (a whole
/// genome spans many reels). Idempotent by per-reel seq. Mirrors fileStore.commitVerbatim/applyRecord.
#[napi]
pub fn store_commit_verbatim(root: String, facts_json: String) -> napi::Result<String> {
    let root_path = std::path::Path::new(&root);
    let entries: Vec<Json> = match parse_arg(&facts_json)? {
        Json::Arr(a) => a,
        _ => return Err(napi::Error::from_reason("storeCommitVerbatim: facts must be a JSON array")),
    };
    let mut fact_ids: Vec<Json> = Vec::new();
    for e in &entries {
        let doc = match obj_get(e, "doc") {
            Some(d) => d,
            None => continue,
        };
        let w = treestore::write_fact_doc(root_path, obj_str(e, "history"), obj_str(e, "kind"), obj_str(e, "id"), doc)
            .map_err(|err| store_io("storeCommitVerbatim", err))?;
        fact_ids.push(Json::Str(w.id));
    }
    Ok(treehash::stringify(&Json::Obj(vec![("factIds".to_string(), Json::Arr(fact_ids))])))
}

/// `storeAppendActLine(root, story, history, being, actDocJson)` -> the byte length appended. The
/// signed act doc arrives FULLY BUILT (the JS computed _id/p/sig/at/endMessage); Rust serializes it
/// verbatim (`JSON.stringify(actDoc) + "\n"`) and durably appends to the Name's act-log. The derived
/// act INDEX (actId->location + the inverted facets) stays in JS — it is a rebuildable cache, not the
/// chain. Mirrors fileStore.appendActLine's WRITE half (the durable append).
#[napi]
pub fn store_append_act_line(
    root: String,
    story: String,
    history: String,
    being: String,
    act_doc_json: String,
) -> napi::Result<u32> {
    let doc = parse_arg(&act_doc_json)?;
    treestore::append_act_line(std::path::Path::new(&root), &story, &history, &being, &doc)
        .map_err(|e| store_io("storeAppendActLine", e))?;
    // Byte length appended (a thin witness; the JS returns { bytes }).
    Ok((treehash::stringify(&doc).len() + 1) as u32)
}

/// `storeReadActHead(root, story, history, being)` -> the Name's act-chain head HASH (GENESIS_PREV
/// when the chain is empty/absent). The DERIVED chain pointer (fileStore.readActHeadFile).
#[napi]
pub fn store_read_act_head(root: String, story: String, history: String, being: String) -> String {
    treestore::read_act_head_file(std::path::Path::new(&root), &story, &history, &being)
}

/// `storeAdvanceActHead(root, story, history, being, actId, expectPrev)` -> `{head, replayed}` JSON.
/// The .acthead COMPARE-AND-SET: advance only if the on-disk head equals `expectPrev`. `cur == actId`
/// is a settled replay (no-op, replayed:true); `cur != expectPrev` is a hard napi error
/// "ACT_CHAIN_MOVED" (the chain can't fork). Mirrors fileStore.advanceActHeadFile.
#[napi]
pub fn store_advance_act_head(
    root: String,
    story: String,
    history: String,
    being: String,
    act_id: String,
    expect_prev: String,
) -> napi::Result<String> {
    use treestore::{AdvanceError, HeadAdvance};
    match treestore::advance_act_head_file(
        std::path::Path::new(&root),
        &story,
        &history,
        &being,
        &act_id,
        &expect_prev,
    ) {
        Ok(adv) => {
            let replayed = matches!(adv, HeadAdvance::Replayed);
            let out = Json::Obj(vec![
                ("head".to_string(), Json::Str(act_id)),
                ("replayed".to_string(), Json::Bool(replayed)),
            ]);
            Ok(treehash::stringify(&out))
        }
        Err(AdvanceError::ChainMoved) => Err(napi::Error::from_reason("ACT_CHAIN_MOVED")),
        Err(AdvanceError::Io(e)) => Err(store_io("storeAdvanceActHead", e)),
    }
}

/// `storeReadActChain(root, story, history, being)` -> the Name's authored acts on a (story, history),
/// append-order (oldest-first), as a JSON array. The own-(story,history) read; the patch overlay is
/// omitted (no patch writer today — a sealed act is immutable). Mirrors fileStore.readActChain.
#[napi]
pub fn store_read_act_chain(root: String, story: String, history: String, being: String) -> String {
    let acts = treestore::read_act_chain_file(std::path::Path::new(&root), &story, &history, &being);
    treehash::stringify(&Json::Arr(acts))
}

// small Json object readers shared by the store ops above (treehash::Json has no field accessors).
fn obj_get<'a>(v: &'a Json, key: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(k, _)| k == key).map(|(_, x)| x),
        _ => None,
    }
}
fn obj_str<'a>(v: &'a Json, key: &str) -> &'a str {
    match obj_get(v, key) {
        Some(Json::Str(s)) => s.as_str(),
        _ => "",
    }
}
