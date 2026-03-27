import log from "../../seed/log.js";
import tools from "./tools.js";
import {
  setServices,
  extractLessons,
  importLessons,
  shareLessons,
  dismissLesson,
  getLessons,
} from "./core.js";

export async function init(core) {
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;
  setServices({
    models: core.models,
    contributions: core.contributions,
    llm: { ...core.llm, runChat: (opts) => core.llm.runChat({ ...opts, llmPriority: BG }) },
    energy: core.energy || null,
  });

  // ── enrichContext: surface active lessons to the AI ──────────────────
  //
  // At the tree root, inject all active lessons so the AI knows the
  // accumulated wisdom. At child nodes, inject a summary count so the
  // AI knows lessons exist without flooding context at every position.

  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const teachMeta = meta.teach;
    if (!teachMeta?.lessons?.length) return;

    const active = teachMeta.lessons.filter(l => !l.dismissedAt);
    if (active.length === 0) return;

    // At root: full lessons. At children: count + top 3.
    if (node.rootOwner) {
      context.treeLessons = active.map(l => ({
        from: l.from,
        insight: l.insight,
        confidence: l.confidence,
        importedFrom: l.importedFrom || null,
      }));
    } else {
      context.treeLessonCount = active.length;
      context.topLessons = active
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3)
        .map(l => l.insight);
    }
  }, "teach");

  // ── onCascade: receive shared lessons from peered lands ─────────────

  core.hooks.register("onCascade", async (hookData) => {
    const { nodeId, payload } = hookData;
    if (!payload?._teach || !payload?.lessonSet) return;

    // Auto-import shared lessons
    try {
      await importLessons(nodeId, payload.lessonSet, "system");
      log.verbose("Teach", `Auto-imported ${payload.lessonSet.lessons?.length || 0} lesson(s) from cascade at ${nodeId}`);
    } catch (err) {
      log.debug("Teach", `Cascade lesson import failed: ${err.message}`);
    }
  }, "teach");

  const { default: router } = await import("./routes.js");

  log.info("Teach", "Tree wisdom transfer loaded");

  return {
    router,
    tools,
    exports: {
      extractLessons,
      importLessons,
      shareLessons,
      dismissLesson,
      getLessons,
    },
  };
}
