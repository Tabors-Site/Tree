// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import log from "../log.js";

// Tool definition registry. Extensions register tool schemas via registerToolDef().
// The kernel resolves tool names to schemas via resolveTools().
//
// Verb tagging (2026-05-18): every tool declares which IBP verb it fires —
// "see" (read-only), "do" (substrate write), or "summon" (emits a SUMMON to
// another being). The verb is stored in a sidecar map (kept outside the
// OpenAI schema so MCP/LLM clients see only the standard tool shape). Roles
// carry a `permissions` array; runChat filters resolved tools to the
// intersection so a role acting in capacity X only sees tools fitting X.
// Permissions belong to role identity, not envelopes — summoners can't
// cripple a role by stripping its capabilities. See memory
// `role-permissions-not-envelope`.
const toolDefs = {};
const toolVerbs = {};        // name → "see" | "do" | "summon"
const _untaggedWarned = new Set();
let MAX_TOOLS = 500;
const TOOL_NAME_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const VALID_VERBS = new Set(["see", "do", "summon"]);

export function setMaxTools(n) { MAX_TOOLS = Math.max(10, Number(n) || 500); }

/**
 * Register a tool definition so resolveTools can find it.
 * Called by the extension loader when wiring MCP tools.
 *
 * @param {string} name
 * @param {object} schema - OpenAI function tool shape
 * @param {object} [opts]
 * @param {"see"|"do"|"summon"} [opts.verb] - which IBP verb this tool
 *   fires. Used by runChat to filter tools against the active role's
 *   permissions. Untagged tools default to "do" with a warn-once.
 */
export function registerToolDef(name, schema, opts = {}) {
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

  // Verb tag (sidecar registry, kept out of the OpenAI schema).
  const verb = opts.verb;
  if (typeof verb === "string" && VALID_VERBS.has(verb)) {
    toolVerbs[name] = verb;
  } else {
    toolVerbs[name] = "do"; // permissive default
    if (verb !== undefined) {
      log.warn("Tools", `Tool "${name}": invalid verb "${verb}". Defaulting to "do". Use "see" | "do" | "summon".`);
    } else if (!_untaggedWarned.has(name)) {
      _untaggedWarned.add(name);
      log.warn("Tools",
        `Tool "${name}" registered without verb tag. Defaulting to "do". ` +
        `Tag with { verb: "see"|"do"|"summon" } so role permission filtering can constrain it.`);
    }
  }
  return true;
}

/**
 * Unregister a tool definition.
 * Called when an extension is uninstalled to prevent stale tools.
 */
export function unregisterToolDef(name) {
  if (toolDefs[name]) {
    delete toolDefs[name];
    delete toolVerbs[name];
    _warnedTools.delete(name);
    _untaggedWarned.delete(name);
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
      delete toolVerbs[name];
      _warnedTools.delete(name);
      _untaggedWarned.delete(name);
    }
  }
}

const _warnedTools = new Set();
// Cap the warned set to prevent unbounded growth from stale references
const MAX_WARNED = 500;

/**
 * Given an array of tool name strings, return the OpenAI tool definition array.
 *
 * Optional `permissions` filter: when supplied, drops any tool whose
 * verb is not in the array. Used by runChat to scope an LLM call to
 * the active role's declared capacities.
 *
 * @param {string[]} toolNames
 * @param {string[]} [permissions] - subset of ["see","do","summon"]
 */
export function resolveTools(toolNames, permissions = null) {
  const allowed = Array.isArray(permissions) ? new Set(permissions) : null;
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
    if (allowed) {
      const verb = toolVerbs[name] || "do";
      if (!allowed.has(verb)) return null;
    }
    return def;
  }).filter(Boolean);
}

/**
 * Look up a tool's verb tag. Returns "do" for untagged tools (permissive
 * default — matches the legacy "every tool may write" model until callers
 * tag them explicitly).
 */
export function getToolVerb(name) {
  return toolVerbs[name] || "do";
}

/**
 * Get count of registered tools (for diagnostics).
 */
export function getToolCount() {
  return Object.keys(toolDefs).length;
}
