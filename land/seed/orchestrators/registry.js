// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import log from "../log.js";

/**
 * Orchestrator Registry
 *
 * Extensions register custom conversation orchestrators for bigModes.
 * One orchestrator per bigMode. First registered wins.
 *
 * Usage in extension init():
 *   core.orchestrators.register("tree", {
 *     async handle({ visitorId, message, socket, userId, sessionId, ... }) { ... },
 *     async classify({ message, treeContext, userId }) { return { intent, confidence }; },
 *   });
 *
 * Usage in core:
 *   const orch = getOrchestrator("tree");
 *   if (orch) await orch.handle({...});
 */

const registry = new Map();
// Metadata stored separately so we never mutate the extension's handler object
const owners = new Map();
// Extensions must be pre-approved by the loader (manifest declares provides.orchestrator)
const _allowedExtensions = new Set();

import { getLandConfigValue } from "../landConfig.js";

const VALID_BIG_MODES = new Set(["land", "home", "tree"]);
function maxOrchestrators() { return Number(getLandConfigValue("maxOrchestrators")) || 10; }

/**
 * Pre-approve an extension for orchestrator registration.
 * Called by the loader for extensions that declare provides.orchestrator.
 */
export function allowOrchestratorExtension(extName) {
  _allowedExtensions.add(extName);
}

export function registerOrchestrator(bigMode, handler, extName = "unknown") {
  if (!_allowedExtensions.has(extName)) {
    log.warn("Orchestrators", `"${extName}" rejected: must declare provides.orchestrator in manifest`);
    return false;
  }
  if (typeof bigMode !== "string" || !bigMode) {
    log.warn("Orchestrators", `Invalid bigMode from ${extName}: must be a non-empty string`);
    return false;
  }
  if (!handler || typeof handler !== "object") {
    log.warn("Orchestrators", `Invalid handler from ${extName}: must be an object`);
    return false;
  }
  if (typeof handler.handle !== "function") {
    log.warn("Orchestrators", `"${bigMode}" from ${extName} missing handle(). Skipped.`);
    return false;
  }
  if (handler.classify && typeof handler.classify !== "function") {
    log.warn("Orchestrators", `"${bigMode}" from ${extName} has non-function classify. Ignored.`);
    handler = { handle: handler.handle }; // strip bad classify, keep handle
  }
  if (registry.has(bigMode)) {
    const existing = owners.get(bigMode) || "unknown";
    log.warn("Orchestrators", `"${bigMode}" already registered by "${existing}". "${extName}" cannot override.`);
    return false;
  }
  if (registry.size >= maxOrchestrators()) {
    log.error("Orchestrators", `Registry full (${maxOrchestrators()}). "${bigMode}" from "${extName}" rejected.`);
    return false;
  }
  if (!VALID_BIG_MODES.has(bigMode)) {
    log.warn("Orchestrators", `"${bigMode}" from "${extName}" is not a standard zone. Registering anyway.`);
  }

  registry.set(bigMode, handler);
  owners.set(bigMode, extName);
  log.verbose("Orchestrators", `Registered: ${bigMode} (${extName})`);
  return true;
}

export function getOrchestrator(bigMode) {
  return registry.get(bigMode) || null;
}

export function getOrchestratorOwner(bigMode) {
  return owners.get(bigMode) || null;
}

export function unregisterOrchestrator(extName) {
  for (const [mode, owner] of owners.entries()) {
    if (owner === extName) {
      registry.delete(mode);
      owners.delete(mode);
      log.verbose("Orchestrators", `Unregistered: ${mode} (${extName})`);
    }
  }
}

export function listOrchestrators() {
  const result = {};
  for (const [mode, owner] of owners.entries()) {
    result[mode] = owner;
  }
  return result;
}
