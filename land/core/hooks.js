import log from "./log.js";
/**
 * Core Hook System
 *
 * Extensions register hooks during init() to modify or react to core operations
 * without core knowing about extensions.
 *
 * Lifecycle hooks:
 *   beforeNote        - Before note save. Modify { nodeId, version, content, userId, contentType }
 *   afterNote         - After note saved. React to { note, nodeId, userId }
 *   beforeContribution - Before contribution log. Modify { nodeId, nodeVersion, action, userId }
 *   afterNodeCreate   - After node saved. React to { node, userId }
 *   beforeStatusChange - Before status write. Modify/validate { node, status, userId }
 *   afterStatusChange  - After status saved. React to { node, status, userId }
 *   beforeNodeDelete  - Before soft delete. Cleanup { node, userId }
 *   enrichContext     - During AI context build. Enrich { context, node, meta }
 *
 * Execution order: hooks run in extension load order (topological sort by deps).
 * "before" hooks can modify the data object. Return false to cancel. Throwing also cancels.
 * "after" hooks run in parallel, fire-and-forget. Errors logged, never block.
 * "enrichContext" hooks run sequentially (extensions may depend on each other's additions).
 *
 * run() returns { cancelled: false } or { cancelled: true, reason: "..." }.
 *
 * One handler per extension per hook. Duplicate registrations replace the previous one.
 * Max 100 handlers per hook as a safety cap.
 *
 * All handlers have a 5s timeout. Hanging handlers are killed and logged.
 *
 * Usage in extensions:
 *   export async function init(core) {
 *     core.hooks.register("beforeNote", async (data) => {
 *       data.version = getPrestigeLevel(data.nodeId);
 *     });
 *   }
 *
 * Usage in core:
 *   import { hooks } from "../core/hooks.js";
 *   const data = { nodeId, version: 0, content, userId };
 *   const result = await hooks.run("beforeNote", data);
 *   if (result.cancelled) return { error: result.reason };
 *   // proceed with data.version (may have been modified by prestige)
 */

const VALID_HOOKS = [
  "beforeNote",
  "afterNote",
  "beforeContribution",
  "afterNodeCreate",
  "beforeStatusChange",
  "afterStatusChange",
  "beforeNodeDelete",
  "enrichContext",
  "beforeRegister",
  "afterRegister",
];

const HOOK_TIMEOUT_MS = 5000;
const MAX_HANDLERS_PER_HOOK = 100;

// Map<hookName, Array<{ extName, handler }>>
const registry = new Map();

for (const hook of VALID_HOOKS) {
  registry.set(hook, []);
}

/**
 * Race a promise against a timeout.
 */
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Hook timed out after ${ms}ms (${label})`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Register a hook handler from an extension.
 * Called during extension init().
 * One handler per extension per hook. Second call replaces the first.
 */
function register(hookName, handler, extName = "unknown") {
  if (!VALID_HOOKS.includes(hookName)) {
    log.warn("Hooks", `Unknown hook "${hookName}" registered by ${extName}. Ignored.`);
    return;
  }
  if (typeof handler !== "function") {
    log.warn("Hooks", `Hook "${hookName}" from ${extName} is not a function. Ignored.`);
    return;
  }

  const handlers = registry.get(hookName);

  // Replace existing handler from same extension (no duplicates)
  const existingIdx = handlers.findIndex(h => h.extName === extName);
  if (existingIdx !== -1) {
    handlers[existingIdx] = { extName, handler };
    return;
  }

  if (handlers.length >= MAX_HANDLERS_PER_HOOK) {
    log.error("Hooks", `"${hookName}" at capacity (${MAX_HANDLERS_PER_HOOK}). Rejected ${extName}.`);
    return;
  }

  handlers.push({ extName, handler });
}

/**
 * Remove all hooks registered by a specific extension.
 * Called when an extension is disabled/uninstalled.
 */
function unregister(extName) {
  for (const [hookName, handlers] of registry.entries()) {
    registry.set(hookName, handlers.filter(h => h.extName !== extName));
  }
}

/**
 * Run all registered handlers for a hook.
 *
 * Returns { cancelled: false } or { cancelled: true, reason: "..." }.
 *
 * "before" hooks: sequential, can modify data, can cancel (return false or throw).
 * "after" hooks: parallel, fire-and-forget, errors logged.
 * "enrichContext": sequential (extensions may read each other's additions), errors logged.
 */
async function run(hookName, data) {
  const handlers = registry.get(hookName);
  if (!handlers || handlers.length === 0) return { cancelled: false };

  const isBefore = hookName.startsWith("before");

  // After hooks: run in parallel, fire-and-forget
  if (!isBefore && hookName !== "enrichContext") {
    await Promise.allSettled(
      handlers.map(({ extName, handler }) =>
        withTimeout(handler(data), HOOK_TIMEOUT_MS, `${hookName}:${extName}`)
          .catch(err => log.warn("Hooks", `${hookName} from "${extName}" failed:`, err.message))
      )
    );
    return { cancelled: false };
  }

  // Before hooks and enrichContext: sequential
  for (const { extName, handler } of handlers) {
    try {
      const result = await withTimeout(handler(data), HOOK_TIMEOUT_MS, `${hookName}:${extName}`);
      if (isBefore && result === false) {
        return { cancelled: true, reason: `Cancelled by ${extName}` };
      }
    } catch (err) {
      if (isBefore) {
        log.error("Hooks", `${hookName} from "${extName}" threw, cancelling:`, err.message);
        return { cancelled: true, reason: err.message };
      }
      // enrichContext: log and continue
      log.warn("Hooks", `${hookName} from "${extName}" failed:`, err.message);
    }
  }

  return { cancelled: false };
}

/**
 * Get the list of registered hooks (for debugging/protocol endpoint).
 */
function list() {
  const result = {};
  for (const [hookName, handlers] of registry.entries()) {
    if (handlers.length > 0) {
      result[hookName] = handlers.map(h => h.extName);
    }
  }
  return result;
}

export const hooks = {
  register,
  unregister,
  run,
  list,
  VALID_HOOKS,
};
