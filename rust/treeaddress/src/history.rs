// treeaddress::history — history-path arithmetic (port of seed/materials/history/historyPath.js). The
// generative side of the `#branch` grammar the address parser validates: paths form a tree rooted at
// "0" (main), each level alternating number / letter segments:
//
//   Level 0: "0"   Level 1: "1","2",…   Level 2: "1a","1b",…,"1z","1za",…   Level 3: "1a1",…
//
// Letter wrap (the z-prefix scheme): a..z, za..zz, zza..zzz, … (1->a, 26->z, 27->za, 52->zz, 53->zza).
// Numbers are ordinary decimal. Numbering is STABLE: the next sibling is "highest existing + 1", never
// "count of siblings", so a deleted branch's number is never reused. PURE.

/// The segment type at a level: levels alternate number / letter, number first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SegType {
    Number,
    Letter,
}

fn is_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}
fn is_letters(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_lowercase())
}

/// Parse a history path into ordered segments. "0"/""/null -> []; "1a" -> ["1","a"]; "22zb3" ->
/// ["22","zb","3"]. Errors on a non `[0-9a-z]` char or a number/letter alternation violation.
pub fn parse_history_path(path: &str) -> Result<Vec<String>, String> {
    if path.is_empty() || path == "0" {
        return Ok(vec![]);
    }
    let mut out: Vec<String> = Vec::new();
    let mut buf = String::new();
    let mut mode: Option<SegType> = None;
    for ch in path.chars() {
        let m = if ch.is_ascii_digit() {
            SegType::Number
        } else if ch.is_ascii_lowercase() {
            SegType::Letter
        } else {
            return Err(format!("parseHistoryPath: invalid char \"{ch}\" in path \"{path}\""));
        };
        match mode {
            None => {
                mode = Some(m);
                buf.push(ch);
            }
            Some(cur) if cur == m => buf.push(ch),
            Some(_) => {
                out.push(std::mem::take(&mut buf));
                buf.push(ch);
                mode = Some(m);
            }
        }
    }
    if !buf.is_empty() {
        out.push(buf);
    }
    // alternation: first segment must be a number, then alternate.
    let mut expected = SegType::Number;
    for (i, seg) in out.iter().enumerate() {
        let got = if is_digits(seg) {
            SegType::Number
        } else if is_letters(seg) {
            SegType::Letter
        } else {
            return Err(format!("parseHistoryPath: segment[{i}] \"{seg}\" invalid in path \"{path}\""));
        };
        if got != expected {
            return Err(format!("parseHistoryPath: segment[{i}] \"{seg}\" violates alternation in path \"{path}\""));
        }
        expected = if expected == SegType::Number { SegType::Letter } else { SegType::Number };
    }
    Ok(out)
}

/// The expected segment type at the next level under `parent_path` (main's children are numbers; then
/// alternating). Errors if `parent_path` is itself malformed.
pub fn next_segment_type(parent_path: &str) -> Result<SegType, String> {
    let segs = parse_history_path(parent_path)?;
    let child_depth = segs.len() + 1;
    Ok(if child_depth % 2 == 1 { SegType::Number } else { SegType::Letter })
}

/// 1-based ordinal -> letter segment (z-prefix): 1->"a", 26->"z", 27->"za", 52->"zz", 53->"zza".
pub fn ordinal_to_letter_segment(ordinal: usize) -> String {
    assert!(ordinal >= 1, "ordinalToLetterSegment: ordinal must be >= 1, got {ordinal}");
    let block = (ordinal - 1) / 26;
    let offset = (ordinal - 1) % 26;
    let final_char = (b'a' + offset as u8) as char;
    format!("{}{final_char}", "z".repeat(block))
}

/// Inverse of `ordinal_to_letter_segment`. Errors if `seg` violates the z-prefix scheme.
pub fn letter_segment_to_ordinal(seg: &str) -> Result<usize, String> {
    if !is_letters(seg) {
        return Err(format!("letterSegmentToOrdinal: \"{seg}\" is not a letter segment"));
    }
    let bytes = seg.as_bytes();
    for &b in &bytes[..bytes.len() - 1] {
        if b != b'z' {
            return Err(format!("letterSegmentToOrdinal: \"{seg}\" violates the z-prefix scheme"));
        }
    }
    let block = seg.len() - 1;
    let offset = (bytes[bytes.len() - 1] - b'a') as usize;
    Ok(block * 26 + offset + 1)
}

/// The next letter segment given the existing letter siblings (max ordinal + 1).
pub fn next_letter_segment(existing: &[String]) -> String {
    let max_ord = existing.iter().filter(|s| is_letters(s)).filter_map(|s| letter_segment_to_ordinal(s).ok()).max().unwrap_or(0);
    ordinal_to_letter_segment(max_ord + 1)
}

/// The next number segment given existing siblings (max + 1, plain decimal).
pub fn next_number_segment(existing: &[String]) -> String {
    let max_n = existing.iter().filter(|s| is_digits(s)).filter_map(|s| s.parse::<u64>().ok()).max().unwrap_or(0);
    (max_n + 1).to_string()
}

/// The new child path under `parent_path`: pick the next segment of the right type among the direct
/// children, append it. Errors if `parent_path` is malformed.
pub fn next_child_path(parent_path: &str, existing_children: &[String]) -> Result<String, String> {
    let parent_segs = parse_history_path(parent_path)?;
    let expected = next_segment_type(parent_path)?;
    let mut child_segs: Vec<String> = Vec::new();
    for c in existing_children {
        let segs = match parse_history_path(c) {
            Ok(s) => s,
            Err(_) => continue,
        };
        if segs.len() != parent_segs.len() + 1 {
            continue; // not a direct child
        }
        if segs[..parent_segs.len()] != parent_segs[..] {
            continue; // prefix mismatch
        }
        child_segs.push(segs[segs.len() - 1].clone());
    }
    let new_seg = match expected {
        SegType::Number => next_number_segment(&child_segs),
        SegType::Letter => next_letter_segment(&child_segs),
    };
    Ok(format!("{}{new_seg}", parent_segs.concat()))
}

/// Is `path` a syntactically well-formed history path?
pub fn is_valid_history_path(path: &str) -> bool {
    path == "0" || path.is_empty() || parse_history_path(path).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(xs: &[&str]) -> Vec<String> {
        xs.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_and_alternates() {
        assert_eq!(parse_history_path("0").unwrap(), Vec::<String>::new());
        assert_eq!(parse_history_path("1").unwrap(), v(&["1"]));
        assert_eq!(parse_history_path("1a").unwrap(), v(&["1", "a"]));
        assert_eq!(parse_history_path("22zb3").unwrap(), v(&["22", "zb", "3"]));
        // first segment must be a number; "a" alone violates alternation
        assert!(parse_history_path("a").is_err());
        // a non-grammar char
        assert!(parse_history_path("1-2").is_err());
    }

    #[test]
    fn next_segment_type_alternates() {
        assert_eq!(next_segment_type("0").unwrap(), SegType::Number); // main's children are numbers
        assert_eq!(next_segment_type("1").unwrap(), SegType::Letter); // a number's children are letters
        assert_eq!(next_segment_type("1a").unwrap(), SegType::Number); // a letter's children are numbers
    }

    #[test]
    fn letter_ordinal_round_trips_the_z_scheme() {
        let cases = [(1, "a"), (26, "z"), (27, "za"), (28, "zb"), (52, "zz"), (53, "zza"), (78, "zzz")];
        for (ord, seg) in cases {
            assert_eq!(ordinal_to_letter_segment(ord), seg, "ord {ord}");
            assert_eq!(letter_segment_to_ordinal(seg).unwrap(), ord, "seg {seg}");
        }
        // a non-z prefix is rejected
        assert!(letter_segment_to_ordinal("ab").is_err());
    }

    #[test]
    fn next_segments_are_stable_max_plus_one() {
        // numbers: stable (max+1), not count — a deleted #1 never reused
        assert_eq!(next_number_segment(&v(&["1", "2", "5"])), "6");
        assert_eq!(next_number_segment(&[]), "1");
        // letters: max ordinal + 1, with z-wrap
        assert_eq!(next_letter_segment(&v(&["a", "b"])), "c");
        assert_eq!(next_letter_segment(&v(&["z"])), "za");
        assert_eq!(next_letter_segment(&[]), "a");
    }

    #[test]
    fn next_child_path_picks_type_and_appends() {
        // under main "0": children are numbers; existing #1,#2 -> #3
        assert_eq!(next_child_path("0", &v(&["1", "2"])).unwrap(), "3");
        // under "1": children are letters; existing "1a" -> "1b"
        assert_eq!(next_child_path("1", &v(&["1a"])).unwrap(), "1b");
        // under "1a": children are numbers; none yet -> "1a1"
        assert_eq!(next_child_path("1a", &[]).unwrap(), "1a1");
        // non-direct children are ignored (a grandchild "1a1" doesn't count as a child of "1")
        assert_eq!(next_child_path("1", &v(&["1a", "1a1"])).unwrap(), "1b");
    }

    #[test]
    fn validity() {
        assert!(is_valid_history_path("0") && is_valid_history_path("22zb3"));
        assert!(!is_valid_history_path("a") && !is_valid_history_path("1-2"));
    }
}
