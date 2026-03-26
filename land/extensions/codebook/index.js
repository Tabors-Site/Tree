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
  setRunChat((opts) => core.llm.runChat({ ...opts, llmPriority: BG }));

  const config = await getCodebookConfig();

  // Listen to every note create/edit. Increment the counter for the user-node pair.
  // When the counter crosses the compression threshold, fire a background compression.
  core.hooks.register("afterNote", async ({ note, nodeId, userId, contentType, action }) => {
    // Only track text notes, only creates and edits
    if (contentType !== "text") return;
    if (action !== "create" && action !== "edit") return;

    // Skip system writes (pulse, etc.)
    if (!userId || userId === "SYSTEM") return;

    // Skip system nodes
    try {
      const Node = core.models.Node;
      const node = await Node.findById(nodeId).select("systemRole").lean();
      if (node?.systemRole) return;
    } catch { return; }

    const count = await incrementNoteCount(nodeId, userId);

    if (count >= config.compressionThreshold) {
      // Look up username for the compression prompt
      let username = null;
      try {
        const user = await core.models.User.findById(userId).select("username").lean();
        username = user?.username;
      } catch {}

      // Fire compression in background, don't block the note write
      runCompression(nodeId, userId, username).catch((err) => {
        log.debug("Codebook", `Background compression failed: ${err.message}`);
      });
    }
  }, "codebook");

  // Inject this user's codebook into AI context. userId is threaded through
  // getContextForAi options into enrichContext hookData by the kernel.
  core.hooks.register("enrichContext", async ({ context, node, meta, userId }) => {
    if (!userId) return;

    const codebook = meta.codebook;
    if (!codebook) return;

    const userEntry = codebook[userId];
    if (userEntry?.dictionary && Object.keys(userEntry.dictionary).length > 0) {
      context.codebook = userEntry.dictionary;
    }
  }, "codebook");

  const { default: router } = await import("./routes.js");

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
