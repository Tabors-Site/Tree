// treecognition::connect — the LLM connection resolver (port of connect.js resolveConnectionSpec, the
// host-see-op floor of add-llm-connection). The validation + spec half (the treehost pattern): validate
// the connection, SSRF-gate the base URL, encrypt the api key, and return the set-being fact spec the
// dispatcher seals — it lays NO fact, mutates nothing. This is the cognition crate's surface (the LLM
// membrane): the SSRF gate is `crate::ssrf`; the encryptedApiKey mint is INJECTED (the edge wires it to
// `treesign::encrypt_credential`), so the resolver stays decoupled from the crypto crate. The store I/O
// (loading the being's current connections + the main slot) is injected too — the edge folds it.
//
// Plugs into the host-resolver seam when it opens (treeibp currently hardcodes treehost::Resolvers).

use treehash::Json;

const MAX_NAME_LENGTH: usize = 100;
const MAX_KEY_LENGTH: usize = 500;
const MAX_MODEL_LENGTH: usize = 200;

fn obj(f: Vec<(&str, Json)>) -> Json {
    Json::Obj(f.into_iter().map(|(k, v)| (k.to_string(), v)).collect())
}
fn jstr(s: &str) -> Json {
    Json::Str(s.to_string())
}
fn has_key(map: &Json, k: &str) -> bool {
    matches!(map, Json::Obj(e) if e.iter().any(|(kk, _)| kk == k))
}
fn count(map: &Json) -> usize {
    match map {
        Json::Obj(e) => e.len(),
        _ => 0,
    }
}

/// The add-llm-connection request.
pub struct ConnectionArgs {
    pub name: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
}

/// The injected context: the being's current `qualities.llmConnections` (for the count + the is-first
/// check), the main slot id, the SSRF opt-in, the connection id (the moment supplies it — a resolver
/// READ is deterministic), the max, and the api-key encryptor (the edge -> treesign::encrypt_credential).
pub struct ConnectionCtx<'a> {
    pub existing: &'a Json,
    pub main_slot: Option<&'a str>,
    pub allowed_domains: &'a [String],
    pub own_host: Option<&'a str>,
    pub connection_id: &'a str,
    pub max_connections: usize,
    pub encrypt: &'a dyn Fn(&str) -> String,
}

/// The resolved spec: the connection record + the set-being fact params + whether it is the first live
/// connection (the `.word` auto-assigns it to main).
pub struct ConnectionSpec {
    pub connection_id: String,
    pub conn: Json,
    pub is_first: bool,
    pub set_being_params: Json,
}

/// Validate + build the add-llm-connection spec. Errors carry the JS host's refusal text.
pub fn resolve_connection(args: &ConnectionArgs, ctx: &ConnectionCtx) -> Result<ConnectionSpec, String> {
    if count(ctx.existing) >= ctx.max_connections {
        return Err(format!("Maximum of {} connections reached", ctx.max_connections));
    }
    let name = validate_name(&args.name)?;
    let model = validate_model(&args.model)?;
    validate_api_key(args.api_key.as_deref(), false)?;
    // SSRF: validate the base URL against the story's allowedLlmDomains + own host (sync gate; the DNS
    // resolveAndValidateHost is the edge's).
    let base_url = crate::ssrf::validate_base_url(&args.base_url, ctx.allowed_domains, ctx.own_host)?;

    let encrypted = match args.api_key.as_deref().filter(|k| !k.is_empty()) {
        Some(k) => jstr(&(ctx.encrypt)(k)),
        None => Json::Null,
    };
    let conn = obj(vec![
        ("name", jstr(&name)),
        ("baseUrl", jstr(&base_url)),
        ("encryptedApiKey", encrypted),
        ("model", jstr(&model)),
        ("createdAt", Json::Null), // clock-free; the edge may stamp a wall-clock if it wants one
        ("lastUsedAt", Json::Null),
    ]);
    // is_first: no live main slot (no main, or main points at an absent connection).
    let is_first = ctx.main_slot.map_or(true, |m| !has_key(ctx.existing, m));
    let set_being_params = obj(vec![
        ("field", jstr(&format!("qualities.llmConnections.{}", ctx.connection_id))),
        ("value", conn.clone()),
    ]);
    Ok(ConnectionSpec { connection_id: ctx.connection_id.to_string(), conn, is_first, set_being_params })
}

/// An update-llm-connection request — every field optional (only the present ones change).
#[derive(Default)]
pub struct UpdateArgs {
    pub name: Option<String>,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
}

/// The resolved update: the merged connection + whether anything changed / was slot-assigned (the post
/// fact client-cache bust) + the set-being params.
pub struct UpdateSpec {
    pub connection_id: String,
    pub merged: Json,
    pub no_change: bool,
    pub was_assigned: bool,
    pub set_being_params: Json,
}

/// Validate + merge an update onto an existing connection. `existing` is the current entry (None ->
/// "Connection not found"); `slots` is `qualities.beingLlm.slots` (for the was-assigned cache bust).
pub fn resolve_connection_update(connection_id: &str, existing: Option<&Json>, args: &UpdateArgs, allowed_domains: &[String], own_host: Option<&str>, slots: &Json, encrypt: &dyn Fn(&str) -> String) -> Result<UpdateSpec, String> {
    let id = validate_connection_id(connection_id)?;
    let existing = existing.ok_or_else(|| "Connection not found".to_string())?;

    let mut update: Vec<(String, Json)> = Vec::new();
    if let Some(b) = &args.base_url {
        update.push(("baseUrl".to_string(), jstr(&crate::ssrf::validate_base_url(b, allowed_domains, own_host)?)));
    }
    if let Some(m) = &args.model {
        update.push(("model".to_string(), jstr(&validate_model(m)?)));
    }
    if let Some(n) = &args.name {
        update.push(("name".to_string(), jstr(&validate_name(n)?)));
    }
    if let Some(k) = args.api_key.as_deref().filter(|k| !k.is_empty()) {
        validate_api_key(Some(k), false)?;
        update.push(("encryptedApiKey".to_string(), jstr(&encrypt(k))));
    }

    let no_change = update.is_empty();
    let merged = merge(existing, &update);
    let was_assigned = slot_values_contain(slots, &id);
    let set_being_params = obj(vec![("field", jstr(&format!("qualities.llmConnections.{id}"))), ("value", merged.clone())]);
    Ok(UpdateSpec { connection_id: id, merged, no_change, was_assigned, set_being_params })
}

/// Validate a removal — confirm the connection exists, return the set-being params that UNSET it
/// (value:null -> the deep-path delete). A dangling slot ref folds to absent on read (no eager cascade).
pub fn resolve_connection_removal(connection_id: &str, existing: Option<&Json>) -> Result<Json, String> {
    let id = validate_connection_id(connection_id)?;
    existing.ok_or_else(|| "Connection not found".to_string())?;
    Ok(obj(vec![("field", jstr(&format!("qualities.llmConnections.{id}"))), ("value", Json::Null)]))
}

fn get<'a>(v: &'a Json, k: &str) -> Option<&'a Json> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).map(|(_, x)| x),
        _ => None,
    }
}

/// resolve-llm-config: normalize an llm-config write (set-being-llm / set-space-llm / set-story-llm) into
/// the `{targetKind, targetId, writes}` block the `.word` fans into per-field set-X deeds. The TARGET
/// (being = the caller's being; space = the target; story = the place root after a heaven gate) is
/// RESOLVED at the edge and passed in. PURE: legacy `connectionId` → `default[connectionId]`, the
/// force-flag MUTEX (forceReceiver wins if both set — matching read_container_llm), and the field list
/// `qualities.llm.{default,slots,preferOwn,forceActor,forceReceiver}`.
pub fn resolve_llm_config(target_kind: &str, target_id: &str, params: &Json) -> Result<Json, String> {
    let mut writes: Vec<Json> = Vec::new();
    let mut push = |field: &str, value: Json| writes.push(obj(vec![("field", jstr(field)), ("value", value)]));

    if let Some(d) = get(params, "default") {
        push("qualities.llm.default", d.clone());
    } else if let Some(c) = get_str(params, "connectionId") {
        push("qualities.llm.default", Json::Arr(vec![jstr(c)])); // legacy single connection -> default list
    }
    if let Some(s) = get(params, "slots") {
        push("qualities.llm.slots", s.clone());
    }
    if let Some(p) = get(params, "preferOwn") {
        push("qualities.llm.preferOwn", p.clone());
    }
    // force-flag mutex: forceReceiver wins if both are set ("use my LLM, never reach actor").
    let fa = matches!(get(params, "forceActor"), Some(Json::Bool(true)));
    let fr = matches!(get(params, "forceReceiver"), Some(Json::Bool(true)));
    if get(params, "forceActor").is_some() {
        push("qualities.llm.forceActor", Json::Bool(fa && !fr));
    }
    if get(params, "forceReceiver").is_some() {
        push("qualities.llm.forceReceiver", Json::Bool(fr));
    }

    if writes.is_empty() {
        return Err("set-llm: no configuration fields provided".to_string());
    }
    Ok(obj(vec![("targetKind", jstr(target_kind)), ("targetId", jstr(target_id)), ("writes", Json::Arr(writes))]))
}

fn get_str<'a>(v: &'a Json, k: &str) -> Option<&'a str> {
    match v {
        Json::Obj(e) => e.iter().find(|(kk, _)| kk == k).and_then(|(_, x)| if let Json::Str(s) = x { Some(s.as_str()) } else { None }),
        _ => None,
    }
}

/// A valid slot SHAPE (kebab — "main" or an able name). The registry membership (CORE_BEING_SLOTS ∪ the
/// extension able slots) folds from the able-word registry, which isn't ported — so the gate is the
/// shape; membership defers to the fold (the same deferral grant's `able-exists` makes).
fn is_valid_slot(slot: &str) -> bool {
    !slot.is_empty() && slot.chars().next().is_some_and(|c| c.is_ascii_lowercase()) && slot.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// resolve-slot-assignment: assign (or clear) a connection on a slot. Returns the block `assign-llm-
/// slot.word` reads — `{isBeing, isSpace, id, field, value, slot, connectionId}`. `field` routes by
/// target kind: a being → `qualities.beingLlm.slots.<slot>`, a space → `qualities.llm.slots.<slot>`. A
/// null/absent connectionId CLEARS the slot. `existing` is the being's current llmConnections (a
/// connection being assigned must exist).
pub fn resolve_slot_assignment(target: &Json, params: &Json, existing: &Json) -> Result<Json, String> {
    let slot = get_str(params, "slot").ok_or_else(|| "assign-llm-slot: slot required".to_string())?;
    if !is_valid_slot(slot) {
        return Err(format!("Invalid assignment slot: {slot}"));
    }
    let conn_id = match get_str(params, "connectionId") {
        Some(c) if !c.is_empty() => Some(validate_connection_id(c)?),
        _ => None,
    };
    if let Some(cid) = &conn_id {
        if !has_key(existing, cid) {
            return Err("Connection not found".to_string());
        }
    }
    let kind = get_str(target, "kind");
    let id = get_str(target, "id").ok_or_else(|| "slot assignment target required".to_string())?;
    let (is_being, is_space) = (kind == Some("being"), kind == Some("space"));
    if !is_being && !is_space {
        return Err("slot assignment target must be a being or space".to_string());
    }
    let field = if is_being { format!("qualities.beingLlm.slots.{slot}") } else { format!("qualities.llm.slots.{slot}") };
    let value = conn_id.as_deref().map(jstr).unwrap_or(Json::Null);
    Ok(obj(vec![
        ("isBeing", Json::Bool(is_being)),
        ("isSpace", Json::Bool(is_space)),
        ("id", jstr(id)),
        ("field", jstr(&field)),
        ("value", value.clone()),
        ("slot", jstr(slot)),
        ("connectionId", value),
    ]))
}

fn validate_connection_id(id: &str) -> Result<String, String> {
    if id.is_empty() || id.chars().count() > 100 {
        return Err("Invalid connection ID".to_string());
    }
    Ok(id.to_string())
}

/// `{ ...existing, ...update }` — existing keys, then the update keys override.
fn merge(existing: &Json, update: &[(String, Json)]) -> Json {
    let mut out: Vec<(String, Json)> = match existing {
        Json::Obj(e) => e.clone(),
        _ => Vec::new(),
    };
    for (k, v) in update {
        if let Some(slot) = out.iter_mut().find(|(kk, _)| kk == k) {
            slot.1 = v.clone();
        } else {
            out.push((k.clone(), v.clone()));
        }
    }
    Json::Obj(out)
}

/// Does any slot in `qualities.beingLlm.slots` point at this connection (the was-assigned check)?
fn slot_values_contain(slots: &Json, connection_id: &str) -> bool {
    matches!(slots, Json::Obj(e) if e.iter().any(|(_, v)| matches!(v, Json::Str(s) if s == connection_id)))
}

fn validate_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Connection name is required".to_string());
    }
    if trimmed.chars().count() > MAX_NAME_LENGTH {
        return Err(format!("Connection name must be 1-{MAX_NAME_LENGTH} characters"));
    }
    Ok(trimmed.to_string())
}

fn validate_model(model: &str) -> Result<String, String> {
    if model.is_empty() || model.chars().count() > MAX_MODEL_LENGTH {
        return Err("Invalid model name".to_string());
    }
    let safe: String = model.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '/' | ':')).collect();
    if safe.is_empty() {
        return Err("Invalid model name after sanitization".to_string());
    }
    Ok(safe)
}

fn validate_api_key(api_key: Option<&str>, required: bool) -> Result<(), String> {
    match api_key {
        None | Some("") if required => Err("API key is required".to_string()),
        Some(k) if k.chars().count() > MAX_KEY_LENGTH => Err("API key too long".to_string()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use treehash::canonicalize;

    fn enc(k: &str) -> String {
        format!("enc({k})")
    }
    fn ctx<'a>(existing: &'a Json, allowed: &'a [String]) -> ConnectionCtx<'a> {
        ConnectionCtx { existing, main_slot: None, allowed_domains: allowed, own_host: None, connection_id: "conn-1", max_connections: 15, encrypt: &enc }
    }
    fn args(base: &str, key: Option<&str>) -> ConnectionArgs {
        ConnectionArgs { name: "my gpt".into(), base_url: base.into(), api_key: key.map(|s| s.to_string()), model: "gpt-4o".into() }
    }

    #[test]
    fn resolves_a_connection_spec_with_ssrf_and_encryption() {
        let empty = Json::Obj(vec![]);
        let allowed = vec!["api.openai.com".to_string()]; // opt-in so the public host passes
        let spec = resolve_connection(&args("https://api.openai.com/v1", Some("sk-secret")), &ctx(&empty, &allowed)).unwrap();
        assert!(spec.is_first); // no main slot -> first
        let v = canonicalize(&spec.set_being_params);
        assert!(v.contains(r#""field":"qualities.llmConnections.conn-1""#));
        assert!(v.contains(r#""encryptedApiKey":"enc(sk-secret)""#)); // key encrypted, never cleartext
        assert!(v.contains(r#""model":"gpt-4o""#));
        // no api key (local LLM) -> null, still valid
        let spec2 = resolve_connection(&args("https://api.openai.com", None), &ctx(&empty, &allowed)).unwrap();
        assert!(canonicalize(&spec2.conn).contains(r#""encryptedApiKey":null"#));
    }

    #[test]
    fn ssrf_refuses_private_and_gates_fire() {
        let empty = Json::Obj(vec![]);
        let no_allow: Vec<String> = vec![];
        // a private IP with no allowlist opt-in -> SSRF refusal
        assert!(resolve_connection(&args("http://127.0.0.1:11434", None), &ctx(&empty, &no_allow)).is_err());
        // empty name refused
        let bad = ConnectionArgs { name: "  ".into(), base_url: "https://x.com".into(), api_key: None, model: "m".into() };
        let allow = vec!["x.com".to_string()];
        assert_eq!(resolve_connection(&bad, &ctx(&empty, &allow)).err().unwrap(), "Connection name is required");
    }

    #[test]
    fn update_merges_changed_fields_and_removal_unsets() {
        let allowed = vec!["x.com".to_string()];
        let existing = obj(vec![("name", jstr("old")), ("baseUrl", jstr("https://x.com")), ("model", jstr("m1")), ("encryptedApiKey", Json::Null)]);
        let slots = obj(vec![("main", jstr("conn-9"))]);
        let upd = UpdateArgs { model: Some("m2".into()), api_key: Some("k2".into()), ..Default::default() };
        let r = resolve_connection_update("conn-9", Some(&existing), &upd, &allowed, None, &slots, &enc).unwrap();
        assert!(!r.no_change && r.was_assigned); // model+key changed; slot main points at it
        let v = canonicalize(&r.merged);
        assert!(v.contains(r#""model":"m2""#) && v.contains(r#""name":"old""#)); // changed + untouched
        assert!(v.contains(r#""encryptedApiKey":"enc(k2)""#));
        // a missing connection -> not found
        assert_eq!(resolve_connection_update("conn-9", None, &upd, &allowed, None, &slots, &enc).err().unwrap(), "Connection not found");
        // removal unsets (value:null)
        let rm = resolve_connection_removal("conn-9", Some(&existing)).unwrap();
        assert!(canonicalize(&rm).contains(r#""value":null"#));
        assert_eq!(resolve_connection_removal("conn-9", None).err().unwrap(), "Connection not found");
    }

    #[test]
    fn llm_config_normalizes_and_force_mutex() {
        // legacy single connectionId -> default list; both force flags -> forceReceiver wins
        let p = obj(vec![("connectionId", jstr("c1")), ("forceActor", Json::Bool(true)), ("forceReceiver", Json::Bool(true))]);
        let cfg = resolve_llm_config("being", "b1", &p).unwrap();
        let v = canonicalize(&cfg);
        assert!(v.contains(r#""targetKind":"being""#) && v.contains(r#""targetId":"b1""#));
        assert!(v.contains(r#""field":"qualities.llm.default","value":["c1"]"#));
        assert!(v.contains(r#""field":"qualities.llm.forceActor","value":false"#)); // mutex: receiver wins
        assert!(v.contains(r#""field":"qualities.llm.forceReceiver","value":true"#));
        // empty config -> refused
        assert!(resolve_llm_config("being", "b1", &obj(vec![])).err().unwrap().contains("no configuration"));
    }

    #[test]
    fn slot_assignment_routes_by_kind_and_clears() {
        let existing = obj(vec![("c1", Json::Null)]);
        let being = obj(vec![("kind", jstr("being")), ("id", jstr("b1"))]);
        let p = obj(vec![("slot", jstr("main")), ("connectionId", jstr("c1"))]);
        let a = resolve_slot_assignment(&being, &p, &existing).unwrap();
        let v = canonicalize(&a);
        assert!(v.contains(r#""isBeing":true"#) && v.contains(r#""field":"qualities.beingLlm.slots.main""#) && v.contains(r#""value":"c1""#));
        // a space target routes to qualities.llm.slots
        let space = obj(vec![("kind", jstr("space")), ("id", jstr("sp1"))]);
        assert!(canonicalize(&resolve_slot_assignment(&space, &p, &existing).unwrap()).contains(r#""field":"qualities.llm.slots.main""#));
        // clear (no connectionId) -> value null; assigning a missing connection -> not found; bad slot
        let clear = obj(vec![("slot", jstr("main"))]);
        assert!(canonicalize(&resolve_slot_assignment(&being, &clear, &existing).unwrap()).contains(r#""value":null"#));
        let missing = obj(vec![("slot", jstr("main")), ("connectionId", jstr("nope"))]);
        assert_eq!(resolve_slot_assignment(&being, &missing, &existing).err().unwrap(), "Connection not found");
        let bad = obj(vec![("slot", jstr("Bad Slot")), ("connectionId", jstr("c1"))]);
        assert!(resolve_slot_assignment(&being, &bad, &existing).err().unwrap().contains("Invalid assignment slot"));
    }

    #[test]
    fn max_connections_and_is_first() {
        let allowed = vec!["x.com".to_string()];
        // at the cap -> refused
        let full = Json::Obj((0..15).map(|i| (format!("c{i}"), Json::Null)).collect());
        assert!(resolve_connection(&args("https://x.com", None), &ctx(&full, &allowed)).err().unwrap().contains("Maximum of 15"));
        // main slot points at a LIVE connection -> not first
        let existing = Json::Obj(vec![("main-conn".to_string(), Json::Null)]);
        let c = ConnectionCtx { existing: &existing, main_slot: Some("main-conn"), allowed_domains: &allowed, own_host: None, connection_id: "conn-2", max_connections: 15, encrypt: &enc };
        assert!(!resolve_connection(&args("https://x.com", None), &c).unwrap().is_first);
    }
}
