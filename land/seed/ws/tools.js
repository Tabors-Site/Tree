// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import log from "../log.js";

// Tool definition registry. Extensions register tool schemas via registerToolDef().
// The kernel resolves tool names to schemas via resolveTools().
const toolDefs = {};
let MAX_TOOLS = 500;
const TOOL_NAME_RE = /^[a-z][a-z0-9_-]{0,63}$/;

export function setMaxTools(n) { MAX_TOOLS = Math.max(10, Number(n) || 500); }

/**
 * Register a tool definition so resolveTools can find it.
 * Called by the extension loader when wiring MCP tools.
 */
export function registerToolDef(name, schema) {
  // Validate name format
  if (typeof name !== "string" || !TOOL_NAME_RE.test(name)) {
    log.error("Tools", `Invalid tool name "${String(name).slice(0, 30)}". Must be lowercase alphanumeric/hyphens/underscores, 1-64 chars, start with letter.`);
    return false;
  }
  // Reject duplicates
  if (toolDefs[name]) {
    log.error("Tools", `Tool "${name}" already registered. Duplicate rejected.`);
    return false;
  }
  // Registry cap
  if (Object.keys(toolDefs).length >= MAX_TOOLS) {
    log.error("Tools", `Tool registry full (${MAX_TOOLS}). "${name}" rejected.`);
    return false;
  }
  // Validate schema structure. Must be an object with a function property.
  if (!schema || typeof schema !== "object") {
    log.error("Tools", `Tool "${name}" has invalid schema (expected object, got ${typeof schema}). Rejected.`);
    return false;
  }
  if (schema.type === "function" && (!schema.function || typeof schema.function.name !== "string")) {
    log.error("Tools", `Tool "${name}" has malformed function schema (missing function.name). Rejected.`);
    return false;
  }
  // Freeze the schema to prevent post-registration mutation
  toolDefs[name] = Object.freeze(schema);
  return true;
}

/**
 * Unregister a tool definition.
 * Called when an extension is uninstalled to prevent stale tools.
 */
export function unregisterToolDef(name) {
  if (toolDefs[name]) {
    delete toolDefs[name];
    _warnedTools.delete(name);
    return true;
  }
  return false;
}

/**
 * Unregister all tools owned by a specific extension.
 * Called by the loader during extension uninstall.
 */
export function unregisterToolsForExtension(extName, getToolOwnerFn) {
  for (const name of Object.keys(toolDefs)) {
    if (getToolOwnerFn(name) === extName) {
      delete toolDefs[name];
      _warnedTools.delete(name);
    }
  }
}

const _warnedTools = new Set();
// Cap the warned set to prevent unbounded growth from stale references
const MAX_WARNED = 500;

/**
 * Given an array of tool name strings, return the OpenAI tool definition array.
 */
export function resolveTools(toolNames) {
  return toolNames.map((name) => {
    if (typeof name !== "string") return null;
    const def = toolDefs[name];
    if (!def) {
      if (!_warnedTools.has(name)) {
        if (_warnedTools.size >= MAX_WARNED) {
          // Evict oldest warnings to prevent unbounded growth
          const first = _warnedTools.values().next().value;
          _warnedTools.delete(first);
        }
        _warnedTools.add(name);
        log.warn("Tools", `Unknown tool: ${name} (skipped)`);
      }
      return null;
    }
    return def;
  }).filter(Boolean);
}

/**
 * Get count of registered tools (for diagnostics).
 */
export function getToolCount() {
  return Object.keys(toolDefs).length;
}
