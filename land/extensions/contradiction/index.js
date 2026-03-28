import log from "../../seed/log.js";
import tools from "./tools.js";
import { setServices, detectContradictions, writeContradictions, cascadeContradictions, incrementNoteCount, resetNoteCount, getContradictionConfig } from "./core.js";

export async function init(core) {
  const { checkCascade } = await import("../../seed/tree/cascade.js");
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;

  core.llm.registerRootLlmSlot("contradiction");

  setServices({
    runChat: async (opts) => {
      if (opts.userId && opts.userId !== "SYSTEM" && !await core.llm.userHasLlm(opts.userId)) return { answer: null };
      return core.llm.runChat({ ...opts, llmPriority: BG });
    },
    checkCascade,
    metadata: core.metadata,
  });

  // ── afterNote: throttled contradiction scanning ─────────────────────
  // Increments a counter on every text note. Only fires the AI detection
  // when the count hits minNotesBetweenScans. Resets on scan. Ten notes
  // in a minute don't trigger ten LLM calls. They trigger two (at default 5).
  const config = await getContradictionConfig();

  core.hooks.register("afterNote", async ({ note, nodeId, userId, contentType, action }) => {
    if (contentType !== "text") return;
    if (action !== "create" && action !== "edit") return;
    if (!userId || userId === "SYSTEM") return;

    // Skip system nodes
    try {
      const Node = core.models.Node;
      const node = await Node.findById(nodeId).select("systemRole").lean();
      if (node?.systemRole) return;
    } catch (err) {
      log.debug("Contradiction", "systemRole check failed:", err.message);
      return;
    }

    // Throttle: increment counter, only scan when threshold reached
    const count = await incrementNoteCount(nodeId);
    if (count < config.minNotesBetweenScans) return;

    // Reset counter before scanning (not after, so concurrent notes don't double-fire)
    await resetNoteCount(nodeId);

    // Look up username
    let username = null;
    try {
      const user = await core.models.User.findById(userId).select("username").lean();
      username = user?.username;
    } catch (err) {
      log.debug("Contradiction", "username lookup failed:", err.message);
    }

    // Detect in background so we don't block the note write response
    detectContradictions(nodeId, note.content || "", userId, username)
      .then(async (contradictions) => {
        if (contradictions.length === 0) return;

        log.verbose("Contradiction",
          `Detected ${contradictions.length} contradiction(s) at node ${nodeId}`,
        );

        await writeContradictions(nodeId, contradictions);
        await cascadeContradictions(nodeId, contradictions);
      })
      .catch((err) => {
        log.debug("Contradiction", `Background detection failed: ${err.message}`);
      });
  }, "contradiction");

  // ── enrichContext: surface active contradictions to the AI ──────────
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const contradictions = meta.contradictions;
    if (!Array.isArray(contradictions)) return;

    const active = contradictions.filter((c) => c.status === "active");
    if (active.length === 0) return;

    context.contradictions = active.map((c) => ({
      id: c.id,
      claim: c.claim,
      conflictsWith: c.conflictsWith,
      severity: c.severity,
      sourceNodeName: c.sourceNodeName,
      detectedAt: c.detectedAt,
    }));
  }, "contradiction");

  const { default: router } = await import("./routes.js");

  return {
    router,
    tools,
    exports: {
      detectContradictions,
      writeContradictions,
    },
  };
}
