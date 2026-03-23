import log from "../../core/log.js";
import getTools from "./tools.js";

export async function init(core) {
  log.warn("TreeCLI", "Tree CLI extension loaded. AI can execute CLI commands for god-tier users.");

  return {
    tools: getTools(),
  };
}
