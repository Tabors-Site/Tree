export async function init(core) {
  // Access declared services via core.*
  // core.models.Node, core.energy.useEnergy(), etc.

  // Register hooks (always available, no need to declare in needs)
  // core.hooks.register("enrichContext", async ({ context, node, meta }) => {
  //   const data = meta["my-extension"] || {};
  //   if (Object.keys(data).length > 0) context.myExtension = data;
  // }, "my-extension");

  // Store per-node data in metadata (not on the Node schema):
  // import { getExtMeta, setExtMeta } from "../../core/tree/extensionMetadata.js";
  // const data = getExtMeta(node, "my-extension");
  // setExtMeta(node, "my-extension", { key: "value" });
  // await node.save();

  return {
    // router,    // Express router, mounted at /api/v1
    // tools,     // MCP tool definitions for AI
    // modeTools, // Inject tools into existing conversation modes
    // jobs,      // Background jobs with start/stop
  };
}
