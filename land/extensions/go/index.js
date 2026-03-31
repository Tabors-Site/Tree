import log from "../../seed/log.js";
import tools from "./tools.js";
import { configure, findDestination, listPositions } from "./core.js";

export async function init(core) {
  // Wire dependencies
  try {
    const { getExtension } = await import("../loader.js");
    configure({ getExtension });
  } catch {}

  const { default: router } = await import("./routes.js");

  // Tool handler
  const toolHandlers = {
    "go-to": async ({ destination }, { userId }) => {
      if (!destination) {
        const { trees, extensions } = await listPositions(userId);
        let out = "";
        if (trees.length > 0) out += "Trees:\n" + trees.map(t => `  ${t.name}`).join("\n");
        if (extensions.length > 0) out += (out ? "\n\n" : "") + "Extensions:\n" + extensions.map(e => `  ${e.name}  ${e.path}`).join("\n");
        return out || "No trees found.";
      }

      const result = await findDestination(destination, userId);

      if (!result.found) {
        return `No match for "${destination}". Try 'go' with no arguments to see all positions.`;
      }

      if (result.ambiguous) {
        return "Multiple matches:\n" + result.options.map(o => `  ${o.path}${o.extension ? ` (${o.extension})` : ""}`).join("\n") + "\nBe more specific.";
      }

      const dest = result.destination;
      return JSON.stringify({
        _navigate: dest.nodeId,
        answer: `Navigating to ${dest.path}`,
      });
    },
  };

  log.info("Go", "Loaded. Navigate by intent.");

  return {
    router,
    tools,
    toolHandlers,
    exports: { findDestination, listPositions },
  };
}
