// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// What a being CAN reach for during its moment. The shared
// dictionary of every callable function any LLM-driven being's
// frame might list as an option. Extensions register tool
// schemas through `registerToolBundle`; roles declare which tools
// they can wield in `canSee / canDo / canSummon / canBe`; the
// assembler resolves names to schemas at frame-build time via
// `resolveTools`, so the being sees its options as part of being.
//
// Every tool has a shape. Each declares which of the four verbs it
// fires (`see`, `do`, `summon`, `be`). Verb is REQUIRED at registration;
// no permissive default; verbless tools are rejected. Internal tools
// and the IBP protocol share one set of verbs, so the same address
// grammar applies to either:
//
//   SEE    `<leftStance> :: <position-or-stance>`  read
//   DO     `<leftStance> :: <position-or-stance>`  write
//   SUMMON `<leftStance> :: <stance>`              target must be a being
//   BE     `<leftStance>`                          identity ops on self
//
// Roles carry a `permissions: ("see"|"do"|"summon"|"be")[]` array.
// `resolveTools` filters the resolved set by verb against the role's
// permissions so a role acting in capacity X only sees tools fitting
// X. Permissions belong to role identity, not envelopes. Summoners
// cannot cripple a role by stripping its capacities at call time.

import log from "../../../system/log.js";
const toolDefs = {};
const toolVerbs = {};    // name → "see" | "do" | "summon" | "be"
const toolHandlers = {}; // name → async (args) => result
let MAX_TOOLS = 500;
const TOOL_NAME_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const VALID_VERBS = new Set(["see", "do", "summon", "be"]);

// Extension tool injection hook. The loader calls
// setExtensionToolResolver during boot with a function that returns
// the extension-contributed tools for a given role name. Stamp uses
// the resolver at frame-build time to merge extension tools into
// the role's base toolNames before the permission filter runs.
let _getExtToolsFn = () => [];
export function setExtensionToolResolver(fn) {
  _getExtToolsFn = typeof fn === "function" ? fn : () => [];
}
export function getExtensionToolsForRole(roleName) {
  return _getExtToolsFn(roleName);
}

export function setMaxTools(n) {
  MAX_TOOLS = Math.max(10, Number(n) || 500);
}

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
    log.error(
      "Tools",
      `Invalid tool name "${String(name).slice(0, 30)}". Must be lowercase alphanumeric/hyphens/underscores, 1-64 chars, start with letter.`,
    );
    return false;
  }
  // Reject duplicates
  if (toolDefs[name]) {
    log.error(
      "Tools",
      `Tool "${name}" already registered. Duplicate rejected.`,
    );
    return false;
  }
  // Registry cap
  if (Object.keys(toolDefs).length >= MAX_TOOLS) {
    log.error(
      "Tools",
      `Tool registry full (${MAX_TOOLS}). "${name}" rejected.`,
    );
    return false;
  }
  // Validate schema structure. Must be an object with a function property.
  if (!schema || typeof schema !== "object") {
    log.error(
      "Tools",
      `Tool "${name}" has invalid schema (expected object, got ${typeof schema}). Rejected.`,
    );
    return false;
  }
  if (
    schema.type === "function" &&
    (!schema.function || typeof schema.function.name !== "string")
  ) {
    log.error(
      "Tools",
      `Tool "${name}" has malformed function schema (missing function.name). Rejected.`,
    );
    return false;
  }
  // Description is required at registration. Without it, the role-summon
  // gate (assertAllToolsResolve in stamp.js) would block the role
  // anyway — better to fail at the registration call so the extension
  // surfaces the misconfiguration immediately, not at the first summon.
  if (schema.type === "function") {
    const desc = schema.function?.description;
    if (typeof desc !== "string" || !desc.trim()) {
      throw new Error(
        `Tool "${name}" registration rejected: function.description must be a ` +
          `non-empty string. Roles that declare this tool cannot be summoned ` +
          `without it.`,
      );
    }
  }
  // Verb tag is REQUIRED. Every tool has a shape — internal and protocol
  // share the same set of verbs ([[role-permissions-not-envelope]]).
  // No permissive default; missing or invalid verb rejects registration.
  const verb = opts.verb;
  if (typeof verb !== "string" || !VALID_VERBS.has(verb)) {
    log.error(
      "Tools",
      `Tool "${name}" rejected: missing or invalid verb (got ${JSON.stringify(verb)}). ` +
        `Every tool must declare { verb: "see"|"do"|"summon"|"be" } at registration.`,
    );
    return false;
  }

  // Freeze the schema to prevent post-registration mutation
  toolDefs[name] = Object.freeze(schema);
  toolVerbs[name] = verb;
  return true;
}

/**
 * Register a bundle of tools in one call. Sole entry point for both
 * kernel-shipped tools (called from genesis.js with `ownerExt: "kernel"`)
 * and extension-shipped tools (called from extensions/loader.js with
 * `ownerExt: manifest.name`). Each tool object:
 *
 *   { name, description, schema, handler, verb, annotations? }
 *
 *   - `schema` may be a raw shape (`{ key: z.string() }`) or a
 *     pre-built zod object. Wrapped in `z.object().passthrough()` for
 *     the MCP server so it does not strip context fields the MCP HTTP
 *     middleware injects (beingId, stampId, ...).
 *   - `verb` is REQUIRED ("see" | "do" | "summon" | "be").
 *   - Tools without a `handler` are def-only (registered for
 *     `resolveTools` but not callable via MCP).
 *
 * Collisions across namespaces are rejected. The kernel claims its
 * tools first (under `ownerExt: "kernel"`); any extension trying to
 * register a tool with the same name is skipped with a log entry.
 */
export async function registerToolBundle(tools, { ownerExt }) {
  if (!Array.isArray(tools) || tools.length === 0) return;
  if (!ownerExt) throw new Error("registerToolBundle: ownerExt is required");

  const { z } = await import("zod");
  const { zodToJsonSchema } = await import("zod-to-json-schema");
  const { registerToolOwner, getToolOwner } =
    await import("../../../place/space/extensionScope.js");

  for (const tool of tools) {
    // Description gate first. The LLM's tool-call prompt needs a
    // description to know when to invoke the tool. Catch missing
    // descriptions before any registration work runs.
    if (typeof tool.description !== "string" || !tool.description.trim()) {
      log.error(
        "Tools",
        `${ownerExt}: tool "${tool.name}" rejected (description must be a ` +
          `non-empty string). Skipped.`,
      );
      continue;
    }

    const existingOwner = getToolOwner(tool.name);
    if (existingOwner) {
      log.error(
        "Tools",
        `Tool "${tool.name}" from "${ownerExt}" conflicts with "${existingOwner}". Skipped.`,
      );
      continue;
    }
    registerToolOwner(tool.name, ownerExt, tool.verb);

    // Stash the handler so runTurn can dispatch it directly. The verb
    // dispatcher's authorize gate already covers per-verb auth + the
    // extension-scope block; no protocol layer is needed between the
    // LLM voice's tool call and the handler.
    if (typeof tool.handler === "function") {
      toolHandlers[tool.name] = tool.handler;
    }

    // JSON schema for the LLM's function-calling format.
    let jsonSchema;
    try {
      const zodObj = z.object(tool.schema);
      jsonSchema = zodToJsonSchema(zodObj);
      delete jsonSchema.$schema;
    } catch {
      jsonSchema = tool.schema;
    }

    registerToolDef(
      tool.name,
      {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: jsonSchema,
        },
      },
      { verb: tool.verb },
    );

    log.verbose(
      "Tools",
      `${ownerExt}: registered "${tool.name}" (${tool.verb})`,
    );
  }
}

/**
 * Unregister a tool definition.
 * Called when an extension is uninstalled to prevent stale tools.
 */
export function unregisterToolDef(name) {
  if (toolDefs[name]) {
    delete toolDefs[name];
    delete toolVerbs[name];
    delete toolHandlers[name];
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
      delete toolHandlers[name];
      _warnedTools.delete(name);
    }
  }
}

/**
 * Look up a tool's handler. Returns null for unregistered tools or
 * def-only tools (registered for resolveTools but not callable).
 * runTurn's executeTool invokes this directly — no MCP transport.
 */
export function getToolHandler(name) {
  return toolHandlers[name] || null;
}

const _warnedTools = new Set();
// Cap the warned set to prevent unbounded growth from stale references
const MAX_WARNED = 500;

/**
 * Given an array of tool name strings, return the OpenAI tool definition array.
 *
 * Optional `permissions` filter: when supplied, drops any tool whose
 * verb is not in the array. Used by runTurn to scope an LLM call to
 * the active role's declared capacities.
 *
 * @param {string[]} toolNames
 * @param {string[]} [permissions] - subset of ["see","do","summon"]
 */
export function resolveTools(toolNames, permissions = null) {
  const allowed = Array.isArray(permissions) ? new Set(permissions) : null;
  return toolNames
    .map((name) => {
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
    })
    .filter(Boolean);
}

/**
 * Look up a tool's verb tag. Returns null for unregistered tools.
 * Every registered tool has a verb (registration without one is rejected).
 */
export function getToolVerb(name) {
  return toolVerbs[name] || null;
}

/**
 * Look up a tool's `description` string. Returns null when the tool is
 * unregistered or has no description. Used by the prompt assembler to
 * render canSee / canDo / canSummon / canBe entries with prose.
 */
export function getToolDescription(name) {
  const def = toolDefs[name];
  return def?.function?.description || null;
}

/**
 * Get count of registered tools (for diagnostics).
 */
export function getToolCount() {
  return Object.keys(toolDefs).length;
}

/**
 * List every registered tool name. Used by configuration UIs that show
 * the base set of tools available before per-space overlays apply.
 */
export function listToolNames() {
  return Object.keys(toolDefs);
}

/**
 * Audit every registered role's declared tools against the registry.
 * For each role, walk canSee + canDo + canSummon + canBe and verify
 * each name resolves to a registered description. Misses are logged
 * loudly at genesis so the operator sees them before any summon
 * (where the same gap would block the role via assertAllToolsResolve
 * in stamp.js).
 *
 * Returns { roles: number, missing: { [roleName]: string[] } }. An
 * empty `missing` map means the tree is wired correctly.
 */
export async function auditToolDescriptions() {
  const { listRoles, getRole } = await import("../../roles/registry.js");
  const roleNames = listRoles();
  const missing = {};
  let scanned = 0;

  for (const roleName of roleNames) {
    const role = getRole(roleName);
    if (!role) continue;
    scanned++;
    const declared = [
      ...(role.canSee || []),
      ...(role.canDo || []),
      ...(role.canSummon || []),
      ...(role.canBe || []),
    ];
    const gaps = declared.filter((name) => !toolDefs[name]);
    if (gaps.length > 0) missing[roleName] = gaps;
  }

  const missingCount = Object.keys(missing).length;
  if (missingCount === 0) {
    log.verbose("Tools", `tool-description audit: ${scanned} role(s) clean`);
  } else {
    for (const [roleName, gaps] of Object.entries(missing)) {
      log.error(
        "Tools",
        `role "${roleName}" declares ${gaps.length} tool(s) with no registered ` +
          `description: ${gaps.join(", ")}. Role cannot be summoned until resolved.`,
      );
    }
  }
  return { roles: scanned, missing };
}

// Sync the full tool registry into `<place>/.tools` as child spaces.
// One child per tool, name = tool name, qualities carries the
// registered shape info. Called at the end of genesis (after
// extensions have registered their tools) so SEE on `<place>/.tools`
// reflects current state. Idempotent; subsequent calls reconcile
// (add new tools, remove gone ones).
export async function syncToolsToSubstrate() {
  const { SEED_SPACE } = await import("../../../place/space/seedSpaces.js");
  const { manifestItems } = await import("../../../place/manifest.js");
  const items = Object.entries(toolDefs).map(([name, def]) => ({
    name,
    qualities: new Map([
      [
        "tool",
        {
          verb: toolVerbs[name] || null,
          description: def?.function?.description || null,
          parameters: def?.function?.parameters || null,
        },
      ],
    ]),
  }));
  return manifestItems({ seedSpace: SEED_SPACE.TOOLS, items });
}
