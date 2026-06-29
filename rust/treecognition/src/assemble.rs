// treecognition::assemble — build the model's INPUT as WORD, not JSON tool-schemas (word/14.md swap
// #1). Order is STABLE -> VOLATILE for prefix-cache alignment: identity + the granted vocabulary (what
// this being can speak) first, the perceived face last. PURE + deterministic.
//
// NOTE: the exact prose here is the tunable surface (a model-prompt concern, refined against real
// decode behavior). What is load-bearing is the SHAPE — Word-native vocabulary + a Word-native face,
// no JSON schemas — and that it is a pure function of (identity, able spec, face).

use treehash::Json;

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}
fn s<'a>(v: &'a Json, k: &str) -> &'a str {
    match get(v, k) {
        Some(Json::Str(x)) => x,
        _ => "",
    }
}
/// The string words of an able-spec list (canDo / canSee / …); a `canCall` entry may be `{pattern,as}`.
fn words(spec: &Json, key: &str) -> Vec<String> {
    match get(spec, key) {
        Some(Json::Arr(a)) => a
            .iter()
            .map(|w| match w {
                Json::Str(x) => x.clone(),
                obj => s(obj, "pattern").to_string(),
            })
            .filter(|x| !x.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

/// Build the system prompt: identity + granted vocabulary (stable head) then the perceived face
/// (volatile tail). `identity` = `{name, able, space}`; `able_spec` = the folded `{canDo,canSee,
/// canCall,canBe,...}` (treeibp::fold_able_noun); `face` = the perceived inner-face (the projection).
pub fn build_prompt(identity: &Json, able_spec: &Json, face: &Json) -> String {
    let mut out = String::new();
    // 1. identity
    out.push_str(&format!("I am {}, {} at {}.\n", s(identity, "name"), s(identity, "able"), s(identity, "space")));

    // 2. the vocabulary I may speak — Word, not schemas (the stable head)
    let line = |label: &str, ws: Vec<String>| {
        if ws.is_empty() {
            String::new()
        } else {
            format!("I can {label}: {}.\n", ws.join(", "))
        }
    };
    out.push_str(&line("do", words(able_spec, "canDo")));
    out.push_str(&line("see", words(able_spec, "canSee")));
    out.push_str(&line("call", words(able_spec, "canCall")));
    out.push_str(&line("be", words(able_spec, "canBe")));

    // 3. the face I perceive now (the volatile tail) — rendered as Word blocks, not JSON
    out.push_str("\nWhat I perceive now:\n");
    out.push_str(&render_face(face));

    out
}

/// Render the perceived face as Word blocks ("label:\n  key: value"). The face's `seen` array holds the
/// canSee blocks; absent or empty, the being perceives nothing.
fn render_face(face: &Json) -> String {
    let seen = match get(face, "seen") {
        Some(Json::Arr(a)) if !a.is_empty() => a,
        _ => return "  (nothing)\n".to_string(),
    };
    let mut out = String::new();
    for block in seen {
        let label = s(block, "label");
        if !label.is_empty() {
            out.push_str(&format!("{label}:\n"));
        }
        if let Some(Json::Obj(payload)) = get(block, "payload") {
            for (k, v) in payload {
                out.push_str(&format!("  {k}: {}\n", scalar(v)));
            }
        }
    }
    out
}

/// A face value flattened to one readable scalar (objects/arrays summarized, not dumped as JSON).
fn scalar(v: &Json) -> String {
    match v {
        Json::Str(x) => x.clone(),
        Json::Bool(b) => b.to_string(),
        Json::Num(n) => {
            if n.is_finite() && n.fract() == 0.0 && n.abs() < 1e15 {
                format!("{}", *n as i64)
            } else {
                format!("{n}")
            }
        }
        Json::Null => "nothing".to_string(),
        Json::Arr(a) => format!("{} items", a.len()),
        Json::Obj(_) => "{…}".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jstr(x: &str) -> Json {
        Json::Str(x.to_string())
    }
    fn obj(f: Vec<(&str, Json)>) -> Json {
        Json::Obj(f.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
    }

    #[test]
    fn prompt_is_word_native_stable_then_volatile() {
        let identity = obj(vec![("name", jstr("Cain")), ("able", jstr("farmer")), ("space", jstr("the field"))]);
        let spec = obj(vec![("canDo", Json::Arr(vec![jstr("plant"), jstr("harvest")])), ("canSee", Json::Arr(vec![jstr("weather")]))]);
        let face = obj(vec![("seen", Json::Arr(vec![obj(vec![("label", jstr("weather")), ("payload", obj(vec![("sky", jstr("clear"))]))])]))]);

        let p = build_prompt(&identity, &spec, &face);
        assert!(p.starts_with("I am Cain, farmer at the field."));
        assert!(p.contains("I can do: plant, harvest."));
        assert!(p.contains("I can see: weather."));
        // the face is the volatile tail, after the vocabulary
        let see_at = p.find("I can see").unwrap();
        let face_at = p.find("What I perceive now").unwrap();
        assert!(see_at < face_at);
        assert!(p.contains("weather:\n  sky: clear"));
        // no JSON tool-schemas anywhere
        assert!(!p.contains("\"type\"") && !p.contains("parameters"));
    }
}
