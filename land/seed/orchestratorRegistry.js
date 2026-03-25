// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import log from "./log.js";
/**
 * Orchestrator Registry
 *
 * Extensions register custom conversation orchestrators for bigModes.
 * If no custom orchestrator is registered, the built-in one runs.
 *
 * Usage in extension init():
 *   core.orchestrators.register("tree", {
 *     async handle({ visitorId, message, socket, userId, sessionId, rootId, nodeId, mode, ...ctx }) {
 *       // Full control over the conversation flow
 *     },
 *     async classify({ message, treeContext, userId }) {
 *       return { intent: "place", confidence: 0.95, responseHint: "..." };
 *     },
 *   });
 *
 * Usage in core:
 *   import { getOrchestrator } from "../seed/orchestratorRegistry.js";
 *   const custom = getOrchestrator("tree");
 *   if (custom) { await custom.handle({...}); }
 *   else { await orchestrateTreeRequest({...}); }
 */

const registry = new Map();

export function registerOrchestrator(bigMode, handler, extName = "unknown") {
  if (!bigMode || !handler) {
    log.warn("Orchestrators", `Invalid registration from ${extName}`);
    return false;
  }
  if (!handler.handle || typeof handler.handle !== "function") {
    log.warn("Orchestrators", `"${bigMode}" from ${extName} missing handle(). Skipped.`);
    return false;
  }
  if (registry.has(bigMode)) {
    log.warn("Orchestrators", `"${bigMode}" already registered by "${registry.get(bigMode)._extName}". ${extName} cannot override.`);
    return false;
  }

  handler._extName = extName;
  registry.set(bigMode, handler);
  log.verbose("Orchestrators", `Registered: ${bigMode} (${extName})`);
  return true;
}

export function getOrchestrator(bigMode) {
  return registry.get(bigMode) || null;
}

export function unregisterOrchestrator(extName) {
  for (const [mode, handler] of registry.entries()) {
    if (handler._extName === extName) {
      registry.delete(mode);
    }
  }
}

export function listOrchestrators() {
  const result = {};
  for (const [mode, handler] of registry.entries()) {
    result[mode] = handler._extName;
  }
  return result;
}
