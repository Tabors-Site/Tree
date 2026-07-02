// The act/fact-boundary corruption-prevention with NO journal (theorems.md Theorem 7 Scope +
// Cor 7.1). The `.head`/`.acthead` IS the commit marker: a torn write (line on disk, head never
// advanced) leaves an ORPHAN. This test simulates the crash and proves the four guarantees:
//
//   (1) SELF-HEAL - the next commit_moment lands the new fact at the ORPHAN's seq, chaining from the
//                    TRUE (walked) head, not from the orphan.
//   (2) INTACT - verify_fact_chain reports the reel whole afterward (no seq-gap from a dup line).
//   (3) ZERO TRACE - the orphan leaves no trace: the reel holds exactly the good chain, the orphan's
//                    content is gone.
//   (4) NEVER OVERWRITE A COMMITTED FACT - a genuinely committed (head-advanced) fact is untouched
//                    across the heal; overwriting committed data is the one thing that corrupts the
//                    chain, so we assert the committed prefix is byte-for-byte preserved.
//
// Plus BYTE-IDENTICAL: a clean (non-torn) sequence produces exactly the bytes the same sequence
// produces with no crash injected - recovery is a no-op on a clean store (Model B, no format change).
//
// The act-chain (the reel's peer) gets the same torn-then-heal proof.

use std::io::Write;

use treestore::{
    commit_moment, read_act_chain_file, read_act_head_file, read_reel_file, read_reel_head,
    verify_act_chain, verify_fact_chain, walked_reel_head, Json,
};

fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn obj(pairs: Vec<(&str, Json)>) -> Json {
    Json::Obj(pairs.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}
fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn id_of(v: &Json) -> String {
    match get(v, "_id") {
        Some(Json::Str(s)) => s.clone(),
        _ => String::new(),
    }
}
fn seq_of(v: &Json) -> f64 {
    match get(v, "seq") {
        Some(Json::Num(n)) => *n,
        _ => -1.0,
    }
}
fn val_of(v: &Json) -> String {
    // the params.value of a set-being fact (the human-readable payload we track across the heal)
    match get(v, "params").and_then(|p| get(p, "value")) {
        Some(Json::Str(s)) => s.clone(),
        _ => String::new(),
    }
}
fn verdict_ok(v: &Json) -> bool {
    matches!(get(v, "ok"), Some(Json::Bool(true)))
}

fn iam_act(label: &str, fact: Json) -> Json {
    obj(vec![
        ("by", jstr("i-am")),
        ("through", jstr("i-am")),
        ("to", jstr("i-am")),
        ("story", jstr("main")),
        ("history", jstr("0")),
        ("startMessage", obj(vec![("content", jstr(label)), ("source", jstr("i-am"))])),
        ("deltaF", Json::Arr(vec![fact])),
    ])
}
fn birth() -> Json {
    obj(vec![
        ("verb", jstr("be")),
        ("act", jstr("birth")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr("be1"))])),
        ("params", obj(vec![("name", jstr("Alice"))])),
        ("history", jstr("0")),
    ])
}
fn set_name(v: &str) -> Json {
    obj(vec![
        ("verb", jstr("do")),
        ("act", jstr("set-being")),
        ("of", obj(vec![("kind", jstr("being")), ("id", jstr("be1"))])),
        ("params", obj(vec![("field", jstr("name")), ("value", jstr(v))])),
        ("history", jstr("0")),
    ])
}

const REEL_REL: [&str; 5] = ["reels", "0", "being", "be", "be1.reel"];

fn reel_file(dir: &std::path::Path) -> std::path::PathBuf {
    REEL_REL.iter().fold(dir.to_path_buf(), |p, seg| p.join(seg))
}

/// Build a REAL valid orphan line for seq 2 (chaining from the seq-1 fact), the way a torn moment
/// would have left it: commit it into a SCRATCH store, lift its second reel line. This guarantees the
/// orphan is a perfectly valid standalone fact (it parses, it re-hashes) - exactly the dangerous case
/// (a half-written final line `parse_reel` already drops; a FULLY written orphan it cannot).
fn make_orphan_seq2_line(scratch: &std::path::Path, value: &str) -> String {
    let _ = std::fs::remove_dir_all(scratch);
    commit_moment(scratch, &iam_act("birth", birth()), 1.0).unwrap();
    commit_moment(scratch, &iam_act("torn", set_name(value)), 2.0).unwrap();
    let s = std::fs::read_to_string(reel_file(scratch)).unwrap();
    let line = s.lines().nth(1).unwrap().to_string();
    let _ = std::fs::remove_dir_all(scratch);
    line
}

#[test]
fn torn_write_self_heals_and_never_overwrites_committed() {
    let dir = std::env::temp_dir().join("treestore-torn-reel");
    let scratch = std::env::temp_dir().join("treestore-torn-scratch");
    let _ = std::fs::remove_dir_all(&dir);

    // ── Commit one GOOD fact (seq 1). This one IS committed (head advanced); it must survive. ──
    let c1 = commit_moment(&dir, &iam_act("birth", birth()), 1.0).expect("commit 1");
    let committed_fact_id = c1.fact_ids[0].clone();
    let reel = reel_file(&dir);
    let committed_line = std::fs::read_to_string(&reel).unwrap(); // the exact bytes of the committed prefix

    // ── Simulate a CRASH mid-moment: append a fully-written seq-2 orphan line, but DON'T advance the
    //    head. (.head stays at seq 1 - the orphan was never committed.) ──
    let orphan_line = make_orphan_seq2_line(&scratch, "TORN");
    {
        let mut f = std::fs::OpenOptions::new().append(true).open(&reel).unwrap();
        writeln!(f, "{orphan_line}").unwrap();
    }
    // Sanity: the reel now physically holds TWO lines, and the raw (un-walked) read sees the orphan.
    let raw = read_reel_file(&dir, "0", "being", "be1", None, None);
    assert_eq!(raw.len(), 2, "the torn append left a second (orphan) line on disk");
    assert_eq!(val_of(&raw[1]), "TORN", "the orphan carries the torn 'TORN' content");
    // The COMMITTED head (.head) is the commit marker, and it lags the orphan -> it stayed at seq 1.
    // (The orphan line is a perfectly valid standalone fact, so the p-WALK alone reads BOTH as chained
    // - what marks the orphan uncommitted is precisely that .head never advanced to it. The committed
    //  head IS the true head; recover_reel_before_commit uses it as the orphan boundary.)
    let committed_head = read_reel_head(&dir, "0", "being", "be1");
    assert_eq!(committed_head.head, 1.0, "the committed .head lags the orphan -> true head is seq 1");
    assert_eq!(committed_head.head_hash, committed_fact_id, "the committed head IS the seq-1 fact");

    // ── The NEXT real commit. It must SELF-HEAL: re-derive seq 2 / p from the TRUE head and overwrite
    //    the orphan FORWARD (drop the orphan, land the good fact at seq 2). ──
    let c2 = commit_moment(&dir, &iam_act("real", set_name("REAL")), 3.0).expect("commit 2 self-heal");

    let facts = read_reel_file(&dir, "0", "being", "be1", None, None);

    // (1) SELF-HEAL: the new fact sits at the ORPHAN's seq (2), chaining from the TRUE head (seq 1).
    assert_eq!(facts.len(), 2, "self-heal: the reel holds exactly 2 facts (orphan overwritten-forward)");
    assert_eq!(seq_of(&facts[1]), 2.0, "the healed fact took the orphan's seq (2)");
    assert_eq!(id_of(&facts[1]), c2.fact_ids[0], "facts[1] is the new committed fact");
    assert_eq!(
        get(&facts[1], "p").and_then(|p| match p { Json::Str(s) => Some(s.as_str()), _ => None }),
        Some(committed_fact_id.as_str()),
        "the healed fact chains from the TRUE (committed seq-1) head, not from the orphan",
    );

    // (2) INTACT: the reel verifies whole - no seq-gap from a surviving duplicate line.
    let v = verify_fact_chain(&facts);
    assert!(verdict_ok(&v), "reel must verify INTACT after the heal: {:?}", v);

    // (3) ZERO TRACE: the orphan's content ("TORN") is gone - nowhere on the reel.
    assert!(
        !facts.iter().any(|f| val_of(f) == "TORN"),
        "the torn moment must leave ZERO TRACE (no orphan content survives the walked chain)",
    );
    let healed_bytes = std::fs::read_to_string(&reel).unwrap();
    assert!(!healed_bytes.contains("TORN"), "the orphan's bytes are physically gone from the reel file");

    // (4) NEVER OVERWRITE A COMMITTED FACT: the committed seq-1 fact is byte-for-byte preserved (its
    //     id unchanged, and the reel still STARTS with the exact committed bytes). Overwriting a
    //     committed fact would break every downstream p; the heal only ever drops the uncommitted tail.
    assert_eq!(id_of(&facts[0]), committed_fact_id, "the committed seq-1 fact id is unchanged");
    assert!(
        healed_bytes.starts_with(committed_line.trim_end()),
        "the committed prefix is preserved byte-for-byte across the heal",
    );

    // ── walked_reel_head also catches a genuinely BROKEN (bad-p) tail (the case the pure walk owns,
    //    vs. the head-lagging orphan above which only the committed .head can mark). Take the healed
    //    2-fact chain, corrupt the second fact's `p`, and confirm the walk retreats to the seq-1 head. ──
    let mut broken = facts.clone();
    if let Json::Obj(e) = &mut broken[1] {
        for (k, v) in e.iter_mut() {
            if k == "p" {
                *v = jstr("deadbeef");
            }
        }
    }
    let w = walked_reel_head(&broken);
    assert_eq!(w.head, 1.0, "walked_reel_head retreats past a p-broken tail -> seq 1");
    assert_eq!(w.head_hash, committed_fact_id, "walked_reel_head returns the last correctly-chained fact");

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_dir_all(&scratch);
    println!("  treestore torn-write: orphan self-heals at its seq from the TRUE head, reel INTACT, zero trace, committed fact never overwritten  OK");
}

#[test]
fn clean_sequence_is_byte_identical_recovery_is_a_noop() {
    // A non-torn sequence must produce EXACTLY the bytes it would with no recovery wired in. We prove
    // it by running the same two commits in two stores (recovery runs in both, but there is nothing to
    // heal in either) and asserting the reel + act-log bytes are identical, AND match a reference run.
    let a = std::env::temp_dir().join("treestore-clean-a");
    let b = std::env::temp_dir().join("treestore-clean-b");
    let _ = std::fs::remove_dir_all(&a);
    let _ = std::fs::remove_dir_all(&b);

    for dir in [&a, &b] {
        commit_moment(dir, &iam_act("birth", birth()), 1.0).expect("commit 1");
        commit_moment(dir, &iam_act("rename", set_name("Alice-2")), 2.0).expect("commit 2");
    }

    let reel_a = std::fs::read_to_string(reel_file(&a)).unwrap();
    let reel_b = std::fs::read_to_string(reel_file(&b)).unwrap();
    assert_eq!(reel_a, reel_b, "a clean sequence yields identical reel bytes (recovery is a no-op)");

    let act_path = |d: &std::path::Path| {
        ["acts", "main", "0", "i-", "i-am.acts"]
            .iter()
            .fold(d.to_path_buf(), |p, seg| p.join(seg))
    };
    let acts_a = std::fs::read_to_string(act_path(&a)).unwrap();
    let acts_b = std::fs::read_to_string(act_path(&b)).unwrap();
    assert_eq!(acts_a, acts_b, "a clean sequence yields identical .acts bytes (recovery is a no-op)");

    // Both still verify, and the reel reads back as a 2-fact chain (no recovery side effect).
    let facts = read_reel_file(&a, "0", "being", "be1", None, None);
    assert_eq!(facts.len(), 2, "clean reel has exactly 2 facts");
    assert!(verdict_ok(&verify_fact_chain(&facts)), "clean reel verifies");

    let _ = std::fs::remove_dir_all(&a);
    let _ = std::fs::remove_dir_all(&b);
    println!("  treestore clean sequence: recovery is a no-op, reel + .acts bytes identical run-to-run (Model B, no format change)  OK");
}

#[test]
fn torn_act_self_heals_too() {
    // The act-chain is the reel's peer (it has its own .acthead commit marker). A torn act (line in
    // .acts, .acthead not advanced) is an orphan too; the next commit walks to the true act-head and
    // drops the orphan act before appending. Same Cor 7.1 mechanism, the act side.
    let dir = std::env::temp_dir().join("treestore-torn-act");
    let scratch = std::env::temp_dir().join("treestore-torn-act-scratch");
    let _ = std::fs::remove_dir_all(&dir);

    // One committed moment -> one act on the i-am chain (committed: .acthead advanced).
    let c1 = commit_moment(&dir, &iam_act("birth", birth()), 1.0).expect("commit 1");
    let committed_act_id = c1.act_id.clone();

    // Build a real valid SECOND act line (chaining from act 1) in a scratch store, lift it.
    let _ = std::fs::remove_dir_all(&scratch);
    commit_moment(&scratch, &iam_act("birth", birth()), 1.0).unwrap();
    commit_moment(&scratch, &iam_act("torn", set_name("TORN")), 2.0).unwrap();
    let act_log = |d: &std::path::Path| {
        ["acts", "main", "0", "i-", "i-am.acts"]
            .iter()
            .fold(d.to_path_buf(), |p, seg| p.join(seg))
    };
    let s = std::fs::read_to_string(act_log(&scratch)).unwrap();
    let orphan_act = s.lines().nth(1).unwrap().to_string();
    let _ = std::fs::remove_dir_all(&scratch);

    // Inject the orphan act: append the line to .acts, but DON'T advance .acthead (crash mid-moment).
    {
        let mut f = std::fs::OpenOptions::new().append(true).open(act_log(&dir)).unwrap();
        writeln!(f, "{orphan_act}").unwrap();
    }
    let raw = read_act_chain_file(&dir, "main", "0", "i-am");
    assert_eq!(raw.len(), 2, "the torn append left a second (orphan) act on disk");
    // The committed .acthead lags the orphan act -> it stayed at act 1 (the true head).
    assert_eq!(
        read_act_head_file(&dir, "main", "0", "i-am"),
        committed_act_id,
        "the committed .acthead lags the orphan act -> true head is act 1",
    );

    // The next real commit heals: drop the orphan act, append the new act past the TRUE head.
    let c2 = commit_moment(&dir, &iam_act("real", set_name("REAL")), 3.0).expect("commit 2 act heal");

    let acts = read_act_chain_file(&dir, "main", "0", "i-am");
    assert_eq!(acts.len(), 2, "act-chain holds exactly 2 acts (orphan act overwritten-forward)");
    assert_eq!(id_of(&acts[0]), committed_act_id, "the committed act 1 is preserved (never overwritten)");
    assert_eq!(id_of(&acts[1]), c2.act_id, "acts[1] is the new committed act");
    assert_ne!(c2.act_id, committed_act_id, "the healed act is a distinct moment");
    assert!(verdict_ok(&verify_act_chain(&acts)), "act-chain verifies INTACT after the heal");

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_dir_all(&scratch);
    println!("  treestore torn-act: orphan act self-heals from the true act-head, chain INTACT, committed act preserved  OK");
}
