/**
 * KB
 *
 * Tell it things. Ask it things. The tree organizes.
 * The AI answers from what it knows.
 */

import log from "../../seed/log.js";
import tellMode from "./modes/tell.js";
import askMode from "./modes/ask.js";
import reviewMode from "./modes/review.js";
import {
  configure,
  scaffold,
  isInitialized,
  findKbNodes,
  getStatus,
  getStaleNotes,
  getUnplaced,
  isMaintainer,
  routeKbIntent,
  getSetupPhase,
} from "./core.js";
import { handleMessage } from "./handler.js";

export async function init(core) {
  core.llm.registerRootLlmSlot?.("kb");

  const runChat = core.llm?.runChat || null;
  configure({
    Node: core.models.Node,
    Note: core.models.Note,
    runChat: runChat
      ? async (opts) => {
          if (opts.userId && opts.userId !== "SYSTEM") {
            const hasLlm = await core.llm.userHasLlm(opts.userId);
            if (!hasLlm) return { answer: null };
          }
          return core.llm.runChat({
            ...opts,
            llmPriority: core.llm.LLM_PRIORITY.INTERACTIVE,
          });
        }
      : null,
    metadata: core.metadata,
  });

  // Register modes
  core.modes.registerMode("tree:kb-tell", tellMode, "kb");
  core.modes.registerMode("tree:kb-ask", askMode, "kb");
  core.modes.registerMode("tree:kb-review", reviewMode, "kb");

  if (core.llm?.registerModeAssignment) {
    core.llm.registerModeAssignment("tree:kb-tell", "kb");
    core.llm.registerModeAssignment("tree:kb-ask", "kb");
    core.llm.registerModeAssignment("tree:kb-review", "kb");
  }

  // ── Boot self-heal ──
  core.hooks.register("afterBoot", async () => {
    try {
      const roots = await core.models.Node.find({
        "metadata.kb.initialized": true,
      }).select("_id metadata").lean();
      for (const root of roots) {
        const modes = root.metadata instanceof Map
          ? root.metadata.get("modes")
          : root.metadata?.modes;
        if (!modes?.respond) {
          const { setNodeMode } = await import("../../seed/modes/registry.js");
          await setNodeMode(root._id, "respond", "tree:kb-tell");
        }
      }
    } catch {}
  }, "kb");

  // ── enrichContext ──
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    if (!node?._id) return;
    const kbMeta = meta?.kb;
    if (!kbMeta) return;

    // Only inject at the root or direct children
    let rootId = null;
    if (kbMeta.initialized) {
      rootId = String(node._id);
    } else if (kbMeta.role) {
      rootId = String(node.parent);
    }
    if (!rootId) return;

    try {
      const status = await getStatus(rootId);
      if (!status) return;

      context.kb = {
        name: status.name,
        topicCount: status.topicCount,
        noteCount: status.noteCount,
        coverage: status.coverage,
        staleNotes: status.staleNotes,
        staleAreas: status.staleBranches || [],
        unplaced: status.unplacedCount,
      };

      if (status.recentUpdates?.length > 0) {
        context.kb.recentlyUpdated = status.recentUpdates.slice(0, 3).map(u =>
          `${u.name} (${Math.floor((Date.now() - new Date(u.date).getTime()) / (24 * 60 * 60 * 1000))}d ago)`
        );
      }

      if (status.staleNotes > 0) {
        context.kb.staleWarning = `${status.staleNotes} notes haven't been updated in 90+ days. Areas: ${(status.staleBranches || []).slice(0, 3).join(", ") || "various"}.`;
      }
    } catch {}
  }, "kb");

  // ── breath:exhale ──
  core.hooks.register("breath:exhale", async ({ rootId }) => {
    try {
      if (!(await isInitialized(rootId))) return;
      const status = await getStatus(rootId);
      if (status?.staleNotes > 5) {
        log.warn("KB", `${status.name}: ${status.staleNotes} stale notes need review`);
      }
    } catch {}
  }, "kb");

  // ── Register apps-grid slot ──
  try {
    const { getExtension } = await import("../loader.js");
    const base = getExtension("treeos-base");
    base?.exports?.registerSlot?.("apps-grid", "kb", ({ userId, rootMap, tokenParam, tokenField, esc: e }) => {
      const entries = rootMap.get("KB") || rootMap.get("Knowledge Base") || [];
      const existing = entries.map(entry =>
        entry.ready
          ? `<a class="app-active" href="/api/v1/root/${entry.id}/kb?html${tokenParam}" style="margin-right:8px;margin-bottom:6px;">${e(entry.name)}</a>`
          : `<a class="app-active" style="background:rgba(236,201,75,0.12);border-color:rgba(236,201,75,0.3);color:#ecc94b;margin-right:8px;margin-bottom:6px;" href="/api/v1/root/${entry.id}/kb?html${tokenParam}">${e(entry.name)} (setup)</a>`
      ).join("");
      return `<div class="app-card">
        <div class="app-header"><span class="app-emoji">📖</span><span class="app-name">Knowledge Base</span></div>
        <div class="app-desc">Tell it things. Ask it things. The tree organizes knowledge into topics with citations.</div>
        ${existing ? `<div style="display:flex;flex-wrap:wrap;margin-bottom:10px;">${existing}</div>` : ""}
        <form class="app-form" method="POST" action="/api/v1/user/${userId}/apps/create">
          ${tokenField}<input type="hidden" name="app" value="kb" />
          <input class="app-input" name="message" placeholder="What's this knowledge base about? (e.g. team wiki, personal notes)" required />
          <button class="app-start" type="submit">${entries.length > 0 ? "New" : "Start"} KB</button>
        </form>
      </div>`;
    }, { priority: 50 });
  } catch {}

  // ── Router ──
  const { default: router } = await import("./routes.js");

  log.info("KB", "Loaded. Tell it things. Ask it things.");

  return {
    router,
    exports: {
      scaffold,
      isInitialized,
      getSetupPhase,
      findKbNodes,
      getStatus,
      getStaleNotes,
      getUnplaced,
      isMaintainer,
      routeKbIntent,
      handleMessage,
    },
  };
}
