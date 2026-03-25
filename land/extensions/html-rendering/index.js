import crypto from "crypto";
import router, { pageRouter } from "./routes.js";
import buildHtmlRoutes from "./htmlRoutes.js";
import appRouter from "./app/app.js";
import chatRouter from "./app/chat.js";
import setupRouter from "./app/setup.js";
import { renderLoginPage, renderRegisterPage, renderForgotPasswordPage } from "./pages.js";
import * as renderers from "./renderers.js";
import { resolveHtmlShareAccess } from "./shareAuth.js";
import urlAuth from "./urlAuth.js";
import authenticateLite from "./authenticateLite.js";
import { notFoundPage, errorHtml } from "./notFoundPage.js";
import { resolvePublicRoot, isPublic, hasTreeLlm } from "./publicAccess.js";
import { isHtmlEnabled } from "./config.js";

// Mount HTML intercept routes (handles ?html on kernel API paths)
const htmlRouter = buildHtmlRoutes({ urlAuth, renderers: { ...renderers, notFoundPage, errorHtml } });
router.use("/", htmlRouter);

// Mount app page routers onto the pageRouter so the loader wires them at /
pageRouter.use("/", appRouter);
pageRouter.use("/", chatRouter);
pageRouter.use("/", setupRouter);

// Canopy admin pages (HTML-only, moved from routes/canopy.js)
import authenticate from "../../seed/middleware/authenticate.js";
pageRouter.get("/canopy/admin", authenticate, async (req, res) => {
  if (!isHtmlEnabled()) return res.status(404).json({ error: "HTML disabled" });
  try {
    const user = await (await import("../../seed/models/user.js")).default.findById(req.userId).select("isAdmin").lean();
    if (!user?.isAdmin) return res.status(403).json({ error: "Admin required" });
    const { getAllPeers, getPendingEventCount, getFailedEvents } = await import("../../canopy/peers.js");
    const { getLandInfoPayload } = await import("../../canopy/identity.js");
    const peers = await getAllPeers();
    const { getPendingEventCount: getCount, getFailedEvents: getFailed } = await import("../../canopy/events.js");
    const pendingEvents = await getCount();
    const failedEvents = await getFailed();
    const land = getLandInfoPayload();
    res.send(renderers.renderCanopyAdmin({ land, peers, pendingEvents, failedEvents }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

pageRouter.get("/canopy/admin/directory", authenticate, async (req, res) => {
  if (!isHtmlEnabled()) return res.status(404).json({ error: "HTML disabled" });
  try {
    const user = await (await import("../../seed/models/user.js")).default.findById(req.userId).select("isAdmin").lean();
    if (!user?.isAdmin) return res.status(403).json({ error: "Admin required" });
    const hasDirectory = !!process.env.DIRECTORY_URL;
    res.send(renderers.renderCanopyDirectory({ hasDirectory }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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

  // Register share token auth strategy so authenticateOptional picks it up
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

  // Write default htmlEnabled to .config if not set (runtime-configurable)
  const { getLandConfigValue, setLandConfigValue } = await import("../../seed/landConfig.js");
  if (getLandConfigValue("htmlEnabled") === undefined || getLandConfigValue("htmlEnabled") === null) {
    const envVal = process.env.ENABLE_FRONTEND_HTML === "true" ? "true" : "false";
    await setLandConfigValue("htmlEnabled", envVal);
  }

  // Generate share token for new users
  core.hooks.register("afterRegister", async ({ user }) => {
    const freshUser = await User.findById(user._id);
    if (!freshUser) return;
    const { getUserMeta, setUserMeta } = await import("../../seed/tree/userMetadata.js");
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
      urlAuth,
      authenticateLite,
      notFoundPage,
      errorHtml,
      resolvePublicRoot,
      isPublic,
      hasTreeLlm,
      ...renderers,
    },
  };
}
