import log from "../../seed/log.js";
import { clean } from "./clean.js";

export async function init(core) {
  // Clean AI responses (emojis, whitespace, filler)
  core.hooks.register("beforeResponse", async (data) => {
    if (data.content && typeof data.content === "string") {
      data.content = clean(data.content);
    }
  }, "llm-response-formatting");

  // Normalize tool names against registered tools.
  // Some models generate tool calls with underscores (navigate_tree) instead
  // of hyphens (navigate-tree), or with slight misspellings. This hook finds
  // the closest matching registered tool name before it reaches MCP.
  const { resolveTools } = await import("../../seed/tools.js");
  const { getToolsForMode } = await import("../../seed/modes/registry.js");

  core.hooks.register("beforeToolCall", async (data) => {
    if (!data.toolName) return;
    // Try the name as-is first (fast path)
    const exact = resolveTools([data.toolName]);
    if (exact.length > 0) return;

    // Try replacing underscores with hyphens
    const hyphenated = data.toolName.replace(/_/g, "-");
    const hyphenMatch = resolveTools([hyphenated]);
    if (hyphenMatch.length > 0) {
      log.debug("Formatting", `Tool name normalized: ${data.toolName} -> ${hyphenated}`);
      data.toolName = hyphenated;
    }
  }, "llm-response-formatting");

  log.verbose("Formatting", "Response cleaning + tool name normalization active");

  return {};
}
