// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Hook system. Open pub/sub for seed and extension events. Any hook
// name is valid; extensions namespace their own as "extName:hookName".
//
// Execution:
//   before*  - sequential, can cancel by returning false or throwing.
//   after*   - parallel, fire-and-forget, errors logged.
//   SEQUENTIAL_OVERRIDES - run sequentially because handlers depend on
//                          each other's output.
//
// run() returns { cancelled: false } or { cancelled: true, reason }.
// fire() is the same but swallows errors.

import log from "./seedReality/log.js";
import { getInternalConfigValue } from "./internalConfig.js";

// Read at use time so config changes take effect without restart.
function HOOK_TIMEOUT_MS() { return Number(getInternalConfigValue("hookTimeoutMs")) || 5000; }
function MAX_HANDLERS_PER_HOOK() { return Number(getInternalConfigValue("hookMaxHandlers")) || 100; }
function CIRCUIT_BREAKER_THRESHOLD() { return Number(getInternalConfigValue("hookCircuitThreshold")) || 5; }
function CIRCUIT_HALF_OPEN_MS() { return Number(getInternalConfigValue("hookCircuitHalfOpenMs")) || 300000; }
function CHAIN_TIMEOUT_MS() { return Number(getInternalConfigValue("hookChainTimeoutMs")) || 15000; }

// Add a hook here only if its handlers need each other's output.
const SEQUENTIAL_OVERRIDES = {
  enrichContext: true,        // cumulative AI context
  onCompress: true,           // sequential summary refinement
};

const CIRCUIT_MAX_BACKOFF_MS = 3600000;

const _failureCounts   = new Map(); // "hook:ext" -> count
const _circuitOpenedAt = new Map(); // "hook:ext" -> ms timestamp
const _circuitRetries  = new Map(); // "hook:ext" -> failed half-open retries
const registry         = new Map(); // hookName -> [{ extName, handler }]

let _getScopeFn = null;

function getHalfOpenDelay(key) {
  const retries = _circuitRetries.get(key) || 0;
  return Math.min(CIRCUIT_HALF_OPEN_MS() * Math.pow(2, retries), CIRCUIT_MAX_BACKOFF_MS);
}

function circuitSuccess(key) {
  _failureCounts.delete(key);
  _circuitOpenedAt.delete(key);
  _circuitRetries.delete(key);
}

function circuitFailure(key, hookName, extName) {
  const count = (_failureCounts.get(key) || 0) + 1;
  _failureCounts.set(key, count);
  if (count >= CIRCUIT_BREAKER_THRESHOLD()) {
    if (_circuitOpenedAt.has(key)) {
      const retries = (_circuitRetries.get(key) || 0) + 1;
      _circuitRetries.set(key, retries);
      const nextDelay = getHalfOpenDelay(key);
      log.error("Hooks", `${hookName} from "${extName}" half-open test failed (retry ${retries}). Next attempt in ${Math.round(nextDelay / 1000)}s.`);
    } else {
      log.error("Hooks", `${hookName} from "${extName}" failed ${count}x. Circuit breaker open.`);
    }
    _circuitOpenedAt.set(key, Date.now());
  }
}

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

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Hook timed out after ${ms}ms (${label})`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Duplicate detection is by handler function identity: re-registering
// the same function replaces it (idempotent init); two distinct
// functions from the same extension are both kept.
function register(hookName, handler, extName = "unknown") {
  if (typeof handler !== "function") {
    log.warn("Hooks", `Hook "${hookName}" from ${extName} is not a function. Ignored.`);
    return;
  }

  if (!registry.has(hookName)) {
    const CORE_HOOKS = [
      "beforeMatter", "afterMatter", "beforeFact",
      "beforeSpaceCreate", "afterSpaceCreate", "beforeSpaceDelete",
      "enrichContext", "onDocumentPressure",
      "beforeLLMCall", "afterLLMCall", "beforeToolCall", "afterToolCall",
      "beforeResponse", "beforeRegister", "afterRegister",
      "afterSessionCreate", "afterSessionEnd",
      "afterSpaceMove", "afterQualityWrite", "afterFieldWrite", "afterPositionUpdate", "afterScopeChange", "afterOwnershipChange", "afterBoot", "afterAct",
      "onTreeTripped", "onTreeRevived", "onCompress",
    ];
    if (!hookName.includes(":")) {
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
  const sameFnIdx = handlers.findIndex(h => h.handler === handler);
  if (sameFnIdx !== -1) {
    handlers[sameFnIdx] = { extName, handler };
    return;
  }

  if (handlers.length >= MAX_HANDLERS_PER_HOOK()) {
    log.error("Hooks", `"${hookName}" at capacity (${MAX_HANDLERS_PER_HOOK()}). Rejected ${extName}.`);
    return;
  }

  handlers.push({ extName, handler });
}

function unregister(extName) {
  for (const [hookName, handlers] of registry.entries()) {
    registry.set(hookName, handlers.filter(h => h.extName !== extName));
    const key = `${hookName}:${extName}`;
    _failureCounts.delete(key);
    _circuitOpenedAt.delete(key);
  }
}

async function run(hookName, data) {
  const handlers = registry.get(hookName);
  if (!handlers || handlers.length === 0) return { cancelled: false };

  const spaceId = data?.spaceId || data?.space?._id || null;
  // Branch rides on the hook payload from whichever moment emitted
  // the substrate change that triggered the hook. The scope resolver
  // (registered in genesis.js) walks the ancestor cache to find
  // confined-extension rules, which is branch-aware. Hook callers
  // that don't pass branch fall to "0" for the scope walk only;
  // safer than swallowing the hook's invocation entirely, but worth
  // surfacing so the caller can be threaded properly.
  const branch = data?.branch || data?.summonCtx?.branch || "0";
  let blockedExtensions = null;
  if (spaceId && _getScopeFn) {
    try {
      blockedExtensions = await _getScopeFn(String(spaceId), branch);
    } catch (scopeErr) {
      log.warn("Hooks", `Scope resolution failed for space ${spaceId} on branch ${branch}: ${scopeErr.message}. Extensions not filtered.`);
    }
  }

  const isBefore = hookName.startsWith("before");

  if (!isBefore && !SEQUENTIAL_OVERRIDES[hookName]) {
    await Promise.allSettled(
      handlers
        .filter(({ extName }) => {
          if (blockedExtensions && blockedExtensions.has(extName)) return false;
          const key = `${hookName}:${extName}`;
          const failures = _failureCounts.get(key) || 0;
          if (failures >= CIRCUIT_BREAKER_THRESHOLD()) {
            const openedAt = _circuitOpenedAt.get(key) || 0;
            if (Date.now() - openedAt < getHalfOpenDelay(key)) return false;
          }
          return true;
        })
        .map(({ extName, handler }) => {
          const key = `${hookName}:${extName}`;
          return withTimeout(handler(data), HOOK_TIMEOUT_MS(), `${hookName}:${extName}`)
            .then(() => {
              circuitSuccess(key);
            })
            .catch(err => {
              circuitFailure(key, hookName, extName);
              const count = _failureCounts.get(key) || 0;
              if (count < CIRCUIT_BREAKER_THRESHOLD()) {
                log.warn("Hooks", `${hookName} from "${extName}" failed (${count}/${CIRCUIT_BREAKER_THRESHOLD()}):`, err.message);
              }
            });
        })
    );
    return { cancelled: false };
  }

  const isSequentialOverride = SEQUENTIAL_OVERRIDES[hookName];
  const chainStart = isSequentialOverride ? Date.now() : 0;

  for (const { extName, handler } of handlers) {
    if (blockedExtensions && blockedExtensions.has(extName)) continue;
    const key = `${hookName}:${extName}`;
    const failures = _failureCounts.get(key) || 0;
    if (failures >= CIRCUIT_BREAKER_THRESHOLD()) {
      const openedAt = _circuitOpenedAt.get(key) || 0;
      if (Date.now() - openedAt < getHalfOpenDelay(key)) continue;
    }

    if (isSequentialOverride) {
      const elapsed = Date.now() - chainStart;
      if (elapsed >= CHAIN_TIMEOUT_MS()) {
        log.warn("Hooks", `${hookName} chain exceeded ${CHAIN_TIMEOUT_MS()}ms. Remaining handlers skipped.`);
        break;
      }
    }

    const perHandlerTimeout = isSequentialOverride
      ? Math.min(HOOK_TIMEOUT_MS(), CHAIN_TIMEOUT_MS() - (Date.now() - chainStart))
      : HOOK_TIMEOUT_MS();

    try {
      const result = await withTimeout(handler(data), perHandlerTimeout, `${hookName}:${extName}`);
      circuitSuccess(key);
      if (isBefore && result === false) {
        return { cancelled: true, reason: `Cancelled by ${extName}` };
      }
    } catch (err) {
      circuitFailure(key, hookName, extName);
      if (isBefore) {
        const isTimeout = err.message?.includes("timed out");
        log.error("Hooks", `${hookName} from "${extName}" ${isTimeout ? "timed out" : "threw"}, cancelling:`, err.message);
        return { cancelled: true, reason: err.message, timedOut: isTimeout };
      }
      const count = _failureCounts.get(key) || 0;
      if (count < CIRCUIT_BREAKER_THRESHOLD()) {
        log.warn("Hooks", `${hookName} from "${extName}" failed:`, err.message);
      }
    }
  }

  return { cancelled: false };
}

function list() {
  const result = {};
  for (const [hookName, handlers] of registry.entries()) {
    if (handlers.length > 0) {
      result[hookName] = handlers.map(h => h.extName);
    }
  }
  return result;
}

// fn(spaceId) -> Promise<Set<string>> of blocked extension names.
function setScopeResolver(fn) {
  _getScopeFn = fn;
}

function resetCircuit(hookName, extName) {
  const key = `${hookName}:${extName}`;
  circuitSuccess(key);
  log.info("Hooks", `Circuit breaker manually reset for ${key}`);
}

// Best-effort variant of run: swallows errors with a warn log.
// Returns null on error, otherwise the same shape as run.
async function fire(hookName, payload) {
  try {
    return await run(hookName, payload);
  } catch (err) {
    log.warn("Hooks", `${hookName} fire failed: ${err.message}`);
    return null;
  }
}

export const hooks = {
  register,
  unregister,
  run,
  fire,
  list,
  setScopeResolver,
  resetCircuit,
};
