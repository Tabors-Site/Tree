import log from "../../seed/log.js";
import { buildNavigationHandler } from "./navigation.js";
import { buildTools } from "./handlers.js";

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

// Tools (OpenAI-format TOOL_DEFS for mode toolNames resolution)
import TOOL_DEFS from "./tools.js";

export async function init(core) {
  const { setModels, setCommandResolver } = await import("./handlers.js");
  setModels(core.models);

  // Wire extension CLI command resolution for get-tree responses.
  // The home AI calls get-tree and sees availableCommands so it can give
  // specific directions ("fitness 'pushups 20'" not "note ...").
  setCommandResolver(async (nodeId) => {
    try {
      const { getLoadedExtensionNames, getExtensionManifest } = await import("../loader.js");
      const { isExtensionBlockedAtNode } = await import("../../seed/tree/extensionScope.js");
      const cmds = [];
      for (const name of getLoadedExtensionNames()) {
        const manifest = getExtensionManifest(name);
        if (!manifest?.provides?.cli?.length) continue;
        if (await isExtensionBlockedAtNode(name, nodeId)) continue;
        for (const cli of manifest.provides.cli) {
          const cmd = cli.command?.split(" ")[0];
          if (cmd) cmds.push(`${cmd}: ${cli.description || name}`);
        }
      }
      return cmds;
    } catch { return []; }
  });
  // Register all tree modes
  core.modes.registerMode("tree:navigate", treeNavigate, "treeos");
  core.modes.registerMode("tree:structure", treeStructure, "treeos");
  core.modes.registerMode("tree:edit", treeEdit, "treeos");
  core.modes.registerMode("tree:respond", treeRespond, "treeos");
  core.modes.registerMode("tree:librarian", treeLibrarian, "treeos");
  core.modes.registerMode("tree:get-context", treeGetContext, "treeos");
  core.modes.registerMode("tree:be", treeBe, "treeos");
  core.modes.registerMode("tree:notes", treeNotes, "treeos");

  // Register home modes
  core.modes.registerMode("home:default", homeDefault, "treeos");
  core.modes.registerMode("home:reflect", homeReflect, "treeos");

  // Upgrade defaults from fallback to real modes
  core.modes.setDefaultMode("home", "home:default");
  core.modes.setDefaultMode("tree", "tree:navigate");

  // Build MCP tools with zod schemas and handlers
  const tools = buildTools();

  // Register afterToolCall hook for frontend navigation
  const onAfterToolCall = buildNavigationHandler(core);
  core.hooks.register("afterToolCall", onAfterToolCall, "treeos");

  log.info("TreeOS", `Registered ${tools.length} tools, 10 modes, navigation hook`);

  return {
    tools,
    exports: { TOOL_DEFS },
  };
}
