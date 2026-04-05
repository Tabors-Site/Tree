/**
 * Core HTML intercept routes for treeos.
 * Mounted at /api/v1 BEFORE kernel routes.
 * Each route checks for ?html. If present, renders HTML. If not, next().
 * The kernel route handles JSON. This route handles HTML. Clean separation.
 */

import express from "express";
import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import User from "../../seed/models/user.js";
import mongoose from "mongoose";
import { sendOk, sendError, ERR, DELETED } from "../../seed/protocol.js";
import { getUserMeta } from "../../seed/tree/userMetadata.js";
import { getExtMeta, setExtMeta } from "../../seed/tree/extensionMetadata.js";
import { getTreeStructure } from "../../seed/tree/treeData.js";
import { getContributions } from "../../seed/tree/contributions.js";
import { buildPathString } from "../../seed/tree/treeFetch.js";
import { getNodeChats } from "../../seed/llm/chatHistory.js";
import { getConnectionsForUser, getAllRootLlmSlots } from "../../seed/llm/connections.js";
import getNodeName from "../../routes/api/helpers/getNameById.js";
import { getExtension } from "../loader.js";
import { isHtmlEnabled } from "../html-rendering/config.js";
import urlAuth from "../html-rendering/urlAuth.js";
import authenticate from "../../seed/middleware/authenticate.js";
import authenticateLite from "../html-rendering/authenticateLite.js";
import { htmlOnly, buildQS, tokenQS } from "../html-rendering/htmlHelpers.js";

// Page renderers (imported directly from local pages)
import { renderUserProfile } from "./pages/profile.js";
import { renderNodeDetail } from "./pages/nodeDetail.js";
import { renderVersionDetail } from "./pages/versionDetail.js";
import { renderNodeChats } from "./pages/nodeChats.js";
import { renderRootChats } from "./pages/nodeChats.js";
import { renderRootOverview } from "./pages/treeOverview.js";
import { renderNotesList } from "./pages/notesList.js";
import { renderNodeMetadata } from "./pages/nodeMetadata.js";
import { renderTextNote, renderFileNote } from "./pages/noteDetail.js";
import { renderEditorPage } from "./pages/editor.js";
import { renderQueryPage } from "./pages/query.js";
import { renderContributions } from "./pages/contributions.js";
import { renderCommandCenter } from "./pages/commandCenter.js";
import { renderShareToken } from "./pages/shareToken.js";
import { renderLlmPage } from "./pages/llmPage.js";
import { renderNodeLlmPage } from "./pages/nodeLlmPage.js";
import { escapeHtml, renderMedia } from "../html-rendering/html/utils.js";
import { notFoundPage } from "../html-rendering/notFoundPage.js";

// Resolve "latest" to current version from metadata. Prestige extension owns versioning.
// Inlined here to avoid cross-extension dependency.
async function resolveVersion(nodeId, version) {
  if (version === "latest" || version === undefined) {
    const node = await Node.findById(nodeId).select("metadata").lean();
    const meta = node?.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node?.metadata || {});
    return meta.prestige?.current || 0;
  }
  return Number(version);
}

export function buildTreeosHtmlRoutes() {
  const router = express.Router();

  // Sanitize token on every request before it reaches any renderer.
  // Share tokens are [A-Za-z0-9\-_.~] only. Anything else is stripped.
  const TOKEN_SAFE = /^[A-Za-z0-9\-_.~]+$/;
  router.use((req, _res, next) => {
    if (req.query.token && !TOKEN_SAFE.test(req.query.token)) {
      req.query.token = "";
    }
    next();
  });

  // ===================================================================
  // CONTRIBUTIONS
  // ===================================================================

  router.get("/node/:nodeId/:version/contributions", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { nodeId } = req.params;
      let version = req.params.version;
      try { version = String(await resolveVersion(nodeId, version)); } catch {}
      const parsedVersion = Number(version);
      if (isNaN(parsedVersion)) return sendError(res, 400, ERR.INVALID_INPUT, "Invalid version");

      const limit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
      const result = await getContributions({
        nodeId,
        version: parsedVersion,
        limit,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
      });

      const nodeName = await getNodeName(nodeId);
      return res.send(renderContributions({
        nodeId,
        version: parsedVersion,
        nodeName,
        contributions: result.contributions || [],
        queryString: buildQS(req),
      }));
    } catch (err) {
      log.error("HTML", "Contributions render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.get("/node/:nodeId/contributions", urlAuth, htmlOnly, async (req, res) => {
    try {
      const version = String(await resolveVersion(req.params.nodeId, "latest"));
      req.params.version = version;
      req.url = `/node/${req.params.nodeId}/${version}/contributions?${new URLSearchParams(req.query)}`;
      router.handle(req, res, () => {});
    } catch (err) {
      sendError(res, 404, ERR.NODE_NOT_FOUND, err.message);
    }
  });

  // ===================================================================
  // APPS
  // ===================================================================

  router.get("/user/:userId/apps", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await User.findById(userId).select("username").lean();
      if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");

      // rootMap: appKey -> [{ id, name, ready }]
      const rootMap = new Map();
      function addToMap(key, id, name, ready) {
        if (!rootMap.has(key)) rootMap.set(key, []);
        // Deduplicate
        if (rootMap.get(key).some(e => e.id === id)) return;
        rootMap.get(key).push({ id, name, ready });
      }

      const NAME_MAP = {
        food: "Food", fitness: "Fitness", recovery: "Recovery",
        study: "Study", kb: "KB", relationships: "Relationships",
        finance: "Finance", investor: "Investor", "market-researcher": "Market Researcher",
      };

      // Prefer life domains (organized under one tree)
      const life = getExtension("life");
      let foundViaLife = false;
      if (life?.exports?.getDomainNodes && life?.exports?.findLifeRoot) {
        try {
          const lifeRootId = await life.exports.findLifeRoot(userId);
          if (lifeRootId) {
            const domainNodes = await life.exports.getDomainNodes(lifeRootId);
            for (const [key, info] of Object.entries(domainNodes)) {
              addToMap(NAME_MAP[key] || key, info.id, info.name, info.ready);
              foundViaLife = true;
            }
          }
        } catch {}
      }

      // Fallback: scan all roots only if life didn't find anything
      if (!foundViaLife) {
        const roots = await Node.find({
          rootOwner: userId,
          parent: { $ne: DELETED },
        }).select("_id name metadata").lean();
        const EXTENSIONS = Object.keys(NAME_MAP);
        for (const r of roots) {
          const meta = r.metadata instanceof Map ? Object.fromEntries(r.metadata) : (r.metadata || {});
          for (const ext of EXTENSIONS) {
            if (meta[ext]?.initialized) {
              addToMap(NAME_MAP[ext], String(r._id), r.name, meta[ext].setupPhase === "complete");
            }
          }
        }
      }

      const { renderAppsPage } = await import("./pages/appsPage.js");
      res.send(renderAppsPage({
        userId,
        username: user.username,
        rootMap,
        qs: req.query,
      }));
    } catch (err) {
      log.error("HTML", "Apps page error:", err.message);
      sendError(res, 500, ERR.INTERNAL, "Apps page failed");
    }
  });

  router.post("/user/:userId/apps/create", authenticate, async (req, res) => {
    try {
      const { userId } = req.params;
      if (req.userId !== userId) return sendError(res, 403, ERR.FORBIDDEN, "Not your account");

      const { app: appKey, message } = req.body;
      if (!appKey || !message) return sendError(res, 400, ERR.INVALID_INPUT, "app and message required");

      // App definitions: key -> { treeName, dashboardPath, multiInstance }
      const APP_DEFS = {
        fitness:  { treeName: "Fitness",  dashboardPath: "fitness",  multiInstance: false },
        food:     { treeName: "Food",     dashboardPath: "food",     multiInstance: false },
        recovery: { treeName: "Recovery", dashboardPath: "recovery", multiInstance: false },
        study:    { treeName: "Study",    dashboardPath: "study",    multiInstance: false },
        kb:       { treeName: "Knowledge Base", dashboardPath: "kb", multiInstance: true },
        relationships: { treeName: "Relationships", dashboardPath: "relationships", multiInstance: false },
        finance:  { treeName: "Finance",  dashboardPath: "finance",  multiInstance: false },
        investor: { treeName: "Investor", dashboardPath: "investor", multiInstance: false },
        "market-researcher": { treeName: "Market Researcher", dashboardPath: "market-researcher", multiInstance: false },
      };
      const appDef = APP_DEFS[appKey];
      if (!appDef) return sendError(res, 400, ERR.INVALID_INPUT, "Unknown app");

      const qs = req.body.token ? `?html&token=${req.body.token}` : "?html";
      const msgParam = `&startMsg=${encodeURIComponent(message)}`;

      // Try life extension for organized scaffolding under Life tree
      const life = getExtension("life");
      if (life?.exports?.addDomain && !appDef.multiInstance) {
        let lifeRootId = await life.exports.findLifeRoot(userId);
        if (!lifeRootId) {
          const result = await life.exports.scaffoldRoot(userId);
          lifeRootId = result.rootId;
        }

        // Check if domain already exists under Life
        const domains = await life.exports.getDomainNodes(lifeRootId);
        if (domains[appKey]) {
          return res.redirect(`/api/v1/root/${domains[appKey].id}/${appDef.dashboardPath}${qs}${msgParam}`);
        }

        const { id: domainId } = await life.exports.addDomain({ rootId: lifeRootId, domain: appKey, userId });
        return res.redirect(`/api/v1/root/${domainId}/${appDef.dashboardPath}${qs}${msgParam}`);
      }

      // Fallback: no life extension or multi-instance. Create standalone root.
      if (!appDef.multiInstance) {
        const existing = await Node.findOne({
          parent: { $ne: DELETED },
          [`metadata.${appKey}.initialized`]: true,
          [`metadata.${appKey}.setupPhase`]: "base",
        }).select("_id").lean();
        if (existing) {
          return res.redirect(`/api/v1/root/${existing._id}/${appDef.dashboardPath}${qs}${msgParam}`);
        }
      }

      const treeName = appDef.multiInstance ? (message.slice(0, 80) || appDef.treeName) : appDef.treeName;
      const { createNode } = await import("../../seed/tree/treeManagement.js");
      const rootNode = await createNode({ name: treeName, isRoot: true, userId });
      return res.redirect(`/api/v1/root/${rootNode._id}/${appDef.dashboardPath}${qs}${msgParam}`);
    } catch (err) {
      log.error("HTML", "App create error:", err.message);
      sendError(res, 500, ERR.INTERNAL, "App creation failed");
    }
  });

  // USER PROFILE
  // ===================================================================

  // Share token management page
  router.get("/user/:userId/llm", urlAuth, async (req, res) => {
    try {
      const { userId } = req.params;
      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
      const connections = await getConnectionsForUser(userId);
      const user = await User.findById(userId).select("username llmDefault metadata").lean();

      if (!wantHtml || !isHtmlEnabled()) {
        return sendOk(res, { connections, mainAssignment: user?.llmDefault || null });
      }

      const userSlots = getUserMeta(user, "userLlm")?.slots || {};
      const { getAllUserLlmSlots } = await import("../../seed/llm/connections.js");
      const allUserSlots = getAllUserLlmSlots();
      const token = req.query.token ?? "";
      const qs = token ? `?token=${encodeURIComponent(token)}&html` : "?html";

      return res.send(renderLlmPage({
        userId,
        username: user?.username || "",
        connections,
        mainAssignment: user?.llmDefault || null,
        allUserSlots,
        userSlots,
        treeSlots: {},
        rootId: null,
        rootName: null,
        qs,
      }));
    } catch (err) {
      log.error("HTML", "LLM page error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.get("/user/:userId/shareToken", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await User.findById(userId).select("username metadata").lean();
      if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");
      const token = req.query.token ?? "";
      const tqs = token ? `?token=${encodeURIComponent(token)}&html` : "?html";
      const { getUserMeta: _gum } = await import("../../seed/tree/userMetadata.js");
      const htmlMeta = _gum(user, "html");
      const savedShareToken = htmlMeta?.shareToken || null;
      return res.send(renderShareToken({ userId, user, token, tokenQS: tqs, savedShareToken }));
    } catch (err) {
      log.error("HTML", "Share token page error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.get("/user/:userId", urlAuth, htmlOnly, async (req, res) => {
    try {
      const userId = req.params.userId;
      const user = await User.findById(userId).exec();
      if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");

      (getExtension("energy")?.exports?.maybeResetEnergy || (() => false))(user);

      const roots = (await getExtension("navigation")?.exports?.getUserRootsWithNames(userId)) || [];
      const billingMeta = getUserMeta(user, "billing");
      const plan = billingMeta.plan || "basic";
      const energyData = getUserMeta(user, "energy");
      const energy = energyData.available;
      const extraEnergy = energyData.additional;

      const ENERGY_RESET_MS = 24 * 60 * 60 * 1000;
      const storageUsedKB = getUserMeta(user, "storage").usageKB || 0;
      const lastResetAt = energy?.lastResetAt ? new Date(energy.lastResetAt) : null;
      const nextResetAt = lastResetAt ? new Date(lastResetAt.getTime() + ENERGY_RESET_MS) : null;
      const resetTimeLabel = nextResetAt
        ? nextResetAt.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" })
        : "...";

      return res.send(renderUserProfile({
        userId,
        user,
        roots,
        queryString: buildQS(req),
        storageUsedKB,
      }));
    } catch (err) {
      log.error("HTML", "User profile render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // ===================================================================
  // NODE DETAIL
  // ===================================================================

  router.get("/node/:nodeId", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const node = await Node.findById(nodeId).populate("children", "name").lean();
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

      const parentName = node.parent ? await getNodeName(node.parent) : null;
      const qs = buildQS(req);
      const rootUrl = `/api/v1/root/${nodeId}${qs}`;

      return res.send(renderNodeDetail({
        node,
        nodeId,
        qs,
        parentName,
        rootUrl,
        isPublicAccess: !!req.isPublicAccess,
      }));
    } catch (err) {
      log.error("HTML", "Node detail render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // -- NODE METADATA ---------------------------------------------------

  router.get("/node/:nodeId/metadata", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const node = await Node.findById(nodeId).lean();
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

      const qs = buildQS(req);
      const rootId = node.rootOwner || nodeId;
      const backUrl = node.rootOwner
        ? `/api/v1/root/${rootId}${qs}`
        : `/api/v1/node/${nodeId}${qs}`;

      return res.send(renderNodeMetadata({ node, nodeId, qs, backUrl }));
    } catch (err) {
      log.error("HTML", "Node metadata render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // Edit a metadata field: POST /node/:nodeId/metadata/:namespace/:key
  router.post("/node/:nodeId/metadata/:namespace/:key", authenticate, async (req, res) => {
    try {
      const { nodeId, namespace, key } = req.params;
      const { value } = req.body;
      const node = await Node.findById(nodeId);
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

      const { batchSetExtMeta } = await import("../../seed/tree/extensionMetadata.js");
      await batchSetExtMeta(nodeId, namespace, { [key]: value });
      return sendOk(res, { updated: true, namespace, key, value });
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // Delete a metadata namespace: DELETE /node/:nodeId/metadata/:namespace
  router.delete("/node/:nodeId/metadata/:namespace", authenticate, async (req, res) => {
    try {
      const { nodeId, namespace } = req.params;
      const node = await Node.findById(nodeId);
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

      const { unsetExtMeta } = await import("../../seed/tree/extensionMetadata.js");
      await unsetExtMeta(nodeId, namespace);
      return sendOk(res, { deleted: true, namespace });
    } catch (err) {
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // -- COMMAND CENTER -------------------------------------------------
  // Must be before /node/:nodeId/:version so "command-center" isn't matched as a version.

  router.get("/node/:nodeId/command-center", urlAuth, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const node = await Node.findById(nodeId).select("name metadata parent rootOwner systemRole").lean();
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

      const rootId = node.rootOwner || nodeId;
      const rootNode = rootId !== nodeId ? await Node.findById(rootId).select("name").lean() : node;

      let path = node.name;
      try { path = await buildPathString(nodeId); } catch {}

      const { getBlockedExtensionsAtNode, getToolOwner, getModeOwner, getConfinedExtensions } = await import("../../seed/tree/extensionScope.js");
      const scope = await getBlockedExtensionsAtNode(nodeId);
      const confinedSet = getConfinedExtensions();

      const isLandRoot = node.systemRole === "land-root";

      const { getAllToolNamesForBigMode, getSubModes } = await import("../../seed/modes/registry.js");
      const { resolveTools } = await import("../../seed/tools.js");
      const { filterToolNamesByScope } = await import("../../seed/tree/extensionScope.js");

      const toolZones = isLandRoot ? ["tree", "home", "land"] : [node.rootOwner ? "tree" : "home"];
      const allToolNames = [...new Set(toolZones.flatMap(z => getAllToolNamesForBigMode(z)))];
      const filteredToolNames = filterToolNamesByScope(allToolNames, scope.blocked, scope.restricted);
      const toolDefs = resolveTools(allToolNames);

      const toolConfig = getExtMeta(node, "tools");
      const nodeBlocked = new Set(toolConfig.blocked || []);
      const nodeAllowed = new Set(toolConfig.allowed || []);

      const tools = allToolNames.map(name => {
        const def = toolDefs.find(d => d.function?.name === name);
        const owner = getToolOwner(name);
        const isFiltered = !filteredToolNames.includes(name);
        const isNodeBlocked = nodeBlocked.has(name);

        let status = "active";
        if (isFiltered) status = scope.restricted?.has(owner) ? "restricted" : "blocked";
        if (isNodeBlocked) status = "blocked";

        return {
          name,
          description: def?.function?.description || "",
          extName: owner || "core",
          readOnly: owner?.readOnly || false,
          destructive: def?.function?.annotations?.destructiveHint || false,
          status,
          nodeBlocked: isNodeBlocked,
        };
      });

      // Land root sees all modes (blocking here cascades everywhere).
      // Tree nodes see only tree modes. Home sees home modes.
      const allModes = isLandRoot
        ? [...(getSubModes("tree") || []), ...(getSubModes("home") || []), ...(getSubModes("land") || [])]
        : getSubModes(node.rootOwner ? "tree" : "home") || [];

      const modeOverrides = getExtMeta(node, "modes");

      const modes = allModes.map(m => {
        const owner = getModeOwner(m.key);
        const isBlocked = owner ? scope.blocked.has(owner) : false;

        return {
          key: m.key,
          emoji: m.emoji || "",
          label: m.label || m.key,
          bigMode: m.key.split(":")[0] || "tree",
          extName: owner || "",
          intent: m.key.split(":")[1] || "",
          status: isBlocked ? "blocked" : "active",
        };
      });

      const { getLoadedManifests } = await import("../../extensions/loader.js");
      const manifests = getLoadedManifests();

      const extensions = manifests.map(m => {
        let status = "active";
        if (scope.blocked.has(m.name)) status = "blocked";
        else if (scope.restricted?.has(m.name)) status = "restricted";
        else if (confinedSet.has(m.name) && !scope.allowed?.has(m.name)) status = "confined";

        return {
          name: m.name,
          version: m.version || "",
          description: m.description || "",
          status,
        };
      }).sort((a, b) => {
        const order = { active: 0, restricted: 1, confined: 2, blocked: 3 };
        return (order[a.status] || 4) - (order[b.status] || 4);
      });

      const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

      if (!wantHtml) {
        const active = tools.filter(t => t.status === "active");
        const blocked = tools.filter(t => t.status !== "active");
        return sendOk(res, {
          node: { id: nodeId, name: node.name, path },
          root: { id: rootId, name: rootNode?.name || rootId },
          tools: { active: active.length, blocked: blocked.length, total: tools.length },
          modes: modes.map(m => `${m.emoji} ${m.key} (${m.status})`),
          extensions: extensions.map(e => `${e.name} (${e.status})`),
        });
      }

      const qs = req.query.token ? `?token=${req.query.token}&html` : "?html";

      return res.send(renderCommandCenter({
        nodeId, nodeName: node.name || nodeId, rootId, rootName: rootNode?.name || rootId, path,
        extensions, tools, modes, toolConfig, modeOverrides,
        blocked: scope.blocked, restricted: scope.restricted, allowed: scope.allowed, confined: confinedSet, qs,
      }));
    } catch (err) {
      log.error("HTML", "Command center error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // ===================================================================
  // NODE VERSION DETAIL
  // ===================================================================

  router.get("/node/:nodeId/:version", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { nodeId } = req.params;
      let v = Number(req.params.version);
      if (isNaN(v)) {
        try { v = Number(await resolveVersion(nodeId, req.params.version)); } catch {
          return sendError(res, 404, ERR.NODE_NOT_FOUND, "Invalid version");
        }
      }

      const node = await Node.findById(nodeId).lean();
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

      const meta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
      const prestigeData = meta.prestige || {};
      const status = (Array.isArray(meta.prestige?.history) ? meta.prestige.history.find(h => h.version === v)?.status : null) || node.status || "active";
      const values = meta.values || {};
      const goals = meta.goals || {};
      const schedule = meta.schedules?.date || null;
      const reeffectTime = meta.schedules?.reeffectTime || null;
      const showPrestige = v === (prestigeData.current || 0);

      const qs = buildQS(req);
      const backUrl = `/api/v1/node/${nodeId}${qs}`;
      const backTreeUrl = `/api/v1/root/${nodeId}${qs}`;
      const createdDate = node.dateCreated ? new Date(node.dateCreated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
      const scheduleHtml = "";

      const ALL_STATUSES = ["active", "completed", "trimmed"];
      const STATUS_LABELS = { active: "Active", completed: "Completed", trimmed: "Trimmed" };

      return res.send(renderVersionDetail({
        node, nodeId, version: v,
        data: { status, values, goals, schedule, prestige: prestigeData, reeffectTime },
        qs, backUrl, backTreeUrl, createdDate, scheduleHtml, reeffectTime,
        showPrestige, prestigeData, ALL_STATUSES, STATUS_LABELS,
      }));
    } catch (err) {
      log.error("HTML", "Version detail render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // ===================================================================
  // NODE CHATS
  // ===================================================================

  router.get("/node/:nodeId/chats", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const node = await Node.findById(nodeId).select("name rootOwner").lean();
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

      const sessionLimit = Math.min(Number(req.query.limit) || 3, 10);
      const { sessions } = await getNodeChats({
        nodeId,
        sessionLimit,
        sessionId: req.query.sessionId || null,
        startDate: req.query.startDate || null,
        endDate: req.query.endDate || null,
        includeChildren: false,
      });

      const allChats = sessions.flatMap(s => s.chats);
      const nodePath = await buildPathString(nodeId);
      const token = req.query.token || "";
      const tQS = token ? `?token=${encodeURIComponent(token)}&html` : "?html";

      return res.send(renderNodeChats({
        nodeId,
        nodeName: node.name,
        nodePath,
        sessions,
        allChats,
        token,
        tokenQS: tQS,
      }));
    } catch (err) {
      log.error("HTML", "Node chats render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // ===================================================================
  // ROOT OVERVIEW
  // ===================================================================

  router.get("/root/:nodeId", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const queryString = buildQS(req, ["token", "html", "trimmed", "active", "completed", "startDate", "endDate", "month", "year"]);

      const allData = await getTreeStructure(nodeId, {
        active: req.query.active !== "false",
        trimmed: req.query.trimmed === "true",
        completed: req.query.completed !== "false",
      });

      const rootMeta = await Node.findById(nodeId)
        .populate("rootOwner", "username _id isAdmin metadata")
        .populate("contributors", "username _id isRemote homeLand")
        .select("rootOwner contributors metadata llmDefault visibility")
        .lean().exec();
      const rootNode = await Node.findById(nodeId).select("parent rootOwner").lean();
      const isDeleted = rootNode.parent === DELETED;
      const isRoot = !!rootNode.rootOwner;
      const isPublicAccess = !!req.isPublicAccess;
      const isOwner = rootMeta?.rootOwner?._id?.toString() === req.userId?.toString();
      const queryAvailable = isPublicAccess
        ? !!((rootMeta?.llmDefault && rootMeta.llmDefault !== "none") || req.canopyVisitor)
        : false;

      const currentUserId = req.userId ? req.userId.toString() : null;
      const token = req.query.token ?? "";

      let deferredItems = [];
      if (!isPublicAccess && mongoose.models.ShortMemory) {
        deferredItems = await mongoose.models.ShortMemory.find({
          rootId: nodeId, status: { $in: ["pending", "escalated"] },
        }).sort({ createdAt: -1 }).lean();
      }

      let ownerConnections = [];
      if (!isPublicAccess && isOwner && rootMeta?.rootOwner) {
        ownerConnections = await getConnectionsForUser(rootMeta.rootOwner._id.toString());
      }

      const { getAllRootLlmSlots } = await import("../../seed/llm/connections.js");
      const allRootSlots = getAllRootLlmSlots();

      return res.send(renderRootOverview({
        allData, rootMeta, ancestors: allData.ancestors || [],
        isOwner, isDeleted, isRoot, isPublicAccess, queryAvailable,
        currentUserId, queryString, nodeId, userId: req.userId,
        token, deferredItems, ownerConnections, allRootSlots,
      }));
    } catch (err) {
      log.error("HTML", "Root overview render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // ===================================================================
  // NODE LLM PAGE
  // ===================================================================

  router.get("/root/:rootId/llm", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { rootId } = req.params;
      const root = await Node.findById(rootId).select("name llmDefault metadata rootOwner").lean();
      if (!root) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Tree not found");

      const userId = req.userId;
      const isOwner = root.rootOwner && String(root.rootOwner) === String(userId);
      if (!isOwner) return sendError(res, 403, ERR.FORBIDDEN, "Only the tree owner can manage LLM assignments");

      const connections = await getConnectionsForUser(userId);
      const qs = buildQS(req);

      const meta = root.metadata instanceof Map ? Object.fromEntries(root.metadata) : (root.metadata || {});
      const llmSlots = meta.llm?.slots || {};
      const allSlots = getAllRootLlmSlots();

      return res.send(renderNodeLlmPage({
        nodeId: rootId,
        nodeName: root.name,
        connections,
        defaultLlm: root.llmDefault || null,
        slots: llmSlots,
        allSlots,
        qs,
        userId,
      }));
    } catch (err) {
      log.error("HTML", "Node LLM page error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // ===================================================================
  // QUERY PAGE
  // ===================================================================

  router.get("/root/:rootId/query", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { rootId } = req.params;
      const root = await Node.findById(rootId)
        .select("name rootOwner visibility llmDefault metadata contributors")
        .populate("rootOwner", "username").lean();
      if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Tree not found");

      const isAuthenticated = !!req.userId;
      const isOwner = isAuthenticated && String(root.rootOwner?._id) === String(req.userId);
      const isContributor = isAuthenticated && (root.contributors || []).map(String).includes(String(req.userId));
      if (root.visibility !== "public" && !isOwner && !isContributor) {
        return sendError(res, 403, ERR.FORBIDDEN, "This tree is not public.");
      }

      const treeHasLlm = !!(root.llmDefault && root.llmDefault !== "none");
      return res.send(renderQueryPage({
        treeName: root.name || "Untitled",
        ownerUsername: root.rootOwner?.username || "unknown",
        rootId, queryAvailable: treeHasLlm || isOwner || isContributor,
        isAuthenticated,
      }));
    } catch (err) {
      log.error("HTML", "Query page render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // ===================================================================
  // ROOT CHATS
  // ===================================================================

  router.get("/root/:rootId/chats", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { rootId } = req.params;
      const root = await Node.findById(rootId).select("name rootOwner").lean();
      if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Tree not found");

      const sessionLimit = Math.min(Number(req.query.limit) || 3, 10);
      const { sessions } = await getNodeChats({
        nodeId: rootId, sessionLimit,
        sessionId: req.query.sessionId || null,
        startDate: req.query.startDate || null,
        endDate: req.query.endDate || null,
        includeChildren: true,
      });

      const allChats = sessions.flatMap(s => s.chats);
      const token = req.query.token || "";
      const tQS = token ? `?token=${encodeURIComponent(token)}&html` : "?html";

      return res.send(renderRootChats({
        rootId, rootName: root.name, sessions, allChats, token, tokenQS: tQS,
      }));
    } catch (err) {
      log.error("HTML", "Root chats render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // ===================================================================
  // NOTES
  // ===================================================================

  router.get("/node/:nodeId/:version/notes/editor", authenticate, async (req, res, next) => {
    if (!isHtmlEnabled()) return next("route");
    try {
      const { nodeId, version } = req.params;
      const qs = buildQS(req);
      const tqs = tokenQS(req);
      return res.send(renderEditorPage({
        nodeId, version, noteId: null, noteContent: "", qs, tokenQS: tqs, originalLength: 0,
      }));
    } catch (err) {
      log.error("HTML", "Editor page error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.get("/node/:nodeId/:version/notes/:noteId/editor", authenticate, async (req, res, next) => {
    if (!isHtmlEnabled()) return next("route");
    try {
      const { nodeId, version, noteId } = req.params;
      const qs = buildQS(req);
      const tqs = tokenQS(req);
      const Note = (await import("../../seed/models/note.js")).default;
      const note = await Note.findById(noteId).lean();
      if (!note) return notFoundPage?.(req, res, "This note doesn't exist or may have been removed.") || sendError(res, 404, ERR.NOTE_NOT_FOUND, "Note not found");
      if (note.contentType !== "text") return res.redirect(`/api/v1/node/${nodeId}/${version}/notes/${noteId}${tqs}`);
      return res.send(renderEditorPage({
        nodeId, version, noteId, noteContent: note.content || "", qs, tokenQS: tqs, originalLength: (note.content || "").length,
      }));
    } catch (err) {
      log.error("HTML", "Editor page error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.get("/node/:nodeId/:version/notes", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { nodeId, version } = req.params;
      const Note = (await import("../../seed/models/note.js")).default;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const query = { nodeId };
      // Version lives in metadata.version (set by prestige beforeNote hook), not a top-level field
      const v = Number(version);
      if (!isNaN(v) && v > 0) query["metadata.version"] = v;
      if (req.query.startDate) query.createdAt = { ...query.createdAt, $gte: new Date(req.query.startDate) };
      if (req.query.endDate) query.createdAt = { ...query.createdAt, $lte: new Date(req.query.endDate) };

      const notes = await Note.find(query)
        .populate("userId", "username")
        .sort({ date: -1 }).limit(limit).lean();

      const nodeName = await getNodeName(nodeId);
      const token = req.query.token || "";
      return res.send(renderNotesList({
        nodeId, version: Number(version), token, nodeName,
        notes, currentUserId: req.userId,
      }));
    } catch (err) {
      log.error("HTML", "Notes list render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.get("/node/:nodeId/:version/notes/:noteId", authenticateLite, htmlOnly, async (req, res) => {
    try {
      const { nodeId, version, noteId } = req.params;
      const Note = (await import("../../seed/models/note.js")).default;
      const note = await Note.findById(noteId).populate("userId", "username").lean();
      if (!note) return sendError(res, 404, ERR.NOTE_NOT_FOUND, "Note not found");

      const token = req.query.token || "";
      const hasToken = !!token;
      const qs = buildQS(req);

      // Public share link (no token): back goes to land home, no editor
      // Authenticated (token or JWT): back goes to notes list, editor available
      let back, backText;
      if (hasToken || req.userId) {
        back = `/api/v1/node/${nodeId}/${version}/notes${qs}`;
        backText = "\u2190 Back to Notes";
      } else {
        try {
          const { getLandUrl } = await import("../../canopy/identity.js");
          back = getLandUrl() || "/";
        } catch { back = "/"; }
        backText = "\u2190 Back to Home";
      }

      const safeUsername = escapeHtml?.(note.userId?.username || "Unknown") || (note.userId?.username || "Unknown");
      const userLink = hasToken || req.userId
        ? `<a href="/api/v1/user/${note.userId?._id || ""}${qs}">${safeUsername}</a>`
        : `<span>${safeUsername}</span>`;

      if (note.contentType === "text") {
        return res.send(renderTextNote({ back, backText, userLink, editorButton: hasToken || !!req.userId, note, hasToken }));
      }

      // File note
      const filePath = note.content;
      const fs = await import("fs");
      const path = await import("path");
      const fileName = path.default.basename(filePath || "");
      const fileUrl = `/api/v1/uploads/${fileName}`;
      const fileDeleted = filePath ? !fs.default.existsSync(filePath) : true;
      const mime = (await import("mime-types")).default;
      const mimeType = mime.lookup(fileName) || "application/octet-stream";
      const mediaHtml = renderMedia?.(fileUrl, mimeType, { lazy: false }) || "";

      return res.send(renderFileNote({ back, backText, userLink, note, fileName, fileUrl, mediaHtml, fileDeleted, hasToken }));
    } catch (err) {
      log.error("HTML", "Note detail render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // ===================================================================
  // MUTATION REDIRECTS (POST/PUT/DELETE with ?html)
  // The extension calls kernel functions, then redirects to HTML view.
  // ===================================================================

  // POST create note -> redirect to notes list
  router.post("/node/:nodeId/:version/notes", authenticate, htmlOnly, async (req, res, next) => {
    try {
      const { createNote } = await import("../../seed/tree/notes.js");
      const { nodeId, version } = req.params;

      if (req.body.content) {
        await createNote({
          contentType: "text",
          content: req.body.content,
          userId: req.userId,
          nodeId,
        });
      }

      const tqs = tokenQS(req);
      return res.redirect(`/api/v1/node/${nodeId}/${version}/notes${tqs}`);
    } catch (err) {
      log.error("HTML", "Create note redirect error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // PUT edit node status -> redirect
  router.put("/node/:nodeId/status", authenticate, htmlOnly, async (req, res) => {
    try {
      const { editNodeStatus } = await import("../../seed/tree/statuses.js");
      await editNodeStatus({
        nodeId: req.params.nodeId,
        newStatus: req.body.status,
        userId: req.userId,
      });
      return res.redirect(`/api/v1/node/${req.params.nodeId}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Edit status redirect error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // PUT edit node name -> redirect
  router.put("/node/:nodeId/name", authenticate, htmlOnly, async (req, res) => {
    try {
      const { editNodeName } = await import("../../seed/tree/treeManagement.js");
      await editNodeName({
        nodeId: req.params.nodeId,
        newName: req.body.name,
        userId: req.userId,
      });
      return res.redirect(`/api/v1/node/${req.params.nodeId}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Edit name redirect error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // PUT move node (update parent) -> redirect
  router.put("/node/:nodeId/parent", authenticate, htmlOnly, async (req, res) => {
    try {
      const { updateParentRelationship: updateParent } = await import("../../seed/tree/treeManagement.js");
      await updateParent({
        nodeId: req.params.nodeId,
        newParentId: req.body.newParentId,
        userId: req.userId,
      });
      return res.redirect(`/api/v1/node/${req.params.nodeId}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Move node redirect error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // PUT set modes -> redirect
  router.put("/node/:nodeId/modes", authenticate, htmlOnly, async (req, res) => {
    try {
      const node = await Node.findById(req.params.nodeId);
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");
      const modes = getExtMeta(node, "modes");
      if (req.body.intent && req.body.modeKey) modes[req.body.intent] = req.body.modeKey;
      if (req.body.clearIntent) delete modes[req.body.clearIntent];
      await setExtMeta(node, "modes", Object.keys(modes).length > 0 ? modes : undefined);
      return res.redirect(`/api/v1/node/${req.params.nodeId}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Set modes redirect error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // PUT set tools -> redirect
  router.put("/node/:nodeId/tools", authenticate, htmlOnly, async (req, res) => {
    try {
      const node = await Node.findById(req.params.nodeId);
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");
      const toolConfig = getExtMeta(node, "tools");
      if (req.body.allow) {
        toolConfig.allowed = [...new Set([...(toolConfig.allowed || []), ...req.body.allow])];
      }
      if (req.body.block) {
        toolConfig.blocked = [...new Set([...(toolConfig.blocked || []), ...req.body.block])];
      }
      if (req.body.clearAllowed) toolConfig.allowed = [];
      if (req.body.clearBlocked) toolConfig.blocked = [];
      await setExtMeta(node, "tools", Object.keys(toolConfig).length > 0 ? toolConfig : undefined);
      return res.redirect(`/api/v1/node/${req.params.nodeId}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Set tools redirect error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // PUT set ext-scope -> redirect
  router.put("/node/:nodeId/ext-scope", authenticate, htmlOnly, async (req, res) => {
    try {
      const node = await Node.findById(req.params.nodeId);
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");
      const { clearScopeCache } = await import("../../seed/tree/extensionScope.js");
      const extConfig = getExtMeta(node, "extensions");
      if (req.body.block) {
        extConfig.blocked = [...new Set([...(extConfig.blocked || []), ...req.body.block])];
      }
      if (req.body.allow) {
        extConfig.blocked = (extConfig.blocked || []).filter(e => !req.body.allow.includes(e));
      }
      await setExtMeta(node, "extensions", Object.keys(extConfig).length > 0 ? extConfig : undefined);
      clearScopeCache();
      return res.redirect(`/api/v1/node/${req.params.nodeId}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Set ext-scope redirect error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // PUT reorder children -> redirect
  router.put("/node/:nodeId/children", authenticate, htmlOnly, async (req, res) => {
    try {
      const { reorderChildren } = await import("../../seed/tree/treeManagement.js");
      await reorderChildren({
        nodeId: req.params.nodeId,
        children: req.body.children,
        userId: req.userId,
      });
      return res.redirect(`/api/v1/node/${req.params.nodeId}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Reorder children redirect error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // DELETE node -> redirect to deleted page
  router.delete("/node/:nodeId", authenticate, htmlOnly, async (req, res) => {
    try {
      const { deleteNodeBranch } = await import("../../seed/tree/treeManagement.js");
      await deleteNodeBranch(req.params.nodeId, req.userId);
      return res.redirect(`/api/v1/user/${req.userId}/deleted${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Delete node redirect error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // -- HTML FORM POST HANDLERS ----------------------------------------
  // HTML forms can only POST. These intercept form submissions from node/version
  // detail pages, perform the operation, and redirect back to the page.

  // Delete node (form POSTs to /node/:nodeId/delete)
  router.post("/node/:nodeId/delete", authenticate, htmlOnly, async (req, res) => {
    try {
      const { deleteNodeBranch } = await import("../../seed/tree/treeManagement.js");
      await deleteNodeBranch(req.params.nodeId, req.userId);
      return res.redirect(`/api/v1/user/${req.userId}/deleted${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Delete node error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // Edit name (form POSTs to /node/:nodeId/editName or /node/:nodeId/:version/editName)
  router.post("/node/:nodeId/:version/editName", authenticate, htmlOnly, async (req, res) => {
    try {
      const { editNodeName } = await import("../../seed/tree/treeManagement.js");
      await editNodeName({ nodeId: req.params.nodeId, newName: req.body.name, userId: req.userId });
      return res.redirect(`/api/v1/node/${req.params.nodeId}/${req.params.version}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Edit name error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.post("/node/:nodeId/editName", authenticate, htmlOnly, async (req, res) => {
    try {
      const { editNodeName } = await import("../../seed/tree/treeManagement.js");
      await editNodeName({ nodeId: req.params.nodeId, newName: req.body.name, userId: req.userId });
      return res.redirect(`/api/v1/node/${req.params.nodeId}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Edit name error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // Edit type (form POSTs to /node/:nodeId/editType)
  router.post("/node/:nodeId/editType", authenticate, htmlOnly, async (req, res) => {
    try {
      const { editNodeType } = await import("../../seed/tree/treeManagement.js");
      await editNodeType({ nodeId: req.params.nodeId, newType: req.body.type || null, userId: req.userId });
      return res.redirect(`/api/v1/node/${req.params.nodeId}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Edit type error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // Edit status (form POSTs to /node/:nodeId/:version/editStatus)
  router.post("/node/:nodeId/:version/editStatus", authenticate, htmlOnly, async (req, res) => {
    try {
      const { editStatus } = await import("../../seed/tree/statuses.js");
      await editStatus({ nodeId: req.params.nodeId, status: req.body.status, userId: req.userId });
      return res.redirect(`/api/v1/node/${req.params.nodeId}/${req.params.version}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Edit status error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.post("/node/:nodeId/editStatus", authenticate, htmlOnly, async (req, res) => {
    try {
      const { editStatus } = await import("../../seed/tree/statuses.js");
      await editStatus({ nodeId: req.params.nodeId, status: req.body.status, userId: req.userId });
      return res.redirect(`/api/v1/node/${req.params.nodeId}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Edit status error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // Create child (form POSTs to /node/:nodeId/createChild)
  router.post("/node/:nodeId/createChild", authenticate, htmlOnly, async (req, res) => {
    try {
      const { createNode } = await import("../../seed/tree/treeManagement.js");
      const names = (req.body.name || "").split(",").map(n => n.trim()).filter(Boolean);
      for (const name of names) {
        await createNode({ name, parentId: req.params.nodeId, userId: req.userId });
      }
      return res.redirect(`/api/v1/node/${req.params.nodeId}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Create child error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // Update parent (form POSTs to /node/:nodeId/updateParent)
  router.post("/node/:nodeId/updateParent", authenticate, htmlOnly, async (req, res) => {
    try {
      const { updateParentRelationship: updateParent } = await import("../../seed/tree/treeManagement.js");
      await updateParent({ nodeId: req.params.nodeId, newParentId: req.body.parentId, userId: req.userId });
      return res.redirect(`/api/v1/node/${req.params.nodeId}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Update parent error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // Prestige (form POSTs to /node/:nodeId/prestige or /node/:nodeId/:version/prestige)
  router.post("/node/:nodeId/prestige", authenticate, htmlOnly, async (req, res) => {
    try {
      const prestigeExt = getExtension("prestige");
      if (!prestigeExt?.exports?.addPrestige) return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, "Prestige extension not loaded");
      await prestigeExt.exports.addPrestige(req.params.nodeId, req.userId);
      return res.redirect(`/api/v1/node/${req.params.nodeId}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Prestige error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.post("/node/:nodeId/:version/prestige", authenticate, htmlOnly, async (req, res) => {
    try {
      const prestigeExt = getExtension("prestige");
      if (!prestigeExt?.exports?.addPrestige) return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, "Prestige extension not loaded");
      await prestigeExt.exports.addPrestige(req.params.nodeId, req.userId);
      const node = await Node.findById(req.params.nodeId).select("metadata").lean();
      const meta = node?.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node?.metadata || {});
      const current = meta.prestige?.current || 0;
      return res.redirect(`/api/v1/node/${req.params.nodeId}/${current}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Prestige error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // Edit schedule (form POSTs to /node/:nodeId/:version/editSchedule)
  router.post("/node/:nodeId/:version/editSchedule", authenticate, htmlOnly, async (req, res) => {
    try {
      const node = await Node.findById(req.params.nodeId);
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");
      const schedule = {};
      if (req.body.startDate) schedule.startDate = req.body.startDate;
      if (req.body.endDate) schedule.endDate = req.body.endDate;
      if (req.body.recurrence) schedule.recurrence = req.body.recurrence;
      await setExtMeta(node, "schedules", Object.keys(schedule).length > 0 ? schedule : null);
      return res.redirect(`/api/v1/node/${req.params.nodeId}/${req.params.version}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Edit schedule error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // PUT root config -> redirect
  router.put("/root/:rootId/config", authenticate, htmlOnly, async (req, res) => {
    try {
      const node = await Node.findById(req.params.rootId);
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Tree not found");

      const { clearScopeCache } = await import("../../seed/tree/extensionScope.js");

      // Apply config updates from body
      const meta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
      const config = meta.config || {};
      for (const [key, value] of Object.entries(req.body)) {
        config[key] = value;
      }
      await setExtMeta(node, "config", config);
      clearScopeCache();

      return res.redirect(`/api/v1/root/${req.params.rootId}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Root config redirect error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // POST create tree -> redirect
  router.post("/user/:userId/trees", authenticate, htmlOnly, async (req, res) => {
    try {
      const { createNode } = await import("../../seed/tree/treeManagement.js");
      const rootNode = await createNode({
        name: req.body.name || "New Tree",
        isRoot: true,
        userId: req.userId,
      });
      return res.redirect(`/api/v1/root/${rootNode._id}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Create tree redirect error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // -- COMMAND CENTER: extension block/allow (HTML form POST) --
  router.post("/node/:nodeId/extensions", authenticate, htmlOnly, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const node = await Node.findById(nodeId);
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

      const { clearScopeCache } = await import("../../seed/tree/extensionScope.js");
      const extConfig = getExtMeta(node, "extensions") || {};

      if (req.body.block) {
        const name = req.body.block;
        extConfig.blocked = [...new Set([...(extConfig.blocked || []), name])];
      }
      if (req.body.allow) {
        const name = req.body.allow;
        extConfig.blocked = (extConfig.blocked || []).filter(e => e !== name);
      }

      await setExtMeta(node, "extensions", Object.keys(extConfig).length > 0 ? extConfig : undefined);
      clearScopeCache();

      const qs = req.query.token ? `?token=${req.query.token}&html` : "?html";
      return res.redirect(`/api/v1/node/${nodeId}/command-center${qs}`);
    } catch (err) {
      log.error("HTML", "CC ext toggle error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // -- COMMAND CENTER: tool block/allow (HTML form POST) --
  router.post("/node/:nodeId/tools", authenticate, htmlOnly, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const node = await Node.findById(nodeId);
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

      const toolConfig = getExtMeta(node, "tools") || {};

      if (req.body.block) {
        const name = req.body.block;
        toolConfig.blocked = [...new Set([...(toolConfig.blocked || []), name])];
        toolConfig.allowed = (toolConfig.allowed || []).filter(t => t !== name);
      }
      if (req.body.allow) {
        const name = req.body.allow;
        toolConfig.allowed = [...new Set([...(toolConfig.allowed || []), name])];
        toolConfig.blocked = (toolConfig.blocked || []).filter(t => t !== name);
      }

      const hasConfig = (toolConfig.allowed?.length || 0) + (toolConfig.blocked?.length || 0) > 0;
      await setExtMeta(node, "tools", hasConfig ? toolConfig : undefined);

      const qs = req.query.token ? `?token=${req.query.token}&html` : "?html";
      return res.redirect(`/api/v1/node/${nodeId}/command-center${qs}`);
    } catch (err) {
      log.error("HTML", "CC tool toggle error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // Alias: /root/:rootId/command-center redirects to the root node's command center
  router.get("/root/:rootId/command-center", urlAuth, htmlOnly, async (req, res) => {
    const qs = req.query.token ? `?token=${req.query.token}&html` : "?html";
    return res.redirect(`/api/v1/node/${req.params.rootId}/command-center${qs}`);
  });

  return router;
}
