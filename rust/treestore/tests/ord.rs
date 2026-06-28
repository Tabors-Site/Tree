// ord: the per-store GLOBAL append ordinal is monotone + per-store isolated + checkpointed, and
// moment_order gives the deterministic global timeline total order — (ord ASC, then actId/_id), the
// id tiebreak being the "coin-flip" for equal ords, with pre-ordinal (no-ord) rows sorting first.

use treestore::{moment_order, next_ord, parse as pj, read_ord, Json};

#[test]
fn next_ord_is_monotone_and_read_ord_tracks_it() {
    let dir = std::env::temp_dir().join("treestore-ord-mono");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    assert_eq!(read_ord(&dir), 0.0, "no ord before any allocation");
    let (a, b, c) = (next_ord(&dir), next_ord(&dir), next_ord(&dir));
    assert_eq!((a, b, c), (1.0, 2.0, 3.0), "monotone from 1");
    assert_eq!(read_ord(&dir), 3.0, "read_ord = the last allocated (the world's now)");
    assert!(dir.join(".ord").exists(), ".ord checkpoint persisted (the first allocation flushes it)");

    let _ = std::fs::remove_dir_all(&dir);
    println!("  treestore ord: next_ord monotone from 1, read_ord tracks the now, .ord checkpointed  OK");
}

#[test]
fn each_store_has_its_own_ord_space() {
    let a = std::env::temp_dir().join("treestore-ord-iso-a");
    let b = std::env::temp_dir().join("treestore-ord-iso-b");
    for d in [&a, &b] {
        let _ = std::fs::remove_dir_all(d);
        std::fs::create_dir_all(d).unwrap();
    }

    assert_eq!(next_ord(&a), 1.0);
    assert_eq!(next_ord(&a), 2.0);
    assert_eq!(next_ord(&b), 1.0, "store b runs its OWN ord space from 1, not 3");
    assert_eq!(next_ord(&a), 3.0, "store a continues independently (one forest = one ord space)");

    for d in [&a, &b] {
        let _ = std::fs::remove_dir_all(d);
    }
    println!("  treestore ord: each store root is an independent ord space  OK");
}

fn actid_of(row: &Json) -> &str {
    match row {
        Json::Obj(e) => e
            .iter()
            .find(|(k, _)| k == "actId")
            .and_then(|(_, v)| if let Json::Str(s) = v { Some(s.as_str()) } else { None })
            .unwrap_or(""),
        _ => "",
    }
}

#[test]
fn moment_order_is_ord_then_id_with_genesis_first() {
    let row = |ord: Option<f64>, id: &str| -> Json {
        match ord {
            Some(o) => pj(&format!(r#"{{"ord":{o},"actId":"{id}"}}"#)).unwrap(),
            None => pj(&format!(r#"{{"actId":"{id}"}}"#)).unwrap(),
        }
    };
    let mut rows = vec![
        row(Some(5.0), "zeta"),
        row(Some(2.0), "alpha"),
        row(Some(5.0), "alpha"), // same ord 5 as zeta -> id tiebreak (alpha < zeta)
        row(None, "genesis"),    // no ord -> pre-ordinal -> sorts FIRST
        row(Some(2.0), "beta"),
    ];
    rows.sort_by(moment_order);
    let ids: Vec<&str> = rows.iter().map(actid_of).collect();
    assert_eq!(
        ids,
        vec!["genesis", "alpha", "beta", "alpha", "zeta"],
        "genesis(no ord) first; then ord 2 (alpha,beta); then ord 5 (alpha,zeta) by the id coin-flip"
    );
    println!("  treestore ord: moment_order = (ord, then id) total order, genesis-first  OK");
}
