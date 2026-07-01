// render.rs — the INVERSE of parse: a Word IR node -> its Word text. The GENERATIVE side ("output is
// always a Word"): a being's cognition SPEAKS a Word (the decided do, re-uttered), and the see-face
// shows the world as Words. Verified by ROUND-TRIP — parse(render(node)) == [node] over the whole real
// `.word` corpus (tests/render_roundtrip.rs). The parser is many-to-one (several texts fold to one IR),
// so render need not reproduce the ORIGINAL text — only a text that re-parses to the SAME IR.

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
fn is_null(v: &Json, k: &str) -> bool {
    matches!(get(v, k), None | Some(Json::Null))
}
/// join the `items` array with ", " — a separator the parser's split_items always splits on, so the
/// re-parse recovers the same list (the and/or/comma distinction isn't in the IR, so ", " is canonical).
fn items_text(v: &Json, k: &str) -> String {
    let xs: Vec<&str> = match get(v, k) {
        Some(Json::Arr(a)) => a.iter().filter_map(|x| if let Json::Str(s) = x { Some(s.as_str()) } else { None }).collect(),
        _ => Vec::new(),
    };
    xs.join(", ")
}
fn of_id<'a>(v: &'a Json) -> &'a str {
    get(v, "of").map(|o| s(o, "id")).unwrap_or("")
}

/// Render ONE top-level Word IR node to its Word text, or None for a node that is not a standalone
/// top-level statement (a bare body effect — render it with `render_effect_word`). The match mirrors
/// the parse RULES, inverted; verified complete over the corpus (319/319 round-trip).
pub fn render(node: &Json) -> Option<String> {
    match s(node, "kind") {
        "is" => Some(render_is(node)),
        "can" => Some(render_can(node, "An", "can")),
        "cannot" => Some(render_cannot(node)),
        "reach" => Some(format!("An {} reaches {}.", s(node, "able"), s(node, "to"))),
        "cognition" => Some(format!("An {} needs {} cognition.", s(node, "able"), s(node, "mode"))),
        "wakes" => Some(format!("An {} never wakes.", s(node, "able"))),
        "owns" => Some(format!("{} owns {}.", s(node, "subject"), s(node, "of"))),
        "extends" => Some(format!("A {} extends {}.", s(node, "able"), s(node, "parent"))),
        "has" => Some(render_has(node)),
        "contains" => Some(format!("A {} contains {}.", s(node, "subject"), items_text(node, "items"))),
        "accepts" | "carries" | "claims" => Some(render_kindverb(node)),
        "act" => render_act(node),
        "flow" => render_flow(node),
        _ => None, // a bare body effect — see render_effect_word
    }
}

/// Render a decided EFFECT as a spoken Word statement — the scripted/cognition output ("a being SPEAKS
/// the decided do, re-uttered"). A top-level act/declaration speaks as itself (a genesis "I make x.");
/// otherwise it is a body form (a state-act, a `do`, a `see`) + a period. Both round-trip: the parser
/// now lifts bare imperative deeds (do/see/call) to top level, so "do move." is act-able too.
pub fn render_effect_word(eff: &Json) -> Option<String> {
    if let Some(top) = render(eff) {
        return Some(top); // a genesis act / declaration — already a complete top-level statement
    }
    render_state_act_inline(eff)
        .or_else(|| render_inline(eff))
        .map(|t| format!("{t}."))
}

/// A FLOW. A single-effect state/event flow renders to the single-LINE form; everything else renders to
/// the multi-line `:` header + an indented body (each effect period-less, the body adds the period).
fn render_flow(node: &Json) -> Option<String> {
    let effects = match get(node, "effects") {
        Some(Json::Arr(e)) => e,
        _ => return None,
    };
    let when = get(node, "when")?;
    // the single-line form (one state/event effect) — the tersest that round-trips.
    if effects.len() == 1 {
        if let Some(eff) = render_state_act_inline(&effects[0]) {
            if let Some(Json::Obj(st)) = get(when, "state") {
                if let Some((_, Json::Str(x))) = st.first() {
                    return Some(format!("When it is {x}, {eff}."));
                }
            }
            if let Some(Json::Str(e)) = get(when, "on") {
                return Some(format!("When a {e} happens, {eff}."));
            }
        }
    }
    // the multi-line `:` form: header + body. Every effect must render or the flow doesn't round-trip.
    let header = render_when(when, get(node, "binds"))?;
    Some(format!("{header}:\n{}", render_block(effects, 2)?))
}

/// The flow header's trigger (parse_header inverted). state -> "When it is X"; a `with`-bind op-trigger
/// -> "When <clause> with <binds>"; a births summon -> "When <to> births a being[, with <binds>]"; a
/// bare event -> "When <clause>".
fn render_when(when: &Json, binds: Option<&Json>) -> Option<String> {
    let binds_txt = render_binds(binds);
    if let Some(Json::Obj(st)) = get(when, "state") {
        if let Some((_, Json::Str(x))) = st.first() {
            return Some(format!("When it is {x}"));
        }
    }
    if let Some(sm) = get(when, "summon") {
        return Some(format!("When {} births a being{}", s(sm, "to"), comma_binds(&binds_txt)));
    }
    if let Some(op) = get(when, "op") {
        return Some(format!("When {}{}", s(op, "clause"), with_binds(&binds_txt)));
    }
    if let Json::Str(e) = get(when, "event")? {
        return Some(format!("When {e}{}", with_binds(&binds_txt)));
    }
    None
}
fn render_binds(binds: Option<&Json>) -> Vec<String> {
    match binds {
        Some(Json::Arr(a)) => a.iter().filter_map(|b| if let Json::Str(s) = b { Some(format!("a {s}")) } else { None }).collect(),
        _ => Vec::new(),
    }
}
fn with_binds(b: &[String]) -> String {
    if b.is_empty() { String::new() } else { format!(" with {}", b.join(" and ")) }
}
fn comma_binds(b: &[String]) -> String {
    if b.is_empty() { String::new() } else { format!(", with {}", b.join(" and ")) }
}

/// A flow body — each effect at `indent` spaces, newline-joined. None if ANY effect is a form not yet
/// inverted (the whole flow then fails its round-trip; a body never half-renders).
fn render_block(effects: &[Json], indent: usize) -> Option<String> {
    let lines: Option<Vec<String>> = effects.iter().map(|e| render_effect_at(e, indent)).collect();
    Some(lines?.join("\n"))
}

/// One effect at a body position: the leading indent + EITHER an inline line ("….") OR a `:`-block
/// (a header line + a deeper body). The block forms are If(then>1) / For each / Match / While.
fn render_effect_at(eff: &Json, indent: usize) -> Option<String> {
    let pad = " ".repeat(indent);
    let sub = indent + 2;
    match s(eff, "kind") {
        "if" => {
            let cond = render_cond(get(eff, "cond")?)?;
            let thens = match get(eff, "then") {
                Some(Json::Arr(a)) => a,
                _ => return None,
            };
            // a single consequence stays inline (a leading Return keeps its structural commas); more
            // than one MUST become a block, else split_inline_effects would shear a Return's commas.
            if thens.len() == 1 {
                return Some(format!("{pad}If {cond}, {}.", render_inline(&thens[0])?));
            }
            Some(format!("{pad}If {cond}:\n{}", render_block(thens, sub)?))
        }
        "foreach" => {
            let bind = s(eff, "bind");
            let src = render_source(get(eff, "in")?)?;
            let ord = if matches!(get(eff, "ordered"), Some(Json::Bool(true))) { " in order" } else { "" };
            let body = match get(eff, "body") {
                Some(Json::Arr(b)) => render_block(b, sub)?,
                _ => return None,
            };
            Some(format!("{pad}For each {bind} in {src}{ord}:\n{body}"))
        }
        "while" => {
            let cond = render_cond(get(eff, "cond")?)?;
            let body = match get(eff, "body") {
                Some(Json::Arr(b)) => render_block(b, sub)?,
                _ => return None,
            };
            Some(format!("{pad}While {cond}:\n{body}"))
        }
        "match" => render_match(eff, indent),
        _ => Some(format!("{pad}{}.", render_inline(eff)?)),
    }
}

/// An inline (single-line) effect, period-less.
fn render_inline(eff: &Json) -> Option<String> {
    match s(eff, "kind") {
        "refuse" => {
            let msg = s(eff, "message");
            Some(match get(eff, "code") {
                Some(Json::Str(c)) if !c.is_empty() => format!("refuse with \"{msg}\" as {}", kebab(c)),
                _ => format!("refuse with \"{msg}\""),
            })
        }
        "return" => Some(format!("Return {}", render_return_items(eff))),
        "break" => Some("stop".to_string()),
        "act" => render_act_effect(eff),
        "see" => render_see_effect(eff),
        "call" => render_call(eff),
        "mark" => {
            // a reflexive state-mark: "the <X> is <Y>" camelCased to one flag — split it back.
            let words = split_camel(s(eff, "flag"));
            let (last, rest) = words.split_last()?;
            if rest.is_empty() {
                return None;
            }
            Some(format!("the {} is {last}", rest.join(" ")))
        }
        "if" => {
            // an inline-if nested as a single consequence of another
            let cond = render_cond(get(eff, "cond")?)?;
            let thens = match get(eff, "then") {
                Some(Json::Arr(a)) if a.len() == 1 => a,
                _ => return None,
            };
            Some(format!("If {cond}, {}", render_inline(&thens[0])?))
        }
        _ => None,
    }
}

/// A `For each` source: a bare ref, or `<ref> whose <cond>` (a filtered walk).
fn render_source(src: &Json) -> Option<String> {
    if let Some(Json::Str(r)) = get(src, "ref") {
        if let Some(filter) = get(src, "filter") {
            return Some(format!("{r} whose {}", render_cond(filter)?));
        }
        return Some(r.clone());
    }
    None
}

/// A `Match <on>:` with `For <label>:` / `Otherwise:` cases, each case body a deeper block.
fn render_match(eff: &Json, indent: usize) -> Option<String> {
    let on = match get(eff, "on") {
        Some(Json::Str(o)) => o.clone(),
        _ => return None,
    };
    let cases = match get(eff, "cases") {
        Some(Json::Arr(c)) => c,
        _ => return None,
    };
    let mut out = format!("{}Match {on}:", " ".repeat(indent));
    for case in cases {
        let head = match get(case, "label") {
            Some(Json::Str(l)) if !l.is_empty() => format!("For {l}"),
            _ => "Otherwise".to_string(),
        };
        let body = match get(case, "body") {
            Some(Json::Arr(b)) => render_block(b, indent + 4)?,
            _ => return None,
        };
        out.push_str(&format!("\n{}{head}:\n{body}", " ".repeat(indent + 2)));
    }
    Some(out)
}

/// A `call <target> to <intent>` / `call <target>, saying <value>` summon effect.
fn render_call(eff: &Json) -> Option<String> {
    let target = get(eff, "of").map(|o| s(o, "ref")).unwrap_or("");
    let bind = match get(eff, "bind") {
        Some(Json::Str(b)) if !b.is_empty() => format!(" as {b}"),
        _ => String::new(),
    };
    if let Some(Json::Str(to)) = get(eff, "to") {
        let w = match get(eff, "with") {
            Some(v) => format!(", with {}", render_value(v)),
            None => String::new(),
        };
        return Some(format!("call the {target} to {to}{w}{bind}"));
    }
    if let Some(saying) = get(eff, "saying") {
        return Some(format!("call the {target}, saying {}{bind}", render_value(saying)));
    }
    None
}

/// A body act (every verb is a `do`; `be` is only its left stance). Three shapes: the host escape, the
/// `by`-actor forms (a write or a form/make/grant/record word), then the plain targeted `do`.
fn render_act_effect(eff: &Json) -> Option<String> {
    let act = s(eff, "act");
    let bind = match get(eff, "bind") {
        Some(Json::Str(b)) if !b.is_empty() => format!(" as {b}"),
        _ => String::new(),
    };
    // host escape: `host: fn(args)` and `do fn(args)` fold to the SAME IR (verb:do, host:act, params.args).
    if !s(eff, "host").is_empty() {
        let args = render_args(get(eff, "params").and_then(|p| get(p, "args")));
        return Some(format!("host: {act}({args}){bind}"));
    }
    // a `by`-actor act (the WALL write + the form/make/grant/record words) carries `by:"I"`; a plain
    // `do` does not. `through` is re-derived from the flow context on re-parse, so it is not emitted.
    if get(eff, "by").is_some() {
        return render_being_act(eff);
    }
    if s(eff, "verb") == "do" {
        let mut out = format!("do {act}");
        if let Some(of) = get(eff, "of") {
            // parse_do_target builds `the <kind> <ref>` (a kinded target) OR a bare `{ref}` (no kind).
            // Render the kinded form back as "on the <kind> <ref>", the bare form as "on <ref>"; both
            // re-parse to the SAME target, so a deed's `of.ref` is never dropped.
            let r = s(of, "ref");
            if !r.is_empty() {
                match s(of, "kind") {
                    "" => out.push_str(&format!(" on {r}")),
                    kind => out.push_str(&format!(" on the {kind} {r}")),
                }
            }
        }
        if let Some(p) = get(eff, "params") {
            if matches!(p, Json::Obj(e) if !e.is_empty()) {
                out.push_str(&format!(" with {}", render_value(p)));
            }
        }
        out.push_str(&bind);
        return Some(out);
    }
    None
}

/// A body act carrying `by:"I"` — the WALL write (`set`/`replace`/`merge`) and the lineage words
/// (form a being / make a space / grant an able / record a lineage), all just Word vocabulary, not
/// system primitives. `through` is the flow context's, re-derived on re-parse.
fn render_being_act(eff: &Json) -> Option<String> {
    let act = s(eff, "act");
    let of = get(eff, "of");
    let params = get(eff, "params");
    let p = |k: &str| params.and_then(|x| get(x, k));
    let field = params.map(|x| s(x, "field")).unwrap_or("");

    if act == "form-being" {
        // through:self = "form a being with <spec>"; otherwise the births-flow's own-Name form.
        return Some(if s(eff, "through") == "self" {
            let body = match params {
                Some(o @ Json::Obj(_)) => render_value(o),
                _ => "{}".to_string(),
            };
            format!("form a being with {body}")
        } else {
            "form the being as the new Name's own".to_string()
        });
    }
    if act == "create-space" {
        if of.map(|o| s(o, "ref")).unwrap_or("") == "placeRoot" {
            return Some(format!("make a {} space", s(eff, "bind")));
        }
    }
    if act == "grant-able" && matches!(p("anchorSpaceId"), Some(Json::Str(a)) if a == "$placeRoot") {
        if let Some(Json::Str(able)) = p("able") {
            return Some(format!("grant the being the {able} able"));
        }
    }
    if act == "set-being" && field == "qualities.lineage" {
        return Some("record the being's lineage".to_string());
    }
    // the WALL write — set/replace/merge the <kind> <ref>'s <field>.
    if act.starts_with("set-") && !field.is_empty() {
        let kind = of.map(|o| s(o, "kind")).unwrap_or("");
        let r = of.map(|o| s(o, "ref")).unwrap_or("");
        let val = render_write_value(p("value")?);
        return Some(match p("merge") {
            Some(Json::Bool(false)) => format!("replace the {kind} {r}'s {field} with {val}"),
            Some(Json::Bool(true)) => format!("merge {val} into the {kind} {r}'s {field}"),
            _ => format!("set the {kind} {r}'s {field} to {val}"),
        });
    }
    None
}

/// write_act's value: a {ref} renders BARE (write_act ref_lits a non-`$`, non-quoted token straight to a
/// ref), a string is quoted (so it re-parses to a Value, including a literal `$x` string).
fn render_write_value(v: &Json) -> String {
    match v {
        Json::Obj(e) if e.len() == 1 && e[0].0 == "ref" => match &e[0].1 {
            Json::Str(r) => r.clone(),
            _ => String::new(),
        },
        Json::Str(s) => format!("\"{s}\""),
        other => render_value(other),
    }
}

/// A body `see` (the see-op call, the fresh projection read, the being-tree descent predicate).
fn render_see_effect(eff: &Json) -> Option<String> {
    let bind = s(eff, "bind");
    if let Some(anc) = get(eff, "descendsFrom") {
        // see whether <ancestor> is an ancestor of <of> as <bind>
        return Some(format!("see whether {} is an ancestor of {} as {bind}", s(anc, "ref"), get(eff, "of").map(|o| s(o, "ref")).unwrap_or("")));
    }
    if let Some(read) = get(eff, "read") {
        if let Json::Str(r) = read {
            // see the <ref>'s <field> as <bind>
            let of = get(eff, "of").map(|o| s(o, "ref")).unwrap_or("");
            return Some(format!("see the {of}'s {r} as {bind}"));
        }
    }
    let act = s(eff, "act");
    if !act.is_empty() {
        let args = render_args(get(eff, "args"));
        return Some(format!("see {act}({args}) as {bind}"));
    }
    None
}

/// Render an args array (the `$`-prefixed refs) back to a bare comma list (the `$` is the parser's, not
/// the source's).
fn render_args(args: Option<&Json>) -> String {
    match args {
        Some(Json::Arr(a)) => a
            .iter()
            .map(|x| match x {
                Json::Str(s) => s.strip_prefix('$').unwrap_or(s).to_string(),
                Json::Obj(_) => render_value(x).trim_start_matches('$').to_string(),
                _ => render_value(x),
            })
            .collect::<Vec<_>>()
            .join(", "),
        _ => String::new(),
    }
}

/// Return items: bare `values` + `k: v` `extra` pairs, comma-joined (split_items splits on ", ").
fn render_return_items(eff: &Json) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(Json::Arr(vals)) = get(eff, "values") {
        for v in vals {
            if let Json::Str(s) = v {
                parts.push(s.clone());
            }
        }
    }
    if let Some(Json::Obj(extra)) = get(eff, "extra") {
        for (k, v) in extra {
            parts.push(format!("{k}: {}", render_value(v)));
        }
    }
    parts.join(", ")
}

/// A cond (parse_leaf inverted): the and/or connectives, the see-op predicate, the host/authority
/// predicates, flags, tests. `negated` round-trips through a leading `not ` (parse_leaf strips it).
fn render_cond(cond: &Json) -> Option<String> {
    let neg = matches!(get(cond, "negated"), Some(Json::Bool(true)));
    let not = |base: String| if neg { format!("not {base}") } else { base };
    if let Some(Json::Arr(a)) = get(cond, "all") {
        let parts: Option<Vec<String>> = a.iter().map(render_cond).collect();
        return Some(parts?.join(" and "));
    }
    if let Some(Json::Arr(a)) = get(cond, "any") {
        let parts: Option<Vec<String>> = a.iter().map(render_cond).collect();
        return Some(parts?.join(" or "));
    }
    if !s(cond, "seeCall").is_empty() {
        return Some(not(format!("{}({})", s(cond, "seeCall"), render_args(get(cond, "args")))));
    }
    if let Some(Json::Str(rb)) = get(cond, "resolvedBy") {
        let args: Vec<String> = match get(cond, "args") {
            Some(Json::Arr(a)) => a.iter().map(|x| s(x, "ref").to_string()).collect(),
            _ => vec![],
        };
        let a = |i: usize| args.get(i).cloned().unwrap_or_default();
        return Some(not(match rb.as_str() {
            "hasAuthorityOver" => format!("{} has authority over {}", a(0), a(1)),
            "hasCredentialAuthority" => format!("{} has credential authority over {}", a(0), a(1)),
            "isBeingParentOf" => format!("{} is the being-parent of {}", a(0), a(1)),
            other => format!("{} is {other}", a(0)), // the generic host "<X> is <word>" predicate
        }));
    }
    if let Some(t) = get(cond, "test") {
        return Some(not(render_test(t)?));
    }
    if let Some(Json::Str(f)) = get(cond, "flag") {
        return Some(if neg { format!("no {f}") } else { f.clone() });
    }
    if let Some(Json::Str(c)) = get(cond, "clause") {
        return Some(c.clone());
    }
    None
}

/// A test cond (operand_fields inverted): equality, ordered compare, the type/kind checks.
fn render_test(t: &Json) -> Option<String> {
    let path = s(t, "path");
    match s(t, "op") {
        "equals" => {
            // a `.kind` path is the kind-check sugar "the <X> is a <kind>"
            if let Some(stem) = path.strip_suffix(".kind") {
                if let Some(Json::Str(k)) = get(t, "value") {
                    return Some(format!("the {stem} is a {k}"));
                }
            }
            let rhs = match get(t, "against") {
                Some(a) => render_operand(a),
                None => render_operand(get(t, "value")?),
            };
            Some(format!("{path} equals {rhs}"))
        }
        "compare" => {
            let word = match s(t, "as") {
                "ge" => "at least",
                "le" => "at most",
                "lt" => "less than",
                "gt" => "greater than",
                _ => return None,
            };
            Some(format!("{path} is {word} {}", render_operand(get(t, "against")?)))
        }
        "isFinite" => Some(format!("{path} is a number")),
        "isString" => Some(format!("{path} is a string")),
        _ => None,
    }
}

/// A test/compare operand: a {ref} renders `$x` (oper reads `$` as a Ref), a plain token renders bare
/// (oper reads it as a Value), anything else through render_value (quoted string / literal).
fn render_operand(v: &Json) -> String {
    match v {
        Json::Obj(e) if e.len() == 1 && e[0].0 == "ref" => match &e[0].1 {
            Json::Str(r) => format!("${r}"),
            _ => "$".to_string(),
        },
        Json::Str(tok) if is_bare_token(tok) => tok.clone(),
        other => render_value(other),
    }
}

/// A token oper() folds straight to a Value (so it can render unquoted): alpha-led, alnum/hyphen, and
/// not a literal keyword (true/false/null parse to their own values).
fn is_bare_token(s: &str) -> bool {
    matches!(s.chars().next(), Some(c) if c.is_ascii_alphabetic())
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        && !matches!(s, "true" | "false" | "null")
}

/// camelCase -> its words, lowercased ("beingFound" -> ["being","found"]) — to invert a state-mark flag.
fn split_camel(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for c in s.chars() {
        if c.is_ascii_uppercase() && !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
        cur.push(c.to_ascii_lowercase());
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// inverse of ref_lit/oper: {ref:x} -> $x; an object/array literal recursively; a string is quoted (so
/// it re-parses to a Value, never a ref); bool/num/null literal.
fn render_value(v: &Json) -> String {
    match v {
        Json::Obj(e) if e.len() == 1 && e[0].0 == "ref" => match &e[0].1 {
            Json::Str(r) => format!("${r}"),
            _ => "$".to_string(),
        },
        Json::Obj(e) => {
            let parts: Vec<String> = e.iter().map(|(k, val)| format!("{k}: {}", render_value(val))).collect();
            format!("{{ {} }}", parts.join(", "))
        }
        Json::Arr(a) => format!("[ {} ]", a.iter().map(render_value).collect::<Vec<_>>().join(", ")),
        Json::Str(s) => format!("\"{s}\""),
        Json::Bool(b) => b.to_string(),
        Json::Num(n) => {
            if n.is_finite() && n.fract() == 0.0 && n.abs() < 1e15 {
                format!("{}", *n as i64)
            } else {
                format!("{n}")
            }
        }
        Json::Null => "null".to_string(),
    }
}

/// SCREAMING_SNAKE -> kebab (the inverse of the refuse `as <code>` upcase).
fn kebab(code: &str) -> String {
    code.to_lowercase().replace('_', "-")
}

/// The inverse of `state_act`: "the <r> <verb>[ the <obj>][, and it becomes <y>]". `by` is the
/// capitalized actor, re-lowercased; the verb stem re-parses to itself.
fn render_state_act_inline(eff: &Json) -> Option<String> {
    if s(eff, "kind") != "act" || s(eff, "verb") != "do" {
        return None;
    }
    let by = s(eff, "by").to_lowercase();
    if by.is_empty() {
        return None; // a state-act names its subject R ("the R V …"); a bare do-op deed does not
    }
    let act = s(eff, "act");
    let mut out = format!("the {by} {act}");
    if let Some(of) = get(eff, "of") {
        if !s(of, "id").is_empty() {
            out.push_str(&format!(" the {}", s(of, "id")));
        }
    }
    if let Some(Json::Obj(sets)) = get(eff, "sets") {
        if let Some((_, Json::Str(y))) = sets.first() {
            out.push_str(&format!(", and it becomes {y}"));
        }
    }
    Some(out)
}

fn render_is(node: &Json) -> String {
    let subj = s(node, "subject");
    match s(node, "isA") {
        "space" => format!("A {subj} is a space."),
        "able" if !is_null(node, "scope") => format!("A {subj} is a able for a {}.", s(node, "scope")),
        "able" => format!("An {subj} is an able."),
        other => format!("A {subj} is a {other}."),
    }
}

/// "An <able> can <verb> <of>." — `of` may be null (no object). Rebuild the article-stripped object as
/// a bare noun (the parser strips a/an/the, so a bare noun re-parses identically).
fn render_can(node: &Json, art: &str, kw: &str) -> String {
    let able = s(node, "able");
    let verb = render_verb(s(node, "verb"));
    match get(node, "of") {
        Some(Json::Str(o)) if !o.is_empty() => format!("{art} {able} {kw} {verb} {o}."),
        _ => format!("{art} {able} {kw} {verb}."),
    }
}
fn render_cannot(node: &Json) -> String {
    let subj = s(node, "subject");
    let verb = render_verb(s(node, "verb"));
    match get(node, "of") {
        Some(Json::Str(o)) if !o.is_empty() => format!("A {subj} cannot {verb} {o}."),
        _ => format!("A {subj} cannot {verb}."),
    }
}

/// the inverse of `verb()` (which stems a trailing "s"): a bare stem re-parses to itself, so emit it raw.
fn render_verb(v: &str) -> String {
    v.to_string()
}

fn render_has(node: &Json) -> String {
    let subj = s(node, "subject");
    let kw = if matches!(get(node, "optional"), Some(Json::Bool(true))) { "may have" } else { "has" };
    let prop = s(node, "property");
    match get(node, "gloss") {
        Some(Json::Str(g)) if !g.is_empty() => format!("A {subj} {kw} {prop}, {g}."),
        _ => format!("A {subj} {kw} {prop}."),
    }
}

/// "It|A <subject> accepts|carries|claims <items>." — subject:null renders the "It" form.
fn render_kindverb(node: &Json) -> String {
    let kw = s(node, "kind");
    let items = items_text(node, "items");
    if is_null(node, "subject") {
        format!("It {kw} {items}.")
    } else {
        format!("A {} {kw} {items}.", s(node, "subject"))
    }
}

/// The genesis life-register acts (rule 9): name:I, make (being/space), stand, give.
///
/// Each genesis act is keyed on `of.id` (the genesis RULES build `of:{kind,id}`, never a `ref`), so a
/// branch fires ONLY when the node is the genesis SHAPE. A flow-body `do <op>` deed of the same op carries
/// `of:{kind,ref}` + `params` instead (do_op_act / parse_do_target); it has no `of.id`, so it falls
/// through to None and renders via render_effect_word's body path (render_act_effect), which keeps the
/// deed's ref + params. Without the `of.id` guard a deed like `do create-space on the place root with {…}`
/// would mis-render to the genesis "I make ." and DROP its target + params.
fn render_act(node: &Json) -> Option<String> {
    let verb = s(node, "verb");
    let act = s(node, "act");
    let has_id = !of_id(node).is_empty();
    match (verb, act) {
        ("name", "I") => Some("I am \"what?\" I am.".to_string()),
        ("be", "birth") if has_id => {
            // "I make <Capitalized>[, <description>]." — of.id carries the case the parser keys on.
            let id = of_id(node);
            match get(node, "params").and_then(|p| get(p, "description")) {
                Some(Json::Str(d)) if !d.is_empty() => Some(format!("I make {id}, {d}.")),
                _ => Some(format!("I make {id}.")),
            }
        }
        ("do", "create-space") if has_id => {
            let id = of_id(node);
            match get(node, "params").and_then(|p| get(p, "gloss")) {
                Some(Json::Str(g)) if !g.is_empty() => Some(format!("I make {id}, {g}.")),
                _ => Some(format!("I make {id}.")),
            }
        }
        // the stand-in genesis always has a target (a space to stand in); a bare `do move` (no target)
        // is an imperative deed, not a genesis — let it fall through to render_inline.
        ("do", "move") if has_id => Some(format!("I stand in {}.", of_id(node))),
        ("do", "give") if has_id => Some(format!("I give the {} to {}.", of_id(node), s(node, "to"))),
        _ => None, // a bare do-op deed / be / see / call — rendered by render_effect_word's body path
    }
}

#[cfg(test)]
mod tests {
    use crate::{parse, render::render, render::render_effect_word};
    use treehash::{canonicalize, Json};

    fn flow_effect(src: &str) -> Json {
        let flow = parse(src).remove(0);
        let effects = if let Json::Obj(e) = &flow {
            e.iter().find(|(k, _)| k == "effects").map(|(_, v)| v.clone())
        } else {
            None
        };
        match effects {
            Some(Json::Arr(a)) => a.into_iter().next().expect("at least one effect"),
            _ => panic!("no effects"),
        }
    }

    /// A parameterized flow-body deed (`do <op> on the <noun> <id> with {…}`) must SPEAK a Word that
    /// re-parses to the very same IR; its target + params are carried, not dropped. This is the
    /// scripted decider's exact path: render_effect_word(effect) -> parse(word) == [effect].
    #[test]
    fn parameterized_flow_deed_round_trips_through_the_spoken_word() {
        for src in [
            // a kinded target + object params
            "When the sky is summoned:\n  do set-being on the being b1 with { field: \"mood\", value: \"calm\" }.",
            // create-space deed: must NOT collapse to the genesis \"I make .\" (the bug this guards)
            "When the sky is summoned:\n  do create-space on the place root with { name: \"grove\", type: \"home-territory\" }.",
            // a kinded space target
            "When the sky is summoned:\n  do create-space on the space grove with { name: \"grove\" }.",
            // give deed (genesis `give` shares the op)
            "When the sky is summoned:\n  do give on the matter apple with { to: \"Bob\" }.",
            // move deed with a target (genesis `move` shares the op)
            "When the sky is summoned:\n  do move on the space grove.",
        ] {
            let eff = flow_effect(src);
            let word = render_effect_word(&eff).expect("a parameterized deed must speak");
            let reparsed = canonicalize(&Json::Arr(parse(&word)));
            let want = canonicalize(&Json::Arr(vec![eff.clone()]));
            assert_eq!(reparsed, want, "spoken word {word:?} dropped params/target for {src}");
        }
    }

    /// The genesis SHAPE (`of.id`, e.g. parsed from "I make grove.") still renders to its genesis text;
    /// the of.id guard disambiguates the genesis act from the same-op flow deed.
    #[test]
    fn genesis_shape_still_renders_to_its_genesis_text() {
        for (src, expect) in [
            ("I make grove.", "I make grove."),
            ("I stand in grove.", "I stand in grove."),
            ("I give the apple to Bob.", "I give the apple to Bob."),
        ] {
            let node = parse(src).remove(0);
            assert_eq!(render(&node).as_deref(), Some(expect));
        }
    }
}
