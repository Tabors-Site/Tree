import log from "../../seed/log.js";
import getForgeTools from "./tools.js";
import forgeShipMode from "./modes/forge-ship.js";

export async function init(core) {
  // Optional LLM slot so operators can pin a quality model to forge-ship.
  // Safe no-op if llm slot registration isn't available in this build.
  try { core.llm?.registerRootLlmSlot?.("forge-ship"); } catch {}

  // Register the showcase mode.
  core.modes.registerMode("tree:forge-ship", forgeShipMode, "code-forge");
  try {
    core.llm?.registerModeAssignment?.("tree:forge-ship", "forge-ship");
  } catch {}

  // Surface forge metadata in enrichContext so a forge node tells the AI
  // which extension it's authoring. Extensions read from meta["code-forge"]
  // via the services bundle; nothing here imports mongoose.
  core.hooks.register(
    "enrichContext",
    async ({ context, meta }) => {
      const forge = meta?.["code-forge"];
      if (!forge || typeof forge !== "object") return;
      context.forge = {
        name: forge.name || null,
        version: forge.version || null,
        description: forge.description || null,
        installed: !!forge.installed,
        restartRequired: !!forge.restartRequired,
      };
    },
    "code-forge",
  );

  log.info("Forge", "Loaded. Trees can now scaffold, test, install, and dry-run-publish TreeOS extensions.");

  // Forge tools are exposed through the tree:forge-ship mode only.
  // Routing reaches that mode via the confined-extension branch of
  // tree-orchestrator/routingIndex.js once an operator runs
  // `ext-allow code-forge` at a tree root. We deliberately do NOT
  // inject forge tools into tree:converse or tree:librarian because
  // (a) forge has its own dedicated mode with the full workflow prompt
  // and (b) forge is confined, so tools must not leak into generic modes.
  return {
    tools: getForgeTools(core),
  };
}
