// TreeOS Seed . AGPL-3.0 . https://treeos.ai
import log from "../log.js";

// Tool definition registry. Extensions register tool schemas via registerToolDef().
// The kernel resolves tool names to schemas via resolveTools().
const toolDefs = {};

/**
 * Register a tool definition so resolveTools can find it.
 * Called by the extension loader when wiring MCP tools.
 */
export function registerToolDef(name, schema) {
  toolDefs[name] = schema;
}

const _warnedTools = new Set();

/**
 * Given an array of tool name strings, return the OpenAI tool definition array.
 */
export function resolveTools(toolNames) {
  return toolNames.map((name) => {
    const def = toolDefs[name];
    if (!def) {
      if (!_warnedTools.has(name)) {
        _warnedTools.add(name);
        log.warn("Tools", `Unknown tool: ${name} (skipped)`);
      }
      return null;
    }
    return def;
  }).filter(Boolean);
}
