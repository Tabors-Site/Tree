import log from "../../seed/log.js";
import tools from "./tools.js";
import {
  setRunChat,
  setMetadata,
  getPurposeConfig,
  deriveThesis,
  checkCoherence,
  checkCoherenceBatch,
  getThesis,
  incrementNoteCount,
} from "./core.js";
import { CONTENT_TYPE } from "../../seed/protocol.js";

// Per-root pending notes buffer for batched coherence checks.
// rootId -> [{ noteId, content }]
const _pending = new Map();

export async function init(core) {
  core.llm.registerRootLlmSlot("purpose");
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;
  setRunChat(async (opts) => {
    if (opts.userId && opts.userId !== "SYSTEM" && !await core.llm.userHasLlm(opts.userId)) return { answer: null };
    return core.llm.runChat({ ...opts, llmPriority: BG });
  });
  setMetadata(core.metadata);

  const config = await getPurposeConfig();

  // ── afterNote: coherence check + thesis re-derivation counter ──────
  core.hooks.register("afterNote", async ({ note, nodeId, userId, contentType, action }) => {
    if (contentType !== CONTENT_TYPE.TEXT) return;
    if (action !== "create") return;
    if (!userId || userId === "SYSTEM") return;

    // Find the tree root for this node
    let rootId;
    try {
      const Node = core.models.Node;
      const node = await Node.findById(nodeId).select("systemRole rootOwner parent").lean();
      if (!node || node.systemRole) return;

      if (node.rootOwner) {
        rootId = nodeId;
      } else {
        const { resolveRootNode } = await import("../../seed/tree/treeFetch.js");
        const root = await resolveRootNode(nodeId);
        rootId = root?._id;
      }
    } catch { return; }
    if (!rootId) return;

    // Check if thesis exists. If not and we have enough notes, derive it.
    const thesis = await getThesis(rootId);
    if (!thesis?.thesis) {
      const Note = core.models.Note;
      const noteCount = await Note.countDocuments({ nodeId: rootId, contentType: CONTENT_TYPE.TEXT });
      if (noteCount >= 3) {
        deriveThesis(rootId, userId).catch(err =>
          log.debug("Purpose", `Auto-derivation failed: ${err.message}`)
        );
      }
      return;
    }

    // Increment counter, re-derive if threshold hit
    const count = await incrementNoteCount(rootId);
    if (count >= config.rederiveInterval) {
      deriveThesis(rootId, userId).catch(err =>
        log.debug("Purpose", `Re-derivation failed: ${err.message}`)
      );
    }

    // Batch coherence: accumulate notes, check every minNotesBetweenChecks.
    // One LLM call scores all pending notes instead of one call per note.
    const content = note.content || "";
    if (content.length < 20) return;

    const noteId = (note._id || note.id).toString();
    if (!_pending.has(rootId)) _pending.set(rootId, []);
    _pending.get(rootId).push({ noteId, content });

    if (_pending.get(rootId).length < config.minNotesBetweenChecks) return;

    // Flush the batch
    const batch = _pending.get(rootId).splice(0);
    _pending.delete(rootId);

    checkCoherenceBatch(batch, rootId, userId)
      .then(async (results) => {
        const Note = core.models.Note;
        for (const r of results) {
          if (!r.noteId) continue;
          await Note.findByIdAndUpdate(r.noteId, {
            $set: {
              "metadata.purpose.coherence": r.score,
              "metadata.purpose.reason": r.reason,
            },
          });
        }
      })
      .catch(err => log.debug("Purpose", `Batch coherence check failed: ${err.message}`));
  }, "purpose");

  // ── enrichContext: surface coherence signals ────────────────────────
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    // At tree root: show the thesis
    if (node.rootOwner) {
      const purpose = meta.purpose;
      if (purpose?.thesis) {
        context.treeThesis = purpose.thesis;
      }
      return;
    }

    // At any node: if the most recent note has a low coherence score, signal it
    const Note = core.models.Note;
    const recentNote = await Note.findOne({
      nodeId: node._id,
      contentType: CONTENT_TYPE.TEXT,
      "metadata.purpose.coherence": { $exists: true },
    })
      .sort({ createdAt: -1 })
      .select("metadata")
      .lean();

    if (!recentNote) return;

    const coherence = recentNote.metadata instanceof Map
      ? recentNote.metadata.get("purpose")?.coherence
      : recentNote.metadata?.purpose?.coherence;

    if (coherence === undefined || coherence === null) return;

    // Also get the thesis for context
    let rootId;
    try {
      const { resolveRootNode } = await import("../../seed/tree/treeFetch.js");
      const root = await resolveRootNode(node._id);
      rootId = root?._id;
    } catch { return; }

    const thesis = await getThesis(rootId);

    if (coherence >= config.coherenceThreshold.high) {
      // On-thesis. No signal needed.
      return;
    }

    if (coherence >= config.coherenceThreshold.medium) {
      context.purposeSignal = {
        coherence,
        thesis: thesis?.thesis,
        message: "Recent content here is loosely connected to the tree's core purpose. It might belong here or it might be the seed of a new tree.",
      };
    } else {
      context.purposeSignal = {
        coherence,
        thesis: thesis?.thesis,
        message: "Recent content here does not align with this tree's purpose. Consider moving it or starting a new tree for this topic.",
      };
    }
  }, "purpose");

  const { default: router } = await import("./routes.js");

  return {
    router,
    tools,
    exports: {
      deriveThesis,
      checkCoherence,
      getThesis,
    },
  };
}
