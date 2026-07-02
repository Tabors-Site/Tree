// present_loop_phase1.rs — the Node-free verification of the Phase-1 present-loop runtime. A being is
// SUMMONED, it WAKES on that real event, runs a moment through the four-beat conductor, DECIDES a Word
// (scripted), and the act STAMPS a fact so the being's reel ADVANCES and the chain VERIFIES. All
// in-process Rust: no node proc, no subprocess, no wall-clock. The scheduler + conductor compose
// treecognition / treeibp / treefold / treestore — the only new host code is the loop shell under test.
//
// CLOCK-FREE by construction: this test never reads a wall-clock; the moment's only ord is the world's
// append ord (a count). The grep guard (in the task report) proves moment.rs/scheduler.rs hold no clock.
//
// Proofs:
//   (A) the full SEAL path: summon -> wake -> scripted DECIDES "I make <space>." -> ACT stamps
//       make -> the new space reel exists + verifies, and the being woke exactly once.
//   (B) the See path: a real scripted able with no matching trigger -> a clean See, NO act row.
//   (F) the FILE-flow DECIDE leg: a scripted being's `.word` file holds a PARAMETERIZED deed; load it
//       off disk and decide -> the spoken Word carries its target + params (the renderer round-trip).
//   (F-seal) the FILE-flow SEAL leg: the SAME parameterized flow deed (`do make on the space
//       <ref> with { name, type }`), decided by the conductor and SEALED end-to-end over a real
//       genesis-born world (the vocabulary coined so `make` resolves as an op word). The deed
//       targets a bare `{ref}` (no resolved id); the conductor's seal (act::run_word -> act_via_fold)
//       runs it through the SAME op-word path genesis uses (op_word_via_fold + derive_trigger's
//       literal-ref recovery), so the deed resolves its op-word + its `{ref}` and STAMPS the enriched
//       make fact — which lands on a real space reel and chain-VERIFIES. Node-free, clock-free.

use std::path::PathBuf;
use std::sync::Mutex;

use treehash::{parse as pj, Json};
use treestore::{compute_fact_doc, read_reel_file, verify_fact_chain, write_fact_doc, Head};
use treeos_lib::scheduler::{wake_sync, Entry};

/// `TREE_ABLES_DIR` is process-global; both tests set it to their own scratch ables, so they must run
/// serially (cargo runs tests in parallel threads of ONE process). A static mutex serializes them. No
/// wall-clock involved — a plain lock.
static ENV_LOCK: Mutex<()> = Mutex::new(());

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
fn ok_true(v: &Json) -> bool {
    matches!(get(v, "ok"), Some(Json::Bool(true)))
}

/// Plant a scratch ables dir with a SCRIPTED "builder" able: scripted cognition, can create spaces, sees
/// + reaches story-wide. The `.word` body folds to the able spec the conductor authorizes against; the
/// DECISION flow is injected on the entry (used by the older proofs that predate the flow-effect
/// round-trip — they keep the seal path honest with a directly built decision Word).
fn plant_builder_able(ables_dir: &std::path::Path) {
    std::fs::create_dir_all(ables_dir).unwrap();
    let body = "# scratch scripted builder able for the present-loop verification.\n\
A builder is an able.\n\
A builder can do make.\n\
A builder can see place.\n\
A builder reaches /**.\n\
A builder needs scripted cognition.\n";
    std::fs::write(ables_dir.join("builder.word"), body).unwrap();
}

/// Plant a scratch "scripted-flow" able whose `.word` carries the DECISION as a PARAMETERIZED FLOW DEED
/// in the file itself; no injected flow. On the summon event the flow's body deed
/// `do make on the space <id> with { name, type }` is parsed AND rendered by treeword (the
/// round-trip the renderer fix unlocked: the deed's target + params are carried, not dropped), spoken as
/// a Word, and stamped by the real act path. This proves the FILE path end-to-end: a scripted being's
/// `.word` flow with a parameterized deed drives the loop.
fn plant_flowfile_able(ables_dir: &std::path::Path, space: &str) {
    std::fs::create_dir_all(ables_dir).unwrap();
    // NB: the body deed line MUST stay indented (the flow body nests by indent); build the lines
    // explicitly so the 2-space indent survives (a `\`-continuation would eat the leading whitespace).
    let body = [
        "# scratch scripted builder able whose DECISION lives in this .word file as a flow.".to_string(),
        "A builder is an able.".to_string(),
        "A builder can do make.".to_string(),
        "A builder can see place.".to_string(),
        "A builder reaches /**.".to_string(),
        "A builder needs scripted cognition.".to_string(),
        String::new(),
        "When the sky is summoned:".to_string(),
        format!("  do make on the space {space} with {{ name: \"{space}\", type: \"home-territory\" }}."),
        String::new(),
    ]
    .join("\n");
    std::fs::write(ables_dir.join("builder.word"), body).unwrap();
}

fn obj(f: Vec<(&str, Json)>) -> Json {
    Json::Obj(f.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}

/// A scripted FLOW that, on the summon event, speaks "I make <space>." — a complete, stampable Word.
/// The When trigger is `event: "the sky is summoned"` (matches face.event); the effect is a directly
/// built make node that renders to "I make <space>.".
fn make_flow(space: &str) -> Json {
    let make = treeword::parse(&format!("I make {space}.")).remove(0);
    obj(vec![
        ("kind", Json::Str("flow".into())),
        ("when", obj(vec![("event", Json::Str("the sky is summoned".into()))])),
        ("effects", Json::Arr(vec![make])),
    ])
}

#[test]
fn summoned_being_wakes_decides_acts_chain_advances() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    // ── a fresh SCRATCH store + scratch ables (never store/past) ────────────
    let base = std::env::temp_dir().join(format!("treeos-present-loop-A-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    let root = base.join("store");
    let ables = base.join("ables");
    plant_builder_able(&ables);
    std::env::set_var("TREE_ABLES_DIR", &ables);

    let being = "tester1";

    // grant the scratch "builder" able to the being — a real fact on its reel (authorize sees the grant).
    let grant = pj(&format!(
        r#"{{"through":"{being}","verb":"do","act":"set-being","by":"{being}","of":{{"kind":"being","id":"{being}"}},"params":{{"field":"qualities.ablesGranted","value":[{{"able":"builder","anchorSpaceId":"root"}}],"merge":false}}}}"#
    ))
    .unwrap();
    let st = compute_fact_doc("0", &grant, &Head::genesis(), None);
    write_fact_doc(&root, "0", "being", being, &st.doc).expect("grant planted");

    let before = read_reel_file(&root, "0", "being", being, None, None);
    assert_eq!(before.len(), 1, "only the grant on the reel before the wake");
    // the space does not exist yet.
    assert!(read_reel_file(&root, "0", "space", "grove", None, None).is_empty(), "grove unborn");

    // ── SUMMON: wake the being on the summon event, carrying the decision flow ──
    let mut entry = Entry::event("corr-1", "the sky is summoned");
    entry.able = Some("builder".to_string());
    entry.flows = Some(vec![make_flow("grove")]); // the injected scripted decision

    // drive the SAME conductor the async run-loop drives, serially.
    let reports = wake_sync(being, entry, &PathBuf::from(&root));

    // ── the being WOKE and ran exactly one moment ───────────────────────────
    assert_eq!(reports.len(), 1, "one summon -> one moment");
    let r = &reports[0];
    assert_eq!(r.being_id, being);
    assert!(!r.act_id.is_empty(), "the moment minted an actId");
    assert_eq!(r.mode, "scripted", "the able routed to scripted cognition");

    // ── it DECIDED a Word and the act STAMPED a fact ────────────────────────
    assert!(r.acted(), "the being decided to ACT (not See/Failure): {:?}", r.decision);
    assert_eq!(r.facts.len(), 1, "the decided Word stamped one fact");
    assert!(ok_true(&r.facts[0]), "the stamped fact is authorized: {}", treehash::stringify(&r.facts[0]));
    let stamped = get(&r.facts[0], "fact").expect("a fact row");
    assert_eq!(get_str(stamped, "act"), Some("make"), "the decided Word was make");

    // ── the new space reel EXISTS + the chain VERIFIES ──────────────────────
    let grove = read_reel_file(&root, "0", "space", "grove", None, None);
    assert_eq!(grove.len(), 1, "the being's act birthed the grove space reel");
    let verdict = verify_fact_chain(&grove);
    assert!(ok_true(&verdict), "the new space chain verifies: {}", treehash::stringify(&verdict));

    let _ = std::fs::remove_dir_all(&base);
    std::env::remove_var("TREE_ABLES_DIR");
    println!("  treeos present-loop Phase 1 (A): summon -> wake -> scripted decide -> ACT stamps make -> chain verifies (Node-free, clock-free)  OK");
}

#[test]
fn no_matching_trigger_is_a_clean_see_no_act_row() {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let base = std::env::temp_dir().join(format!("treeos-present-loop-B-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    let root = base.join("store");
    let ables = base.join("ables");
    plant_builder_able(&ables);
    std::env::set_var("TREE_ABLES_DIR", &ables);

    let being = "tester2";
    let grant = pj(&format!(
        r#"{{"through":"{being}","verb":"do","act":"set-being","by":"{being}","of":{{"kind":"being","id":"{being}"}},"params":{{"field":"qualities.ablesGranted","value":[{{"able":"builder","anchorSpaceId":"root"}}],"merge":false}}}}"#
    ))
    .unwrap();
    let st = compute_fact_doc("0", &grant, &Head::genesis(), None);
    write_fact_doc(&root, "0", "being", being, &st.doc).expect("grant planted");

    // summon with a flow whose trigger does NOT hold (the face event is a different clause) -> See.
    let mut entry = Entry::event("corr-2", "an unrelated event");
    entry.able = Some("builder".to_string());
    entry.flows = Some(vec![make_flow("grove")]); // trigger is "the sky is summoned" -> no match

    let reports = wake_sync(being, entry, &PathBuf::from(&root));
    assert_eq!(reports.len(), 1);
    let r = &reports[0];
    assert!(!r.acted(), "no trigger held -> See (not Act): {:?}", r.decision);
    assert!(matches!(r.decision, treecognition::Cognition::See), "a clean See");
    assert!(r.facts.is_empty(), "See stamps NO act row");

    // the reel did NOT advance — still just the grant.
    let after = read_reel_file(&root, "0", "being", being, None, None);
    assert_eq!(after.len(), 1, "See leaves the reel untouched");

    let _ = std::fs::remove_dir_all(&base);
    std::env::remove_var("TREE_ABLES_DIR");
    println!("  treeos present-loop Phase 1 (B): summon, no trigger -> clean See, no act row, reel untouched  OK");
}

#[test]
fn wire_summon_drives_the_conductor_node_free() {
    // the WIRE seam end-to-end: a `{"verb":"summon", ...}` message -> ibp::handle_wire -> scheduler wake
    // -> the conductor runs the being's moment -> a moment outcome rides back on the reply. No node, no
    // wall-clock. (The wire summon parses the able's `.word` flows; the seed has no param-rendering flow
    // yet, so a scripted being decides a clean See here — the full wake PATH is what this proves.)
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let base = std::env::temp_dir().join(format!("treeos-present-loop-W-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    let root = base.join("store");
    let ables = base.join("ables");
    plant_builder_able(&ables);
    std::env::set_var("TREE_ABLES_DIR", &ables);

    let being = "tester3";
    let grant = pj(&format!(
        r#"{{"through":"{being}","verb":"do","act":"set-being","by":"{being}","of":{{"kind":"being","id":"{being}"}},"params":{{"field":"qualities.ablesGranted","value":[{{"able":"builder","anchorSpaceId":"root"}}],"merge":false}}}}"#
    ))
    .unwrap();
    let st = compute_fact_doc("0", &grant, &Head::genesis(), None);
    write_fact_doc(&root, "0", "being", being, &st.doc).expect("grant planted");

    let msg = format!(r#"{{"verb":"summon","being":"{being}","able":"builder","event":"the sky is summoned","correlation":"w1"}}"#);
    let reply = treeos_lib::ibp::handle_wire(&msg, &root);
    let v = treehash::parse(&reply).expect("a JSON reply");
    assert_eq!(get_str(&v, "verb"), Some("summon"));
    assert!(matches!(get(&v, "woke"), Some(Json::Bool(true))), "the being woke: {reply}");
    let moments = get(&v, "moments").and_then(|m| if let Json::Arr(a) = m { Some(a) } else { None }).expect("moments array");
    assert_eq!(moments.len(), 1, "one summon -> one moment on the wire");
    assert_eq!(get_str(&moments[0], "being"), Some(being));
    assert!(get_str(&moments[0], "actId").is_some(), "the wire moment minted an actId");

    let _ = std::fs::remove_dir_all(&base);
    std::env::remove_var("TREE_ABLES_DIR");
    println!("  treeos present-loop Phase 1 (W): wire {{verb:summon}} -> wake -> conductor -> moment reply (Node-free, clock-free)  OK");
}

#[test]
fn scripted_word_file_flow_with_a_parameterized_deed_drives_the_loop() {
    // THE FILE PATH (the gap closed): a scripted being's `.word` FILE carries a PARAMETERIZED flow deed
    // (`do make on the space <id> with { name, type }`). The conductor PARSES the able's flows off
    // disk (no injected decision) and RENDERS the matched effect to the spoken decision Word. The renderer
    // no longer DROPS the deed's target/params (the of.id genesis guard keeps a flow `do make`
    // deed from collapsing to the genesis "I make ."), so the being decides the FULL deed
    // `do make on the space <id> with { name: ..., type: ... }`; end-to-end FROM THE FILE, Node-free.
    //
    // This drives the conductor's REAL decide path: load the able's `.word` flows the same way moment.rs
    // does (entry.flows is None -> read the file), build the inner-face the summon event makes, and run
    // treecognition's scripted decider. Before the fix that decision was the collapsed genesis stub
    // (target + params gone); now it is the complete parameterized Word the file declared. (The literal-id
    // SEAL of a make DEED is the op-word path's job; a flow deed targets `{ref}`, resolved by the
    // op-word body on the real seed vocabulary; the seal RAIL itself is proven by proof (A) above. This
    // proof is the file -> decide -> a COMPLETE parameterized decision Word leg the renderer fix unlocks.)
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let base = std::env::temp_dir().join(format!("treeos-present-loop-F-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    let ables = base.join("ables");
    let space = "thicket";
    plant_flowfile_able(&ables, space); // the DECISION is in the .word FILE, not injected
    std::env::set_var("TREE_ABLES_DIR", &ables);

    // LOAD the flows off disk exactly as the conductor does when entry.flows is None.
    let ables_dir = treeos_lib::config::ables_dir();
    let flows = treeword::parse(&std::fs::read_to_string(ables_dir.join("builder.word")).unwrap());
    let flow_count = flows.iter().filter(|n| get_str(n, "kind") == Some("flow")).count();
    assert_eq!(flow_count, 1, "the .word file declares exactly one flow");
    // the FILE flow's effect; what the spoken Word must re-parse to (target + params intact).
    let want_effect = {
        let flow = flows.iter().find(|n| get_str(n, "kind") == Some("flow")).unwrap();
        let eff0 = match get(flow, "effects") {
            Some(Json::Arr(a)) if !a.is_empty() => a[0].clone(),
            _ => panic!("the file flow has no body effect; the parser dropped it (indent?)"),
        };
        treehash::canonicalize(&Json::Arr(vec![eff0]))
    };

    // the inner-face the summon builds (`state.event` is the trigger clause the `When <event>:` reads).
    let face = obj(vec![("state", obj(vec![("event", Json::Str("the sky is summoned".into()))]))]);
    let no_host = |_: &str, _: &[Json]| false;
    let decision = treecognition::scripted::decide_scripted(&flows, &face, &no_host);

    // the file flow's trigger held and its parameterized deed decided an ACT.
    let content = match &decision {
        treecognition::Cognition::Act { content } => content.clone(),
        other => panic!("expected an Act decided from the .word FILE flow, got {other:?}"),
    };
    // THE FIX: the spoken Word is the FULL deed; it CARRIES the target + the { name, type } params, not
    // the collapsed genesis "I make .". This is the precise round-trip the renderer fix unlocked.
    assert!(content.starts_with("do make on the space "), "spoke the targeted deed (not the genesis stub): {content:?}");
    assert!(content.contains(space), "the deed carries its target id: {content:?}");
    assert!(content.contains(&format!("name: \"{space}\"")), "the deed carries its name param: {content:?}");
    assert!(content.contains("type: \"home-territory\""), "the deed carries its type param: {content:?}");
    // and the spoken Word re-parses to the very effect the FILE flow declared (a clean round-trip).
    let reparsed = treehash::canonicalize(&Json::Arr(treeword::parse(&content)));
    assert_eq!(reparsed, want_effect, "the spoken Word re-parses to the FILE flow's effect (params + target carried, not dropped)");

    let _ = std::fs::remove_dir_all(&base);
    std::env::remove_var("TREE_ABLES_DIR");
    println!("  treeos present-loop Phase 1 (F): scripted .word FILE flow (parameterized deed) -> load-from-file -> decide -> ACT speaks the FULL `do make ... with {{ name, type }}` (target + params carried, not dropped), Node-free  OK");
}

/// The repo root (CARGO_MANIFEST_DIR is seed/treeos), canonicalized — so `seed/store/words/` resolves
/// when the conductor seal (act::run_word) loads an op's `.word` body off disk.
fn repo_root() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."))
        .canonicalize()
        .expect("repo root canonicalizes")
}

/// Plant a scratch scripted "builder" able whose `.word` flow holds a parameterized make deed
/// targeting a bare `{ref}` — with a VALID space type (`place`), so the deed SEALS a real fact (proof F
/// used the illustrative `home-territory` type to prove the render leg; the seal leg must use a type the
/// space type-registry admits). The deed's `<ref>` is a literal id named directly in the flow, which the
/// conductor's seal recovers via derive_trigger's literal-ref recovery (the op-word path's job).
fn plant_seal_flow_able(ables_dir: &std::path::Path, space_ref: &str) {
    std::fs::create_dir_all(ables_dir).unwrap();
    let body = [
        "# scratch scripted builder whose flow SEALS a real make (valid space type).".to_string(),
        "A builder is an able.".to_string(),
        "A builder can do make.".to_string(),
        "A builder can see place.".to_string(),
        "A builder reaches /**.".to_string(),
        "A builder needs scripted cognition.".to_string(),
        String::new(),
        "When the sky is summoned:".to_string(),
        format!("  do make on the space {space_ref} with {{ name: \"{space_ref}\", type: \"place\" }}."),
        String::new(),
    ]
    .join("\n");
    std::fs::write(ables_dir.join("builder.word"), body).unwrap();
}

#[test]
fn scripted_word_file_flow_deed_seals_a_real_fact_end_to_end() {
    // THE SEAL leg of the file-flow proof: a scripted being's `.word` flow deed
    // `do make on the space <ref> with { name, type }` is SUMMONED -> the conductor WAKES it,
    // DECIDES the parameterized Word off the FILE, and SEALS it through act::run_word -> act_via_fold.
    // The deed targets a bare `{ref}` (no resolved id), so the seal MUST run it through the op-word path
    // (op_word_via_fold resolves `make` from the chain word-fold; derive_trigger's literal-ref
    // recovery supplies the `{ref}` id; the make `.word` body runs through the host see-op and
    // enriches the fact). The proof: a REAL make fact stamps + its space reel chain-VERIFIES.
    //
    // The vocabulary must be coined on chain for `make` to fold as a kind:"op" word, so this
    // proof births a real genesis world first (treebook::full_genesis) — the SAME world the runtime
    // serves. Node-free (pure Rust over the spine) and clock-free (the only ord is the append count).
    let _guard = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    // cwd = repo root so act::run_word's `seed/store/words` relative path resolves to the rust store's
    // word bodies on disk (the bottom-turtle file map; `seed/` IS the rust workspace since the
    // restructure). Harmless to the other tests (they key off absolute scratch paths), ENV_LOCK-serialized.
    std::env::set_current_dir(repo_root()).unwrap();

    let base = std::env::temp_dir().join(format!("treeos-present-loop-Fseal-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&base);
    let root = base.join("store");

    // 1. BIRTH a real world: the vocabulary coined (so `make` resolves as an op word), the
    //    spaces/delegates created, the grants run — exactly the runtime's born world, Node-free.
    //    (M1B: full_genesis boots from the EMBEDDED store — the reading order is book/index.word.)
    let born = treebook::full_genesis(&root).expect("the genesis world is born");
    assert!(born.vocabulary_coined > 400, "the vocabulary coined ({})", born.vocabulary_coined);

    // 2. a scripted being granted the builder able whose FILE flow holds the parameterized deed.
    let ables = base.join("ables");
    let space_ref = "homegrove";
    plant_seal_flow_able(&ables, space_ref);
    std::env::set_var("TREE_ABLES_DIR", &ables);

    let being = "homesteader";
    let grant = pj(&format!(
        r#"{{"through":"{being}","verb":"do","act":"set-being","by":"{being}","of":{{"kind":"being","id":"{being}"}},"params":{{"field":"qualities.ablesGranted","value":[{{"able":"builder","anchorSpaceId":"root"}}],"merge":false}}}}"#
    ))
    .unwrap();
    let st = compute_fact_doc("0", &grant, &Head::genesis(), None);
    write_fact_doc(&root, "0", "being", being, &st.doc).expect("grant planted");

    // 3. SUMMON on the flow's trigger event; flows = None so the conductor LOADS them off the .word file.
    let mut entry = Entry::event("corr-Fseal", "the sky is summoned");
    entry.able = Some("builder".to_string());
    let reports = wake_sync(being, entry, &root);

    // ── the being WOKE and ran exactly one moment, deciding the FULL parameterized Word ─────────────
    assert_eq!(reports.len(), 1, "one summon -> one moment");
    let r = &reports[0];
    assert_eq!(r.mode, "scripted", "the able routed to scripted cognition");
    assert!(r.acted(), "the file flow's deed decided an ACT (not See/Failure): {:?}", r.decision);
    if let treecognition::Cognition::Act { content } = &r.decision {
        assert!(content.starts_with("do make on the space "), "the decided Word is the targeted deed: {content:?}");
        assert!(content.contains(space_ref), "the decided Word carries its `{{ref}}`: {content:?}");
    }

    // ── the SEAL stamped a real make fact (NOT just rendered) ────────────────────────────────
    assert_eq!(r.facts.len(), 1, "the decided Word SEALED exactly one fact: {}", treehash::stringify(&Json::Arr(r.facts.clone())));
    assert!(ok_true(&r.facts[0]), "the stamped fact is authorized (the seal RAIL did not refuse): {}", treehash::stringify(&r.facts[0]));
    let stamped = get(&r.facts[0], "fact").expect("a stamped fact row");
    assert_eq!(get_str(stamped, "act"), Some("make"), "the SEAL is a make fact");
    assert_eq!(get_str(stamped, "verb"), Some("do"), "a do-fact");
    assert_eq!(get_str(stamped, "through"), Some(being), "attributed through the acting being");
    // the make op DERIVES the new space's reel id (id-from-nature); read it off the sealed fact.
    let new_space_id = get(stamped, "of").and_then(|o| get_str(o, "id")).expect("the sealed fact names its space reel id").to_string();
    assert!(!new_space_id.is_empty(), "the op-word path resolved + enriched the fact's target id (not null)");
    // the params the deed carried rode into the enriched fact (the `{ name, type }` the flow declared).
    let params = get(stamped, "params").expect("the enriched fact carries params");
    assert_eq!(get_str(params, "name"), Some(space_ref), "the deed's name param enriched the fact");
    assert_eq!(get_str(params, "type"), Some("place"), "the deed's type param enriched the fact");

    // ── the new space reel EXISTS on disk + the chain VERIFIES ───────────────────────────────────────
    let new_reel = read_reel_file(&root, "0", "space", &new_space_id, None, None);
    assert_eq!(new_reel.len(), 1, "the conductor's SEAL birthed the new space reel ({new_space_id})");
    assert_eq!(get_str(&new_reel[0], "act"), Some("make"), "the reel's first fact is the sealed make");
    let verdict = verify_fact_chain(&new_reel);
    assert!(ok_true(&verdict), "the sealed space chain verifies: {}", treehash::stringify(&verdict));

    let _ = std::fs::remove_dir_all(&base);
    std::env::remove_var("TREE_ABLES_DIR");
    println!("  treeos present-loop Phase 1 (F-seal): scripted .word FILE flow deed (`do make on the space {{ref}} with {{ name, type }}`) -> summon -> wake -> decide -> SEAL via the op-word path (op_word_via_fold + literal-ref recovery) -> a REAL make fact lands + chain-verifies (Node-free, clock-free)  OK");
}
