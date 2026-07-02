// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Path helpers shared by the reel store and the act-log: the 2-char shard (so no directory holds
// millions of files) and pathSafe (so a hostile story/history/being id can never escape its root).

/// fileStore.js `shard`: first 2 chars, or pad to 2 with `_`.
pub fn shard(id: &str) -> String {
    let chars: Vec<char> = id.chars().collect();
    if chars.len() >= 2 {
        chars[..2].iter().collect()
    } else {
        let mut s: String = chars.iter().collect();
        while s.chars().count() < 2 {
            s.push('_');
        }
        s
    }
}

/// fileStore.js `pathSafe`: `String(s).replace(/[^A-Za-z0-9._-]/g, "_") || "_"` — no path traversal.
pub fn path_safe(s: &str) -> String {
    let out: String = s
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if out.is_empty() {
        "_".to_string()
    } else {
        out
    }
}
