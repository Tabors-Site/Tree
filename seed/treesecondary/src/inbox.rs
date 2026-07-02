// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// InboxProjection - the PURE FOLD half of seed/past/projections/inbox/
// inboxProjectionFold.js. One row per open summon, keyed by params.correlation,
// indexed by recipient. Two events:
//
//   call fact (the fat call, params.correlation + of=recipient)
//        -> upsert the InboxProjection row keyed by params.correlation.
//   answering act seal
//        -> evict the row where _id === act.answers.
//
// What is PURE here (and lives in this crate):
//   inbox_open(fact)  : a `call` fact -> the InboxProjection row (Some), or None
//                       when the fact is not an inbox-opening fat call. Byte-
//                       compatible with the JS _insertUpsert row shape.
//   inbox_evict(answers_correlation) : the answering-act seal -> the _id to delete.
//
// What is NOT a pure fact-fold (stays in JS, flagged here, NOT ported):
//   - the ANSWERED-GUARD. handleCall skips the upsert when an Act already answers
//     this correlation (`getActsByField("answers", corr).length > 0`). That reads
//     LIVE cross-reel act state (the act-chain index), not the one fact. The pure
//     fold cannot know it; the caller must apply the guard before taking the row.
//   - the QUOTED-WORD CLOSE delivery (handleQuotedWordClose). A close-quote
//     assembles the utterance from the CALLER's whole reel (readReel), resolves
//     the recipient by NAME (findByName) and the inboxSpace off the recipient's
//     slot, then WAKES the scheduler. That needs reel I/O + name resolution +
//     a live slot read; it is not fact -> row. The CALLER assembles the inputs
//     (recipient id, inboxSpace, assembled content) and may then call
//     `inbox_open_quoted_word(...)` below for the pure row build.
//
// PURE / clock-free: the row's ORDER key is `ord` (fact.ord ?? params.ord); the
// inert display witness `sentAt` is fact.date or null (never a fresh clock).

use crate::value as v;
use crate::value::{Json, RowBuilder};

/// Priority -> numeric rank (lower = picked first). The ONE enum-to-rank map
/// (PRIORITY_RANK in inboxProjectionFold.js); the fold writes priorityRank from
/// it. `priorityRankOf(p) = map[p] ?? 3`.
pub fn priority_rank_of(priority: &str) -> i64 {
    match priority {
        "HUMAN" => 1,
        "GATEWAY" => 2,
        "INTERACTIVE" => 3,
        "BACKGROUND" => 4,
        _ => 3,
    }
}

/// Is this a `call` fact at all? (verb === "call"). The non-call facts return
/// early in handleCall; the cross-cutting dispatch hands every applied fact in.
pub fn is_call(fact: &Json) -> bool {
    matches!(v::str_of(fact, "verb"), Some("call"))
}

/// inbox_open: the fat-call path of handleCall, as a PURE fact -> row.
///
/// Returns Some(row) when `fact` is an inbox-opening fat call: verb === "call",
/// params.correlation present, and of = {kind:"being", id} (the recipient reel).
/// Returns None otherwise (not a call, no correlation, no being recipient) -
/// the same early-returns handleCall takes.
///
/// The row's keys are pushed in the EXACT JS order (traced from projStore
/// _insertUpsert + applyUpdate): `_id` first, then the $set keys in literal
/// order. `attachments` is emitted only when params.attachments is truthy (JS:
/// `params.attachments || undefined`, and JSON.stringify drops undefined). The
/// `history` field is read off the fact (JS asserts it via assertHistoryOrThrow;
/// here a missing history yields None so the caller can surface the broken
/// invariant rather than write a history-less row).
///
/// The ANSWERED-GUARD is NOT applied here (see module docs) - pass facts the
/// caller has already cleared.
pub fn inbox_open(fact: &Json) -> Option<Json> {
    if !is_call(fact) {
        return None;
    }
    let params = v::params(fact);
    let correlation = v::str_of(&params, "correlation")?.to_string();

    // Recipient is the fact's object (right stance, of=recipient).
    let recipient = match v::of_ref(fact) {
        Some((kind, id)) if kind == "being" => id,
        _ => return None,
    };

    // history is required (JS assertHistoryOrThrow). No history -> None.
    let history = v::str_of(fact, "history")?.to_string();

    let priority = v::or_truthy(v::get(&params, "priority"), Json::Str("INTERACTIVE".into()));
    let priority_str = match &priority {
        Json::Str(s) => s.clone(),
        _ => "INTERACTIVE".to_string(),
    };

    // `attachments` is only set when truthy (JS `params.attachments || undefined`).
    let attachments = match v::get(&params, "attachments") {
        Some(a) if v::truthy(Some(a)) => Some(a.clone()),
        _ => None,
    };

    let summoner = match v::get(fact, "through") {
        Some(t) if v::truthy(Some(t)) => string_coerce(t),
        _ => Json::Null,
    };

    let row = RowBuilder::new()
        .put("_id", Json::Str(correlation.clone()))
        .put("recipient", Json::Str(recipient))
        .put("summoner", summoner)
        .put("sender", v::or_truthy(v::get(&params, "sender"), Json::Null))
        .put("content", v::nullish(v::get(&params, "content"), Json::Null))
        .put("activeAble", v::or_truthy(v::get(&params, "activeAble"), Json::Null))
        .put_opt("attachments", attachments)
        .put("intent", v::or_truthy(v::get(&params, "intent"), Json::Null))
        .put("priority", priority)
        .put("priorityRank", Json::Num(priority_rank_of(&priority_str) as f64))
        .put("orientation", v::or_truthy(v::get(&params, "orientation"), Json::Str("forward".into())))
        .put(
            "rootCorrelation",
            v::or_truthy(v::get(&params, "rootCorrelation"), Json::Str(correlation.clone())),
        )
        .put("inReplyTo", v::or_truthy(v::get(&params, "inReplyTo"), Json::Null))
        .put("inboxSpaceId", v::or_truthy(v::get(&params, "inboxSpaceId"), Json::Null))
        // ORDER KEY (clock-free): fact.ord ?? params.ord ?? null.
        .put("ord", ord_of(fact, &params))
        // INERT display witness only: fact.date ?? null. Never a fresh clock.
        .put("sentAt", v::nullish(v::get(fact, "date"), Json::Null))
        .put("history", Json::Str(history))
        .build();
    Some(row)
}

/// inbox_evict: the answering-act seal -> the _id (correlation) to delete from
/// InboxProjection. closeInboxOnAnswer(answersCorrelation): a no-op (None) when
/// the correlation is empty, else the String(correlation) key to deleteOne by.
pub fn inbox_evict(answers_correlation: &str) -> Option<String> {
    if answers_correlation.is_empty() {
        None
    } else {
        Some(answers_correlation.to_string())
    }
}

/// inbox_open_quoted_word: the PURE row build for the quoted-word-close delivery.
/// The CALLER does the impure work first (assemble the utterance from the
/// caller's reel, resolve the recipient by name, read the inboxSpace off the
/// recipient slot) and hands the resolved inputs here. Returns the row in the
/// JS key order of handleQuotedWordClose's `$set`.
///
/// `content` is the assembled utterance (qw.said). `recipient_id` / `summoner`
/// (the caller id) / `sender` / `intent` / `inbox_space_id` are resolved by the
/// caller. `ord` is fact.ord ?? params.ord ?? null; `sent_at` is fact.date ?? null.
#[allow(clippy::too_many_arguments)]
pub fn inbox_open_quoted_word(
    correlation: &str,
    recipient_id: &str,
    summoner_caller_id: &str,
    sender: Option<&str>,
    content: Json,
    intent: Option<&str>,
    inbox_space_id: Option<&str>,
    ord: Json,
    sent_at: Json,
    history: &str,
) -> Json {
    RowBuilder::new()
        .put("_id", Json::Str(correlation.to_string()))
        .put("recipient", Json::Str(recipient_id.to_string()))
        .put("summoner", Json::Str(summoner_caller_id.to_string()))
        .put(
            "sender",
            sender.map(|s| Json::Str(s.to_string())).unwrap_or(Json::Null),
        )
        .put("content", content)
        .put("activeAble", Json::Null)
        .put(
            "intent",
            intent.map(|s| Json::Str(s.to_string())).unwrap_or(Json::Null),
        )
        .put("priority", Json::Str("INTERACTIVE".into()))
        .put("priorityRank", Json::Num(priority_rank_of("INTERACTIVE") as f64))
        .put("orientation", Json::Str("forward".into()))
        .put("rootCorrelation", Json::Str(correlation.to_string()))
        .put("inReplyTo", Json::Null)
        .put(
            "inboxSpaceId",
            inbox_space_id
                .map(|s| Json::Str(s.to_string()))
                .unwrap_or(Json::Null),
        )
        .put("ord", ord)
        .put("sentAt", sent_at)
        .put("history", Json::Str(history.to_string()))
        .build()
}

/// `fact.ord ?? params.ord ?? null` - the row's clock-free order key.
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

/// `String(fact.through)` - the JS coerces `through` with String(); for the live
/// path it is always a string id, so we pass strings through and stringify any
/// non-string the JS String() way (numbers -> their text). Null/absent is handled
/// by the caller (the truthy guard).
fn string_coerce(v: &Json) -> Json {
    match v {
        Json::Str(_) => v.clone(),
        Json::Num(n) => Json::Str(treehash::stringify(&Json::Num(*n))),
        other => Json::Str(treehash::stringify(other)),
    }
}
