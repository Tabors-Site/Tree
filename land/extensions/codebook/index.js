import log from "../../seed/log.js";
import tools from "./tools.js";
import {
  setRunChat,
  getCodebookConfig,
  incrementNoteCount,
  runCompression,
  getCodebook,
  clearCodebook,
} from "./core.js";

export async function init(core) {
  // Wire runChat with BACKGROUND priority (compression runs are background work)
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;

  core.llm.registerRootLlmSlot("codebook");

  setRunChat(async (opts) => {
    if (opts.beingId && opts.beingId !== "SYSTEM" && !await core.llm.userHasLlm(opts.beingId)) return { answer: null };
    return core.llm.runChat({ ...opts, llmPriority: BG });
  });

  const config = await getCodebookConfig();

  // Listen to every artifact create/edit. Increment the counter for the user-node pair.
  // When the counter crosses the compression threshold, fire a background compression.
  core.hooks.register("afterArtifact", async ({ artifact, nodeId, beingId, origin, action }) => {
    // Only track ibp-origin artifacts (text content), only creates and edits
    if (origin !== "ibp") return;
    if (action !== "create" && action !== "edit") return;

    // Skip system writes (pulse, etc.)
    if (!beingId || beingId === "SYSTEM") return;

    // Skip system nodes
    try {
      const Node = core.models.Node;
      const node = await Node.findById(nodeId).select("systemRole").lean();
      if (node?.systemRole) return;
    } catch { return; }

    const count = await incrementNoteCount(nodeId, beingId);

    if (count >= config.compressionThreshold) {
      // Look up username for the compression prompt
      let username = null;
      try {
        const user = await core.models.Being.findById(beingId).select("username").lean();
        username = user?.username;
      } catch (err) {
        log.debug("Codebook", "Username lookup failed:", err.message);
      }

      // Fire compression in background, don't block the note write
      runCompression(nodeId, beingId, username).catch((err) => {
        log.debug("Codebook", `Background compression failed: ${err.message}`);
      });
    }
  }, "codebook");

  // Inject this user's codebook into AI context. beingId is threaded through
  // getContextForAi options into enrichContext hookData by the kernel.
  core.hooks.register("enrichContext", async ({ context, node, meta, beingId }) => {
    if (!beingId) return;

    const codebook = meta.codebook;
    if (!codebook) return;

    const userEntry = codebook[beingId];
    if (userEntry?.dictionary && Object.keys(userEntry.dictionary).length > 0) {
      context.codebook = userEntry.dictionary;
    }
  }, "codebook");

  const { default: router } = await import("./routes.js");

  // HTML page + tree quick link
  try {
    const { getExtension } = await import("../loader.js");
    const htmlExt = getExtension("html-rendering");
    const base = getExtension("treeos-base");
    if (htmlExt) {
      const { default: buildHtmlRoutes } = await import("./htmlRoutes.js");
      htmlExt.router.use("/", buildHtmlRoutes());
    }
    base?.exports?.registerSlot?.("tree-quick-links", "codebook", ({ rootId, queryString }) =>
      `<a href="/api/v1/root/${rootId}/codebook${queryString}" class="back-link">Codebook</a>`,
      { priority: 50 }
    );
  } catch {}

  return {
    router,
    tools,
    exports: {
      getCodebook,
      clearCodebook,
      runCompression,
    },
  };
}
