import log from "../../seed/log.js";
import tools from "./tools.js";
import {
  setServices, getEffectiveWatchlist, createRequest,
  getPendingRequests, resolveRequest,
} from "./core.js";

export async function init(core) {
  // Wire services
  const notificationModel = core.models.Notification || null;
  setServices({
    websocket: core.websocket || null,
    notifications: notificationModel,
    gateway: null, // accessed dynamically in core.js
    metadata: core.metadata,
  });

  // beforeToolCall: intercept watched tools
  core.hooks.register("beforeToolCall", async (hookData) => {
    const { toolName, args, userId, rootId } = hookData;
    const nodeId = args?.nodeId || rootId;
    if (!nodeId || !toolName) return;

    // Check if this tool is on the effective watchlist
    const watched = await getEffectiveWatchlist(nodeId);
    if (!watched.has(toolName)) return;

    // Freeze the tool call. The hook system will wait for this to resolve.
    log.verbose("Approve", `Freezing tool call: ${toolName} (waiting for operator approval)`);

    const { id, promise } = createRequest({
      toolName,
      args,
      nodeId,
      userId,
      rootId,
    });

    // Wait for operator decision. This blocks the tool call.
    // The beforeToolCall hook supports async. The conversation loop
    // waits for all before hooks to resolve before executing the tool.
    try {
      const result = await promise;
      if (!result.approved) {
        hookData.cancelled = true;
        hookData.reason = "Rejected by operator";
      }
      // approved: hook returns normally, tool call proceeds
    } catch (err) {
      // Rejected or timed out
      hookData.cancelled = true;
      hookData.reason = err.message || "Approval denied";
    }
  }, "approve");

  // enrichContext: let the AI know there's a watchlist active
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const approveMeta = meta?.approve;
    if (!approveMeta?.watchlist?.length) return;

    context.toolApproval = {
      watchedTools: approveMeta.watchlist,
      note: "These tools require operator approval before execution. The call will pause until approved.",
    };
  }, "approve");

  const { default: router } = await import("./routes.js");

  log.verbose("Approve", "Approve loaded");

  return {
    router,
    tools,
    exports: {
      getEffectiveWatchlist,
      getPendingRequests,
      resolveRequest,
    },
  };
}
