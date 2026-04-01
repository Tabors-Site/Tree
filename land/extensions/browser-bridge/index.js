/**
 * Browser Bridge
 *
 * The AI sees and acts through the user's browser.
 * Chrome extension connects via Socket.IO. Server-side tools bridge AI calls
 * to browser actions. Confined scope. Site-scoped. Approve-gated. Logged.
 */

import log from "../../seed/log.js";
import User from "../../seed/models/user.js";
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
      if (!apiKey && !(data.username && data.password)) {
        socket.emit("browserAuthResult", { success: false, error: "API key or username + password required" });
        return;
      }

      let userId = null;
      const { username, password } = data;

      // Method 1: API key (if api-keys extension data exists)
      if (apiKey) {
        try {
          // User imported at top of file
          const { getUserMeta } = await import("../../seed/tree/userMetadata.js");
          const { default: bcryptMod } = await import("bcrypt");

          const prefix = apiKey.slice(0, 8);
          log.debug("BrowserBridge", `API key auth attempt, prefix: ${prefix}`);
          const candidates = await User.find({
            "metadata.apiKeys": {
              $elemMatch: { keyPrefix: prefix, revoked: { $ne: true } },
            },
          }).select("_id username metadata");

          log.debug("BrowserBridge", `Found ${candidates.length} candidates for prefix ${prefix}`);

          for (const user of candidates) {
            const keys = getUserMeta(user, "apiKeys");
            if (!Array.isArray(keys)) continue;
            for (const key of keys) {
              if (key.revoked || key.keyPrefix !== prefix) continue;
              const match = await bcryptMod.compare(apiKey, key.keyHash);
              if (match) {
                userId = String(user._id);
                socket.username = user.username;
                break;
              }
            }
            if (userId) break;
          }
        } catch (err) {
          log.warn("BrowserBridge", `API key auth error: ${err.message}`);
        }
      }

      // Method 2: username + password (always available, no extension needed)
      if (!userId && username && password) {
        try {
          // User imported at top of file
          const { default: bcryptMod } = await import("bcrypt");
          log.debug("BrowserBridge", `Password auth attempt for user: ${username}`);
          const user = await User.findOne({ username }).select("_id username password");
          if (user) {
            const match = await bcryptMod.compare(password, user.password);
            log.debug("BrowserBridge", `Password match for ${username}: ${match}`);
            if (match) {
              userId = String(user._id);
              socket.username = user.username;
            }
          } else {
            log.debug("BrowserBridge", `User not found: ${username}`);
          }
        } catch (err) {
          log.warn("BrowserBridge", `Password auth error: ${err.message}`);
        }
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
