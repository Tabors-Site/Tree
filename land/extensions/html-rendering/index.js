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

  // Share token and public tree access are handled by urlAuth directly.
  // They are NOT registered as kernel auth strategies because they provide
  // view-only access to HTML pages. The kernel's authenticate middleware
  // should only accept full credentials (JWT, API keys). If share tokens
  // were in the kernel pipeline, any POST route using authenticate would
  // accept them and allow mutations.

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
