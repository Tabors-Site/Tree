// Conformance for the act-log + the moment seal.
//
//   A. ACT STAMP   — compute_act_doc reproduces computeActId + the act doc {_id, p, ...opening}
//                    byte-for-byte (and the digest excludes startMessage while the line keeps it).
//   B. REAL act-log — Rust read_act_chain + verify_act_chain read + verify a .acts the actual
//                    appendActLine + advanceActHeadFile CAS wrote; the .acthead matches.
//   C. MOMENT SEAL — seal_moment reproduces commitMoment's head-threading + ord + fan-out flag.

use treestore::{
    act_line, canonicalize, compute_act_doc, parse, read_act_chain, seal_moment, verify_act_chain,
    FactSpec, Head, Json,
};

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn as_str(v: &Json) -> &str {
    match v {
        Json::Str(s) => s.as_str(),
        _ => "",
    }
}
fn as_arr(v: &Json) -> &[Json] {
    match v {
        Json::Arr(a) => a.as_slice(),
        _ => &[],
    }
}
fn field<'a>(v: &'a Json, k: &str) -> &'a Json {
    get(v, k).expect(k)
}
fn verdict_ok(v: &Json) -> bool {
    matches!(get(v, "ok"), Some(Json::Bool(true)))
}

#[test]
fn act_log_and_seal_conformance() {
    let raw = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/act.vectors.json"))
        .expect("read act.vectors.json");
    let doc = parse(&raw).expect("parse act.vectors.json");

    // ── A: the act stamp, byte-for-byte ─────────────────────────────────────
    let av = as_arr(field(&doc, "actStampVectors"));
    let mut a_pass = 0;
    let mut a_fail: Vec<String> = Vec::new();
    for v in av {
        let name = as_str(field(v, "name"));
        let opening = field(v, "opening");
        let head_hash = as_str(field(v, "headHash"));
        let want_line = as_str(field(v, "line"));
        let want_id = as_str(field(v, "id"));

        let stamped = compute_act_doc(opening, head_hash);
        if act_line(&stamped.doc) == want_line && stamped.id == want_id {
            a_pass += 1;
        } else {
            a_fail.push(format!(
                "  {name}\n    line want: {want_line:?}\n    line got:  {:?}\n    id want: {want_id}  got: {}",
                act_line(&stamped.doc),
                stamped.id
            ));
        }
    }
    println!("  treestore ACT STAMP (Rust) vs golden:  {}/{} byte-identical", a_pass, av.len());
    assert!(a_fail.is_empty(), "act-stamp mismatches:\n{}", a_fail.join("\n"));

    // ── B: Rust reads + verifies a REAL act-log the JS CAS wrote ─────────────
    let real = field(&doc, "realActLog");
    let acts_text = as_str(field(real, "actsText"));
    let want_acts = as_arr(field(real, "acts"));
    let head_expected = as_str(field(real, "headExpected"));

    let parsed = read_act_chain(acts_text);
    assert_eq!(parsed.len(), want_acts.len(), "real act-log: act count differs from JS readActChain");
    for (i, (g, w)) in parsed.iter().zip(want_acts).enumerate() {
        assert_eq!(canonicalize(g), canonicalize(w), "real act-log: act {i} differs from JS");
    }
    let verdict = verify_act_chain(&parsed);
    assert!(verdict_ok(&verdict), "real act-log failed chain verify: {}", canonicalize(&verdict));
    assert_eq!(
        get(&verdict, "headHash").map(as_str).unwrap_or(""),
        head_expected,
        "real act-log: chain head differs from the .acthead",
    );
    println!("  treestore reads the REAL JS act-log:  {} acts, chain verified, head matches", parsed.len());

    // ── C: the moment seal (head-threading + ord + fan-out) ─────────────────
    let sv = as_arr(field(&doc, "sealVectors"));
    let mut s_pass = 0;
    let mut s_fail: Vec<String> = Vec::new();
    for v in sv {
        let name = as_str(field(v, "name"));
        let ord = match get(v, "ord") {
            Some(Json::Num(n)) => Some(*n),
            _ => None,
        };
        let specs_json = as_arr(field(v, "specs"));
        let owned: Vec<(String, String, String, &Json)> = specs_json
            .iter()
            .map(|s| {
                (
                    as_str(field(s, "history")).to_string(),
                    as_str(field(s, "kind")).to_string(),
                    as_str(field(s, "id")).to_string(),
                    field(s, "spec"),
                )
            })
            .collect();
        let fact_specs: Vec<FactSpec> = owned
            .iter()
            .map(|(h, k, i, sp)| FactSpec { history: h, kind: k, id: i, spec: sp })
            .collect();

        let seal = seal_moment(&fact_specs, ord, |_, _, _| Head::genesis());

        let want_facts = as_arr(field(v, "facts"));
        let want_reels: Vec<&str> = as_arr(field(v, "reels")).iter().map(as_str).collect();
        let want_fanout = matches!(get(v, "fanout"), Some(Json::Bool(true)));

        let mut ok = seal.fanout == want_fanout
            && seal.reels == want_reels
            && seal.facts.len() == want_facts.len();
        if ok {
            for (g, w) in seal.facts.iter().zip(want_facts) {
                if canonicalize(&g.doc) != canonicalize(field(w, "doc")) {
                    ok = false;
                    break;
                }
            }
        }
        if ok {
            s_pass += 1;
        } else {
            s_fail.push(format!("  {name}: fanout {} reels {:?}", seal.fanout, seal.reels));
        }
    }
    println!("  treestore SEAL (Rust) vs commitMoment:  {}/{} match (docs + reels + fan-out)", s_pass, sv.len());
    assert!(s_fail.is_empty(), "seal mismatches:\n{}", s_fail.join("\n"));
}
