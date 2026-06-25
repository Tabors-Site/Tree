// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Canonical JSON — the byte-for-byte twin of seed/past/fact/hash.js's
// `canonicalize` (= JSON.stringify(toCanonical(value))). This MUST stay
// identical to the JS forever: it is a versioned wire format; past reels only
// verify if every byte matches. The conformance vectors pin it.
//
// Rules (from the JS + the vectors' note):
//   - object keys sorted recursively, by UTF-16 code units (JS String sort)
//   - undefined object values dropped (n/a for parsed JSON; the Rust callers in
//     hash.rs simply omit absent keys, which is the same thing)
//   - empty-object {} values dropped (recursively, bottom-up)
//   - empty arrays [] kept; null kept; array undefined -> null
//   - NaN / Infinity -> null
//   - strings escaped exactly as JSON.stringify does (\" \\ \b \t \n \f \r,
//     other control chars as \u00xx lowercase, everything else raw UTF-8)
//   - numbers formatted exactly as ECMAScript Number::toString / JSON.stringify
//     (shortest round-trip digits, e+21 / e-7 exponent rules, -0 -> "0")

use crate::json::Json;

/// `JSON.stringify(toCanonical(value))`.
pub fn canonicalize(value: &Json) -> String {
    let mut out = String::new();
    write_value(&to_canonical(value), &mut out);
    out
}

/// The structural normalization (key sort + empty-object drop), before serialization.
pub fn to_canonical(value: &Json) -> Json {
    match value {
        Json::Arr(items) => Json::Arr(items.iter().map(to_canonical).collect()),
        Json::Obj(entries) => {
            let mut kept: Vec<(String, Json)> = Vec::new();
            for (k, v) in entries {
                let cv = to_canonical(v);
                if matches!(&cv, Json::Obj(e) if e.is_empty()) {
                    continue; // empty-object value dropped (recursively)
                }
                kept.push((k.clone(), cv));
            }
            // JS Array.prototype.sort() on keys: UTF-16 code-unit order.
            kept.sort_by(|a, b| a.0.encode_utf16().cmp(b.0.encode_utf16()));
            Json::Obj(kept)
        }
        Json::Num(n) if !n.is_finite() => Json::Null, // NaN/Infinity -> null
        other => other.clone(),
    }
}

fn write_value(v: &Json, out: &mut String) {
    match v {
        Json::Null => out.push_str("null"),
        Json::Bool(true) => out.push_str("true"),
        Json::Bool(false) => out.push_str("false"),
        Json::Num(n) => out.push_str(&format_number(*n)),
        Json::Str(s) => write_string(s, out),
        Json::Arr(items) => {
            out.push('[');
            for (i, it) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_value(it, out);
            }
            out.push(']');
        }
        Json::Obj(entries) => {
            out.push('{');
            for (i, (k, val)) in entries.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_string(k, out);
                out.push(':');
                write_value(val, out);
            }
            out.push('}');
        }
    }
}

/// JSON string escaping, exactly as JSON.stringify.
fn write_string(s: &str, out: &mut String) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{0009}' => out.push_str("\\t"),
            '\u{000A}' => out.push_str("\\n"),
            '\u{000C}' => out.push_str("\\f"),
            '\u{000D}' => out.push_str("\\r"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// ECMAScript Number::toString (base 10), the format JSON.stringify emits.
/// Strategy: take Rust's shortest round-trip scientific form (`{:e}`), pull out the
/// significant digits and the decimal-point position `n`, then apply the ES layout
/// rules (6.1.6.1.20). This reproduces `1e+21`, `0.1`, `9007199254740991`, etc.
fn format_number(n: f64) -> String {
    if n == 0.0 {
        return "0".to_string(); // also normalizes -0.0 -> "0"
    }
    if !n.is_finite() {
        return "null".to_string(); // unreachable via to_canonical; defensive
    }
    let neg = n < 0.0;
    let sci = format!("{:e}", n.abs()); // e.g. "1.5e0", "1e21", "9.007199254740991e15", "1e-1"
    let (mant, exp_str) = sci.split_once('e').expect("rust {:e} always has an exponent");
    let exp: i32 = exp_str.parse().expect("valid exponent");
    let digits: String = mant.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32; // count of significant digits
    let n_pos = exp + 1; // ES `n`: value = digits * 10^(n - k)
    let body = ecma_layout(&digits, k, n_pos);
    if neg {
        format!("-{}", body)
    } else {
        body
    }
}

fn ecma_layout(s: &str, k: i32, n: i32) -> String {
    if k <= n && n <= 21 {
        // integer: digits then (n - k) trailing zeros
        let mut out = String::from(s);
        for _ in 0..(n - k) {
            out.push('0');
        }
        out
    } else if 0 < n && n <= 21 {
        // decimal point inside the digits
        format!("{}.{}", &s[..n as usize], &s[n as usize..])
    } else if -6 < n && n <= 0 {
        // 0.00…digits
        let mut out = String::from("0.");
        for _ in 0..(-n) {
            out.push('0');
        }
        out.push_str(s);
        out
    } else {
        // exponential
        let mantissa = if k == 1 {
            s.to_string()
        } else {
            format!("{}.{}", &s[..1], &s[1..])
        };
        let e = n - 1;
        let sign = if e >= 0 { "+" } else { "-" };
        format!("{}e{}{}", mantissa, sign, e.abs())
    }
}
