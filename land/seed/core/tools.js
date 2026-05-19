// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
import log from "./log.js";

// Tool definition registry. Extensions register tool schemas via registerToolDef().
// The kernel resolves tool names to schemas via resolveTools().
//
// **Internal tools and the IBP protocol share one shape.** Every tool
// declares which IBP verb it fires — `see`, `do`, `summon`, or `be`.
// Verb is REQUIRED on every registration; there is no permissive default.
// Tools without a verb are rejected.
//
// The IBPA grammar (which the verb tag enforces at the address layer):
//   SEE    `<leftStance> :: <position-or-stance>`  read anything
//   DO     `<leftStance> :: <position-or-stance>`  write anything
//   SUMMON `<leftStance> :: <stance>`              target must be a being
//   BE     `<leftStance>`                          left-stance operations
//                                                  (claim/release/switch
//                                                  the identity itself —
//                                                  no separate right target)
//
// Roles carry a `permissions: ("see"|"do"|"summon"|"be")[]` array;
// `resolveTools` filters resolved tools by verb against the role's
// permissions so a role acting in capacity X only sees tools fitting X.
// Permissions belong to role identity, not envelopes — summoners can't
// cripple a role by stripping its capabilities. See memory
// `role-permissions-not-envelope`.
const toolDefs = {};
const toolVerbs = {};        // name → "see" | "do" | "summon" | "be"
let MAX_TOOLS = 500;
const TOOL_NAME_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const VALID_VERBS = new Set(["see", "do", "summon", "be"]);

export function setMaxTools(n) { MAX_TOOLS = Math.max(10, Number(n) || 500); }

/**
 * Register a tool definition so resolveTools can find it.
 * Called by the extension loader when wiring MCP tools.
 *
 * @param {string} name
 * @param {object} schema - OpenAI function tool shape
 * @param {object} opts
 * @param {"see"|"do"|"summon"|"be"} opts.verb - REQUIRED. Which IBP verb
 *   this tool fires. Internal tools and protocol verbs share one shape;
 *   tools without a verb are rejected.
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
  // Verb tag is REQUIRED. Every tool has a shape — internal and protocol
  // share the same set of verbs ([[role-permissions-not-envelope]]).
  // No permissive default; missing or invalid verb rejects registration.
  const verb = opts.verb;
  if (typeof verb !== "string" || !VALID_VERBS.has(verb)) {
    log.error("Tools",
      `Tool "${name}" rejected: missing or invalid verb (got ${JSON.stringify(verb)}). ` +
      `Every tool must declare { verb: "see"|"do"|"summon"|"be" } at registration.`);
    return false;
  }

  // Freeze the schema to prevent post-registration mutation
  toolDefs[name] = Object.freeze(schema);
  toolVerbs[name] = verb;
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
      const verb = toolVerbs[name];
      if (!verb || !allowed.has(verb)) return null;
    }
    return def;
  }).filter(Boolean);
}

/**
 * Look up a tool's verb tag. Returns null for unregistered tools.
 * Every registered tool has a verb (registration without one is rejected).
 */
export function getToolVerb(name) {
  return toolVerbs[name] || null;
}

/**
 * Get count of registered tools (for diagnostics).
 */
export function getToolCount() {
  return Object.keys(toolDefs).length;
}

/**
 * List every registered tool name. Used by configuration UIs that show
 * the base set of tools available before per-node overlays apply.
 */
export function listToolNames() {
  return Object.keys(toolDefs);
}

/**
 * Sync the full tool registry into `<land>/.tools` as child Nodes. One
 * child per tool, name = tool name, metadata = the registered shape
 * info. Called at the end of boot (after extensions register their
 * tools) so SEE on `<land>/.tools` reflects current state. Idempotent;
 * subsequent calls reconcile (add new tools, remove gone ones).
 */
export async function syncToolsToSubstrate() {
  const { SYSTEM_ROLE } = await import("./protocol.js");
  const { syncRegistryToSubstrate } = await import("../tree/registryMirror.js");
  const items = Object.entries(toolDefs).map(([name, def]) => ({
    name,
    metadata: new Map([
      ["tool", {
        verb:        toolVerbs[name] || null,
        description: def?.function?.description || null,
        parameters:  def?.function?.parameters || null,
      }],
    ]),
  }));
  return syncRegistryToSubstrate({ systemRole: SYSTEM_ROLE.TOOLS, items });
}
