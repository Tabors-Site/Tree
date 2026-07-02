// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The moment seal — commitMoment's pure orchestration (everything before applyRecord writes the bytes).
// Threads the per-reel heads, stamps each fact (compute_fact_doc), attaches the moment's append ordinal
// to every fact, and enforces ONE ACT = ONE FACT = ONE REEL: a fan-out across >1 reel is the run-on the
// no-journal floor can't tail-truncate (project_stamper_is_the_commit). The head reads/writes are the
// I/O (store.rs); this is the deterministic core that decides WHAT gets written.

use std::collections::HashMap;

use treehash::Json;

use crate::stamp::{compute_fact_doc, Head};

/// The fact specs a moment lays. The reel is (history, kind, id); `spec` is the fact content the stamp
/// derives identity over.
pub struct FactSpec<'a> {
    pub history: &'a str,
    pub kind: &'a str,
    pub id: &'a str,
    pub spec: &'a Json,
}

/// One fact in a sealed moment: where it lands + its full stamped doc.
#[derive(Debug, Clone)]
pub struct SealedFact {
    pub history: String,
    pub kind: String,
    pub id: String,
    pub doc: Json,
}

/// A sealed moment: the stamped facts, the distinct reels they touch (insertion order), and whether the
/// act fanned across >1 reel (the run-on the floor's truncation recovery rests on NOT happening).
#[derive(Debug, Clone)]
pub struct Seal {
    pub facts: Vec<SealedFact>,
    pub reels: Vec<String>,
    pub fanout: bool,
}

/// seal_moment: compute each fact's identity ONCE, threading per-reel heads (a multi-fact moment on one
/// reel chains seq 1,2,3...), attach the moment's `ord` to every fact (non-digest, like `date`), and flag
/// a fan-out. `read_head(history, kind, id)` supplies a reel's starting head (the fs in production, an
/// in-memory map in tests). Mirrors commitMoment's pre-apply loop exactly.
pub fn seal_moment<F>(specs: &[FactSpec<'_>], ord: Option<f64>, read_head: F) -> Seal
where
    F: Fn(&str, &str, &str) -> Head,
{
    let mut heads: HashMap<String, Head> = HashMap::new();
    let mut facts: Vec<SealedFact> = Vec::new();
    let mut reels: Vec<String> = Vec::new();
    for fs in specs {
        let key = format!("{}:{}:{}", fs.history, fs.kind, fs.id);
        let head = heads
            .get(&key)
            .cloned()
            .unwrap_or_else(|| read_head(fs.history, fs.kind, fs.id));
        let stamped = compute_fact_doc(fs.history, fs.spec, &head, ord);
        heads.insert(key.clone(), stamped.next_head);
        if !reels.contains(&key) {
            reels.push(key.clone());
        }
        facts.push(SealedFact {
            history: fs.history.to_string(),
            kind: fs.kind.to_string(),
            id: fs.id.to_string(),
            doc: stamped.doc,
        });
    }
    let fanout = reels.len() > 1;
    Seal { facts, reels, fanout }
}
