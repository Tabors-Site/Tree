/**
 * Browser Bridge
 *
 * The AI sees and acts through the user's browser.
 * Chrome extension connects via Socket.IO. Server-side tools bridge AI calls
 * to browser actions. Confined scope. Site-scoped. Approve-gated. Logged.
 */

import log from "../../seed/log.js";
import {
  configure,
  registerConnection,
  resolveRequest,
  setCurrentUrl,
  isConnected,
  sendRequest,
  checkSiteAccess,
  getCurrentUrl,
} from "./core.js";
import getTools from "./tools.js";

const WRITE_TOOLS = new Set([
  "browser-click",
  "browser-type",
  "browser-navigate",
  "browser-scroll",
]);

export async function init(core) {
  configure({
    metadata: core.metadata,
    Node: core.models.Node,
  });

  // ── Socket.IO event handlers for Chrome extension ──────────────────

  // Auth: Chrome extension sends API key after connecting
  core.websocket.registerSocketHandler("browserAuth", async ({ socket, data }) => {
    try {
      const apiKey = data?.apiKey;
      if (!apiKey) {
        socket.emit("browserAuthResult", { success: false, error: "API key required" });
        return;
      }

      // Validate API key against api-keys extension or user lookup
      let userId = null;
      try {
        const { getExtension } = await import("../loader.js");
        const apiKeysExt = getExtension("api-keys");
        if (apiKeysExt?.exports?.validateApiKey) {
          const result = await apiKeysExt.exports.validateApiKey(apiKey);
          if (result?.userId) userId = result.userId;
        }
      } catch {}

      // Fallback: check if apiKey matches any user's stored key
      if (!userId) {
        try {
          const User = core.models.User;
          const user = await User.findOne({
            "metadata.api-keys.keys.key": apiKey,
          }).select("_id username").lean();
          if (user) userId = String(user._id);
        } catch {}
      }

      if (!userId) {
        socket.emit("browserAuthResult", { success: false, error: "Invalid API key" });
        return;
      }

      // Set userId on socket (doesn't affect authSessions since it was null on connect)
      socket.userId = userId;
      socket._browserBridge = true;

      registerConnection(userId, socket);
      socket.emit("browserAuthResult", { success: true });
    } catch (err) {
      socket.emit("browserAuthResult", { success: false, error: err.message });
    }
  });

  // Response handlers: resolve pending requests from AI tool calls
  const responseEvents = ["pageState", "actionResult", "screenshot", "networkLog", "tabsList"];
  for (const event of responseEvents) {
    core.websocket.registerSocketHandler(event, ({ data }) => {
      if (data?.requestId) {
        resolveRequest(data.requestId, data.data || data);
      }
    });
  }

  // Unprompted: user navigated to a new page
  core.websocket.registerSocketHandler("pageNavigated", ({ socket, data }) => {
    const userId = socket.userId;
    if (!userId || !socket._browserBridge) return;
    if (data?.url) {
      setCurrentUrl(userId, data.url);
      log.verbose("BrowserBridge", `${userId} navigated to ${data.url}`);
    }
  });

  // ── beforeToolCall: site scoping guard ─────────────────────────────

  core.hooks.register("beforeToolCall", async (hookData) => {
    const { toolName, args, userId } = hookData;
    if (!WRITE_TOOLS.has(toolName)) return;

    const nodeId = args?.nodeId;
    if (!nodeId) return;

    const url = toolName === "browser-navigate" ? args?.url : getCurrentUrl(userId);
    if (!url) return;

    const access = await checkSiteAccess(nodeId, url);
    if (access.blocked) {
      hookData.cancelled = true;
      hookData.reason = `Browser action blocked: ${access.reason}`;
    }
  }, "browser-bridge");

  // ── enrichContext: tell AI browser is available ─────────────────────

  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const bbMeta = meta?.["browser-bridge"];
    // Only inject if the extension is active at this position
    // (spatial scoping already filters hooks, so if we're here, it's allowed)
    context.browserBridge = {
      available: true,
      note: "Browser bridge is active at this position. Use browser-get-state to see the current page. Always get state before clicking or typing.",
    };
    if (bbMeta?.autoApprove?.length) {
      context.browserBridge.autoApprovedSites = bbMeta.autoApprove;
    }
    if (bbMeta?.blocked?.length) {
      context.browserBridge.blockedSites = bbMeta.blocked;
    }
  }, "browser-bridge");

  log.info("BrowserBridge", "Loaded. Confined. The AI can see and act through the browser.");

  return {
    tools: getTools(),
    exports: {
      isConnected,
      sendRequest,
      checkSiteAccess,
      getCurrentUrl,
    },
  };
}
