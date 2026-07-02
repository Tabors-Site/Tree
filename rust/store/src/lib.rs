// TreeOS Seed (Rust) . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// treeseed — THE STORE. One place holding every word of the story with its floor Rust BESIDE it:
//
//   store/
//     book/                the genesis book — index.word (the reading order) + the genesis words
//     words/<name>.word    a flat file = a pure CONCEPT (English only, no floor)
//     words/<bundle>/      a dir = an IMPLEMENTATION — the .word (the meaning) + its floor .rs
//     src/lib.rs           this file: the resolver seam + the #[path] registrations + the lookup API
//
// THE SEAM LAW, structural: to see what a word MEANS you open its `.word`; to see the floor it stands
// on you open the `.rs` sitting next to it. A floor `.rs` with no sibling `.word` is drift; meaning in
// an `.rs` that its `.word` does not say is drift (WORD-DRIVEN-PARSER.md). The engine (treeos) boots
// from THIS store; the JS `seed/` tree is a dead reference corpus. Each floor module below is
// registered with a `#[path]` line into its bundle dir — one line, right above the `Resolvers` match
// arm a new bundle must also add, so a bundle cannot be half-wired.
//
// (Formerly the treehost crate.) The HOST SEE-OP BRIDGE half: materials act-handlers are WORD-SOLE — each `.word`
// (set-being.word / set-space.word / create.word / end-space.word / set-matter.word /
// create-matter.word) is the ONLY path, and its genuine substrate READS bottom out in a host see-op,
// `see resolve-X(args) as bind` — the strand the JS floor (`*Host.js`) carried. treeibp::run_body
// evaluates `act` nodes but NOT `see resolve-X` nodes, so those `.word` files cannot run end-to-end.
// This crate IS those resolver bodies, ported native:
//
//   resolve_set_being_spec    (setBeingHost.js     resolve-set-being-spec)
//   resolve_set_space_spec    (setSpaceHost.js     resolve-set-space-spec)
//   resolve_create_space      (spaceHost.js        resolve-birth-space)
//   resolve_end_space_spec    (endSpaceHost.js     resolve-end-space-spec)
//   resolve_set_matter_spec   (setMatterHost.js    resolve-set-matter-spec)
//   resolve_create_matter     (matterHost.js       resolve-birth-spec / resolveBirthSpec)
//   resolve_birth_being       (identity/birth.js   resolve-birth-being / birthBeing)
//   resolve_move              (moveHost.js         resolve-source)
//   resolve_rename_matter     (renameMatterHost.js resolve-rename-spec)
//   resolve_purge             (purgeContentHost.js resolve-purge)
//   resolve_inheritation      (inheritationHost.js resolve-inheritation)
//   resolve_owner             (ownerHost.js        space-id-of / may-set-owner / may-remove-owner)
//   resolve_grant             (grantHost.js        able-exists)
//   resolve_kill              (killHost.js         resolve-target-being)
//   resolve_switch            (switchHost.js       destination-missing / destination-paused / being-lives-on)
//   resolve_truename          (truenameHost.js     resolve-name-id / name-exists / name-banished)
//
// The host THROW each refuses with is the refined `HostError { reason: Reason, message }` (PART 1): a
// real `Reason` enum (the JS `IBP_ERR` + the `.word` `as <reason>` taxonomy, deduped) whose `code()` is
// the stable kebab the wire / `.word` refusal carries; `message` is the byte-matched human refusal.
//
// Each: VALIDATE (name-collision -> err, coord-out-of-bounds -> err, CAS-missing -> err, already-
// deleted -> err, unknown-type -> err, unknown-field -> err) and RETURN the fact SPEC the dispatcher
// stamps — byte-compatible with the JS host's returned block (the `factParams` / enriched spec the
// reducers fold). It lays NO fact and mutates nothing: it is a READ.
//
// IT COMPOSES the past-engine crates (treeproj find/refold, treefold fold, treecas existence,
// treestore reels, treehash hash) and reimplements none of them — exactly as the JS hosts reused
// loadTargetRow / findByName / assertCoordInBounds / hasContent. It does NOT depend on treeibp or
// treeval: AUTHORITY (the able-walk verdict, the owner/not-root check, the actor's beingId) is the
// CALLER's INPUT — an `AuthCtx` parameter — mirroring the existing `able_spec_of` / `host: &dyn Fn`
// injection seams. The seam treeibp::run_body calls for `see resolve-X` is the `HostResolver` trait
// (and the `Resolvers` default table) below; wiring it INTO run_body is a coordinated additive touch
// on the other agent's crate (see NOTES.md — do NOT do it here).

use std::path::Path;

use treehash::Json;

pub mod toolkit;

#[path = "../words/able-manager/able_manager.rs"]
mod able_manager;
#[path = "../words/acquisition/acquisition.rs"]
mod acquisition;
#[path = "../words/being/being.rs"]
mod being;
#[path = "../words/being/birth.rs"]
mod birth;
#[path = "../words/cherub/cherub.rs"]
mod cherub;
#[path = "../words/config/config.rs"]
mod config;
#[path = "../words/credential/credential.rs"]
mod credential;
#[path = "../words/able-manager/flow.rs"]
mod flow;
#[path = "../words/key/key.rs"]
mod key;
#[path = "../words/grant-able/grant.rs"]
mod grant;
#[path = "../words/history-pointers/history_pointers.rs"]
mod history_pointers;
#[path = "../words/being/inheritation.rs"]
mod inheritation;
#[path = "../words/llm/llm.rs"]
mod llm;
#[path = "../words/matter/matter.rs"]
mod matter;
#[path = "../words/model/model.rs"]
mod model;
#[path = "../words/owner/owner.rs"]
mod owner;
#[path = "../words/portal/portal.rs"]
mod portal;
#[path = "../words/matter/purge.rs"]
mod purge;
#[path = "../words/move/relocate.rs"]
mod relocate;
#[path = "../words/matter/rename.rs"]
mod rename;
#[path = "../words/set-render/render.rs"]
mod render;
#[path = "../words/space/space.rs"]
mod space;
#[path = "../words/set-world-signal/worldsignal.rs"]
mod worldsignal;

pub use able_manager::{author_able, remove_able};
pub use acquisition::{able_request, asked_policy, grant_internal};
pub use being::resolve_set_being_spec;
pub use birth::resolve_birth_being;
pub use cherub::{resolve_kill, resolve_switch, resolve_truename};
pub use config::{resolve_config_delete, resolve_config_set};
pub use credential::{mint_credential, read_credential, reel_head_of};
pub use flow::resolve_set_being_flow_spec;
pub use key::{load_key, paper_form};
pub use grant::resolve_grant;
pub use history_pointers::{
    delete_pointer_map, find_pointers_space_id, read_pointers, set_pointer_map, valid_canonical,
    valid_pointer_name,
};
pub use inheritation::resolve_inheritation;
pub use llm::{
    resolve_connection, resolve_connection_removal, resolve_connection_update, resolve_llm_config,
    resolve_slot_assignment,
};
pub use matter::{resolve_create_matter, resolve_end_matter, resolve_set_matter_spec};
pub use model::{may_set_model, resolve_model_block};
pub use owner::resolve_owner;
pub use portal::resolve_containing_space;
pub use purge::resolve_purge;
pub use relocate::{resolve_move, resolve_move_being};
pub use rename::resolve_rename_matter;
pub use render::validate_render_block;
pub use space::{resolve_create_space, resolve_end_space_spec, resolve_set_space_spec};
pub use worldsignal::{
    parse_signal_value, signal_fact, signal_field, story_root, valid_key, valid_namespace,
};

// ── the AUTHORITY input (the caller's verdict; treehost does NOT compute it) ───────────────────────
/// The authority context the CALLER (treeibp's authorize / able-walk) resolves and hands in. treehost
/// does NOT depend on treeibp/treeval, so it never runs the able-walk or the owner check itself: those
/// verdicts arrive HERE, already decided. The resolvers TRUST them (the `.word` comments say so:
/// "Authorization is the verb dispatcher's able-walk (AblesAreAuth); this trusts it").
///
/// Fields:
///   - `actor_being_id`: the real caller's beingId (the JS `ctx.identity.beingId` / `caller` arg). It
///     is the matter/space CREATOR (create-matter/create-space attribute to it) and the space DELETER
///     (end-space records it). Required for create (the `.word` refuses "no caller").
///   - `authorized`: the verb-dispatcher's able-walk verdict for THIS act (the JS trusts it). The
///     resolvers do not re-gate on it (the substrate read is their job); it is carried so run_body can
///     pass the same verdict it already computed and a resolver MAY refuse on it where the JS host did
///     (end-space's owner/not-root authority is the caller's input — see resolve_end_space_spec).
///   - `is_i`: the actor is I (the genesis / boot mirror identity that bypasses gates the JS keyed on
///     `beingId !== I` — e.g. deleteSpaceHistory's bypass).
#[derive(Debug, Clone, Default)]
pub struct AuthCtx {
    pub actor_being_id: Option<String>,
    pub authorized: bool,
    pub is_i: bool,
}

impl AuthCtx {
    /// A caller-attributed context (the common case: a real being acting, able-walk already passed).
    pub fn caller(being_id: &str) -> Self {
        AuthCtx {
            actor_being_id: Some(being_id.to_string()),
            authorized: true,
            is_i: false,
        }
    }
    /// The I-internal context (genesis / boot mirror sync) — bypasses the `beingId !== I` gates.
    pub fn i_am() -> Self {
        AuthCtx {
            actor_being_id: Some("I".to_string()),
            authorized: true,
            is_i: true,
        }
    }
}

// ── the REFINED error system (the JS IbpError / `.word` `as <reason>` taxonomy, as a real enum) ──────
/// The structured refusal REASON — the Rust ENUM of the JS error taxonomy, REFINED from two
/// stringly-typed JS sources into one closed set:
///
///   1. `seed/ibp/protocol.js` `IBP_ERR` — the SCREAMING_SNAKE wire code set the verb dispatcher
///      throws (`IbpError(IBP_ERR.INVALID_INPUT, ...)`); and
///   2. the `.word` refusal tail `refuse with "..." as <reason>` — the kebab `as <reason>` set the
///      WORD-SOLE handlers carry (`as unauthorized`, `as invalid-input`, `as being-not-found`,
///      `as forbidden`, `as story-paused`, `as name-collision`, ...).
///
/// Refined = ONE enum, deduped + grouped (the JS had BOTH `UNAUTHORIZED`+`as unauthorized` and
/// `FORBIDDEN`+`as forbidden`; both survive as distinct variants because the `.word`s distinguish
/// them — auth-absent vs auth-present-but-denied). Each variant has a STABLE `code()` -> the kebab
/// string the wire / `.word` refusal carries, so the ported refusal text matches the JS `as <reason>`
/// names byte-for-byte. The Display of a `HostError` is its `message` (the human refusal the host
/// threw); the `code()` is the machine reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    /// auth ABSENT: no identity / no caller (JS `UNAUTHORIZED`, `.word` `as unauthorized`).
    Unauthorized,
    /// auth PRESENT but DENIED: the actor exists but lacks authority (JS `FORBIDDEN`, `as forbidden`).
    Forbidden,
    /// a shape / input refusal (JS `INVALID_INPUT` / `INVALID_TYPE`, `.word` `as invalid-input`).
    InvalidInput,
    /// a missing TARGET being (JS `BEING_NOT_FOUND`, `.word` `as being-not-found`).
    BeingNotFound,
    /// a missing TARGET space (JS `SPACE_NOT_FOUND`).
    SpaceNotFound,
    /// a missing Name (JS `NAME_NOT_FOUND`).
    NameNotFound,
    /// a name already taken in the kind's scope (findByName collision; the JS threw `RESOURCE_CONFLICT`
    /// for space siblings / `INVALID_INPUT` for matter siblings — REFINED to one dedicated reason).
    NameCollision,
    /// the space/matter is already soft-deleted (its parent/spaceId === DELETED).
    AlreadyDeleted,
    /// a coord axis out of bounds against the containing/parent Space.size (the clamp THROW).
    CoordOutOfBounds,
    /// an unknown matter/space TYPE (the type-registry gate, JS `INVALID_TYPE`).
    UnknownType,
    /// a content hash whose bytes are NOT in the CAS store (hasContent false).
    UnknownContent,
    /// a required TARGET / subject is absent (the move/owner/purge "target required" refusals).
    MissingTarget,
    /// a shared-fate / lock CONFLICT (JS `RESOURCE_CONFLICT` — purge's refcount over dedup'd bytes).
    ResourceConflict,
    /// the destination history is paused / frozen for writes (JS `STORY_PAUSED`, `as story-paused`).
    StoryPaused,
    /// a corrupt registry lineage surfaced by the cross-history walk (JS `BRANCH_NOT_FOUND`).
    BranchNotFound,
    /// an unclassified internal fault (JS `INTERNAL`). The fallback reason.
    Internal,
}

impl Reason {
    /// The STABLE kebab code the wire / `.word` refusal carries (matching the JS `as <reason>` names).
    /// This is the round-trippable machine reason; `code()` is the inverse of `from_code`.
    pub fn code(self) -> &'static str {
        match self {
            Reason::Unauthorized => "unauthorized",
            Reason::Forbidden => "forbidden",
            Reason::InvalidInput => "invalid-input",
            Reason::BeingNotFound => "being-not-found",
            Reason::SpaceNotFound => "space-not-found",
            Reason::NameNotFound => "name-not-found",
            Reason::NameCollision => "name-collision",
            Reason::AlreadyDeleted => "already-deleted",
            Reason::CoordOutOfBounds => "coord-out-of-bounds",
            Reason::UnknownType => "unknown-type",
            Reason::UnknownContent => "unknown-content",
            Reason::MissingTarget => "missing-target",
            Reason::ResourceConflict => "resource-conflict",
            Reason::StoryPaused => "story-paused",
            Reason::BranchNotFound => "branch-not-found",
            Reason::Internal => "internal",
        }
    }
    /// Parse a kebab code back to its Reason (the round-trip inverse of `code()`). An unknown code is
    /// `Internal` (the safe fallback, mirroring the JS `code || IBP_ERR.INTERNAL`).
    pub fn from_code(code: &str) -> Reason {
        match code {
            "unauthorized" => Reason::Unauthorized,
            "forbidden" => Reason::Forbidden,
            "invalid-input" => Reason::InvalidInput,
            "being-not-found" => Reason::BeingNotFound,
            "space-not-found" => Reason::SpaceNotFound,
            "name-not-found" => Reason::NameNotFound,
            "name-collision" => Reason::NameCollision,
            "already-deleted" => Reason::AlreadyDeleted,
            "coord-out-of-bounds" => Reason::CoordOutOfBounds,
            "unknown-type" => Reason::UnknownType,
            "unknown-content" => Reason::UnknownContent,
            "missing-target" => Reason::MissingTarget,
            "resource-conflict" => Reason::ResourceConflict,
            "story-paused" => Reason::StoryPaused,
            "branch-not-found" => Reason::BranchNotFound,
            _ => Reason::Internal,
        }
    }
}

impl std::fmt::Display for Reason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}

// ── the host-throw -> the .word's refusal (a HostError IS the refusal) ──────────────────────────────
/// What a resolver refuses with — the Rust twin of the JS host THROW (an Error / IbpError), which the
/// dispatcher turns into the `.word`'s refusal. REFINED: a CLEAN typed pair { reason, message } — the
/// `reason` is the machine code (the `Reason` enum, `code()` -> the kebab the wire/`.word` carries),
/// the `message` is the human refusal text the JS host threw (byte-matched, so a wired run_body
/// surfaces a value-identical denial). Display is the message; `.reason.code()` is the wire reason.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostError {
    pub reason: Reason,
    pub message: String,
}

impl HostError {
    /// Construct from a reason + an owned/borrowable message.
    pub fn new(reason: Reason, message: impl Into<String>) -> Self {
        HostError { reason, message: message.into() }
    }
    /// The stable kebab reason code (the wire / `.word` `as <reason>` string).
    pub fn code(&self) -> &'static str {
        self.reason.code()
    }

    // ── the named constructors (each builds the right Reason + the EXACT JS refusal text) ───────────
    /// A shape / input refusal (the JS `throw new Error(...)` / `IbpError(INVALID_INPUT, ...)`).
    pub fn invalid(message: impl Into<String>) -> Self {
        HostError::new(Reason::InvalidInput, message)
    }
    /// Auth ABSENT (no caller / no identity). The JS `IbpError(UNAUTHORIZED, ...)`.
    pub fn unauthorized(message: impl Into<String>) -> Self {
        HostError::new(Reason::Unauthorized, message)
    }
    /// Auth PRESENT but DENIED (the able-walk / owner verdict is false). The JS `IbpError(FORBIDDEN, ...)`.
    pub fn forbidden(message: impl Into<String>) -> Self {
        HostError::new(Reason::Forbidden, message)
    }
    /// A required TARGET / subject is absent. The JS "... target required" refusals.
    pub fn missing_target(message: impl Into<String>) -> Self {
        HostError::new(Reason::MissingTarget, message)
    }
    /// A missing TARGET being (the cherub kill/truename "target being not found" refusals).
    pub fn being_not_found(message: impl Into<String>) -> Self {
        HostError::new(Reason::BeingNotFound, message)
    }
    /// A missing TARGET space (the move/owner "space not found" refusals).
    pub fn space_not_found(message: impl Into<String>) -> Self {
        HostError::new(Reason::SpaceNotFound, message)
    }
    /// A missing Name (the name-registry "no such name" refusals).
    pub fn name_not_found(message: impl Into<String>) -> Self {
        HostError::new(Reason::NameNotFound, message)
    }
    /// The destination history is paused / frozen for writes (the switch `as story-paused`).
    pub fn story_paused(message: impl Into<String>) -> Self {
        HostError::new(Reason::StoryPaused, message)
    }
    /// A shared-fate / lock CONFLICT (purge's refcount over dedup'd bytes; the JS `RESOURCE_CONFLICT`).
    pub fn resource_conflict(message: impl Into<String>) -> Self {
        HostError::new(Reason::ResourceConflict, message)
    }
    /// A name already taken on this history in the kind's scope (findByName collision). Formats the
    /// SAME refusal the prior `NameTaken` variant's Display produced.
    pub fn name_taken(op: &str, name: &str, history: &str) -> Self {
        HostError::new(
            Reason::NameCollision,
            format!("{op}: name \"{name}\" already taken on history {history}"),
        )
    }
    /// A coord axis out of bounds against the containing/parent Space.size (the clamp THROW). Formats
    /// the SAME refusal the prior `CoordOutOfBounds` variant's Display produced.
    pub fn coord_out_of_bounds(op: &str, axis: &str, value: f64, high: f64, noun: &str) -> Self {
        HostError::new(
            Reason::CoordOutOfBounds,
            format!("{op}: coord.{axis}={value} is out of bounds (0..{high} for this {noun})"),
        )
    }
    /// A content hash whose bytes are NOT in the CAS store. Formats the SAME refusal the prior
    /// `UnknownContent` variant's Display produced.
    pub fn unknown_content(op: &str, hash: &str) -> Self {
        let short: String = hash.chars().take(12).collect();
        HostError::new(
            Reason::UnknownContent,
            format!("{op}: unknown content hash \"{short}...\" (bytes not in store)"),
        )
    }
    /// An unknown matter type. Formats the SAME refusal the prior `UnknownType` variant's Display did.
    pub fn unknown_type(ty: &str) -> Self {
        HostError::new(
            Reason::UnknownType,
            format!("create-matter: unknown matter type \"{ty}\""),
        )
    }
    /// The space is already soft-deleted. Formats the SAME refusal the prior `AlreadyDeleted` did.
    pub fn already_deleted(id: &str) -> Self {
        HostError::new(
            Reason::AlreadyDeleted,
            format!("end-space: space \"{id}\" is already deleted"),
        )
    }
    /// A corrupt registry lineage surfaced by the cross-history walk (the JS BRANCH_NOT_FOUND).
    pub fn lineage(message: impl std::fmt::Display) -> Self {
        HostError::new(Reason::BranchNotFound, format!("lineage: {message}"))
    }
}

impl std::fmt::Display for HostError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for HostError {}

// ── the dispatch SEAM (the HostResolver trait + the default Resolvers table) ────────────────────────
/// The injectable seam treeibp::run_body calls for a `see resolve-X(args) as bind` node. `op` is the
/// see-op name (the `.word`'s `act`, e.g. "resolve-set-being-spec"), `args` is the positional `args`
/// array the parser built (each already $-resolved to a value by run_body BEFORE dispatch), `root` /
/// `history` locate the on-disk store, `ctx` carries the caller's AUTHORITY verdict. The resolver
/// returns the BLOCK the `.word` binds (`{ beingId, factParams }` / `{ spaceId, factParams }` /
/// `{ enrichedSpec, matterId, ... }` / `{ spaceId }`), which the `.word` promotes into its fact.
///
/// This MIRRORS the existing `able_spec_of: impl Fn(&str) -> Option<Json>` and `host: &dyn Fn(...)`
/// seams in treeibp/treeval: a trait object treeibp takes, decoupled from this crate's work. Wiring it
/// into run_body is an ADDITIVE touch on treeibp (a `Some("see")` match arm), described in NOTES.md.
pub trait HostResolver {
    /// Resolve ONE host see-op. `Ok(block)` is the validated return the `.word` binds; `Err` is the
    /// host throw (the `.word`'s refusal). An UNKNOWN op is `Err(HostError::Invalid("unknown see-op
    /// ..."))` — the SEE_FLOOR reject-unknown gate (deferred in the parser, enforced here).
    fn resolve(
        &self,
        op: &str,
        args: &[Json],
        root: &Path,
        history: &str,
        ctx: &AuthCtx,
    ) -> Result<Json, HostError>;
}

/// The default resolver TABLE: routes each `resolve-X` see-op to its native body. This is the value
/// run_body injects (or any caller drives directly). Stateless — the store ROOT + history + AuthCtx
/// arrive per call, exactly as the JS `ctx` did.
#[derive(Debug, Default, Clone, Copy)]
pub struct Resolvers;

impl HostResolver for Resolvers {
    fn resolve(
        &self,
        op: &str,
        args: &[Json],
        root: &Path,
        history: &str,
        ctx: &AuthCtx,
    ) -> Result<Json, HostError> {
        match op {
            // the original six (set/create/end resolvers)
            "resolve-set-being-spec" => resolve_set_being_spec(root, history, args, ctx),
            "resolve-set-space-spec" => resolve_set_space_spec(root, history, args, ctx),
            "resolve-birth-space" => resolve_create_space(root, history, args, ctx),
            "resolve-end-space-spec" => resolve_end_space_spec(root, history, args, ctx),
            "resolve-set-matter-spec" => resolve_set_matter_spec(root, history, args, ctx),
            "resolve-birth-spec" => resolve_create_matter(root, history, args, ctx),
            // be:birth: the being-creation validation + spec (identity/birth.js birthBeing).
            "resolve-birth-being" => resolve_birth_being(root, history, args, ctx),
            // move: the source-space READ (moveHost.js resolve-source).
            "resolve-source" => resolve_move(root, history, args, ctx),
            // move (being step): validate the compass direction + name the walker (the WASD walk).
            "resolve-move-being" => resolve_move_being(root, history, args, ctx),
            // rename-matter: the per-folder uniqueness READ (renameMatterHost.js resolve-rename-spec).
            "resolve-rename-spec" => resolve_rename_matter(root, history, args, ctx),
            // purge-content: load + hash + auth + shared-fate refcount (purgeContentHost.js resolve-purge).
            "resolve-purge" => resolve_purge(root, history, args, ctx),
            // grant/revoke inheritation: name-declared + not-banished + hasAuthorityOver (inheritationHost.js).
            "resolve-inheritation" => resolve_inheritation(root, history, args, ctx),
            // owner: the ownerHost.js family (space-id-of / may-set-owner / may-remove-owner).
            "space-id-of" | "may-set-owner" | "may-remove-owner" => {
                resolve_owner(op, root, history, args, ctx)
            }
            // grant-able: the able-registry lookup (grantHost.js able-exists).
            "able-exists" => resolve_grant(op, root, history, args, ctx),
            // cherub kill: resolve the target being from the address handle (killHost.js).
            "resolve-target-being" => resolve_kill(op, root, history, args, ctx),
            // cherub switch: the destination-history reads (switchHost.js).
            "destination-missing" | "destination-paused" | "being-lives-on" => {
                resolve_switch(op, root, history, args, ctx)
            }
            // cherub truename: the Name reads (truenameHost.js resolve-name-id / name-exists / name-banished).
            "resolve-name-id" | "name-exists" | "name-banished" => {
                resolve_truename(op, root, history, args, ctx)
            }
            // end-matter: load + author-or-root-owner gate (endMatterHost.js resolve-end-matter-spec).
            "resolve-end-matter-spec" => resolve_end_matter(root, history, args, ctx),
            // story-config: the validate-and-author NAME-ACT params (storyConfig.js configHostEnv).
            "resolve-config-set" => resolve_config_set(root, history, args, ctx),
            "resolve-config-delete" => resolve_config_delete(root, history, args, ctx),
            // set-model: the per-kind auth READ + the model-block builder (modelHost.js).
            "may-set-model" => may_set_model(root, history, args, ctx),
            "resolve-model-block" => resolve_model_block(root, history, args, ctx),
            // set-being-flow: the flow-clause validation + spec (setBeingFlowHost.js).
            "resolve-set-being-flow-spec" => resolve_set_being_flow_spec(root, history, args, ctx),
            // set-render: the render-block schema validation + spec (setRenderHost.js validate-render-block).
            "validate-render-block" => validate_render_block(root, history, args, ctx),
            // portal: the containing-space read (portalHost.js resolve-containing-space).
            "resolve-containing-space" => resolve_containing_space(root, history, args, ctx),
            // set-world-signal: the kebab gates + value coercion + field/fact builders + story-root read.
            "valid-namespace" => valid_namespace(root, history, args, ctx),
            "valid-key" => valid_key(root, history, args, ctx),
            "parse-signal-value" => parse_signal_value(root, history, args, ctx),
            "signal-field" => signal_field(root, history, args, ctx),
            "signal-fact" => signal_fact(root, history, args, ctx),
            "story-root" => story_root(root, history, args, ctx),
            // history-pointers: the pointer-name/canonical gates + the .histories heaven reads + the
            // map merge/prune (historyManagerHost.js; set-pointer.word / delete-pointer.word).
            "valid-pointer-name" => valid_pointer_name(root, history, args, ctx),
            "valid-canonical" => valid_canonical(root, history, args, ctx),
            "find-pointers-space-id" => find_pointers_space_id(root, history, args, ctx),
            "read-pointers" => read_pointers(root, history, args, ctx),
            "set-pointer-map" => set_pointer_map(root, history, args, ctx),
            "delete-pointer-map" => delete_pointer_map(root, history, args, ctx),
            // acquisition: the asked policy + the grant-record build + the able-request payload
            // (acquisitionHost.js; ask-able.word / take-able.word).
            "asked-policy" => asked_policy(root, history, args, ctx),
            "grant-internal" => grant_internal(root, history, args, ctx),
            "able-request" => able_request(root, history, args, ctx),
            // able-manager: the live able-authoring spec + the remove spec (ableManagerHost.js;
            // set-able.word / delete-able.word). The manifest write + hot-register are seal deferrals.
            "author-able" => author_able(root, history, args, ctx),
            "remove-able" => remove_able(root, history, args, ctx),
            // credential reset/read (credentialHost.js): the chain-head read + the credential SPECs.
            // reel-head-of is a pure substrate read; read-credential returns the encrypted blob spec
            // (the seal decrypts); mint-credential returns the mint spec (the seal mints + encrypts).
            "reel-head-of" => reel_head_of(root, history, args, ctx),
            "read-credential" => read_credential(root, history, args, ctx),
            "mint-credential" => mint_credential(root, history, args, ctx),
            // key-export (keyHost.js): the signing-key load SPEC (the seal loads the live PEM) + the
            // BIP39 paper form (deterministic via treesign; deferred since its input is the load-key PEM).
            "load-key" => load_key(root, history, args, ctx),
            "paper-form" => paper_form(root, history, args, ctx),
            // LLM connections + config (llmHost.js / llmAssignerHost.js around connect.js): the wave-3
            // floor, COMPOSING treecognition::connect's resolver bodies behind this seam (the see-arm an
            // llm `.word` reaches via run_body_host). Validate / SSRF-gate / encrypt the api key / read
            // is-first|was-assigned / mint the connection id / normalize the config writes — all pure
            // spec resolves (no live LLM HTTP). store/words/llm-connection/*.word + llm-assigner/set-*-llm.
            "resolve-connection" => resolve_connection(root, history, args, ctx),
            "resolve-connection-update" => resolve_connection_update(root, history, args, ctx),
            "resolve-connection-removal" => resolve_connection_removal(root, history, args, ctx),
            "resolve-slot-assignment" => resolve_slot_assignment(root, history, args, ctx),
            "resolve-llm-config" => resolve_llm_config(root, history, args, ctx),
            other => Err(HostError::invalid(format!(
                "host: unknown see-op \"{other}\" (SEE_FLOOR reject-unknown)"
            ))),
        }
    }
}

// ── arg helpers the resolvers share (positional `args[i]`, JS `args: [a, b, c]`) ────────────────────
/// `args[i]` or Json::Null (an absent positional arg is JS `undefined`, which the hosts treat as null).
pub(crate) fn arg(args: &[Json], i: usize) -> &Json {
    args.get(i).unwrap_or(&Json::Null)
}
