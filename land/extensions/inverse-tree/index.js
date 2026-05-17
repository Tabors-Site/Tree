import log from "../../seed/log.js";
import tools from "./tools.js";
import { setRunChat, recordSignal, compress, getInverseConfig, getInverseData, getProfile } from "./core.js";
import { SYSTEM_ROLE } from "../../seed/protocol.js";
import Node from "../../seed/models/node.js";
import { getLandConfigValue } from "../../seed/landConfig.js";

export async function init(core) {
  const BG = core.llm.LLM_PRIORITY.BACKGROUND;

  core.llm.registerRootLlmSlot?.("inverseTree");

  setRunChat(async (opts) => {
    if (opts.beingId && opts.beingId !== "SYSTEM" && !await core.llm.userHasLlm(opts.beingId)) return { answer: null };
    return core.llm.runChat({ ...opts, llmPriority: BG });
  });

  // Read config from .config metadata
  const configNode = await Node.findOne({ systemRole: SYSTEM_ROLE.CONFIG }).select("metadata").lean();
  const rawConfig = configNode?.metadata instanceof Map
    ? configNode.metadata.get("inverse-tree") || {}
    : configNode?.metadata?.["inverse-tree"] || {};
  const config = getInverseConfig(rawConfig);

  // ── afterNote: extract topic signals + detect intentions ─────────────
  const INTENTION_PATTERNS = [
    /\bi will\b/i, /\bi'm going to\b/i, /\bstarting tomorrow\b/i,
    /\bmy goal is\b/i, /\bi plan to\b/i, /\bi want to\b/i,
    /\bi need to\b/i, /\bi should\b/i, /\bgoing to start\b/i,
    /\bcommit to\b/i, /\baiming for\b/i, /\btarget(ing)?\b/i,
  ];

  core.hooks.register("afterArtifact", async ({ artifact, nodeId, beingId, origin, action }) => {
    if (origin !== "ibp") return;
    if (action !== "create") return;
    if (!beingId || beingId === "SYSTEM") return;

    // Don't track artifacts on system nodes
    try {
      const node = await Node.findById(nodeId).select("systemRole name").lean();
      if (node?.systemRole) return;

      const content = typeof artifact?.content === "string" ? artifact.content : "";

      // Check for future-tense commitments
      const isIntention = INTENTION_PATTERNS.some((p) => p.test(content));

      const signal = isIntention
        ? { type: "intention", topic: node?.name || nodeId, value: content.slice(0, 200), rootId: null }
        : { type: "artifact", topic: node?.name || nodeId, rootId: null };

      const shouldCompress = await recordSignal(beingId, signal, config);

      if (shouldCompress) {
        compress(beingId).catch((err) =>
          log.debug("InverseTree", `Background compression failed: ${err.message}`),
        );
      }
    } catch (err) {
      log.debug("InverseTree", "afterNote signal recording failed:", err.message);
    }
  }, "inverse-tree");

  // ── afterLLMCall: track activity patterns ──────────────────────────
  core.hooks.register("afterLLMCall", async ({ beingId, rootId, mode, model, usage }) => {
    if (!beingId || beingId === "SYSTEM") return;

    try {
      const shouldCompress = await recordSignal(beingId, {
        type: "llm",
        mode: mode || "unknown",
        rootId: rootId || null,
        tokens: usage?.total_tokens || 0,
      }, config);

      if (shouldCompress) {
        compress(beingId).catch((err) =>
          log.debug("InverseTree", `Background compression failed: ${err.message}`),
        );
      }
    } catch (err) {
      log.debug("InverseTree", "afterLLMCall signal recording failed:", err.message);
    }
  }, "inverse-tree");

  // ── afterToolCall: track tool usage patterns ───────────────────────
  core.hooks.register("afterToolCall", async ({ toolName, args, success, beingId, rootId, mode }) => {
    if (!beingId || beingId === "SYSTEM") return;

    try {
      const shouldCompress = await recordSignal(beingId, {
        type: "tool",
        toolName,
        success,
        rootId: rootId || null,
      }, config);

      if (shouldCompress) {
        compress(beingId).catch((err) =>
          log.debug("InverseTree", `Background compression failed: ${err.message}`),
        );
      }
    } catch (err) {
      log.debug("InverseTree", "afterToolCall signal recording failed:", err.message);
    }
  }, "inverse-tree");

  // ── afterNavigate: track spatial patterns ─────────────────────────────
  // Which trees the user spends time in vs passes through. Which branches
  // they visit repeatedly. This is the data that lets the profile say
  // "tabor is most active 10pm-2am in /Health/Fitness" rather than just
  // "tabor writes notes about fitness."
  core.hooks.register("afterNavigate", async ({ beingId, rootId, nodeId }) => {
    if (!beingId || beingId === "SYSTEM") return;
    if (!rootId) return;

    try {
      const shouldCompress = await recordSignal(beingId, {
        type: "navigation",
        rootId,
        nodeId: nodeId || rootId,
      }, config);

      if (shouldCompress) {
        compress(beingId).catch((err) =>
          log.debug("InverseTree", `Background compression failed: ${err.message}`),
        );
      }
    } catch (err) {
      log.debug("InverseTree", "afterNavigate signal recording failed:", err.message);
    }
  }, "inverse-tree");

  // ── enrichContext: inject profile scoped by zone ─────────────────────
  // Home and tree zones get the profile. Land zone does not. A land-manager
  // AI diagnosing federation issues doesn't need to know the user works out
  // on weekends. profileZones config controls this. Default: ["home", "tree"].
  const profileZones = config.profileZones || ["home", "tree"];

  core.hooks.register("enrichContext", async ({ context, node, meta, beingId }) => {
    if (!beingId) return;

    // Determine zone from node: system nodes = land zone, rootOwner = tree zone root,
    // no rootOwner + no systemRole = somewhere in a tree or home
    const isLandZone = !!node.systemRole;
    const isTreeZone = !node.systemRole && (!!node.rootOwner || !!node.parent);
    const isHomeZone = !node.systemRole && !node.parent; // orphan = home context

    let zone = "tree"; // default
    if (isLandZone) zone = "land";
    else if (isHomeZone) zone = "home";

    if (!profileZones.includes(zone)) return;

    try {
      const Being = core.models.Being;
      const user = await Being.findById(beingId).select("metadata").lean();
      if (!user) return;

      const inverseData = user.metadata instanceof Map
        ? user.metadata.get("inverse-tree") || {}
        : user.metadata?.["inverse-tree"] || {};

      const profile = inverseData.profile;
      if (profile && Object.keys(profile).length > 0) {
        context.userProfile = profile;
      }
    } catch (err) {
      log.debug("InverseTree", "enrichContext profile lookup failed:", err.message);
    }
  }, "inverse-tree");

  const { default: router } = await import("./routes.js");

  // Register HTML page with html-rendering
  try {
    const { getExtension } = await import("../loader.js");
    const htmlExt = getExtension("html-rendering");
    if (htmlExt) {
      const { default: buildHtmlRoutes } = await import("./htmlRoutes.js");
      htmlExt.router.use("/", buildHtmlRoutes());
    }
  } catch {}

  return {
    router,
    tools,
    exports: {
      compress,
      recordSignal,
      getProfile,
    },
  };
}
