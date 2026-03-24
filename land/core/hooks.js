import log from "./log.js";
/**
 * Hook System
 *
 * An open pub/sub bus for kernel and extension events. Any hook name is valid.
 * Core fires kernel hooks. Extensions fire their own and listen to each other's.
 *
 * Core hooks (fired by kernel):
 *   beforeNote         - Before note save. Modify { nodeId, version, content, userId, contentType }
 *   afterNote          - After note saved. React to { note, nodeId, userId, sizeKB, action }
 *   beforeContribution - Before contribution log. Modify { nodeId, nodeVersion, action, userId }
 *   afterNodeCreate    - After node saved. React to { node, userId }
 *   beforeStatusChange - Before status write. Modify/validate { node, status, userId }
 *   afterStatusChange  - After status saved. React to { node, status, userId }
 *   beforeNodeDelete   - Before deletion. Cleanup { node, userId }
 *   enrichContext      - During AI context build. Enrich { context, node, meta }
 *   beforeRegister     - Before user registration
 *   afterRegister      - After user registration
 *
 * Extension hooks (examples, extensions define their own):
 *   gateway:beforeDispatch    - Before notification dispatch
 *   understanding:afterRun    - After understanding run completes
 *   dreams:afterDream         - After dream cycle finishes
 *
 * Naming convention: core hooks are camelCase. Extension hooks use "extName:hookName".
 *
 * Execution rules:
 *   "before*" hooks: sequential, can modify data, return false or throw to cancel.
 *   "after*" hooks: parallel, fire-and-forget, errors logged but never block.
 *   "enrichContext": sequential (extensions may read each other's additions).
 *   All other hooks: parallel by default (same as "after" behavior).
 *
 * run() returns { cancelled: false } or { cancelled: true, reason: "..." }.
 *
 * One handler per extension per hook. Duplicate registrations replace the previous one.
 * Max 100 handlers per hook as a safety cap. 5s timeout per handler.
 *
 * Usage in extensions:
 *   // Listen to a core hook
 *   core.hooks.register("afterNote", async (data) => { ... }, "my-ext");
 *
 *   // Fire your own hook for other extensions to listen to
 *   core.hooks.run("my-ext:afterProcess", { result, userId });
 *
 *   // Listen to another extension's hook
 *   core.hooks.register("gateway:beforeDispatch", async (data) => { ... }, "my-ext");
 */

const HOOK_TIMEOUT_MS = 5000;
const MAX_HANDLERS_PER_HOOK = 100;

// Map<hookName, Array<{ extName, handler }>>
const registry = new Map();

// Spatial scoping: function to resolve blocked extensions at a node.
// Set by startup after extensionScope is loaded.
let _getScopeFn = null;

/** Simple Levenshtein distance for typo detection. */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0]; dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = tmp;
    }
  }
  return dp[m];
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
  if (typeof handler !== "function") {
    log.warn("Hooks", `Hook "${hookName}" from ${extName} is not a function. Ignored.`);
    return;
  }

  // Auto-create registry entry for new hook names (extensions can define their own)
  if (!registry.has(hookName)) {
    // Typo detection: warn if it looks like a misspelled core hook
    const CORE_HOOKS = ["beforeNote", "afterNote", "beforeContribution", "afterNodeCreate",
      "beforeStatusChange", "afterStatusChange", "beforeNodeDelete", "enrichContext",
      "beforeRegister", "afterRegister"];
    if (!hookName.includes(":")) {
      // Only check non-namespaced hooks (ext hooks use "extName:hookName")
      for (const core of CORE_HOOKS) {
        if (core !== hookName && levenshtein(core, hookName) <= 2) {
          log.warn("Hooks", `"${hookName}" from ${extName} looks like a typo for "${core}". Registering anyway.`);
          break;
        }
      }
    }
    registry.set(hookName, []);
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

  // Spatial extension scoping: resolve blocked extensions at this node
  const nodeId = data?.nodeId || data?.node?._id || null;
  let blockedExtensions = null;
  if (nodeId && _getScopeFn) {
    try {
      blockedExtensions = await _getScopeFn(String(nodeId));
    } catch {}
  }

  const isBefore = hookName.startsWith("before");

  // After hooks: run in parallel, fire-and-forget
  if (!isBefore && hookName !== "enrichContext") {
    await Promise.allSettled(
      handlers
        .filter(({ extName }) => !blockedExtensions || !blockedExtensions.has(extName))
        .map(({ extName, handler }) =>
          withTimeout(handler(data), HOOK_TIMEOUT_MS, `${hookName}:${extName}`)
            .catch(err => log.warn("Hooks", `${hookName} from "${extName}" failed:`, err.message))
        )
    );
    return { cancelled: false };
  }

  // Before hooks and enrichContext: sequential
  for (const { extName, handler } of handlers) {
    // Skip if extension is blocked at this node
    if (blockedExtensions && blockedExtensions.has(extName)) continue;
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

/**
 * Set the spatial scope resolver. Called once at boot.
 * fn(nodeId) -> Promise<Set<string>> of blocked extension names.
 */
function setScopeResolver(fn) {
  _getScopeFn = fn;
}

export const hooks = {
  register,
  unregister,
  run,
  list,
  setScopeResolver,
};
