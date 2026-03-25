import log from "../../seed/log.js";
import { buildNavigationHandler } from "./navigation.js";

// Tree modes
import treeNavigate from "./modes/tree/navigate.js";
import treeStructure from "./modes/tree/structure.js";
import treeEdit from "./modes/tree/edit.js";
import treeRespond from "./modes/tree/respond.js";
import treeLibrarian from "./modes/tree/librarian.js";
import treeGetContext from "./modes/tree/getContext.js";
import treeBe from "./modes/tree/be.js";
import treeNotes from "./modes/tree/notes.js";

// Home modes
import homeDefault from "./modes/home/default.js";
import homeReflect from "./modes/home/reflect.js";

// Tools (the full TOOL_DEFS catalog)
import TOOL_DEFS from "./tools.js";

export async function init(core) {
  // Register all tree modes
  core.modes.registerMode("tree:navigate", treeNavigate, "treeos");
  core.modes.registerMode("tree:structure", treeStructure, "treeos");
  core.modes.registerMode("tree:edit", treeEdit, "treeos");
  core.modes.registerMode("tree:respond", treeRespond, "treeos");
  core.modes.registerMode("tree:librarian", treeLibrarian, "treeos");
  core.modes.registerMode("tree:getContext", treeGetContext, "treeos");
  core.modes.registerMode("tree:be", treeBe, "treeos");
  core.modes.registerMode("tree:notes", treeNotes, "treeos");

  // Register home modes
  core.modes.registerMode("home:default", homeDefault, "treeos");
  core.modes.registerMode("home:reflect", homeReflect, "treeos");

  // Upgrade defaults from fallback to real modes
  core.modes.setDefaultMode("home", "home:default");
  core.modes.setDefaultMode("tree", "tree:navigate");

  // Build tool array from TOOL_DEFS for MCP registration
  const tools = Object.values(TOOL_DEFS).map(def => ({
    name: def.function?.name || def.name,
    description: def.function?.description || def.description || "",
    inputSchema: def.function?.parameters || def.parameters || { type: "object", properties: {} },
    annotations: def.function?.annotations || def.annotations || {},
  }));

  // Register afterToolCall hook for frontend navigation
  const onAfterToolCall = buildNavigationHandler(core);
  core.hooks.register("afterToolCall", onAfterToolCall, "treeos");

  log.info("TreeOS", `Registered ${Object.keys(TOOL_DEFS).length} tools, 10 modes, navigation hook`);

  return {
    tools,
    exports: { TOOL_DEFS },
  };
}
