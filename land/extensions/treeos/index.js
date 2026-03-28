import log from "../../seed/log.js";
import { buildNavigationHandler } from "./navigation.js";
import { buildTools } from "./handlers.js";

// Tree modes
import treeNavigate from "./modes/tree/navigate.js";
import treeStructure from "./modes/tree/structure.js";
import treeEdit from "./modes/tree/edit.js";
import treeRespond from "./modes/tree/respond.js";
import treeLibrarian from "./modes/tree/librarian.js";
import treeGetContext from "./modes/tree/getContext.js";
import treeBe from "./modes/tree/be.js";
import treeNotes from "./modes/tree/notes.js";

// Home modes
import homeDefault from "./modes/home/default.js";
import homeReflect from "./modes/home/reflect.js";

// Tools (OpenAI-format TOOL_DEFS for mode toolNames resolution)
import TOOL_DEFS from "./tools.js";

export async function init(core) {
  const { setModels, setCommandResolver } = await import("./handlers.js");
  setModels(core.models);

  // Wire extension CLI command resolution for get-tree responses.
  // The home AI calls get-tree and sees availableCommands so it can give
  // specific directions ("fitness 'pushups 20'" not "note ...").
  setCommandResolver(async (nodeId) => {
    try {
      const { getLoadedExtensionNames, getExtensionManifest } = await import("../loader.js");
      const { isExtensionBlockedAtNode } = await import("../../seed/tree/extensionScope.js");
      const cmds = [];
      for (const name of getLoadedExtensionNames()) {
        const manifest = getExtensionManifest(name);
        if (!manifest?.provides?.cli?.length) continue;
        if (await isExtensionBlockedAtNode(name, nodeId)) continue;
        for (const cli of manifest.provides.cli) {
          const cmd = cli.command?.split(" ")[0];
          if (cmd) cmds.push(`${cmd}: ${cli.description || name}`);
        }
      }
      return cmds;
    } catch { return []; }
  });
  // Register all tree modes
  core.modes.registerMode("tree:navigate", treeNavigate, "treeos");
  core.modes.registerMode("tree:structure", treeStructure, "treeos");
  core.modes.registerMode("tree:edit", treeEdit, "treeos");
  core.modes.registerMode("tree:respond", treeRespond, "treeos");
  core.modes.registerMode("tree:librarian", treeLibrarian, "treeos");
  core.modes.registerMode("tree:get-context", treeGetContext, "treeos");
  core.modes.registerMode("tree:be", treeBe, "treeos");
  core.modes.registerMode("tree:notes", treeNotes, "treeos");

  // Register home modes
  core.modes.registerMode("home:default", homeDefault, "treeos");
  core.modes.registerMode("home:reflect", homeReflect, "treeos");

  // Upgrade defaults from fallback to real modes
  core.modes.setDefaultMode("home", "home:default");
  core.modes.setDefaultMode("tree", "tree:navigate");

  // Build MCP tools with zod schemas and handlers
  const tools = buildTools();

  // Register afterToolCall hook for frontend navigation
  const onAfterToolCall = buildNavigationHandler(core);
  core.hooks.register("afterToolCall", onAfterToolCall, "treeos");

  // ── Register TreeOS HTML pages (if html-rendering is installed) ──
  // html-rendering is infrastructure. TreeOS provides the actual pages.
  try {
    const { getExtension } = await import("../loader.js");
    const htmlExt = getExtension("html-rendering");
    if (htmlExt?.exports?.registerRenderer && htmlExt?.exports?.registerPage) {
      const { registerRenderer, registerPage } = htmlExt.exports;

      // Import all TreeOS page renderers from html-rendering's files
      // (physical files stay in html-rendering for now, will move to treeos later)
      const renderers = await import("../html-rendering/renderers.js");
      for (const [name, fn] of Object.entries(renderers)) {
        if (typeof fn === "function") registerRenderer(name, fn);
      }

      // Register login/register/forgot pages
      const { renderLoginPage, renderRegisterPage, renderForgotPasswordPage } = await import("../html-rendering/pages.js");
      registerRenderer("renderLoginPage", renderLoginPage);
      registerRenderer("renderRegisterPage", renderRegisterPage);
      registerRenderer("renderForgotPasswordPage", renderForgotPasswordPage);

      // Register app pages (dashboard, chat, setup, flow)
      const { default: appRouter } = await import("../html-rendering/app/app.js");
      const { default: chatRouter } = await import("../html-rendering/app/chat.js");
      const { default: setupRouter } = await import("../html-rendering/app/setup.js");
      const { default: flowDashboardRouter } = await import("../html-rendering/app/flowDashboard.js");
      const authenticate = (await import("../../seed/middleware/authenticate.js")).default;

      htmlExt.pageRouter.use("/", appRouter);
      htmlExt.pageRouter.use("/", chatRouter);
      htmlExt.pageRouter.use("/", setupRouter);
      htmlExt.pageRouter.use("/", flowDashboardRouter);

      // Canopy admin pages
      const { isHtmlEnabled } = await import("../html-rendering/config.js");
      registerPage("get", "/canopy/admin", authenticate, async (req, res) => {
        if (!isHtmlEnabled()) return (await import("../../seed/protocol.js")).sendError(res, 404, "EXTENSION_NOT_FOUND", "HTML disabled");
        try {
          const user = await core.models.User.findById(req.userId).select("isAdmin").lean();
          if (!user?.isAdmin) return (await import("../../seed/protocol.js")).sendError(res, 403, "FORBIDDEN", "Admin required");
          const { getAllPeers } = await import("../../canopy/peers.js");
          const { getLandInfoPayload } = await import("../../canopy/identity.js");
          const { getPendingEventCount, getFailedEvents } = await import("../../canopy/events.js");
          res.send(renderers.renderCanopyAdmin({ land: getLandInfoPayload(), peers: await getAllPeers(), pendingEvents: await getPendingEventCount(), failedEvents: await getFailedEvents() }));
        } catch (err) { (await import("../../seed/protocol.js")).sendError(res, 500, "INTERNAL", err.message); }
      });

      registerPage("get", "/canopy/admin/horizon", authenticate, async (req, res) => {
        if (!isHtmlEnabled()) return (await import("../../seed/protocol.js")).sendError(res, 404, "EXTENSION_NOT_FOUND", "HTML disabled");
        try {
          const user = await core.models.User.findById(req.userId).select("isAdmin").lean();
          if (!user?.isAdmin) return (await import("../../seed/protocol.js")).sendError(res, 403, "FORBIDDEN", "Admin required");
          res.send(renderers.renderCanopyHorizon({ hasHorizon: !!process.env.HORIZON_URL }));
        } catch (err) { (await import("../../seed/protocol.js")).sendError(res, 500, "INTERNAL", err.message); }
      });

      log.info("TreeOS", "HTML pages registered via html-rendering");
    }
  } catch (err) {
    log.verbose("TreeOS", `HTML pages not registered: ${err.message}`);
  }

  log.info("TreeOS", `Registered ${tools.length} tools, 10 modes, navigation hook`);

  return {
    tools,
    exports: { TOOL_DEFS },
  };
}
