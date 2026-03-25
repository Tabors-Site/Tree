/**
 * HTML intercept routes.
 * Mounted at /api/v1 BEFORE kernel routes.
 * Each route checks for ?html. If present, renders HTML. If not, next().
 * The kernel route handles JSON. This route handles HTML. Clean separation.
 */

import express from "express";
import log from "../../seed/log.js";
import Node from "../../seed/models/node.js";
import User from "../../seed/models/user.js";
import mongoose from "mongoose";
import { sendError, ERR } from "../../seed/protocol.js";
import { getUserMeta } from "../../seed/tree/userMetadata.js";
import { getTreeStructure } from "../../seed/tree/treeData.js";
import { getContributions } from "../../seed/tree/contributions.js";
import { resolveVersion } from "../../seed/tree/treeFetch.js";
import { buildPathString } from "../../seed/tree/treeFetch.js";
import { getNodeChats } from "../../seed/ws/chatHistory.js";
import { getConnectionsForUser, getAllRootLlmSlots } from "../../seed/llm/connections.js";
import { getExtMeta } from "../../seed/tree/extensionMetadata.js";
import getNodeName from "../../routes/api/helpers/getNameById.js";
import { getExtension } from "../loader.js";

export default function buildHtmlRoutes({ urlAuth, renderers }) {
  const router = express.Router();

  // Gate: only handle if ?html is present and HTML rendering is enabled
  function htmlOnly(req, res, next) {
    if (!("html" in req.query) || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return next("route"); // skip to next route (kernel)
    }
    next();
  }

  // Query string helpers
  function buildQS(req, allowed = ["token", "html"]) {
    const filtered = Object.entries(req.query)
      .filter(([k]) => allowed.includes(k))
      .map(([k, v]) => (v === "" ? k : `${k}=${v}`))
      .join("&");
    return filtered ? `?${filtered}` : "";
  }

  function tokenQS(req) {
    const token = req.query.token ?? "";
    return token ? `?token=${token}&html` : "?html";
  }

  // ═══════════════════════════════════════════════════════════════════
  // CONTRIBUTIONS
  // ═══════════════════════════════════════════════════════════════════

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
      return res.send(renderers.renderContributions({
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

  // ═══════════════════════════════════════════════════════════════════
  // USER PROFILE
  // ═══════════════════════════════════════════════════════════════════

  router.get("/user/:userId", urlAuth, htmlOnly, async (req, res) => {
    try {
      const userId = req.params.userId;
      const user = await User.findById(userId).populate("roots", "name").exec();
      if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");

      (getExtension("energy")?.exports?.maybeResetEnergy || (() => false))(user);

      const roots = user.roots || [];
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

      return res.send(renderers.renderUserProfile({
        userId,
        user,
        roots,
        plan,
        energy,
        extraEnergy,
        queryString: buildQS(req),
        resetTimeLabel,
        storageUsedKB,
      }));
    } catch (err) {
      log.error("HTML", "User profile render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // PASSWORD RESET (always HTML, no ?html flag needed)
  // ═══════════════════════════════════════════════════════════════════

  router.get("/user/reset-password/:token", async (req, res) => {
    if (process.env.ENABLE_FRONTEND_HTML !== "true") {
      return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, "HTML rendering disabled");
    }
    try {
      const user = await User.findOne({
        "metadata.email.resetToken": req.params.token,
        "metadata.email.resetExpiry": { $gt: Date.now() },
      });
      if (!user) return res.send(renderers.renderResetPasswordExpired());
      return res.send(renderers.renderResetPasswordForm({ token: req.params.token }));
    } catch (err) {
      log.error("HTML", "Reset password form error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.post("/user/reset-password/:token", async (req, res) => {
    if (process.env.ENABLE_FRONTEND_HTML !== "true") {
      return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, "HTML rendering disabled");
    }
    try {
      const { password, confirm } = req.body;
      if (password !== confirm) {
        return res.send(renderers.renderResetPasswordMismatch({ token: req.params.token }));
      }

      const user = await User.findOne({
        "metadata.email.resetToken": req.params.token,
        "metadata.email.resetExpiry": { $gt: Date.now() },
      });
      if (!user) return res.send(renderers.renderResetPasswordInvalid());

      user.password = password;
      const emailMeta = (user.metadata instanceof Map ? user.metadata.get("email") : user.metadata?.email) || {};
      delete emailMeta.resetToken;
      delete emailMeta.resetExpiry;
      emailMeta.tokensInvalidBefore = new Date();
      if (user.metadata instanceof Map) user.metadata.set("email", emailMeta);
      else user.metadata.email = emailMeta;
      if (user.markModified) user.markModified("metadata");
      await user.save();

      return res.send(renderers.renderResetPasswordSuccess());
    } catch (err) {
      log.error("HTML", "Reset password error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // NODE DETAIL
  // ═══════════════════════════════════════════════════════════════════

  router.get("/node/:nodeId", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const node = await Node.findById(nodeId).populate("children", "name").lean();
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

      const parentName = node.parent ? await getNodeName(node.parent) : null;
      const qs = buildQS(req);
      const rootUrl = node.rootOwner ? `/api/v1/root/${node.rootOwner}${qs}` : null;

      return res.send(renderers.renderNodeDetail({
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

  // ═══════════════════════════════════════════════════════════════════
  // NODE VERSION DETAIL
  // ═══════════════════════════════════════════════════════════════════

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
      const status = meta.prestige?.history?.find(h => h.version === v)?.status || node.status || "active";
      const values = meta.values || {};
      const goals = meta.goals || {};
      const schedule = meta.schedule || null;
      const reeffectTime = meta.reeffectTime || null;
      const showPrestige = v === (prestigeData.current || 0);

      const qs = buildQS(req);
      const backUrl = `/api/v1/node/${nodeId}${qs}`;
      const backTreeUrl = node.rootOwner ? `/api/v1/root/${node.rootOwner}${qs}` : null;
      const createdDate = node.dateCreated ? new Date(node.dateCreated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
      const scheduleHtml = schedule ? renderers.renderScheduleInline?.(schedule) || "" : "";

      return res.send(renderers.renderVersionDetail({
        node, nodeId, version: v,
        data: { status, values, goals, schedule, prestige: prestigeData, reeffectTime },
        qs, backUrl, backTreeUrl, createdDate, scheduleHtml, reeffectTime,
        showPrestige, prestigeData,
      }));
    } catch (err) {
      log.error("HTML", "Version detail render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // NODE CHATS
  // ═══════════════════════════════════════════════════════════════════

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
      const tQS = token ? `?token=${token}&html` : "?html";

      return res.send(renderers.renderNodeChats({
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

  // ═══════════════════════════════════════════════════════════════════
  // MUTATION REDIRECTS (POST/PUT/DELETE with ?html)
  // The extension calls kernel functions, then redirects to HTML view.
  // ═══════════════════════════════════════════════════════════════════

  // POST create note -> redirect to notes list
  router.post("/node/:nodeId/:version/notes", urlAuth, htmlOnly, async (req, res, next) => {
    // Let kernel handle the mutation, we just need the redirect after
    // Remove ?html so kernel doesn't see it, then redirect after
    // Actually: simpler to just let kernel handle and redirect won't happen
    // because kernel won't have html check anymore.
    // For POST mutations, the pattern is: kernel does mutation, extension catches redirect.
    // But if kernel doesn't redirect anymore, the POST returns JSON.
    // The HTML client submits the form, gets JSON back, which is wrong.
    // So: the extension must handle the full POST for html clients.
    try {
      const { createNote } = await import("../../seed/tree/notes.js");
      const { nodeId, version } = req.params;

      if (req.body.content) {
        await createNote({
          contentType: "text",
          content: req.body.content,
          userId: req.userId,
          nodeId,
          version: Number(version),
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
  router.put("/node/:nodeId/status", urlAuth, htmlOnly, async (req, res) => {
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
  router.put("/node/:nodeId/name", urlAuth, htmlOnly, async (req, res) => {
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
  router.put("/node/:nodeId/parent", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { updateParent } = await import("../../seed/tree/treeManagement.js");
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
  router.put("/node/:nodeId/modes", urlAuth, htmlOnly, async (req, res) => {
    try {
      const node = await Node.findById(req.params.nodeId);
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");
      const { setExtMeta } = await import("../../seed/tree/extensionMetadata.js");
      const modes = getExtMeta(node, "modes");
      if (req.body.intent && req.body.modeKey) modes[req.body.intent] = req.body.modeKey;
      if (req.body.clearIntent) delete modes[req.body.clearIntent];
      setExtMeta(node, "modes", Object.keys(modes).length > 0 ? modes : undefined);
      await node.save();
      return res.redirect(`/api/v1/node/${req.params.nodeId}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Set modes redirect error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // PUT set tools -> redirect
  router.put("/node/:nodeId/tools", urlAuth, htmlOnly, async (req, res) => {
    try {
      const node = await Node.findById(req.params.nodeId);
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");
      const { setExtMeta } = await import("../../seed/tree/extensionMetadata.js");
      const toolConfig = getExtMeta(node, "tools");
      if (req.body.allow) {
        toolConfig.allowed = [...new Set([...(toolConfig.allowed || []), ...req.body.allow])];
      }
      if (req.body.block) {
        toolConfig.blocked = [...new Set([...(toolConfig.blocked || []), ...req.body.block])];
      }
      if (req.body.clearAllowed) toolConfig.allowed = [];
      if (req.body.clearBlocked) toolConfig.blocked = [];
      setExtMeta(node, "tools", Object.keys(toolConfig).length > 0 ? toolConfig : undefined);
      await node.save();
      return res.redirect(`/api/v1/node/${req.params.nodeId}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Set tools redirect error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // PUT set ext-scope -> redirect
  router.put("/node/:nodeId/ext-scope", urlAuth, htmlOnly, async (req, res) => {
    try {
      const node = await Node.findById(req.params.nodeId);
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");
      const { setExtMeta } = await import("../../seed/tree/extensionMetadata.js");
      const { clearScopeCache } = await import("../../seed/tree/extensionScope.js");
      const extConfig = getExtMeta(node, "extensions");
      if (req.body.block) {
        extConfig.blocked = [...new Set([...(extConfig.blocked || []), ...req.body.block])];
      }
      if (req.body.allow) {
        extConfig.blocked = (extConfig.blocked || []).filter(e => !req.body.allow.includes(e));
      }
      setExtMeta(node, "extensions", Object.keys(extConfig).length > 0 ? extConfig : undefined);
      await node.save();
      clearScopeCache();
      return res.redirect(`/api/v1/node/${req.params.nodeId}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Set ext-scope redirect error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // PUT reorder children -> redirect
  router.put("/node/:nodeId/children", urlAuth, htmlOnly, async (req, res) => {
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
  router.delete("/node/:nodeId", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { deleteNodeBranch } = await import("../../seed/tree/treeManagement.js");
      await deleteNodeBranch(req.params.nodeId, req.userId);
      return res.redirect(`/api/v1/user/${req.userId}/deleted${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Delete node redirect error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // PUT root config -> redirect
  router.put("/root/:rootId/config", urlAuth, htmlOnly, async (req, res) => {
    try {
      // Config update is handled inline in the root route currently.
      // For now, pass through to kernel and redirect after.
      // The kernel route will handle the actual config update.
      // We just need to intercept the redirect.
      const node = await Node.findById(req.params.rootId);
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Tree not found");

      const { setExtMeta } = await import("../../seed/tree/extensionMetadata.js");
      const { clearScopeCache } = await import("../../seed/tree/extensionScope.js");

      // Apply config updates from body
      const meta = node.metadata instanceof Map ? Object.fromEntries(node.metadata) : (node.metadata || {});
      const config = meta.config || {};
      for (const [key, value] of Object.entries(req.body)) {
        config[key] = value;
      }
      setExtMeta(node, "config", config);
      await node.save();
      clearScopeCache();

      return res.redirect(`/api/v1/root/${req.params.rootId}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Root config redirect error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // POST create tree -> redirect
  router.post("/user/:userId/trees", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { createRoot } = await import("../../seed/tree/treeManagement.js");
      const rootNode = await createRoot({
        name: req.body.name || "New Tree",
        userId: req.userId,
      });
      return res.redirect(`/api/v1/root/${rootNode._id}${tokenQS(req)}`);
    } catch (err) {
      log.error("HTML", "Create tree redirect error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  return router;
}
