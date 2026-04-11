/**
 * Study
 *
 * The tree that teaches you. Queue topics. Build curricula.
 * Study through conversation. Track mastery. Detect gaps.
 * Part of the proficiency stack: food fuels, fitness builds,
 * recovery heals, study grows.
 */

import log from "../../seed/log.js";
import sessionMode from "./modes/session.js";
import planMode from "./modes/plan.js";
import getTools from "./tools.js";
import {
  configure,
  isInitialized,
  getSetupPhase,
  findStudyNodes,
  getActiveTopics,
  getStudyProgress,
  getQueue,
  getGaps,
} from "./core.js";
import { setDeps as setSetupDeps } from "./setup.js";
import { handleMessage } from "./handler.js";

export async function init(core) {
  core.llm.registerRootLlmSlot?.("study");

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
  setSetupDeps({ metadata: core.metadata, Node: core.models.Node });

  // ── Register modes: two modes only ──
  core.modes.registerMode("tree:study-coach", sessionMode, "study");
  core.modes.registerMode("tree:study-plan", planMode, "study");

  if (core.llm?.registerModeAssignment) {
    core.llm.registerModeAssignment("tree:study-coach", "studySession");
    core.llm.registerModeAssignment("tree:study-plan", "studyPlan");
  }

  // ── Boot self-heal ──
  core.hooks.register("afterBoot", async () => {
    try {
      const studyRoots = await core.models.Node.find({
        "metadata.study.initialized": true,
      }).select("_id metadata").lean();
      for (const root of studyRoots) {
        const modes = root.metadata instanceof Map
          ? root.metadata.get("modes")
          : root.metadata?.modes;
        if (!modes?.respond) {
          await core.modes.setNodeMode(root._id, "respond", "tree:study-coach");
          log.verbose("Study", `Self-healed mode on ${String(root._id).slice(0, 8)}...`);
        }
      }
    } catch {}
  }, "study");

  // ── enrichContext ──
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    if (!node?._id) return;

    const studyMeta = meta?.study;
    if (!studyMeta?.role) return;

    const role = studyMeta.role;

    if (role === "log" || role === "queue" || role === "active") {
      // At structural nodes: show full study state
      const rootId = String(node.parent || node._id);
      const progress = await getStudyProgress(rootId);
      if (progress) context.study = progress;

    } else if (role === "topic") {
      // At a topic: show subtopics with mastery
      const subtopics = await core.models.Node.find({ parent: node._id })
        .select("name metadata").lean();
      context.studyTopic = {
        name: node.name,
        subtopics: subtopics
          .filter(s => {
            const sm = s.metadata instanceof Map ? s.metadata.get("study") : s.metadata?.study;
            return sm?.role === "subtopic";
          })
          .map(s => {
            const vals = s.metadata instanceof Map ? s.metadata.get("values") : s.metadata?.values;
            return {
              name: s.name,
              mastery: vals?.mastery || 0,
              attempts: vals?.attempts || 0,
              lastStudied: vals?.lastStudied || null,
            };
          }),
      };

    } else if (role === "subtopic") {
      // At a subtopic: show its mastery details
      const vals = meta?.values || {};
      context.studySubtopic = {
        name: node.name,
        mastery: vals.mastery || 0,
        attempts: vals.attempts || 0,
        lastStudied: vals.lastStudied || null,
      };

    } else if (role === "gaps") {
      // At gaps node: show all gaps
      const rootId = String(node.parent);
      const gaps = await getGaps(rootId);
      context.studyGaps = gaps;
    }
  }, "study");

  // ── Register tool navigation (if treeos-base installed) ──
  try {
    const { getExtension } = await import("../loader.js");
    const base = getExtension("treeos-base");
    if (base?.exports?.registerToolNavigations) {
      const nodeNav = ({ args, withToken: t }) => t(`/api/v1/node/${args.rootId || args.activeNodeId || args.topicId || args.subtopicId}?html`);
      base.exports.registerToolNavigations({
        "study-add-to-queue": nodeNav,
        "study-create-topic": nodeNav,
        "study-add-subtopic": nodeNav,
        "study-update-mastery": nodeNav,
        "study-move-to-active": nodeNav,
        "study-detect-gap": nodeNav,
        "study-complete-setup": nodeNav,
        "study-save-profile": nodeNav,
      });
    }
  } catch {}

  // ── Live dashboard updates ──
  core.hooks.register("afterNote", async ({ nodeId }) => {
    if (!nodeId) return;
    try {
      const node = await core.models.Node.findById(nodeId).select("rootOwner metadata").lean();
      if (!node?.rootOwner) return;
      const fm = node.metadata instanceof Map ? node.metadata.get("study") : node.metadata?.study;
      if (!fm?.role) return;
      core.websocket?.emitToUser?.(String(node.rootOwner), "dashboardUpdate", { rootId: String(node.rootOwner) });
    } catch {}
  }, "study");

  core.hooks.register("afterMetadataWrite", async ({ nodeId, extName }) => {
    if (extName !== "values" && extName !== "study") return;
    try {
      const node = await core.models.Node.findById(nodeId).select("rootOwner").lean();
      if (!node?.rootOwner) return;
      core.websocket?.emitToUser?.(String(node.rootOwner), "dashboardUpdate", { rootId: String(node.rootOwner) });
    } catch {}
  }, "study");

  // ── Register HTML dashboard (if html-rendering installed) ──
  try {
    const { getExtension } = await import("../loader.js");
    const htmlExt = getExtension("html-rendering");
    if (htmlExt) {
      const { default: htmlRoutes } = await import("./htmlRoutes.js");
      htmlExt.router.use("/", htmlRoutes);
      log.verbose("Study", "HTML dashboard registered");
    }
  } catch {}

  // ── Register apps-grid slot ──
  try {
    const { getExtension } = await import("../loader.js");
    const base = getExtension("treeos-base");
    base?.exports?.registerSlot?.("apps-grid", "study", ({ userId, rootMap, tokenParam, tokenField, esc: e }) => {
      const entries = rootMap.get("Study") || [];
      const existing = entries.map(entry =>
        entry.ready
          ? `<a class="app-active" href="/api/v1/root/${entry.id}/study?html${tokenParam}" style="margin-right:8px;margin-bottom:6px;">${e(entry.name)}</a>`
          : `<a class="app-active" style="background:rgba(236,201,75,0.12);border-color:rgba(236,201,75,0.3);color:#ecc94b;margin-right:8px;margin-bottom:6px;" href="/api/v1/root/${entry.id}/study?html${tokenParam}">${e(entry.name)} (setup)</a>`
      ).join("");
      return `<div class="app-card">
        <div class="app-header"><span class="app-emoji">📚</span><span class="app-name">Study</span></div>
        <div class="app-desc">Queue topics, track mastery, detect gaps. The tree manages your curriculum.</div>
        ${entries.length > 0
          ? `<div style="display:flex;flex-wrap:wrap;">${existing}</div>`
          : `<form class="app-form" method="POST" action="/api/v1/user/${userId}/apps/create">
              ${tokenField}<input type="hidden" name="app" value="study" />
              <input class="app-input" name="message" placeholder="What do you want to learn? (e.g. distributed systems, react hooks)" required />
              <button class="app-start" type="submit">Start Study</button>
            </form>`}
      </div>`;
    }, { priority: 40 });
  } catch {}

  // ── Import router ──
  const { default: router, setServices } = await import("./routes.js");
  setServices({ Node: core.models.Node });

  const tools = getTools();

  log.info("Study", "Loaded. The tree that teaches you.");

  return {
    router,
    tools,
    modeTools: [
      { modeKey: "tree:study-plan", toolNames: [
        "study-create-topic", "study-add-subtopic", "study-move-to-active",
        "study-add-to-queue", "study-complete-setup", "study-save-profile",
      ]},
      { modeKey: "tree:study-coach", toolNames: [
        "study-update-mastery", "study-detect-gap", "study-add-subtopic", "study-add-to-queue",
      ]},
    ],
    exports: {
      isInitialized,
      getSetupPhase,
      findStudyNodes,
      getActiveTopics,
      getStudyProgress,
      getQueue,
      getGaps,
      handleMessage,
      scaffold: (await import("./setup.js")).scaffold,
    },
  };
}
