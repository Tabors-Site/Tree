import log from "../../seed/log.js";

export async function init(core) {
  // Logging: use log.info/verbose/debug/warn/error instead of console.log
  // log.info("MyExt", "Job started");
  // log.verbose("MyExt", "Processing...");
  // log.debug("MyExt", "Detail...");

  // Access declared services via core.*
  // core.models.Node, core.energy.useEnergy(), etc.

  // Register hooks (always available, no need to declare in needs)
  // core.hooks.register("enrichContext", async ({ context, node, meta }) => {
  //   const data = meta["my-extension"] || {};
  //   if (Object.keys(data).length > 0) context.myExtension = data;
  // }, "my-extension");

  // Store per-node data in metadata (use core.metadata, never import directly):
  // const data = core.metadata.getExtMeta(node, "my-extension");
  // await core.metadata.setExtMeta(node, "my-extension", { key: "value" });
  // await core.metadata.incExtMeta(nodeId, "my-extension", "counter", 1);
  // await core.metadata.pushExtMeta(nodeId, "my-extension", "history", item, 50);
  // await core.metadata.batchSetExtMeta(nodeId, "my-extension", { a: 1, b: 2 });
  // await core.metadata.unsetExtMeta(nodeId, "my-extension");
  //
  // User metadata (same pattern):
  // const prefs = core.userMetadata.getUserMeta(user, "my-extension");
  // await core.userMetadata.incUserMeta(userId, "my-extension", "visits", 1);

  // Register custom AI modes (see manifest.js for declaration)
  // core.modes.registerMode("tree:my-mode", {
  //   emoji: "🔬",
  //   label: "My Mode",
  //   bigMode: "tree",
  //   toolNames: ["my-tool-1", "my-tool-2"],
  //   buildSystemPrompt({ username, rootId, currentNodeId }) {
  //     return `You are a custom agent for ${username}. Do something special.`;
  //   },
  // }, "my-extension");

  return {
    // router,       // Express router, mounted at /api/v1
    // tools,        // MCP tool definitions for AI
    // modes,        // Custom AI conversation modes [{key, handler}]
    // modeTools,    // Inject tools into existing conversation modes
    // jobs,         // Background jobs with start/stop
    // orchestrator, // Replace the conversation orchestrator for a bigMode:
    // orchestrator: {
    //   bigMode: "tree",  // which bigMode to intercept
    //   async handle({ visitorId, message, socket, userId, sessionId, ...ctx }) {
    //     // Full control over chat/place/query flow
    //     // Use core.conversation.processMessage() for LLM calls
    //   },
    // },
  };
}
