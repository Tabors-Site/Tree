/**
 * Browser Bridge
 *
 * The AI sees and acts through the user's browser.
 * Chrome extension connects via a separate Socket.IO namespace (/browser-bridge).
 * Server-side tools bridge AI calls to browser actions.
 * Confined scope. Site-scoped. Approve-gated. Logged.
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

  // ── Separate Socket.IO namespace for browser bridge ───────────────
  // Keeps browser-bridge traffic isolated from the main dashboard WebSocket.
  const io = core.websocket.getIO?.();
  if (io) {
    const ns = io.of("/browser-bridge");

    // Auth middleware: validate API key or username+password on connect
    ns.use(async (socket, next) => {
      try {
        const auth = socket.handshake.auth || {};
        const { apiKey, username, password } = auth;

        if (!apiKey && !(username && password)) {
          return next(new Error("API key or username + password required"));
        }

        let userId = null;

        // Method 1: API key
        if (apiKey) {
          try {
            const { getUserMeta } = await import("../../seed/tree/userMetadata.js");
            const { default: bcryptMod } = await import("bcrypt");
            const prefix = apiKey.slice(0, 8);
            const candidates = await User.find({
              "metadata.apiKeys": { $elemMatch: { keyPrefix: prefix, revoked: { $ne: true } } },
            }).select("_id username metadata");

            for (const user of candidates) {
              const keys = getUserMeta(user, "apiKeys");
              if (!Array.isArray(keys)) continue;
              for (const key of keys) {
                if (key.revoked || key.keyPrefix !== prefix) continue;
                if (await bcryptMod.compare(apiKey, key.keyHash)) {
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

        // Method 2: username + password
        if (!userId && username && password) {
          try {
            const { default: bcryptMod } = await import("bcrypt");
            const user = await User.findOne({ username }).select("_id username password");
            if (user && await bcryptMod.compare(password, user.password)) {
              userId = String(user._id);
              socket.username = user.username;
            }
          } catch (err) {
            log.warn("BrowserBridge", `Password auth error: ${err.message}`);
          }
        }

        if (!userId) return next(new Error("Authentication failed"));

        socket.userId = userId;
        socket._browserBridge = true;
        next();
      } catch (err) {
        next(new Error("Auth error: " + err.message));
      }
    });

    // Connection handler
    ns.on("connection", (socket) => {
      const userId = socket.userId;
      log.info("BrowserBridge", `Namespace connection from ${userId}`);

      registerConnection(userId, socket);
      socket.emit("browserAuthResult", { success: true });

      // Response handlers: resolve pending requests from AI tool calls
      const responseEvents = ["pageState", "actionResult", "screenshot", "networkLog", "tabsList"];
      for (const event of responseEvents) {
        socket.on(event, (data) => {
          if (data?.requestId) {
            resolveRequest(data.requestId, data.data || data);
          }
        });
      }

      // Unprompted: user navigated to a new page
      socket.on("pageNavigated", (data) => {
        if (data?.url) {
          setCurrentUrl(userId, data.url);
          log.verbose("BrowserBridge", `${userId} navigated to ${data.url}`);
        }
      });
    });

    log.info("BrowserBridge", "Socket.IO namespace /browser-bridge created");
  } else {
    log.warn("BrowserBridge", "WebSocket server not available. Chrome extension will not work.");
  }

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

  // ── afterScopeChange: auto-set browser-agent mode when allowed ──────
  core.hooks.register("afterScopeChange", async ({ nodeId, allowed }) => {
    if (!allowed || !Array.isArray(allowed)) return;
    if (!allowed.includes("browser-bridge")) return;
    try {
      const { setExtMeta } = await import("../../seed/tree/extensionMetadata.js");
      const node = await core.models.Node.findById(nodeId);
      if (!node) return;
      const modes = node.metadata instanceof Map ? node.metadata.get("modes") : node.metadata?.modes;
      if (!modes?.respond) {
        await setExtMeta(node, "modes", { ...(modes || {}), respond: "tree:browser-agent" });
        log.info("BrowserBridge", `Auto-set browser-agent mode on ${nodeId}`);
      }
    } catch {}
  }, "browser-bridge");

  // ── enrichContext: tell AI browser is available ─────────────────────

  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const bbMeta = meta?.["browser-bridge"];
    context.browserBridge = {
      available: true,
      note: "BROWSER BRIDGE IS ACTIVE. You control the user's REAL browser. " +
        "To interact with websites use BROWSER tools, NOT tree tools. " +
        "browser-read = see the actual webpage content and elements. " +
        "browser-click = click a real element on the website. " +
        "browser-type = type into a real input on the website. " +
        "browser-navigate = go to a real URL. " +
        "browser-comment = post a comment/reply on social sites (handles the full flow automatically). " +
        "Tree tools (create-node, create-note) only affect the tree, NOT websites. " +
        "To post a comment or reply, use browser-comment with the text. " +
        "Always call browser-read first to understand the page.",
    };
    if (bbMeta?.autoApprove?.length) {
      context.browserBridge.autoApprovedSites = bbMeta.autoApprove;
    }
    if (bbMeta?.blocked?.length) {
      context.browserBridge.blockedSites = bbMeta.blocked;
    }
  }, "browser-bridge");

  // Register browser agent mode
  const { default: agentMode } = await import("./modes/agent.js");
  core.modes.registerMode("tree:browser-agent", agentMode, "browser-bridge");

  log.info("BrowserBridge", "Loaded. Confined. The AI can see and act through the browser.");

  return {
    tools: getTools(),
    modeTools: [
      { modeKey: "tree:browser-agent", toolNames: ["browser-read", "browser-click", "browser-type", "browser-navigate", "browser-comment"] },
      { modeKey: "tree:respond", toolNames: ["browser-read", "browser-click", "browser-type", "browser-navigate", "browser-comment"] },
      { modeKey: "tree:librarian", toolNames: ["browser-read", "browser-click", "browser-type", "browser-navigate", "browser-comment"] },
    ],
    exports: {
      isConnected,
      sendRequest,
      checkSiteAccess,
      getCurrentUrl,
    },
  };
}
