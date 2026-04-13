/**
 * Todo
 *
 * Track todos as nodes in the tree. Each todo is a child node under a
 * Todo root, with completion status stored in metadata.todo.completed.
 */

import log from "../../seed/log.js";
import getTools from "./tools.js";

export async function init(core) {
  const tools = getTools({ Node: core.models.Node, metadata: core.metadata });

  log.info("Todo", "Loaded. Track todos as nodes.");

  return {
    tools,
  };
}
