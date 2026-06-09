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
//   summon           - auto-wrapped with defaultSummon when role has no
//                      custom summon (LLM path is the default)
//   buildSystemPrompt - auto-assembled via seed/present/buildPrompt when not provided
//
import log from "../../seedReality/log.js";

// The role registry. Seed-shipped roles (auth, llm-assigner,
// place-manager) register through registerRole during genesis;
// extensions add theirs the same way.
const REGISTRY = new Map();

const VALID_PERMISSIONS = new Set(["see", "do", "summon", "be"]);
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

  // Derive permissions from canSee/canDo/canSummon/canBe. Role files
  // declare what they can do; the verb permissions fall out. Authors
  // never write permissions[] directly — the registry computes it.
  const derived = derivePermissions(def);
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

  const spec = {
    name,
    ...def,
    permissions,
    respondMode,
    triggerOn,
    requiredCognition: def.requiredCognition || null,
    origin,
  };

  // Auto-wrap with defaultSummon when the role brings no custom summon.
  // The custom summon is the SCRIPTED dispatch path; defaultSummon is
  // the LLM dispatch path. Momentum picks which to invoke at moment-
  // assign time based on the being's effective cognition (inhabit ?
  // "human" : qualities.cognition.defaultKind), regardless of which
  // path the role provides.
  if (typeof spec.summon !== "function") {
    spec.summon = makeLazyDefaultSummon(spec);
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

function derivePermissions(def) {
  const verbs = new Set();
  if (hasEntries(def.canSee))    verbs.add("see");
  if (hasEntries(def.canDo))     verbs.add("do");
  if (hasEntries(def.canSummon)) verbs.add("summon");
  if (hasEntries(def.canBe))     verbs.add("be");
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
        `[see, do, summon, be], got "${p}"`,
      );
    }
    seen.add(p);
  }
  return [...seen];
}

// Lazy default-summon wiring. Avoids a circular import: defaultSummon
// imports runTurn, runTurn imports the registry. The closure resolves
// defaultSummon on first invocation.
function makeLazyDefaultSummon(role) {
  let cached = null;
  return async (message, ctx) => {
    if (!cached) {
      const mod = await import("../cognition/defaultSummon.js");
      cached = mod.defaultSummon;
    }
    return cached({ message, ctx, role });
  };
}

/**
 * Sync the role registry into `<reality>/./roles` as child Spaces. One child
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
          permissions: role.permissions || [],
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
 * `<reality>/./roles` for children whose qualities.role.origin === "live"
 * and calls registerRole on each so they live in the in-memory map
 * alongside seed and extension roles. Runs AFTER extension loading
 * and BEFORE syncRolesToSubstrate so the round-trip preserves them.
 *
 * Live roles store their prompt as a string in qualities; we wrap that
 * string into a prompt function so the registry contract holds
 * (defaultSummon / buildPrompt call role.prompt()).
 *
 * @returns {Promise<{ loaded: number }>}
 */
export async function loadLiveRolesFromSubstrate() {
  const { HEAVEN_SPACE } = await import("../../materials/space/heavenSpaces.js");
  const { findByHeavenSpace } = await import("../../materials/projections.js");
  const { default: Projection } = await import("../../materials/branch/projection.js");
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
        canSee:    Array.isArray(role.canSee)    ? role.canSee    : [],
        canDo:     Array.isArray(role.canDo)     ? role.canDo     : [],
        canSummon: Array.isArray(role.canSummon) ? role.canSummon : [],
        canBe:     Array.isArray(role.canBe)     ? role.canBe     : [],
        replyTo:   role.replyTo || null,
        // Wrap the stored string prompt as a prompt function so the
        // role spec matches what defaultSummon / buildPrompt expect.
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
