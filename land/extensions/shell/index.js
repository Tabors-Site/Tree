import log from "../../core/log.js";
import getTools from "./tools.js";

export async function init(core) {
  log.warn("Shell", "Shell extension loaded. AI has full system access for god-tier users.");

  return {
    tools: getTools(),
  };
}
