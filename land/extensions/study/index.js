/**
 * Study
 *
 * The tree that teaches you. Queue topics. Build curricula.
 * Study through conversation. Track mastery. Detect gaps.
 * Part of the proficiency stack: food fuels, fitness builds,
 * recovery heals, study grows.
 */

import log from "../../seed/log.js";
import logMode from "./modes/log.js";
import sessionMode from "./modes/session.js";
import reviewMode from "./modes/review.js";
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

  // ── Register modes ──
  core.modes.registerMode("tree:study-log", logMode, "study");
  core.modes.registerMode("tree:study-session", sessionMode, "study");
  core.modes.registerMode("tree:study-review", reviewMode, "study");
  core.modes.registerMode("tree:study-plan", planMode, "study");

  if (core.llm?.registerModeAssignment) {
    core.llm.registerModeAssignment("tree:study-log", "studyLog");
    core.llm.registerModeAssignment("tree:study-session", "studySession");
    core.llm.registerModeAssignment("tree:study-review", "studyReview");
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
          await core.modes.setNodeMode(root._id, "respond", "tree:study-log");
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
      { modeKey: "tree:study-session", toolNames: [
        "study-update-mastery", "study-detect-gap", "study-add-subtopic",
      ]},
      { modeKey: "tree:study-log", toolNames: [
        "study-add-to-queue",
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
    },
  };
}
