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

import log from "../../../seedReality/log.js";
import { hooks } from "../../../hooks.js";
import { getInternalConfigValue } from "../../../internalConfig.js";
import { isDbHealthy } from "../../../seedReality/dbConfig.js";
import {
  getCurrentSpace,
  getRootIdFor,
} from "../../../materials/being/position.js";
import { getAncestorChain, resolveExtensionScopeFromChain } from "../../../materials/space/ancestorCache.js";
import { getToolCallTimeoutMs, getToolResultMaxBytes } from "../../knobs.js";
import { resolveToolsForRole } from "./assemble.js";

const toolDefs = {};
const toolVerbs = {};    // name → "see" | "do" | "summon" | "be"
const toolHandlers = {}; // name → async (args) => result
let MAX_TOOLS = 500;
const TOOL_NAME_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const VALID_VERBS = new Set(["see", "do", "summon", "be"]);

// Walk a JSON-Schema-shaped object and remove any
// `additionalProperties: {}` keys (the empty-object sentinel zod
// emits for z.record(z.any())). Mongoose Mixed strips empty objects
// on storage, so leaving the sentinel in causes the projection's
// stored value to diverge from the registry's after a single write —
// triggering redundant set-space facts every reboot. Stripping at
// registration makes storage and registry agree.
function stripEmptyAdditionalProperties(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) stripEmptyAdditionalProperties(child);
    return;
  }
  if (
    "additionalProperties" in node &&
    node.additionalProperties &&
    typeof node.additionalProperties === "object" &&
    !Array.isArray(node.additionalProperties) &&
    Object.keys(node.additionalProperties).length === 0
  ) {
    delete node.additionalProperties;
  }
  for (const key of Object.keys(node)) stripEmptyAdditionalProperties(node[key]);
}

export function setMaxTools(n) {
  MAX_TOOLS = Math.max(10, Number(n) || 500);
}

/**
 * Register a tool definition so resolveTools can find it.
 * Called by the extension loader when wiring tools.
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
 * seed-shipped tools (called from genesis.js with `ownerExt: "seed"`)
 * and extension-shipped tools (called from extensions/loader.js with
 * `ownerExt: manifest.name`). Each tool object:
 *
 *   { name, description, schema, handler, verb, annotations? }
 *
 *   - `schema` may be a raw shape (`{ key: z.string() }`) or a
 *     pre-built zod object. Translated to JSON schema for the
 *     LLM's function-calling format.
 *   - `verb` is REQUIRED ("see" | "do" | "summon" | "be").
 *   - Tools without a `handler` are def-only (registered for
 *     `resolveTools` but not callable).
 *
 * Collisions across namespaces are rejected. The seed claims its
 * tools first (under `ownerExt: "seed"`); any extension trying to
 * register a tool with the same name is skipped with a log entry.
 */
export async function registerToolBundle(tools, { ownerExt }) {
  if (!Array.isArray(tools) || tools.length === 0) return;
  if (!ownerExt) throw new Error("registerToolBundle: ownerExt is required");

  const { z } = await import("zod");
  const { zodToJsonSchema } = await import("zod-to-json-schema");
  const { registerToolOwner, getToolOwner } =
    await import("../../../materials/space/extensionScope.js");

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
      // zod renders `z.record(z.any())` as `{ type:"object",
      // additionalProperties: {} }`. The empty object is JSON Schema's
      // "no constraint" sentinel, semantically equivalent to omitting
      // the key. But Mongoose Mixed strips empty objects on storage,
      // so the projection drops it on every write and the next reboot
      // sees a diff and re-emits a redundant set-space fact. Strip the
      // empty sentinel recursively at registration so storage matches
      // registry.
      stripEmptyAdditionalProperties(jsonSchema);
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
 * runTurn's executeTool invokes this directly.
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
 * Audit that the seed's verb-tools are registered. Four tools ship
 * from the seed:
 *
 *   do / summon / be   — the three act-capable verbs. Each is a
 *                        generic tool the LLM dispatches into the
 *                        role's licensed surface (canDo / canSummon
 *                        / canBe describe what the role may invoke).
 *
 *   end-turn           — the explicit no-act call. Always available,
 *                        bypasses the can* gating and verb-permission
 *                        filter. Routes to cognitionSee() on success;
 *                        the moment closes without an Act.
 *
 * The old audit walked the can* lists and looked each entry up in
 * toolDefs. That produced false-positive warnings under the verbs-
 * as-language doctrine . object entries (e.g. `{action, description}`)
 * stringify to `[object Object]`, plain address strings like
 * `.config` aren't registered tool names. Both are correct per the
 * descriptor doctrine, neither should fail the audit.
 *
 * Now the audit checks only the four seed verb-tools; if any are
 * missing, no LLM role can run.
 *
 * canSee retired from the LLM toolset. canSee entries preload into
 * the face as JSON blocks at moment-open via renderCanSeeBlocks;
 * they are perception, not dispatch.
 */
export async function auditToolDescriptions() {
  const SEED_VERB_TOOLS = ["do", "summon", "be", "end-turn"];
  const missing = SEED_VERB_TOOLS.filter((name) => !toolDefs[name]);
  if (missing.length === 0) {
    log.verbose("Tools", `verb-tool audit: ${SEED_VERB_TOOLS.length} seed tool(s) registered`);
  } else {
    log.error(
      "Tools",
      `seed verb-tools missing from the registry: ${missing.join(", ")}. ` +
        `Genesis did not register seedDoTool / seedSummonTool / seedBeTool ` +
        `before role auditing. No LLM role can run until this is fixed.`,
    );
  }
  return { tools: SEED_VERB_TOOLS.length, missing };
}

// Sync the full tool registry into `<reality>/./tools` as child spaces.
// One child per tool, name = tool name, qualities carries the
// registered shape info. Called at the end of genesis (after
// extensions have registered their tools) so SEE on `<reality>/./tools`
// reflects current state. Idempotent; subsequent calls reconcile
// (add new tools, remove gone ones).
export async function syncToolsToSubstrate() {
  const { HEAVEN_SPACE } = await import("../../../materials/space/heavenSpaces.js");
  const { manifestItems } = await import("../../manifest.js");
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
  return manifestItems({ heavenSpace: HEAVEN_SPACE.TOOLS, items });
}

// ─────────────────────────────────────────────────────────────────────────
// PER-POSITION TOOL RESOLUTION + DISPATCH
// ─────────────────────────────────────────────────────────────────────────
//
// resolveToolsForPosition: per-moment resolution of which tools the being
// may reach for. Role base + extension overlays + per-position rules +
// permission filter. Called once at the start of the LLM loop (see
// loop.js). The position-walk reads the being's ancestor cache so a
// tree's `qualities.tools.{allowed, blocked}` can tighten or loosen
// the role's defaults; confined extensions on the chain drop their
// tools out of the surface.
//
// executeTool: dispatch one tool call from the LLM. Parse the args,
// inject context (beingId, actId, spaceId), check the per-tool circuit
// breaker, fire beforeToolCall, dispatch through the handler, capture
// the result, fire afterToolCall, append the tool-response message to
// session history. The loop in loop.js calls this once per tool the
// model invoked in its last forward pass.

/**
 * Resolve the tool surface for one moment.
 *
 * @param {object} session           the per-being presence reel
 * @param {string} beingId           acting being
 * @param {string[]|null} rolePermissions  caller-supplied permission filter
 * @returns {Promise<{tools, blockedExtensions, restrictedExtensions}>}
 */
export async function resolveToolsForPosition(
  session,
  beingId,
  rolePermissions = null,
  branch,
) {
  let treeToolConfig = null;
  let blockedExtensions = null;
  let restrictedExtensions = null;
  const currentSpace = getCurrentSpace(beingId) || getRootIdFor(beingId);
  if (currentSpace) {
    try {
      const ancestors =
        session._ancestorSnapshot || (await getAncestorChain(currentSpace, branch));

      if (ancestors && ancestors.length > 0) {
        // Position-scoped tool allow/block. Walks closest-to-farthest;
        // any space can contribute, place-heaven spaces terminate.
        const allowed = new Set();
        const blocked = new Set();
        for (const space of ancestors) {
          if (space.heavenSpace) break;
          const meta = space.qualities || {};
          if (meta.tools?.allowed)
            for (const t of meta.tools.allowed) allowed.add(t);
          if (meta.tools?.blocked)
            for (const t of meta.tools.blocked) blocked.add(t);
        }
        if (allowed.size || blocked.size) {
          treeToolConfig = {
            allowed: allowed.size ? [...allowed] : undefined,
            blocked: blocked.size ? [...blocked] : undefined,
          };
        }

        // Confined-extension scope: same resolver extensionScope.js uses,
        // so policy stays in one place.
        const { getConfinedExtensions } =
          await import("../../../materials/space/extensionScope.js");
        const scope = resolveExtensionScopeFromChain(
          ancestors,
          getConfinedExtensions(),
        );
        if (scope.blocked.size) blockedExtensions = scope.blocked;
        if (scope.restricted.size) restrictedExtensions = scope.restricted;
      }
    } catch (scopeErr) {
      log.warn(
        "LLM",
        `Tool scope resolution failed for space ${currentSpace}: ${scopeErr.message}`,
      );
    }
  }
  // Role base + extension overlays + position overlays + permission
  // filter. Permissions are role identity; envelopes never widen them.
  let tools = resolveToolsForRole(
    session.role,
    treeToolConfig,
    rolePermissions,
  );
  if (blockedExtensions || restrictedExtensions) {
    const { filterToolsByScope } =
      await import("../../../materials/space/extensionScope.js");
    tools = filterToolsByScope(tools, blockedExtensions, restrictedExtensions);
  }
  return { tools, blockedExtensions, restrictedExtensions };
}

/**
 * I run one tool call. The LLM has asked for a hand reach: parse
 * its args, check the per-tool circuit breaker, fire beforeToolCall
 * so extensions can rewrite or cancel, dispatch through the
 * handler, capture the result, fire afterToolCall. The result lands
 * in session.messages as the `tool` role partner of the assistant's
 * tool_call so the next call sees the answer in its history.
 *
 * @param {object} toolCall      OpenAI tool-call object
 * @param {object} session       per-being presence reel
 * @param {object} ctx           moment ctx (beingId, actId, signal, ...)
 * @param {string} presenceKey   conversation identifier
 */
export async function executeTool(toolCall, session, ctx, presenceKey) {
  const toolName = toolCall.function.name;
  let args;

  if (
    !toolCall.function.arguments ||
    typeof toolCall.function.arguments !== "string"
  ) {
    log.error("LLM", `Missing or non-string tool arguments for ${toolName}`);
    session.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: "Missing tool arguments" }),
    });
    return { tool: toolName, success: false, error: "Missing tool arguments" };
  }

  try {
    args = JSON.parse(toolCall.function.arguments);
  } catch (e) {
    log.error("LLM", `Invalid tool arguments for ${toolName}:`, e.message);
    session.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: "Invalid arguments" }),
    });
    return {
      tool: toolName,
      success: false,
      error: "Invalid arguments",
    };
  }

  // Auto-injected context args. The LLM doesn't know the summon's
  // identifiers; we do. We stamp them onto every tool call so the
  // handler can correlate back without global lookups. beingId names
  // the caller; actId/sessionId tie to this LLM turn; rootActId
  // points at the user-message-level root for per-turn state;
  // ibpAddress identifies the conversation; spaceId pins the position.
  args.beingId = ctx.beingId;
  if (ctx?.actId && !args.actId) args.actId = ctx.actId;
  if (ctx?.sessionId && !args.sessionId) args.sessionId = ctx.sessionId;
  if (ctx?.rootActId && !args.rootActId)
    args.rootActId = ctx.rootActId;
  else if (ctx?.actId && !args.rootActId)
    args.rootActId = ctx.actId;
  if (presenceKey && !args.ibpAddress) args.ibpAddress = presenceKey;
  if (ctx.rootId && !args.rootId) args.rootId = ctx.rootId;
  // Position-pin. When a turn is dispatched with an explicit
  // ctx.currentSpace (sub-Ruler turn, branch dispatch, Worker-at-
  // scope, etc.) the tool call places AT THAT space even if the user
  // navigates somewhere else mid-turn. Without this, a dispatched
  // Worker's writes follow the user's cursor — position is per-being,
  // and user-driven and dispatch-driven turns share it. The pin is
  // the only thing keeping the two flows from clobbering each other.
  const _curNode =
    ctx.currentSpace || getCurrentSpace(ctx.beingId) || ctx.rootId || null;
  if (_curNode && !args.spaceId) args.spaceId = _curNode;

  // Per-tool circuit breaker. If one tool keeps failing this
  // session, disable it for the rest of the session. The tool
  // disappears from the AI's perspective; it routes around. One
  // bad API key kills one tool, not the whole turn.
  if (!session._toolFailures) session._toolFailures = {};
  const toolCircuitThreshold = parseInt(
    getInternalConfigValue("toolCircuitThreshold") || "5",
    10,
  );
  if ((session._toolFailures[toolName] || 0) >= toolCircuitThreshold) {
    session.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({
        error: `Tool "${toolName}" has been temporarily disabled due to repeated failures. Use a different approach.`,
      }),
    });
    return {
      tool: toolName,
      args,
      success: false,
      error: "tool_circuit_tripped",
    };
  }

  // beforeToolCall lets extensions rewrite args or cancel the call.
  // actId / sessionId / spaceId let forensics correlate the call
  // back to the originating turn.
  const _toolActId = ctx?.actId || null;
  const _toolSessionId = ctx?.sessionId || null;
  const hookData = {
    toolName,
    args,
    beingId: ctx.beingId,
    rootId: ctx.rootId,
    role: session.role?.name,
    actId: _toolActId,
    sessionId: _toolSessionId,
    spaceId: getCurrentSpace(ctx.beingId) || ctx.rootId || null,
  };
  const hookResult = await hooks.run("beforeToolCall", hookData);
  if (hookResult.cancelled) {
    const errCode = hookResult.timedOut ? "HOOK_TIMEOUT" : "HOOK_CANCELLED";
    session.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({
        error: hookResult.reason || "Tool call cancelled",
        code: errCode,
      }),
    });
    return { tool: toolName, args, success: false, error: errCode };
  }
  args = hookData.args;
  const resolvedToolName = hookData.toolName || toolName;

  log.debug("LLM", `🔧 [role:${session.role?.name}] ${resolvedToolName}`, args);

  // Announce the call before dispatch. Live consumers (CLI, web) get
  // to show "running <tool>..." while the work is happening instead
  // of waiting for the answer to flash in.
  if (ctx.onToolCalled) {
    try {
      ctx.onToolCalled({ tool: resolvedToolName, args });
    } catch {
      /* never let a listener break the tool loop */
    }
  }

  // DB health gate. If Mongo is unreachable, every substrate-touching
  // tool will fail in the same way; rather than burn time on the
  // failures, tell the AI directly so it can speak to the user.
  if (!isDbHealthy()) {
    const dbErr =
      "Database is currently unavailable. Tell the user the place is experiencing issues and to try again shortly.";
    session.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: dbErr }),
    });
    return { tool: toolName, args, success: false, error: "db_unavailable" };
  }

  try {
    // Direct handler dispatch. Tools are verb-tagged and registered
    // with their handler via registerToolDef (above); the handler IS
    // the verb call (it usually wraps reality.see / reality.do /
    // reality.summon / reality.be against a target). The verb dispatcher's
    // authorize gate covers per-verb auth and the extension-scope
    // block — no protocol layer between the LLM voice and the handler.
    const handler = getToolHandler(resolvedToolName);
    if (typeof handler !== "function") {
      throw new Error(`Tool "${resolvedToolName}" has no registered handler`);
    }
    // Per-call context for the handler. Carries the ambient moment so
    // a tool that delegates to doVerb / beVerb can thread summonCtx
    // and the Fact rides the open Act. Without this every extension
    // tool would have to repack ctx fields from args by hand and
    // forgetting throws "missing ambient actId" mid-stream.
    // Thread the live moment ctx so a tool that delegates to
    // doVerb/summonVerb/beVerb pushes its Fact onto THIS moment's ΔF.
    // ctx.summonCtx is the deltaF/foldedSeqs/afterSeal-bearing object
    // assign built and the seal drains; we spread it (preserving the
    // deltaF/afterSeal array references and the foldedSeqs Map) and add
    // the wake/reply fields the seed summon tool reads. Rebuilding a
    // deltaF-less copy here was the bug: the handler's emitFact then
    // self-sealed its Fact outside the moment and the Act orphaned. The
    // minimal fallback covers standalone tool paths with no live moment.
    const liveCtx = ctx.summonCtx || null;
    const callCtx = {
      identity: { beingId: ctx.beingId, name: ctx.username || null },
      summonCtx: liveCtx
        ? {
            ...liveCtx,
            rootActId: liveCtx.rootActId || ctx.rootActId || ctx.actId || null,
            ibpAddress: liveCtx.ibpAddress || presenceKey || null,
            wakeFrom: liveCtx.wakeFrom || ctx.wakeFrom || null,
            wakeCorrelation: liveCtx.wakeCorrelation || ctx.wakeCorrelation || null,
            spaceId: liveCtx.spaceId || ctx.currentSpace || ctx.rootId || null,
          }
        : {
            actId: ctx.actId || null,
            sessionId: ctx.sessionId || null,
            rootActId: ctx.rootActId || ctx.actId || null,
            ibpAddress: presenceKey || null,
            wakeFrom: ctx.wakeFrom || null,
            wakeCorrelation: ctx.wakeCorrelation || null,
            spaceId: ctx.currentSpace || ctx.rootId || null,
          },
    };
    const nodeToolTimeout =
      session._nodeLlmConfig?.toolCallTimeout ?? getToolCallTimeoutMs();
    const result = await Promise.race([
      Promise.resolve(handler(args, callCtx)),
      new Promise((_, reject) =>
        setTimeout(
          () =>
            reject(
              new Error(
                `Tool "${resolvedToolName}" timed out after ${nodeToolTimeout / 1000}s`,
              ),
            ),
          nodeToolTimeout,
        ),
      ),
    ]);
    let resultText =
      typeof result === "string" ? result : JSON.stringify(result);
    // Cap the result before it joins history. The full answer
    // already informed this turn; only the historical copy gets
    // truncated, so future turns don't drag a megabyte of file dump
    // across the wire on every call.
    const nodeResultMax =
      session._nodeLlmConfig?.toolResultMaxBytes ?? getToolResultMaxBytes();
    if (resultText && Buffer.byteLength(resultText, "utf8") > nodeResultMax) {
      const charEstimate = Math.floor(nodeResultMax * 0.9);
      resultText =
        resultText.slice(0, charEstimate) +
        `\n... (truncated, result exceeded ${Math.round(nodeResultMax / 1024)}KB)`;
    }

    session.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: resultText,
    });

    // Success clears the breaker. One transient failure shouldn't
    // disable a tool for the rest of the turn.
    delete session._toolFailures[resolvedToolName];

    hooks
      .run("afterToolCall", {
        toolName: resolvedToolName,
        args,
        result: resultText,
        success: true,
        beingId: ctx.beingId,
        rootId: ctx.rootId,
        role: session.role?.name,
        actId: _toolActId,
        sessionId: _toolSessionId,
        spaceId: getCurrentSpace(ctx.beingId) || ctx.rootId || null,
      })
      .catch(() => {});

    // The full text rides back on the return so the Act row can
    // archive what actually ran. Callers that only need success/fail
    // ignore it; the extra field costs nothing.
    return { tool: resolvedToolName, args, result: resultText, success: true };
  } catch (err) {
    log.error("LLM", `❌ Tool ${resolvedToolName} failed:`, err.message);

    session._toolFailures[resolvedToolName] =
      (session._toolFailures[resolvedToolName] || 0) + 1;
    if (session._toolFailures[resolvedToolName] >= toolCircuitThreshold) {
      log.warn(
        "LLM",
        `Tool "${resolvedToolName}" tripped after ${toolCircuitThreshold} consecutive failures. Disabled for this session.`,
      );
    }

    // If Mongo died during the call, the error shape is misleading;
    // rewrite the message so the AI knows the cause.
    const errorMsg = !isDbHealthy()
      ? "Database became unavailable during this operation. Tell the user the place is experiencing issues."
      : err.message;

    session.messages.push({
      role: "tool",
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: errorMsg }),
    });

    hooks
      .run("afterToolCall", {
        toolName: resolvedToolName,
        args,
        error: err.message,
        success: false,
        beingId: ctx.beingId,
        rootId: ctx.rootId,
        role: session.role?.name,
        actId: _toolActId,
        sessionId: _toolSessionId,
        spaceId: getCurrentSpace(ctx.beingId) || ctx.rootId || null,
      })
      .catch(() => {});

    return {
      tool: resolvedToolName,
      args,
      success: false,
      error: err.message,
    };
  }
}
