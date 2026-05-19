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
//     - emoji, label, bigMode: presentation metadata.
//     - modeKey: legacy seed/modes/registry key (auto-registered when
//       present, so callers using runChat({ mode: "..." }) still work
//       during the migration to runChat({ role })). See memory
//       `mode-registry-legacy`.
//     - maxMessagesBeforeLoop, preserveContextOnLoop, maxToolCallsPerStep:
//       LLM loop config.
//
// **Why one registration**: split was implementation drift. Role and
// mode are the same architectural concept — see memory
// `role-subsumes-mode`. Extensions register the role once; if it
// carries behavior fields with a modeKey, the role registry mirrors
// the registration into the seed mode registry so legacy mode-key
// callers (runChat, switchMode) keep working until they migrate.

import { echoEmbodiment } from "./echo.js";
import { makeBridgeEmbodiment } from "./bridge.js";
import { registerMode as registerInModeRegistry } from "../../seed/modes/registry.js";
import log from "../../seed/log.js";

// Bridge beings: thin shims that route SUMMON through runChat() with
// the existing modeKey. Replaced one-by-one as each being grows a
// first-class IBP implementation.
const BRIDGED = [
  { name: "land-manager",     modeKey: "land:manager",                    zone: "land" },
  { name: "citizen",          modeKey: "land:citizen",                    zone: "land" },
  { name: "ruler",            modeKey: "tree:governing-ruler",            zone: "tree" },
  { name: "planner",          modeKey: "tree:governing-planner",          zone: "tree" },
  { name: "contractor",       modeKey: "tree:governing-contractor",       zone: "tree" },
  { name: "foreman",          modeKey: "tree:governing-foreman",          zone: "tree" },
  // Typed worker bridges. The Planner picks a workerType per leaf step
  // (build / refine / review / integrate); Foreman SUMMONs the matching
  // worker being. The generic `tree:governing-worker` mode was retired
  // in Slice 7 — recursive sub-Ruler dispatch never reaches it. Bridge
  // entry left as `worker-build` so any caller summoning the bare
  // `@worker` qualifier resolves to the build worker by default.
  { name: "worker",           modeKey: "tree:governing-worker-build",     zone: "tree" },
  { name: "worker-build",     modeKey: "tree:governing-worker-build",     zone: "tree" },
  { name: "worker-refine",    modeKey: "tree:governing-worker-refine",    zone: "tree" },
  { name: "worker-review",    modeKey: "tree:governing-worker-review",    zone: "tree" },
  { name: "worker-integrate", modeKey: "tree:governing-worker-integrate", zone: "tree" },
  { name: "archivist",        modeKey: "tree:archivist",                  zone: "tree" },
];

const REGISTRY = new Map([
  ["echo", echoEmbodiment],
  ...BRIDGED.map((b) => [b.name, makeBridgeEmbodiment(b)]),
]);

export function getRole(name) {
  if (!name) return null;
  return REGISTRY.get(name) || null;
}

export function listRoles() {
  return Array.from(REGISTRY.keys());
}

/**
 * Register a role. Extensions use this to ship LLM-driven, code-driven,
 * human, or hybrid roles. The single source of truth: a role carries
 * dispatch contract AND (optionally) LLM-behavior contract.
 *
 * Dispatch fields (required): honoredIntents, respondMode, triggerOn, summon.
 *
 * Behavior fields (optional, for LLM-driven roles): buildSystemPrompt,
 * toolNames, modeKey, emoji, label, bigMode, plus LLM loop config. When
 * `modeKey` is present alongside `buildSystemPrompt` and `toolNames`,
 * the role registry mirrors the role into the seed mode registry so
 * legacy callers using runChat({ mode: "..." }) keep working.
 *
 * Idempotent — re-registering the same name replaces the prior def.
 *
 * @param {string} name
 * @param {object} def
 * @param {string} [extName] — owning extension; defaults to "role-registry"
 */
const VALID_PERMISSIONS = new Set(["see", "do", "summon"]);

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
  // Default ["see", "do", "summon"] — permissive backward-compat for
  // roles that haven't declared yet. Untagged roles log a warn-once.
  let permissions = ["see", "do", "summon"];
  if (Array.isArray(def.permissions)) {
    for (const p of def.permissions) {
      if (!VALID_PERMISSIONS.has(p)) {
        throw new Error(
          `registerRole("${name}") permissions must be a subset of [see, do, summon], got "${p}"`,
        );
      }
    }
    permissions = [...new Set(def.permissions)];
  } else if (def.permissions !== undefined) {
    throw new Error(
      `registerRole("${name}") permissions must be an array of "see"|"do"|"summon"`,
    );
  }

  REGISTRY.set(name, Object.freeze({ name, ...def, permissions }));

  // Mirror into the seed mode registry when the role carries
  // mode-shape behavior fields. Lets runChat({ mode: "..." }) callers
  // (the legacy path) keep working without a separate registerMode
  // call. Once runChat takes role specs directly, this mirror retires
  // along with the mode registry itself — see memory
  // `mode-registry-legacy`.
  if (
    typeof def.modeKey === "string"
    && typeof def.buildSystemPrompt === "function"
    && Array.isArray(def.toolNames)
  ) {
    try {
      registerInModeRegistry(def.modeKey, {
        name:                  def.modeKey,
        emoji:                 def.emoji  || "🧩",
        label:                 def.label  || name,
        bigMode:               def.bigMode || def.modeKey.split(":")[0] || "tree",
        toolNames:             def.toolNames,
        buildSystemPrompt:     def.buildSystemPrompt,
        maxMessagesBeforeLoop: def.maxMessagesBeforeLoop,
        preserveContextOnLoop: def.preserveContextOnLoop,
        maxToolCallsPerStep:   def.maxToolCallsPerStep,
        hidden:                def.hidden,
        // Flag this registration as coming through the role mirror so
        // the mode registry's deprecation warning skips it.
        _viaRoleMirror:        true,
      }, extName);
    } catch (err) {
      log.warn("Roles",
        `Auto-register mode "${def.modeKey}" failed for role "${name}": ${err.message}`);
    }
  }
}

/**
 * Remove a previously-registered being. Returns true when something
 * was removed.
 */
export function unregisterRole(name) {
  return REGISTRY.delete(name);
}
