import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import { getExtMeta } from "../../seed/tree/extensionMetadata.js";
import { createNote } from "../../seed/tree/notes.js";

// In-flight guard: one flow per tree at a time
const _running = new Set();

// Cooldown per flow node: don't run the same flow faster than its cadence
const _lastRun = new Map();

// Default cadence: 5 minutes between runs
const DEFAULT_CADENCE_MS = 5 * 60 * 1000;

export async function init(core) {
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;
  const { runChat: _runChatDirect } = await import("../../seed/llm/conversation.js");
  const runChat = async (opts) => _runChatDirect({ ...opts, llmPriority: BG });

  core.llm.registerRootLlmSlot?.("automate");

  // Keep trees with enabled flows alive. Poke breath so it never goes dormant.
  let _recordActivity = null;
  try {
    const { getExtension } = await import("../loader.js");
    const breathExt = getExtension("breath");
    if (breathExt?.exports?.recordActivity) _recordActivity = breathExt.exports.recordActivity;
  } catch {}

  // On boot, wake any tree that has enabled flows so breathing starts immediately.
  core.hooks.register("afterBoot", async () => {
    if (!_recordActivity) return;
    try {
      const { getLandRootId } = await import("../../seed/landRoot.js");
      const landRootId = getLandRootId();
      if (!landRootId) return;
      const roots = await Node.find({ parent: landRootId, systemRole: null }).select("_id children").lean();
      for (const root of roots) {
        if (!root.children?.length) continue;
        const children = await Node.find({ _id: { $in: root.children } }).select("metadata").lean();
        const hasFlows = children.some(c => {
          const meta = c.metadata instanceof Map ? c.metadata.get("automate") : c.metadata?.automate;
          return meta?.enabled;
        });
        if (hasFlows) {
          _recordActivity(String(root._id));
          log.verbose("Automate", `Woke tree ${String(root._id).slice(0, 8)} (has enabled flows)`);
        }
      }
    } catch {}
  }, "automate");

  core.hooks.register("breath:exhale", async ({ rootId, breathRate }) => {
    if (breathRate === "dormant") return;

    // Fire and forget. Pass _recordActivity so the flow can poke breath when done.
    runFlows(rootId, runChat, core, _recordActivity).catch(err =>
      log.debug("Automate", `Flow failed: ${err.message}`)
    );
  }, "automate");

  log.info("Automate", "Loaded. Trees can run flows on repeat.");
  return {};
}

/**
 * Find and run all enabled flows in a tree.
 */
async function runFlows(rootId, runChat, core, recordActivity) {
  const rid = String(rootId);
  if (_running.has(rid)) return;
  _running.add(rid);

  try {
    // Get tree owner for LLM access
    const { isUserRoot } = await import("../../seed/landRoot.js");
    const rootNode = await Node.findById(rootId).select("rootOwner systemRole parent children").lean();
    if (!isUserRoot(rootNode)) return;
    const ownerId = String(rootNode.rootOwner);

    // Find flow nodes: direct children of root with metadata.automate.enabled
    const children = await Node.find({ parent: rootId })
      .select("_id name metadata children")
      .lean();

    for (const child of children) {
      const meta = getExtMeta(child, "automate");
      if (!meta?.enabled) continue;

      const flowId = String(child._id);
      const cadence = meta.cadenceMs || DEFAULT_CADENCE_MS;
      const lastTime = _lastRun.get(flowId) || 0;
      if (Date.now() - lastTime < cadence) continue;

      // Run this flow
      try {
        await runFlow(child, rootId, ownerId, runChat, core);
        _lastRun.set(flowId, Date.now());
      } catch (err) {
        log.debug("Automate", `Flow "${child.name}" failed: ${err.message}`);
      }

      // Poke breath after each flow. The flow is the activity.
      // This prevents dormancy between cadence gaps.
      if (recordActivity) recordActivity(rootId);
    }
  } finally {
    _running.delete(rid);
  }
}

/**
 * Run a single flow. Children of the flow node are the steps.
 * Each step has metadata.automate with: { mode, prompt }
 * Steps execute in order. Each step's result feeds the next step's context.
 */
async function runFlow(flowNode, rootId, ownerId, runChat, core) {
  const flowName = flowNode.name || String(flowNode._id);

  // Get steps: children of the flow node, sorted by name (1. 2. 3. or alphabetical)
  if (!flowNode.children?.length) {
    log.debug("Automate", `Flow "${flowName}" has no steps`);
    return;
  }

  const stepNodes = await Node.find({ _id: { $in: flowNode.children } })
    .select("_id name metadata")
    .sort({ name: 1 })
    .lean();

  if (stepNodes.length === 0) return;

  log.verbose("Automate", `Running flow "${flowName}": ${stepNodes.length} steps`);

  let context = "";
  const results = [];

  for (const step of stepNodes) {
    const stepMeta = getExtMeta(step, "automate");
    const mode = stepMeta?.mode || "tree:converse";
    const prompt = stepMeta?.prompt || "";

    if (!prompt) {
      log.debug("Automate", `  Step "${step.name}" has no prompt, skipping`);
      continue;
    }

    // Build the message for this step
    const message = context
      ? `${prompt}\n\nContext from previous step:\n${context}`
      : prompt;

    try {
      const { answer } = await runChat({
        userId: ownerId,
        username: "automate",
        message,
        mode,
        rootId,
        slot: "automate",
      });

      const result = answer || "";
      results.push({ step: step.name, result: result.slice(0, 500) });
      context = result;

      log.verbose("Automate", `  Step "${step.name}" (${mode}): "${result.slice(0, 80)}"`);
    } catch (err) {
      log.debug("Automate", `  Step "${step.name}" failed: ${err.message}`);
      results.push({ step: step.name, error: err.message });
      // Continue to next step even if one fails
    }
  }

  // Log the flow run as a note on the flow node
  const summary = results.map(r =>
    r.error ? `${r.step}: FAILED (${r.error})` : `${r.step}: ${r.result.slice(0, 200)}`
  ).join("\n\n");

  try {
    await createNote({
      contentType: "text",
      content: `Flow run at ${new Date().toISOString()}\n\n${summary}`,
      userId: ownerId,
      nodeId: String(flowNode._id),
      wasAi: true,
    });
  } catch {}

  // Cap notes on flow node at 30
  const Note = (await import("../../seed/models/note.js")).default;
  const noteCount = await Note.countDocuments({ nodeId: String(flowNode._id) });
  if (noteCount > 30) {
    const oldest = await Note.find({ nodeId: String(flowNode._id) })
      .sort({ createdAt: 1 })
      .limit(noteCount - 30)
      .select("_id")
      .lean();
    if (oldest.length > 0) {
      await Note.deleteMany({ _id: { $in: oldest.map(n => n._id) } });
    }
  }

  log.verbose("Automate", `Flow "${flowName}" completed: ${results.length} steps`);
}
