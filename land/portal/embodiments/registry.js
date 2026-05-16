// TreeOS IBP — embodiment registry.
//
// An embodiment is the active interpretation pattern that comes alive
// when a being is summoned at a position. Embodiments are NOT data
// targets; they are summoned executors. Each embodiment declares:
//
//   - honoredIntents: which TALK intents it accepts ("chat" | "place" |
//     "query" | "be"). A message with an unhonored intent is rejected
//     with INVALID_INTENT.
//   - respondMode: "sync" (response returns inline on the ack), "async"
//     (response arrives later as a follow-up TALK to the sender), or
//     "none" (no response is produced).
//   - triggerOn: when summoning fires. Phase 4 only honors "message"
//     (summon immediately on inbox-write); "hook" and "schedule" land
//     in later phases.
//   - summon(message, context): the function the kernel calls when the
//     embodiment is summoned. It receives the message and a context
//     object with { nodeId, position, resolved, identity, readConfig }
//     and returns the response content (for sync/async) or null (none).
//
// Phase 4 ships ONE demo embodiment: `echo`. It returns the message
// content back to the sender with an "echo: " prefix. The point of
// this is to prove the round-trip; real LLM-backed embodiments come
// in Phase 6 onward.
//
// Later phases will let extensions register embodiments via the
// existing extension loader; for now the registry is a plain Map in
// memory.

import { echoEmbodiment } from "./echo.js";

const REGISTRY = new Map([
  ["echo", echoEmbodiment],
]);

export function getEmbodiment(name) {
  if (!name) return null;
  return REGISTRY.get(name) || null;
}

export function listEmbodiments() {
  return Array.from(REGISTRY.keys());
}

export function registerEmbodiment(name, def) {
  REGISTRY.set(name, def);
}
