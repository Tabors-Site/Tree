// TreeOS IBP — role registry.
//
// A **role** is the unit of behavior a being carries when summoned.
// One concept, one registration. The role definition combines:
//
//   **Dispatch contract** (kernel calls these when a SUMMON lands):
//     - honoredIntents: SUMMON intents accepted ("chat" | "place" |
//       "query" | "be"). Mismatched intents → INVALID_INTENT.
//     - respondMode: "sync" | "async" | "none".
//     - triggerOn: ["message"] (Phase 4); "hook" / "schedule" later.
//     - summon(message, ctx): the function the kernel invokes.
//
//   **Behavior contract** (what the LLM does when the role runs an
//   LLM call inside summon). All optional — non-LLM roles (auth-
//   being, echo) omit these:
//     - buildSystemPrompt(ctx): async function returning the prompt.
//     - toolNames: array of tool names the LLM may call.
//     - emoji, label: presentation metadata.
//     - maxMessagesBeforeLoop, preserveContextOnLoop, maxToolCallsPerStep:
//       LLM loop config.
//     - timeoutMs, maxRetries, llmSlot: optional per-role LLM budget.
//
// Roles are the unit. Mode is gone. See [[project_role_subsumes_mode]]
// and [[project_ibp_universal_grammar]] for the architectural lock.

import { echoEmbodiment } from "./echo.js";
import log from "../../../seed/core/log.js";

// The role registry seeded with kernel-default roles. Extensions add
// their own via registerRole. governing's promoteToRuler is the
// reference example — Ruler/Planner/Contractor/Foreman/Worker.
const REGISTRY = new Map([
  ["echo", echoEmbodiment],
]);

export function getRole(name) {
  if (!name) return null;
  return REGISTRY.get(name) || null;
}

export function listRoles() {
  return Array.from(REGISTRY.keys());
}

/**
 * Register a role. Extensions ship LLM-driven, code-driven, human, or
 * hybrid roles. The single source of truth: a role carries its dispatch
 * contract AND its LLM-behavior contract.
 *
 * Dispatch fields (required): respondMode, triggerOn, summon.
 * Permissions (required): which IBP verbs the role fires.
 * Behavior fields (optional, for LLM-driven roles): buildSystemPrompt,
 * toolNames, emoji, label, plus LLM loop config (maxMessagesBeforeLoop,
 * maxToolCallsPerStep, timeoutMs, maxRetries, llmSlot).
 *
 * Idempotent — re-registering the same name replaces the prior def.
 *
 * @param {string} name
 * @param {object} def
 * @param {string} [extName] — owning extension; defaults to "role-registry"
 */
const VALID_PERMISSIONS = new Set(["see", "do", "summon", "be"]);

export function registerRole(name, def, extName = "role-registry") {
  if (!name || typeof name !== "string") {
    throw new Error("registerRole requires a non-empty name");
  }
  if (!def || typeof def !== "object") {
    throw new Error(`registerRole("${name}") requires a definition object`);
  }
  const required = ["respondMode", "triggerOn", "summon"];
  for (const k of required) {
    if (def[k] === undefined) {
      throw new Error(`registerRole("${name}") missing required field: ${k}`);
    }
  }

  // Permissions — roles declare which IBP verbs they fire. The runChat
  // tool filter narrows the LLM-visible tool set to tools whose verb
  // is in this list. Permissions are role identity (see memory
  // `role-permissions-not-envelope`); envelopes never narrow them.
  // REQUIRED: every role declares its permissions. No permissive
  // default — same shape principle as tool defs.
  if (!Array.isArray(def.permissions)) {
    throw new Error(
      `registerRole("${name}") missing required field: permissions ` +
      `(array of "see"|"do"|"summon"|"be")`,
    );
  }
  for (const p of def.permissions) {
    if (!VALID_PERMISSIONS.has(p)) {
      throw new Error(
        `registerRole("${name}") permissions must be a subset of [see, do, summon, be], got "${p}"`,
      );
    }
  }
  const permissions = [...new Set(def.permissions)];

  REGISTRY.set(name, Object.freeze({ name, ...def, permissions }));
  log.verbose("Roles", `Registered role "${name}" (${extName})`);
}

/**
 * Remove a previously-registered role. Returns true when something was removed.
 */
export function unregisterRole(name) {
  return REGISTRY.delete(name);
}

/**
 * Sync the role registry into `<land>/.roles` as child Nodes. One child
 * per role; metadata mirrors the role's surface (permissions, label,
 * emoji, toolNames). Called at boot end after extensions register;
 * idempotent.
 */
export async function syncRolesToSubstrate() {
  const { SYSTEM_ROLE } = await import("../../../seed/core/protocol.js");
  const { syncRegistryToSubstrate } = await import("../../../seed/tree/registryMirror.js");
  const items = [];
  for (const [name, role] of REGISTRY) {
    items.push({
      name,
      metadata: new Map([
        ["role", {
          permissions:  role.permissions || [],
          respondMode:  role.respondMode  || null,
          triggerOn:    role.triggerOn    || [],
          toolNames:    role.toolNames    || [],
          label:        role.label        || name,
          emoji:        role.emoji        || null,
        }],
      ]),
    });
  }
  return syncRegistryToSubstrate({ systemRole: SYSTEM_ROLE.ROLES, items });
}
