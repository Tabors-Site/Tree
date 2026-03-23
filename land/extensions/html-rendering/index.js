import crypto from "crypto";
import router, { pageRouter } from "./routes.js";
import { renderLoginPage, renderRegisterPage, renderForgotPasswordPage } from "./pages.js";
import * as renderers from "./renderers.js";
import { resolveHtmlShareAccess } from "./shareAuth.js";

function generateShareToken() {
  return crypto.randomBytes(16).toString("base64url");
}

/**
 * Register an HTML page route on the page router (mounted at /, not /api/v1).
 * Other extensions call this to add their own server-rendered pages.
 *
 * @param {string} method - HTTP method: "get", "post", etc.
 * @param {string} path - Route path, e.g. "/my-dashboard"
 * @param  {...Function} handlers - Express middleware/handler(s)
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

  // Generate share token for new users
  core.hooks.register("afterRegister", async ({ user }) => {
    const freshUser = await User.findById(user._id);
    if (!freshUser) return;
    const { getUserMeta, setUserMeta } = await import("../../core/tree/userMetadata.js");
    const existing = getUserMeta(freshUser, "html");
    if (existing?.shareToken) return; // already has one
    setUserMeta(freshUser, "html", { ...existing, shareToken: generateShareToken() });
    await freshUser.save();
  }, "html-rendering");

  return {
    router,
    pageRouter,
    exports: {
      renderLoginPage,
      renderRegisterPage,
      renderForgotPasswordPage,
      resolveHtmlShareAccess,
      registerPage,
      ...renderers,
    },
  };
}
