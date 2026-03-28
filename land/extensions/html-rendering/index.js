/**
 * HTML Rendering (Infrastructure)
 *
 * Server-rendered HTML pages for TreeOS lands. Provides:
 * - page() layout wrapper with shared CSS
 * - ?html intercept on API routes (delegates to registered renderers)
 * - URL-based auth (share tokens, cookie auth)
 * - registerPage() for extensions to mount their own pages
 * - registerRenderer() for extensions to provide ?html renderers
 *
 * This extension is infrastructure. It ships no pages of its own.
 * The treeos extension (or any OS distribution) registers its pages here.
 */

import crypto from "crypto";
import router, { pageRouter } from "./routes.js";
import { resolveHtmlShareAccess } from "./shareAuth.js";
import urlAuth from "./urlAuth.js";
import authenticateLite from "./authenticateLite.js";
import { notFoundPage, errorHtml } from "./notFoundPage.js";
import { resolvePublicRoot, isPublic, hasTreeLlm } from "./publicAccess.js";
import { isHtmlEnabled } from "./config.js";
import { sendError, ERR } from "../../seed/protocol.js";

function generateShareToken() {
  return crypto.randomBytes(16).toString("base64url");
}

/**
 * Register an HTML page route on the page router (mounted at /, not /api/v1).
 * Other extensions call this to add their own server-rendered pages.
 */
function registerPage(method, path, ...handlers) {
  const m = method.toLowerCase();
  if (typeof pageRouter[m] !== "function") {
    throw new Error(`Invalid HTTP method: ${method}`);
  }
  pageRouter[m](path, ...handlers);
}

export async function init(core) {
  const User = core.models.User;

  // Register share token auth strategy
  core.auth.registerStrategy("shareToken", async (req) => {
    const token = req.query?.token || req.headers?.["x-share-token"];
    if (!token) return null;
    const userId = req.params?.userId;
    const nodeId = req.params?.nodeId || req.params?.rootId;
    const result = await resolveHtmlShareAccess({ userId, nodeId, shareToken: token });
    if (!result.allowed) return null;
    return {
      userId: result.matchedUserId,
      username: result.matchedUsername,
      extra: { isHtmlShare: true, shareScope: result.scope },
    };
  });

  // Register public tree access strategy
  core.auth.registerStrategy("publicAccess", async (req) => {
    const nodeId = req.params?.nodeId || req.params?.rootId;
    if (!nodeId) return null;
    const rootInfo = await resolvePublicRoot(nodeId);
    if (!rootInfo || !isPublic(rootInfo.visibility)) return null;
    return {
      userId: null,
      username: null,
      extra: {
        isPublicAccess: true,
        publicRootId: rootInfo.rootId,
        publicRootOwner: rootInfo.rootOwner,
        publicLlmDefault: rootInfo.llmDefault,
      },
    };
  });

  // Write default htmlEnabled to .config if not set
  const { getLandConfigValue, setLandConfigValue } = await import("../../seed/landConfig.js");
  if (getLandConfigValue("htmlEnabled") === undefined || getLandConfigValue("htmlEnabled") === null) {
    const envVal = process.env.ENABLE_FRONTEND_HTML === "false" ? "false" : "true";
    await setLandConfigValue("htmlEnabled", envVal);
  }

  // Generate share token for new users
  core.hooks.register("afterRegister", async ({ user }) => {
    const freshUser = await User.findById(user._id);
    if (!freshUser) return;
    const existing = core.userMetadata.getUserMeta(freshUser, "html");
    if (existing?.shareToken) return;
    core.userMetadata.setUserMeta(freshUser, "html", { ...existing, shareToken: generateShareToken() });
    await freshUser.save();
  }, "html-rendering");

  return {
    router,
    pageRouter,
    exports: {
      // Infrastructure (reusable by any OS distribution)
      registerPage,
      urlAuth,
      authenticateLite,
      notFoundPage,
      errorHtml,
      resolveHtmlShareAccess,
      resolvePublicRoot,
      isPublic,
      hasTreeLlm,
    },
  };
}
