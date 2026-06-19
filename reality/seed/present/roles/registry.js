// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// The role registry — the templates of what a being CAN BE.
//
// A **role** is the template the being's frame is built around
// when a moment is assembled. The being IS the rendered frame;
// the role is the recipe for that frame. The role's prompt body,
// see list, and capabilities together describe a kind-of-being —
// a Planner, a Ruler, a Worker, a place manager. When a summon
// arrives, the activeRole names which kind the moment will be a
// moment of. The role file declares what the role uniquely IS;
// I fill in everything derivable.
//
// ── COGNITION DOCTRINE (closed set, BEING level — not role level) ──
//
// Cognition is what a being IS (human-driven, LLM-driven, scripted),
// not what a role IS. The same role applies regardless of who or what
// is driving the being. A factory-worker role on an LLM-driven being
// is the LLM doing factory work; the SAME role on the same being
// while a human inhabits it is the human doing factory work. The
// role doesn't change; the cognition does.
//
// Cognition lives on the being at `qualities.cognition.defaultKind`,
// one of:
//
//   "llm"      Wake → runLlmMoment with the active role's prompt + tools.
//   "human"    Wake → don't auto-process. The human reads the inbox in
//              their portal and emits the act from their own transport.
//   "scripted" Wake → call the active role's `summon(message, ctx)` if
//              present; else SEE (no act).
//
// Inhabit overrides defaultKind: when `qualities.inhabit` is present
// on the being, effective cognition for that moment is "human" — the
// inhabiting operator drives, regardless of defaultKind. Release the
// inhabit and effective cognition reverts to defaultKind.
//
// The closed-set discipline matches BE_OPS: additions to the cognition
// vocabulary are substrate changes (scheduler / momentum / stamper
// all branch on effective cognition), not extension hooks. "hybrid" /
// "chain" / "conditional" patterns belong at the roleFlow layer, not
// inside cognition.
//
// ── ROLES ───────────────────────────────────────────────────────────
//
// What the role file writes:
//   name             - kebab-case identifier
//   see              - preloaded resolver names (resolved into prompt at build)
//   canSee           - SEE tool names the LLM may call
//   canDo            - DO tool names the LLM may call
//   canSummon        - SUMMON tool names (beings the role may wake)
//   canBe            - BE tool names (being shapes the role may create)
//   prompt           - () => prompt body (used when effective cognition = "llm")
//   summon           - custom dispatch (used when effective cognition = "scripted")
//   requiredCognition - optional roleFlow guard: this clause only
//                       applies when effective cognition matches.
//                       One of "llm" | "human" | "scripted". Omitted
//                       = applies to any cognition.
//   replyTo          - optional: "asker" | "chain-initial" reply mode
//
// What seed derives at registration:
//   permissions      - union of verbs implied by canSee / canDo / canSummon / canBe
//   respondMode      - "async" by default
//   triggerOn        - ["message"] by default
//   summon           - auto-wrapped with defaultCall when role has no
//                      custom summon (LLM path is the default)
//   buildSystemPrompt - auto-assembled via seed/present/buildPrompt when not provided
//
import log from "../../seedStory/log.js";

// The role registry. Seed-shipped roles (auth, llm-assigner,
// place-manager) register through registerRole during genesis;
// extensions add theirs the same way.
const REGISTRY = new Map();

// Role-handler registry (RESOURCES.md: registerRoleHandler).
//
// A role resource ships pure data: name, canSee/Do/Summon/Be, prompt,
// defaultOrientation. A code resource OPTIONALLY registers a
// code-cognition handler for that role by name. When summon dispatches
// to a role, the role registry consults HANDLERS first; if a handler
// is registered, the role runs through that handler (scripted cognition).
// If no handler is registered, the role runs through the substrate's
// default LLM cognition.
//
// Today's scripted roles carry their `summon` function inline on the
// role spec; that path keeps working. The handler registry is the
// future-shape seam: a role resource published as kind:"role" cannot
// carry an inline `summon` (it's pure data), so a paired code resource
// registers the handler at boot through this API.
const HANDLERS = new Map();

const VALID_PERMISSIONS = new Set(["see", "do", "call", "be"]);
const VALID_REPLY_MODES = new Set(["asker", "chain-initial"]);

// Closed-set cognition vocabulary. Cognition lives on the being
// (qualities.cognition.defaultKind), not on the role; the role's
// `requiredCognition` (optional) is a roleFlow guard, not a declaration.
// Adding a value here requires a substrate change (scheduler, momentum,
// stamper all branch on it). See the header comment block for the
// doctrine.
export const VALID_COGNITION = Object.freeze(new Set(["llm", "human", "scripted"]));

export function getRole(name) {
  if (!name) return null;
  return REGISTRY.get(name) || null;
}

export function listRoles() {
  return Array.from(REGISTRY.keys());
}

/**
 * Register a code-cognition handler for a role by name. When a code
 * resource (e.g. store/code/) wants to drive the cognition for a role
 * defined as a standalone resource (e.g. store/roles/registrar/), it
 * calls this at init. The handler runs in place of the default LLM
 * cognition when the role is summoned.
 *
 * The role spec does not need to exist at handler-registration time;
 * the loader's topological order means roles install before code, but
 * the handler will look up the role at dispatch time regardless.
 *
 * @param {string} roleName
 * @param {Function} handler  async (message, ctx) => CognitionResult
 * @param {string} [ownerExtension]
 */
export function registerRoleHandler(roleName, handler, ownerExtension = "code-resource") {
  if (!roleName || typeof roleName !== "string") {
    throw new Error("registerRoleHandler requires a non-empty role name");
  }
  if (typeof handler !== "function") {
    throw new Error(`registerRoleHandler("${roleName}") requires a handler function`);
  }
  const prior = HANDLERS.get(roleName);
  if (prior && prior.ownerExtension !== ownerExtension) {
    log.warn(
      "Roles",
      `registerRoleHandler("${roleName}"): owner changed from "${prior.ownerExtension}" to "${ownerExtension}". Last writer wins.`,
    );
  }
  HANDLERS.set(roleName, { handler, ownerExtension });
}

export function getRoleHandler(roleName) {
  const entry = HANDLERS.get(roleName);
  return entry ? entry.handler : null;
}

export function unregisterRoleHandler(roleName) {
  HANDLERS.delete(roleName);
}

/**
 * Register a role. The role file declares what the role IS (name,
 * capabilities, prompt body); seed defaults the rest and wraps the
 * default summon dispatcher when not provided.
 *
 * @param {string} name
 * @param {object} def
 * @param {string} [extName] - owning extension; defaults to "role-registry"
 */
export function registerRole(name, def, extName = "role-registry") {
  if (!name || typeof name !== "string") {
    throw new Error("registerRole requires a non-empty name");
  }
  if (!def || typeof def !== "object") {
    throw new Error(`registerRole("${name}") requires a definition object`);
  }

  // Validate replyTo when present.
  if (def.replyTo !== undefined && def.replyTo !== null && !VALID_REPLY_MODES.has(def.replyTo)) {
    throw new Error(
      `registerRole("${name}") invalid replyTo "${def.replyTo}"; ` +
      `must be one of ${[...VALID_REPLY_MODES].join("|")}`,
    );
  }

  // requiredCognition is an optional roleFlow guard. When set, this
  // role only applies when the being's effective cognition matches
  // (e.g. a "human-conversationalist" role makes sense only when a
  // human is inhabiting). The roleFlow evaluator (Step 2) honors it;
  // unguarded clauses below in the flow then have a chance to apply.
  // Omitted = the role applies to any cognition.
  if (
    def.requiredCognition !== undefined &&
    def.requiredCognition !== null &&
    !VALID_COGNITION.has(def.requiredCognition)
  ) {
    throw new Error(
      `registerRole("${name}") invalid requiredCognition "${def.requiredCognition}"; ` +
      `must be one of ${[...VALID_COGNITION].join("|")} or omitted.`,
    );
  }

  // Unify capabilities: `can` is the canonical granted-word-set; canSee/canDo/canSummon/canBe
  // are its group-by-verb VIEWS. A role declares EITHER `can` (the collapsed form) OR the four;
  // the registry keeps both consistent. The verb permissions fall out of `can`. Authors never
  // write permissions[] directly — the registry computes it.
  const unified = unifyCan(def, name);
  const derived = deriveFromCan(unified.can);
  // Allow explicit override only if the role has a code-cognition
  // shape that wants permissions seed cannot derive (e.g., a role
  // with no canX fields that still needs SUMMON permission to emit).
  // Most roles never set this.
  const permissions =
    Array.isArray(def.permissions) && def.permissions.length > 0
      ? validatePermissions(name, def.permissions)
      : derived;

  // Default dispatch contract. Roles needing sync override; roles with
  // non-message triggers (scheduled, hook-fired) override.
  const respondMode = def.respondMode || "async";
  const triggerOn   = Array.isArray(def.triggerOn) && def.triggerOn.length > 0
    ? def.triggerOn
    : ["message"];

  // Build the final role spec. summon and buildSystemPrompt are wired
  // lazily because they depend on seed/present modules; importing
  // them at module top would create a load-order cycle with runTurn.
  // The lazy refs resolve at first call.
  // Origin tag: who introduced this role. "seed" for the seed-shipped
  // ones, "<extName>" for extension-provided, "live" for operator-
  // authored (set-role DO op). syncRolesToSubstrate writes this into
  // qualities.role.origin so the boot live-role loader can pick out
  // live entries from the .roles mirror without confusing them with
  // seed/extension auto-synced ones.
  const origin = extName === "role-registry" ? "seed" : extName;

  // Reach validation (seed/RolesAreAuth.md "Final doctrine"). The
  // optional `reach` field is a path-filter list that adjusts the
  // role's default coverage (host + descendants). Bash-style with
  // `!` prefix for exclusions:
  //
  //   reach: [
  //     "/docs/coding/**",     // ADD this subtree (outside host)
  //     "!/coders/legacy/**",  // REMOVE this subtree from default
  //   ]
  //
  // Patterns: exact paths, spaceIds, prefix/**, prefix/*, **, ! prefix.
  // Empty / absent → host + descendants (the default base).
  //
  // The `scope: "global" | "anchored"` field is RETIRED — every role
  // just has a host (the space where it's installed via set-role).
  let reach = null;
  if (def.reach !== undefined && def.reach !== null) {
    if (!Array.isArray(def.reach)) {
      throw new Error(
        `registerRole("${name}") invalid reach: must be an array of strings.`,
      );
    }
    for (const r of def.reach) {
      if (typeof r !== "string" || !r.length) {
        throw new Error(
          `registerRole("${name}") invalid reach entry: ${JSON.stringify(r)}. ` +
          `Each entry must be a non-empty string (exact path, spaceId, prefix/**, ` +
          `or '!' prefix for exclusion).`,
        );
      }
    }
    reach = def.reach.length > 0 ? Object.freeze([...def.reach]) : null;
  }

  const spec = {
    name,
    ...def,
    can: unified.can,            // the canonical granted-word-set
    canSee: unified.canSee,      // group-by-verb VIEWS over `can`, for the rest of the system
    canDo: unified.canDo,
    canSummon: unified.canSummon,
    canBe: unified.canBe,
    permissions,
    respondMode,
    triggerOn,
    requiredCognition: def.requiredCognition || null,
    reach,
    origin,
  };
  // Drop any legacy `scope` field — retired with the host-on-space model.
  delete spec.scope;

  // Auto-wrap with defaultCall when the role brings no custom summon.
  // The custom summon is the SCRIPTED dispatch path; defaultCall is
  // the LLM dispatch path. Momentum picks which to invoke at moment-
  // assign time based on the being's effective cognition (inhabit ?
  // "human" : qualities.cognition.defaultKind), regardless of which
  // path the role provides.
  if (typeof spec.call !== "function") {
    spec.call = makeLazyDefaultCall(spec);
  }

  REGISTRY.set(name, Object.freeze(spec));
  log.verbose("Roles",
    `Registered role "${name}" (${extName}) ` +
    `[verbs: ${permissions.join("/")}${spec.requiredCognition ? `, requires: ${spec.requiredCognition}` : ""}]`);
}

/**
 * Remove a previously-registered role. Returns true when something was removed.
 */
export function unregisterRole(name) {
  return REGISTRY.delete(name);
}

// ────────────────────────────────────────────────────────────────────
// Derivation helpers
// ────────────────────────────────────────────────────────────────────

// `can` is THE way a role declares capability: a granted-word-set, one entry per word the being
// may speak — [{verb, word, description?}]. The verb is intrinsic to each word (see/do/summon/be);
// canSee/canDo/canSummon/canBe are its group-by-verb VIEWS, derived here so the rest of the system
// reads them unchanged. A role NEVER declares the four directly — that's the collapse. (See
// project: role-is-a-composite-word; "can X" is the one grant.)
function unifyCan(def, name) {
  if (def.canSee || def.canDo || def.canSummon || def.canBe) {
    throw new Error(
      `registerRole("${name}"): canSee/canDo/canSummon/canBe are retired — declare \`can\` instead, ` +
      `a list of { verb, word } (e.g. { verb: "see", word: "roles" }, { verb: "do", word: "set-role" }).`,
    );
  }
  const can = (Array.isArray(def.can) ? def.can : []).map((e) => ({
    verb: e.verb, word: e.word ?? e.action, ...(e.description ? { description: e.description } : {}),
  }));
  return { can, ...canViews(can) };
}

// The group-by-verb VIEWS over `can` (canSee/canDo/canSummon/canBe). Exported because a role spec
// SYNCED to a space stores the canonical `can`; the auth derives the views here when a stored spec
// carries `can` but not the four, so the role-walk reads consistent capabilities either way.
export function canViews(can) {
  const list = Array.isArray(can) ? can : [];
  const byVerb = (v) => list.filter((e) => e.verb === v);
  return {
    canSee:    byVerb("see").map((e) => e.word),
    canDo:     byVerb("do").map((e) => (e.description ? { action: e.word, description: e.description } : { action: e.word })),
    canSummon: byVerb("call").map((e) => { const { verb, ...rest } = e; return (Object.keys(rest).length === 1 && rest.word !== undefined) ? rest.word : rest; }),
    canBe:     byVerb("be").map((e) => e.word),
    canRecall: byVerb("recall").map((e) => e.word), // the granted recall-VIEWS — a being's consciousness-level (which folds it may pull)
  };
}

// The verb permissions fall out of `can` — the set of verbs its granted words carry.
function deriveFromCan(can) {
  const verbs = new Set();
  for (const e of can) if (e.verb) verbs.add(e.verb);
  return [...verbs];
}

function hasEntries(field) {
  if (!field) return false;
  if (Array.isArray(field)) return field.length > 0;
  if (typeof field === "object") {
    return Object.values(field).some(
      (v) => Array.isArray(v) ? v.length > 0 : Boolean(v),
    );
  }
  return false;
}

function validatePermissions(name, list) {
  const seen = new Set();
  for (const p of list) {
    if (!VALID_PERMISSIONS.has(p)) {
      throw new Error(
        `registerRole("${name}") permissions must be a subset of ` +
        `[see, do, call, be], got "${p}"`,
      );
    }
    seen.add(p);
  }
  return [...seen];
}

// Lazy default-summon wiring. Avoids a circular import: defaultCall
// imports runTurn, runTurn imports the registry. The closure resolves
// defaultCall on first invocation.
function makeLazyDefaultCall(role) {
  let cached = null;
  return async (message, ctx) => {
    if (!cached) {
      const mod = await import("../cognition/defaultCall.js");
      cached = mod.defaultCall;
    }
    return cached({ message, ctx, role });
  };
}

/**
 * Sync the role registry into `<story>/./roles` as child Spaces. One child
 * per role; qualities mirror the role's surface. Called at boot end
 * after extensions register; idempotent.
 */
export async function syncRolesToSubstrate() {
  const { HEAVEN_SPACE } = await import("../../materials/space/heavenSpaces.js");
  const { manifestItems } = await import("../manifest.js");
  const items = [];
  for (const [name, role] of REGISTRY) {
    items.push({
      name,
      qualities: new Map([
        ["role", {
          requiredCognition: role.requiredCognition || null,
          // NOTE: the verb-summary `permissions: ["see","do",...]` field
          // retired with the roles-are-auth doctrine (RolesAreAuth.md).
          // The canX entries below ARE the auth gate; a separate verb
          // summary is redundant. Consumers that need "does this role
          // permit verb X" check `role.canX?.length > 0` directly.
          // `scope` retired alongside it — every role just has a host.
          reach:       Array.isArray(role.reach) ? role.reach : null,
          respondMode: role.respondMode  || null,
          triggerOn:   role.triggerOn    || [],
          canSee:      role.canSee       || [],
          canDo:       role.canDo        || [],
          canSummon:   role.canSummon    || [],
          canBe:       role.canBe        || [],
          replyTo:     role.replyTo      || null,
          origin:      role.origin       || "seed",
          // Live roles carry a prompt string (seed/extension roles use
          // a prompt function we can't serialize). Surface it when
          // present so the .roles mirror is round-trip-able.
          prompt:      typeof role.prompt === "string" ? role.prompt : null,
        }],
      ]),
    });
  }
  return manifestItems({ heavenSpace: HEAVEN_SPACE.ROLES, items });
}

/**
 * Boot-time loader for operator-authored live roles. Walks
 * `<story>/./roles` for children whose qualities.role.origin === "live"
 * and calls registerRole on each so they live in the in-memory map
 * alongside seed and extension roles. Runs AFTER extension loading
 * and BEFORE syncRolesToSubstrate so the round-trip preserves them.
 *
 * Live roles store their prompt as a string in qualities; we wrap that
 * string into a prompt function so the registry contract holds
 * (defaultCall / buildPrompt call role.prompt()).
 *
 * @returns {Promise<{ loaded: number }>}
 */
export async function loadLiveRolesFromSubstrate() {
  const { HEAVEN_SPACE } = await import("../../materials/space/heavenSpaces.js");
  const { findByHeavenSpace } = await import("../../materials/projections.js");
  const { default: Projection } = await import("../../materials/history/projection.js");
  const parent = await findByHeavenSpace(HEAVEN_SPACE.ROLES, "0");
  if (!parent) return { loaded: 0 };
  const rows = await Projection.find({
    branch: "0", type: "space",
    "state.parent": parent.id,
    tombstoned: { $ne: true },
  }).lean();
  const children = rows.map((s) => ({ name: s.state?.name, qualities: s.state?.qualities }));
  let loaded = 0;
  for (const child of children) {
    const quals = child.qualities;
    const role  = quals instanceof Map ? quals.get("role") : quals?.role;
    if (!role || role.origin !== "live") continue;
    try {
      const promptStr = typeof role.prompt === "string" ? role.prompt : "";
      registerRole(child.name, {
        description:       `Live role authored via @role-manager.`,
        requiredCognition: role.requiredCognition || null,
        can:       Array.isArray(role.can) ? role.can : [],
        replyTo:   role.replyTo || null,
        // Wrap the stored string prompt as a prompt function so the
        // role spec matches what defaultCall / buildPrompt expect.
        prompt:    () => promptStr,
      }, "live");
      loaded++;
    } catch (err) {
      log.warn(
        "Roles",
        `Failed to load live role "${child.name}": ${err.message}`,
      );
    }
  }
  log.info("Roles", `Loaded ${loaded} live role${loaded === 1 ? "" : "s"} from .roles.`);
  return { loaded };
}
