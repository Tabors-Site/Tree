import log from "../../seed/log.js";
import { buildNavigationHandler, registerToolNavigation, registerToolNavigations } from "./navigation.js";
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
  core.modes.registerMode("tree:navigate", treeNavigate, "treeos-base");
  core.modes.registerMode("tree:structure", treeStructure, "treeos-base");
  core.modes.registerMode("tree:edit", treeEdit, "treeos-base");
  core.modes.registerMode("tree:respond", treeRespond, "treeos-base");
  core.modes.registerMode("tree:librarian", treeLibrarian, "treeos-base");
  core.modes.registerMode("tree:get-context", treeGetContext, "treeos-base");
  core.modes.registerMode("tree:be", treeBe, "treeos-base");
  core.modes.registerMode("tree:notes", treeNotes, "treeos-base");

  // Register home modes
  core.modes.registerMode("home:default", homeDefault, "treeos-base");
  core.modes.registerMode("home:reflect", homeReflect, "treeos-base");

  // Upgrade defaults from fallback to real modes
  core.modes.setDefaultMode("home", "home:default");
  core.modes.setDefaultMode("tree", "tree:navigate");

  // Register LLM slots and mode-to-slot assignments.
  // Operators assign models per slot: treeos llm tree-assign librarian <connectionId>
  // Grouping: navigate (read-only, cheap), librarian (write, quality),
  //           respond (user-facing, highest quality), notes (medium).
  core.llm.registerRootLlmSlot("navigate");
  core.llm.registerRootLlmSlot("librarian");
  core.llm.registerRootLlmSlot("respond");
  core.llm.registerRootLlmSlot("notes");
  if (core.llm.registerModeAssignment) {
    // Read-only tree observation
    core.llm.registerModeAssignment("tree:navigate", "navigate");
    core.llm.registerModeAssignment("tree:get-context", "navigate");
    // Write operations (create, edit, restructure)
    core.llm.registerModeAssignment("tree:librarian", "librarian");
    core.llm.registerModeAssignment("tree:structure", "librarian");
    core.llm.registerModeAssignment("tree:edit", "librarian");
    core.llm.registerModeAssignment("tree:be", "librarian");
    // User-facing conversation
    core.llm.registerModeAssignment("tree:respond", "respond");
    // Note operations
    core.llm.registerModeAssignment("tree:notes", "notes");
  }

  // Build MCP tools with zod schemas and handlers
  const tools = buildTools();

  // Protect scaffolded nodes — any node with a role in extension metadata is structural
  core.hooks.register("beforeNodeDelete", async ({ node }) => {
    if (!node?.metadata) return;
    const meta = node.metadata instanceof Map
      ? Object.fromEntries(node.metadata)
      : node.metadata;
    for (const [namespace, data] of Object.entries(meta)) {
      if (data?.role) {
        return {
          cancelled: true,
          reason: `This node is structural for the ${namespace} extension (role: ${data.role}). ` +
                  `Deleting it will break functionality. Use --force to override.`,
        };
      }
    }
  }, "treeos-base");

  // Register afterToolCall hook for frontend navigation
  const onAfterToolCall = buildNavigationHandler(core);
  core.hooks.register("afterToolCall", onAfterToolCall, "treeos-base");

  // ── Register TreeOS HTML pages (if html-rendering is installed) ──
  // html-rendering is infrastructure. TreeOS provides the actual pages.
  try {
    const { getExtension } = await import("../loader.js");
    const htmlExt = getExtension("html-rendering");
    if (htmlExt?.exports?.registerPage) {
      const { registerPage } = htmlExt.exports;

      // Register app pages (dashboard, chat, setup)
      const { default: appRouter } = await import("./app/app.js");
      const { default: chatRouter } = await import("./app/chat.js");
      const { default: setupRouter } = await import("./app/setup.js");
      const authenticate = (await import("../../seed/middleware/authenticate.js")).default;

      htmlExt.pageRouter.use("/", appRouter);
      htmlExt.pageRouter.use("/", chatRouter);
      htmlExt.pageRouter.use("/", setupRouter);

      // Mount HTML intercept routes (before kernel routes)
      const { buildTreeosHtmlRoutes } = await import("./htmlRoutes.js");
      htmlExt.router.use("/", buildTreeosHtmlRoutes());

      // Canopy admin pages
      const { isHtmlEnabled } = await import("../html-rendering/config.js");
      const { renderCanopyAdmin, renderCanopyInvites, renderCanopyHorizon } = await import("./pages/canopy.js");
      const { sendError: _sendError, ERR: _ERR } = await import("../../seed/protocol.js");

      registerPage("get", "/canopy/admin", authenticate, async (req, res) => {
        if (!isHtmlEnabled()) return _sendError(res, 404, _ERR.EXTENSION_NOT_FOUND, "HTML disabled");
        try {
          const user = await core.models.User.findById(req.userId).select("isAdmin").lean();
          if (!user?.isAdmin) return _sendError(res, 403, _ERR.FORBIDDEN, "Admin required");
          const { getAllPeers } = await import("../../canopy/peers.js");
          const { getLandInfoPayload } = await import("../../canopy/identity.js");
          const { getPendingEventCount, getFailedEvents } = await import("../../canopy/events.js");
          res.send(renderCanopyAdmin({ land: getLandInfoPayload(), peers: await getAllPeers(), pendingEvents: await getPendingEventCount(), failedEvents: await getFailedEvents() }));
        } catch (err) { _sendError(res, 500, _ERR.INTERNAL, err.message); }
      });

      registerPage("get", "/canopy/admin/invites", authenticate, async (req, res) => {
        if (!isHtmlEnabled()) return _sendError(res, 404, _ERR.EXTENSION_NOT_FOUND, "HTML disabled");
        try {
          const user = await core.models.User.findById(req.userId).select("isAdmin").lean();
          if (!user?.isAdmin) return _sendError(res, 403, _ERR.FORBIDDEN, "Admin required");
          const mongoose = (await import("mongoose")).default;
          const CanopyEvent = mongoose.models.CanopyEvent;
          const RemoteUser = mongoose.models.RemoteUser;
          const invites = CanopyEvent ? await CanopyEvent.find({ type: "invite" }).sort({ createdAt: -1 }).lean() : [];
          const remoteUsers = RemoteUser ? await RemoteUser.find().lean() : [];
          const localTrees = await core.models.Node.find({ rootOwner: { $exists: true, $ne: null } }).select("_id name").lean();
          res.send(renderCanopyInvites({ invites, remoteUsers, localTrees }));
        } catch (err) { _sendError(res, 500, _ERR.INTERNAL, err.message); }
      });

      registerPage("get", "/canopy/admin/horizon", authenticate, async (req, res) => {
        if (!isHtmlEnabled()) return _sendError(res, 404, _ERR.EXTENSION_NOT_FOUND, "HTML disabled");
        try {
          const user = await core.models.User.findById(req.userId).select("isAdmin").lean();
          if (!user?.isAdmin) return _sendError(res, 403, _ERR.FORBIDDEN, "Admin required");
          res.send(renderCanopyHorizon({ hasHorizon: !!process.env.HORIZON_URL }));
        } catch (err) { _sendError(res, 500, _ERR.INTERNAL, err.message); }
      });

      log.info("TreeOS", "HTML pages registered via html-rendering");
    }
  } catch (err) {
    log.verbose("TreeOS", `HTML pages not registered: ${err.message}`);
  }

  log.info("TreeOS", `Registered ${tools.length} tools, 10 modes, navigation hook`);

  return {
    tools,
    exports: { TOOL_DEFS, registerToolNavigation, registerToolNavigations },
  };
}
