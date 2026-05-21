// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Role registry.
//
// A **role** is the unit of behavior a being carries when summoned.
// The role definition declares what the role uniquely IS; seed fills
// in everything derivable.
//
// What the role file writes:
//   name             - kebab-case identifier
//   see              - preloaded resolver names (resolved into prompt at build)
//   canSee           - SEE tool names the LLM may call
//   canDo            - DO tool names the LLM may call
//   canSummon        - SUMMON tool names (beings the role may wake)
//   canBe            - BE tool names (being shapes the role may create)
//   prompt           - () => prompt body string
//   replyTo          - optional: "asker" | "chain-initial" reply mode
//
// What seed derives at registration:
//   permissions      - union of verbs implied by canSee / canDo / canSummon / canBe
//   respondMode      - "async" by default
//   triggerOn        - ["message"] by default
//   summon           - auto-wrapped with defaultSummon when not provided
//   buildSystemPrompt - auto-assembled via seed/cognition/buildPrompt when not provided
//
// Roles with custom dispatch attach their own `summon` and seed leaves
// it alone. Roles with custom prompt assembly attach
// `buildSystemPrompt` and the assembler is skipped. The defaults
// cover the common case; opt-in covers the rest.
//
// See [[project_role_subsumes_mode]], [[project_ibp_universal_grammar]],
// [[project_role_permissions_not_envelope]].

import { echoEmbodiment } from "./echo.js";
import log from "../../system/log.js";

// The role registry seeded with kernel-default roles. Extensions add
// their own via registerRole.
const REGISTRY = new Map([
  ["echo", echoEmbodiment],
]);

const VALID_PERMISSIONS = new Set(["see", "do", "summon", "be"]);
const VALID_REPLY_MODES = new Set(["asker", "chain-initial"]);

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
  // lazily because they depend on seed/cognition modules; importing
  // them at module top would create a load-order cycle with runChat.
  // The lazy refs resolve at first call.
  const spec = {
    name,
    ...def,
    permissions,
    respondMode,
    triggerOn,
  };

  // Auto-wrap with defaultSummon when no custom summon is provided.
  if (typeof spec.summon !== "function") {
    spec.summon = makeLazyDefaultSummon(spec);
  }

  REGISTRY.set(name, Object.freeze(spec));
  log.verbose("Roles",
    `Registered role "${name}" (${extName}) ` +
    `[verbs: ${permissions.join("/")}, ` +
    `summon: ${typeof def.summon === "function" ? "custom" : "default"}]`);
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
  // Roles with preloaded see content also need SEE permission.
  if (hasEntries(def.see))       verbs.add("see");
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
// imports runChat, runChat imports the registry. The closure resolves
// defaultSummon on first invocation.
function makeLazyDefaultSummon(role) {
  let cached = null;
  return async (message, ctx) => {
    if (!cached) {
      const mod = await import("../../cognition/defaultSummon.js");
      cached = mod.defaultSummon;
    }
    return cached({ message, ctx, role });
  };
}

/**
 * Sync the role registry into `<land>/.roles` as child Nodes. One child
 * per role; metadata mirrors the role's surface. Called at boot end
 * after extensions register; idempotent.
 */
export async function syncRolesToSubstrate() {
  const { SEED_SPACE } = await import("../../ibp/protocol.js");
  const { syncRegistryToSubstrate } = await import("../../registryMirror.js");
  const items = [];
  for (const [name, role] of REGISTRY) {
    items.push({
      name,
      metadata: new Map([
        ["role", {
          permissions: role.permissions || [],
          respondMode: role.respondMode  || null,
          triggerOn:   role.triggerOn    || [],
          canSee:      role.canSee       || [],
          canDo:       role.canDo        || [],
          canSummon:   role.canSummon    || [],
          canBe:       role.canBe        || [],
          see:         role.see          || [],
          replyTo:     role.replyTo      || null,
        }],
      ]),
    });
  }
  return syncRegistryToSubstrate({ seedSpace: SEED_SPACE.ROLES, items });
}
