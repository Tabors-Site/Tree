// treehost::llm — the LLM CONNECTION + CONFIG see-op ADAPTER. The wave-3 host floor: it COMPOSES the
// already-built resolver bodies in `treecognition::connect` (resolve_connection / resolve_connection_
// update / resolve_connection_removal / resolve_slot_assignment / resolve_llm_config) behind the SAME
// HostResolver seam the wave-1/2 substrate resolvers use. The act's see-arm (treeibp::run_body_host ->
// treehost::Resolvers) reaches these via `see resolve-X(args) as bind` inside an llm `.word`
// (store/words/llm-connection/*.word + llm-assigner/set-*-llm.word). Reimplements NONE of the
// validation/normalization — treecognition owns that; this layer does only the EDGE work the JS hosts
// (llmHost.js / llmAssignerHost.js + connect.js's resolve* floors) did around the pure resolver:
//
//   1. the STORE I/O the resolvers expect INJECTED: load the being row (qualities.llmConnections for
//      the count + the existing-connection checks, qualities.beingLlm.slots for the main / was-assigned
//      reads), compose treehost::toolkit::load_row (the same loadOrFold the other resolvers use).
//   2. the SSRF context: read the story's `allowedLlmDomains` + own host from the library config reel
//      (the JS hostInAllowedLlmDomains opt-in), pass them to treecognition's sync SSRF gate.
//   3. the api-key ENCRYPTOR: the FRESH treesign at-rest seal — AES-256-GCM under
//      credential_key(JWT_SECRET) (HKDF-SHA256), the SAME envelope every other at-rest secret uses
//      (treesign::encrypt_credential). One primitive, one envelope, one reality. The OUTBOUND edge
//      (treeos::llm_http::decrypt_api_key) unseals with the matching treesign::decrypt_credential, so the
//      seal and the unseal are the same crypto. The legacy JS AES-256-CBC `ivHex:ciphertextHex` shim is
//      GONE (no JS reality to interoperate with — Tabor's fresh-and-new directive).
//   4. the connection-id MINT (the JS uuidv4 — a fresh positional id keying the connections Map).
//   5. SHAPE the resolver's struct into the FLAT block the `.word` binds ($conn.beingId / .field /
//      .value / .isFirst / .connectionId, $patch.setBeingParams, $a.isBeing / .field / .value, ...).
//
// This is a PURE spec resolve: no live LLM HTTP session is touched (validate / SSRF-gate / encrypt /
// store-read only) — so nothing here routes through the binary's llm_http/cognize wire edge. A wired
// act running an llm `.word` reaches it through the see-arm and nothing more.

use std::path::Path;

use treehash::Json;

use crate::toolkit::{get, get_str, jstr, load_row, obj};
use crate::{arg, AuthCtx, HostError, Reason};

// The story domain = the library reel id (mirrors treeibp::STORY / treeos::config). A config follow-up
// will thread the live domain; for now the seed story is "localhost", matching the rest of the spine.
const STORY: &str = "localhost";

/// Turn a treecognition resolver's `String` refusal into a typed HostError. The cognition resolvers
/// carry the JS host's exact refusal TEXT (byte-matched); we classify the REASON by the text so the
/// `.word`'s `as <reason>` tail / the wire code matches the JS IbpError class (INVALID_INPUT for the
/// shape/validation refusals, BEING/SPACE_NOT_FOUND for the missing-target ones, FORBIDDEN for the
/// heaven-authority denial, UNAUTHORIZED for the no-caller ones).
fn classify(msg: String) -> HostError {
    let reason = if msg.contains("not found") && msg.contains("Being") {
        Reason::BeingNotFound
    } else if msg.contains("not found") && msg.contains("Space") {
        Reason::SpaceNotFound
    } else if msg.contains("heaven authority") || msg.starts_with("Only beings") {
        Reason::Forbidden
    } else if msg.contains("authenticated being") || msg.contains("identified actor") {
        Reason::Unauthorized
    } else {
        // "Connection not found" / "Maximum of N" / the validation refusals / the SSRF refusal /
        // "no configuration fields" — all the JS INVALID_INPUT class.
        Reason::InvalidInput
    };
    HostError::new(reason, msg)
}

// ── the injected STORE / EDGE context (what the JS hosts read around connect.js) ─────────────────────

/// The being's `qualities.llmConnections` map (or an empty object when absent) — the resolver's
/// `existing` for the count + the connection-exists checks. Composes load_row (loadOrFold) + nested get.
fn connections_of(row: &Json) -> Json {
    get(row, "qualities")
        .and_then(|q| get(q, "llmConnections"))
        .cloned()
        .unwrap_or_else(|| Json::Obj(vec![]))
}

/// The being's `qualities.beingLlm.slots` map (or an empty object when absent) — the resolver's `slots`
/// for the main-slot is-first read + the update's was-assigned check.
fn being_slots_of(row: &Json) -> Json {
    get(row, "qualities")
        .and_then(|q| get(q, "beingLlm"))
        .and_then(|b| get(b, "slots"))
        .cloned()
        .unwrap_or_else(|| Json::Obj(vec![]))
}

/// The story's `allowedLlmDomains` (the SSRF opt-in list) folded off the library config reel. Composes
/// treestore::read_reel_file + treefold::fold (the SAME read treeos::config::allowed_llm_domains makes),
/// staying inside treehost's existing crate set (no treeos dependency).
fn allowed_llm_domains(root: &Path) -> Vec<String> {
    let facts = treestore::read_reel_file(root, "0", "library", STORY, None, None);
    let state = treefold::fold("library", &facts);
    match get(&state, "config").and_then(|c| get(c, "allowedLlmDomains")) {
        Some(Json::Arr(a)) => a
            .iter()
            .filter_map(|x| if let Json::Str(s) = x { Some(s.clone()) } else { None })
            .collect(),
        _ => Vec::new(),
    }
}

/// The story's own host (also SSRF-refused), parsed from the config `storyUrl` exactly as
/// treeos::config::story_host does. None when no storyUrl is configured.
fn story_host(root: &Path) -> Option<String> {
    let facts = treestore::read_reel_file(root, "0", "library", STORY, None, None);
    let state = treefold::fold("library", &facts);
    let url = match get(&state, "config").and_then(|c| get(c, "storyUrl")) {
        Some(Json::Str(u)) if !u.is_empty() => u.clone(),
        _ => return None,
    };
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .unwrap_or(&url);
    Some(rest.split(['/', ':']).next().unwrap_or(rest).to_lowercase())
}

// ── the api-key ENCRYPTOR (FRESH treesign AES-256-GCM at-rest seal) ───────────────────────────────────

/// SEAL the connection api key with the FRESH treesign envelope: AES-256-GCM under
/// credential_key(JWT_SECRET) (HKDF-SHA256) — base64( iv(12) || tag(16) || ct ), exactly the at-rest seal
/// treesign uses for every other secret. The matching UNSEAL is treeos::llm_http::decrypt_api_key
/// (treesign::decrypt_credential under the same key), so the seam seals and unseals with ONE primitive.
///
/// JWT_SECRET is the edge secret (the process env, like the story key). The legacy AES-256-CBC
/// `ivHex:ciphertextHex` shim under CUSTOM_LLM_API_SECRET_KEY is GONE — there is no JS reality to keep the
/// ciphertext decryptable for. The cleartext key never lands on the chain; only this encrypted blob does,
/// and it decrypts solely at the outbound edge to set the Authorization bearer.
fn encrypt_api_key(plain: &str) -> Result<String, String> {
    let secret = std::env::var("JWT_SECRET").unwrap_or_default();
    if secret.is_empty() {
        return Err("JWT_SECRET is required to seal an LLM api key".to_string());
    }
    let key = treesign::credential_key(&secret);
    treesign::encrypt_credential(plain, &key)
}

/// Mint a fresh connection id — a v4-shaped uuid (the JS `uuidv4()`), 16 random bytes formatted
/// `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`. It keys the `qualities.llmConnections` Map (id from POSITION:
/// a connection is positional identity, the id_derivation rule).
fn mint_connection_id() -> String {
    let mut b = [0u8; 16];
    let _ = getrandom::getrandom(&mut b);
    b[6] = (b[6] & 0x0f) | 0x40; // version 4
    b[8] = (b[8] & 0x3f) | 0x80; // variant 10
    let h: String = b.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32])
}

// ── arg helpers (the see-op positional args the `.word` passes) ──────────────────────────────────────

fn str_param<'a>(params: &'a Json, k: &str) -> Option<&'a str> {
    get_str(params, k).filter(|s| !s.is_empty())
}

/// The being id a connection op targets: the standard-trigger `caller` (the actor's beingId). The llm-
/// connection `.word`s all act on the CALLER's OWN being (`do ... on the being $conn.beingId`), so the
/// connection target IS the caller. (The JS read `targetIdOf(target)`, which for these self-acts is the
/// caller's being.) `caller` arrives as the see-op's 3rd positional arg.
fn caller_being(args: &[Json]) -> Option<String> {
    match arg(args, 2) {
        Json::Str(s) if !s.is_empty() => Some(s.clone()),
        _ => None,
    }
}

// ── the five see-op handlers (each composes its treecognition resolver) ──────────────────────────────

/// resolve-connection(target, params, caller, branch) — add-llm-connection.word's floor. Validate /
/// SSRF-gate / encrypt / mint, read isFirst, return the FLAT block the `.word` binds.
pub fn resolve_connection(
    root: &Path,
    history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let params = arg(args, 1);
    let being_id = caller_being(args)
        .ok_or_else(|| HostError::unauthorized("add-llm-connection requires an identified actor"))?;
    let name = str_param(params, "name");
    let base_url = str_param(params, "baseUrl");
    let model = str_param(params, "model");
    if name.is_none() || base_url.is_none() || model.is_none() {
        return Err(HostError::invalid(
            "add-llm-connection: `name`, `baseUrl`, and `model` are required",
        ));
    }
    let row = load_row(root, history, "being", &being_id);
    if matches!(row, Json::Null) {
        return Err(HostError::being_not_found("Being not found"));
    }
    let existing = connections_of(&row);
    let slots = being_slots_of(&row);
    let main_slot = get_str(&slots, "main");
    let connection_id = mint_connection_id();
    let allowed = allowed_llm_domains(root);
    let own = story_host(root);

    let cargs = treecognition::connect::ConnectionArgs {
        name: name.unwrap().to_string(),
        base_url: base_url.unwrap().to_string(),
        api_key: str_param(params, "apiKey").map(|s| s.to_string()),
        model: model.unwrap().to_string(),
    };
    let cctx = treecognition::connect::ConnectionCtx {
        existing: &existing,
        main_slot,
        allowed_domains: &allowed,
        own_host: own.as_deref(),
        connection_id: &connection_id,
        max_connections: 15, // MAX_CONNECTIONS_PER_USER (connect.js)
        encrypt: &|k| encrypt_api_key(k).unwrap_or_default(),
    };
    let spec = treecognition::connect::resolve_connection(&cargs, &cctx).map_err(classify)?;
    // FLAT block: $conn.beingId / .field / .value / .connectionId / .isFirst (add.word binds these).
    let (field, value) = field_value_of(&spec.set_being_params);
    Ok(obj(vec![
        ("beingId", jstr(&being_id)),
        ("field", field),
        ("value", value),
        ("connectionId", jstr(&spec.connection_id)),
        ("isFirst", Json::Bool(spec.is_first)),
    ]))
}

/// resolve-connection-update(target, params, caller, branch) — update-llm-connection.word's floor.
pub fn resolve_connection_update(
    root: &Path,
    history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let params = arg(args, 1);
    let being_id = caller_being(args)
        .ok_or_else(|| HostError::unauthorized("update-llm-connection requires an identified actor"))?;
    let conn_id = str_param(params, "connectionId")
        .ok_or_else(|| HostError::invalid("update-llm-connection: `connectionId` is required"))?;
    if str_param(params, "baseUrl").is_none() || str_param(params, "model").is_none() {
        return Err(HostError::invalid(
            "update-llm-connection: `baseUrl` and `model` are required",
        ));
    }
    let row = load_row(root, history, "being", &being_id);
    if matches!(row, Json::Null) {
        return Err(HostError::being_not_found("Being not found"));
    }
    let existing_map = connections_of(&row);
    let existing = get(&existing_map, conn_id);
    let slots = being_slots_of(&row);

    let uargs = treecognition::connect::UpdateArgs {
        name: str_param(params, "name").map(|s| s.to_string()),
        base_url: str_param(params, "baseUrl").map(|s| s.to_string()),
        api_key: str_param(params, "apiKey").map(|s| s.to_string()),
        model: str_param(params, "model").map(|s| s.to_string()),
    };
    let spec = treecognition::connect::resolve_connection_update(
        conn_id,
        existing,
        &uargs,
        &allowed_llm_domains(root),
        story_host(root).as_deref(),
        &slots,
        &|k| encrypt_api_key(k).unwrap_or_default(),
    )
    .map_err(classify)?;
    // FLAT block: $patch.beingId / .connectionId / .wasAssigned / .setBeingParams.
    Ok(obj(vec![
        ("beingId", jstr(&being_id)),
        ("connectionId", jstr(&spec.connection_id)),
        ("wasAssigned", Json::Bool(spec.was_assigned)),
        ("setBeingParams", spec.set_being_params),
    ]))
}

/// resolve-connection-removal(target, params, caller, branch) — delete-llm-connection.word's floor.
pub fn resolve_connection_removal(
    root: &Path,
    history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let params = arg(args, 1);
    let being_id = caller_being(args)
        .ok_or_else(|| HostError::unauthorized("delete-llm-connection requires an identified actor"))?;
    let conn_id = str_param(params, "connectionId")
        .ok_or_else(|| HostError::invalid("delete-llm-connection: `connectionId` is required"))?;
    let row = load_row(root, history, "being", &being_id);
    if matches!(row, Json::Null) {
        return Err(HostError::being_not_found("Being not found"));
    }
    let existing_map = connections_of(&row);
    let existing = get(&existing_map, conn_id);
    let set_being_params =
        treecognition::connect::resolve_connection_removal(conn_id, existing).map_err(classify)?;
    // FLAT block: $removal.beingId / .connectionId / .setBeingParams.
    Ok(obj(vec![
        ("beingId", jstr(&being_id)),
        ("connectionId", jstr(conn_id)),
        ("setBeingParams", set_being_params),
    ]))
}

/// resolve-slot-assignment(target, params, caller, branch) — assign-llm-slot.word's floor. The target
/// kind comes from the `.word`'s `target` ({kind,id}); a stance assigns at the space level (the JS
/// detectTargetKind === "stance" -> "space"). The `existing` connections come from the being whose
/// connection is being bound (a being -> that being; a space -> the caller, who OWNS the connection).
pub fn resolve_slot_assignment(
    root: &Path,
    history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let target = arg(args, 0);
    let params = arg(args, 1);
    if str_param(params, "slot").is_none() {
        return Err(HostError::invalid("assign-llm-slot: `slot` is required"));
    }
    // Normalize the target kind (a stance assigns at the space level, the JS detectTargetKind rule).
    let kind = match get_str(target, "kind") {
        Some("being") => "being",
        Some("stance") | Some("space") => "space",
        // The `.word` self-acts on the caller's being by default (do ... on the being $a.id).
        _ => "being",
    };
    let target_id = get_str(target, "id")
        .map(|s| s.to_string())
        .or_else(|| caller_being(args))
        .ok_or_else(|| HostError::missing_target("slot assignment target required"))?;
    let norm_target = obj(vec![("kind", jstr(kind)), ("id", jstr(&target_id))]);

    // The being that OWNS the connection: a being target -> itself; a space target -> the caller.
    let owner = if kind == "being" {
        target_id.clone()
    } else {
        caller_being(args).unwrap_or_else(|| target_id.clone())
    };
    let row = load_row(root, history, "being", &owner);
    let existing = if matches!(row, Json::Null) {
        Json::Obj(vec![])
    } else {
        connections_of(&row)
    };
    let block = treecognition::connect::resolve_slot_assignment(&norm_target, params, &existing)
        .map_err(classify)?;
    Ok(block)
}

/// resolve-llm-config(params, caller) — the set-*-llm floor. ONE see-op NAME backs all three modes
/// (being / space / story); the JS bound the mode in the op-registration closure (llmConfigHostEnv).
/// The see-arm passes only (params, caller) — the trigger's targetKind is NOT threaded — so the mode is
/// inferred from the args: `params.spaceId` -> SPACE; `params.scope === "story"` (the story-llm marker)
/// -> STORY (the heaven-gated place root); otherwise -> BEING (the caller's own being). See the report's
/// coordination note: the story-vs-being split is only fully faithful when the trigger targetKind is
/// threaded into the see-arm; absent that thread, set-story-llm must carry a `scope:"story"` marker (or
/// a spaceId of the root) to route to the root rather than the caller.
pub fn resolve_llm_config(
    root: &Path,
    _history: &str,
    args: &[Json],
    _ctx: &AuthCtx,
) -> Result<Json, HostError> {
    let params = arg(args, 0);
    let caller = match arg(args, 1) {
        Json::Str(s) if !s.is_empty() => Some(s.as_str()),
        _ => None,
    };

    // Force-flag mutex (the JS assertFlagMutex): both-true is rejected up front, matching the JS refusal
    // (treecognition's resolver applies the receiver-wins mutex but does not REFUSE both-true).
    if matches!(get(params, "forceActor"), Some(Json::Bool(true)))
        && matches!(get(params, "forceReceiver"), Some(Json::Bool(true)))
    {
        return Err(HostError::invalid(
            "forceActor and forceReceiver cannot both be true on the same container. \
             Pick one — the chain caps at this container (forceReceiver) or jumps to the actor side (forceActor).",
        ));
    }

    let is_story = matches!(get_str(params, "scope"), Some("story"));
    let space_id = str_param(params, "spaceId");

    let (kind, id): (&str, String) = if let Some(sp) = space_id {
        // SPACE mode: the space must exist (the JS Space.exists read; SPACE_NOT_FOUND on absence).
        let row = load_row(root, "0", "space", sp);
        if matches!(row, Json::Null) {
            return Err(HostError::space_not_found(format!("Space {sp} not found")));
        }
        ("space", sp.to_string())
    } else if is_story {
        // STORY mode: the heaven-gated place root. AUTH (hasHeavenAuthority) is the caller's verdict,
        // which the see-arm does not thread here; the root resolve is the substrate read.
        let caller = caller.ok_or_else(|| {
            HostError::unauthorized("set-story-llm requires an authenticated being.")
        })?;
        let _ = caller; // the heaven-authority gate is the dispatcher's able-walk (AblesAreAuth).
        let root_id = crate::toolkit::story_root_id(root)
            .ok_or_else(|| HostError::new(Reason::Internal, "Story place root not found"))?;
        ("space", root_id)
    } else {
        // BEING mode: the caller's own being.
        let caller = caller.ok_or_else(|| {
            HostError::unauthorized("set-being-llm requires an authenticated being.")
        })?;
        ("being", caller.to_string())
    };

    treecognition::connect::resolve_llm_config(kind, &id, params).map_err(classify)
}

/// Split a `{ field, value }` set-being params block into its two values (the FLAT shape add.word binds).
fn field_value_of(set_being_params: &Json) -> (Json, Json) {
    let field = get(set_being_params, "field").cloned().unwrap_or(Json::Null);
    let value = get(set_being_params, "value").cloned().unwrap_or(Json::Null);
    (field, value)
}
