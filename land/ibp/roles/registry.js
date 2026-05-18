// TreeOS IBP — being registry.
//
// An being is the active interpretation pattern that comes alive
// when a being is summoned at a position. Beings are NOT data
// targets; they are summoned executors. Each being declares:
//
//   - honoredIntents: which SUMMON intents it accepts ("chat" | "place" |
//     "query" | "be"). A message with an unhonored intent is rejected
//     with INVALID_INTENT.
//   - respondMode: "sync" (response returns inline on the ack), "async"
//     (response arrives later as a follow-up SUMMON to the sender), or
//     "none" (no response is produced).
//   - triggerOn: when summoning fires. Phase 4 only honors "message"
//     (summon immediately on inbox-write); "hook" and "schedule" land
//     in later phases.
//   - summon(message, context): the function the kernel calls when the
//     being is summoned. It receives the message and a context
//     object with { nodeId, position, resolved, identity, readConfig }
//     and returns the response content (for sync/async) or null (none).
//
// Phase 4 ships ONE demo being: `echo`. It returns the message
// content back to the sender with an "echo: " prefix. The point of
// this is to prove the round-trip; real LLM-backed beings come
// in Phase 6 onward.
//
// Later phases will let extensions register beings via the
// existing extension loader; for now the registry is a plain Map in
// memory.

import { echoEmbodiment } from "./echo.js";
import { makeBridgeEmbodiment } from "./bridge.js";

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
  // Generic worker (legacy + fallback).
  { name: "worker",           modeKey: "tree:governing-worker",           zone: "tree" },
  // Typed worker bridges. Latent until Slice 7 moves the worker
  // dispatch path off the orchestrator into Foreman's role template;
  // registering them now means callers can summon `@worker-build`,
  // `@worker-refine`, etc. once Foreman starts dispatching via SUMMON,
  // without a registry change at that time.
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
 * Register a custom being for a role. Extensions use this when
 * shipping a code-cognition being (auth-being precedent), a custom
 * LLM flow that bypasses the bridge, or any other non-standard summon
 * handler. Validates the contract: `name`, `honoredIntents`, `respondMode`,
 * `triggerOn`, `summon` must all be present.
 *
 * Idempotent — re-registering the same name replaces the prior def.
 */
export function registerRole(name, def) {
  if (!name || typeof name !== "string") {
    throw new Error("registerRole requires a non-empty name");
  }
  if (!def || typeof def !== "object") {
    throw new Error(`registerRole("${name}") requires a definition object`);
  }
  const required = ["honoredIntents", "respondMode", "triggerOn", "summon"];
  for (const k of required) {
    if (def[k] === undefined) {
      throw new Error(`registerRole("${name}") missing required field: ${k}`);
    }
  }
  REGISTRY.set(name, Object.freeze({ name, ...def }));
}

/**
 * Remove a previously-registered being. Returns true when something
 * was removed.
 */
export function unregisterRole(name) {
  return REGISTRY.delete(name);
}
