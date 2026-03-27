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
import { sendError, ERR, DELETED } from "../../seed/protocol.js";
import { getUserMeta } from "../../seed/tree/userMetadata.js";
import { getTreeStructure } from "../../seed/tree/treeData.js";
import { getContributions } from "../../seed/tree/contributions.js";
import { buildPathString } from "../../seed/tree/treeFetch.js";

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
import { getNodeChats } from "../../seed/ws/chatHistory.js";
import { getConnectionsForUser, getAllRootLlmSlots } from "../../seed/llm/connections.js";
import { getExtMeta } from "../../seed/tree/extensionMetadata.js";
import getNodeName from "../../routes/api/helpers/getNameById.js";
import { getExtension } from "../loader.js";
import { isHtmlEnabled } from "./config.js";

export default function buildHtmlRoutes({ urlAuth, optionalAuth, renderers }) {
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

  // Gate: only handle if ?html is present and HTML rendering is enabled
  function htmlOnly(req, res, next) {
    if (!("html" in req.query) || !isHtmlEnabled()) {
      return next("route"); // skip to next route (kernel)
    }
    next();
  }

  // Query string helpers
  function buildQS(req, allowed = ["token", "html"]) {
    const filtered = Object.entries(req.query)
      .filter(([k]) => allowed.includes(k))
      .map(([k, v]) => (v === "" ? k : `${k}=${encodeURIComponent(v)}`))
      .join("&");
    return filtered ? `?${filtered}` : "";
  }

  function tokenQS(req) {
    const token = req.query.token ?? "";
    return token ? `?token=${encodeURIComponent(token)}&html` : "?html";
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
  // NOTIFICATIONS
  // ═══════════════════════════════════════════════════════════════════

  router.get("/user/:userId/notifications", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { userId } = req.params;
      const user = await User.findById(userId).select("username").lean();
      if (!user) return sendError(res, 404, ERR.USER_NOT_FOUND, "User not found");

      const notifExt = getExtension("notifications");
      if (!notifExt?.exports?.getNotifications) return sendError(res, 404, ERR.EXTENSION_NOT_FOUND, "Notifications extension not loaded");

      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const offset = parseInt(req.query.offset, 10) || 0;
      const { notifications, total } = await notifExt.exports.getNotifications({ userId, limit, offset });

      return res.send(renderers.renderNotifications({
        userId,
        notifications,
        total,
        username: user.username,
        token: req.query.token ?? "",
      }));
    } catch (err) {
      log.error("HTML", "Notifications render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // PASSWORD RESET (always HTML, no ?html flag needed)
  // ═══════════════════════════════════════════════════════════════════

  router.get("/user/reset-password/:token", async (req, res) => {
    if (!isHtmlEnabled()) {
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
    if (!isHtmlEnabled()) {
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
      const rootUrl = `/api/v1/root/${nodeId}${qs}`;

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
      const status = (Array.isArray(meta.prestige?.history) ? meta.prestige.history.find(h => h.version === v)?.status : null) || node.status || "active";
      const values = meta.values || {};
      const goals = meta.goals || {};
      const schedule = meta.schedule || null;
      const reeffectTime = meta.reeffectTime || null;
      const showPrestige = v === (prestigeData.current || 0);

      const qs = buildQS(req);
      const backUrl = `/api/v1/node/${nodeId}${qs}`;
      const backTreeUrl = `/api/v1/root/${nodeId}${qs}`;
      const createdDate = node.dateCreated ? new Date(node.dateCreated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
      const scheduleHtml = schedule ? renderers.renderScheduleInline?.(schedule) || "" : "";

      const ALL_STATUSES = ["active", "completed", "trimmed"];
      const STATUS_LABELS = { active: "Active", completed: "Completed", trimmed: "Trimmed" };

      return res.send(renderers.renderVersionDetail({
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
      const tQS = token ? `?token=${encodeURIComponent(token)}&html` : "?html";

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
  // ROOT OVERVIEW
  // ═══════════════════════════════════════════════════════════════════

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

      return res.send(renderers.renderRootOverview({
        allData, rootMeta, ancestors: allData.ancestors || [],
        isOwner, isDeleted, isRoot, isPublicAccess, queryAvailable,
        currentUserId, queryString, nodeId, userId: req.userId,
        token, deferredItems, ownerConnections,
      }));
    } catch (err) {
      log.error("HTML", "Root overview render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // QUERY PAGE
  // ═══════════════════════════════════════════════════════════════════

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
      return res.send(renderers.renderQueryPage({
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

  // ═══════════════════════════════════════════════════════════════════
  // GATEWAY
  // ═══════════════════════════════════════════════════════════════════

  router.get("/root/:rootId/gateway", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { rootId } = req.params;
      const root = await Node.findById(rootId).select("name rootOwner contributors").lean();
      if (!root) return sendError(res, 404, ERR.TREE_NOT_FOUND, "Tree not found");
      if (String(root.rootOwner) !== String(req.userId)) {
        return sendError(res, 403, ERR.FORBIDDEN, "Owner only");
      }

      let channels = [];
      try {
        const gw = getExtension("gateway");
        if (gw?.exports?.getChannelsForRoot) channels = await gw.exports.getChannelsForRoot(rootId);
      } catch {}

      return res.send(renderers.renderGateway({
        rootId, rootName: root.name, queryString: buildQS(req), channels,
      }));
    } catch (err) {
      log.error("HTML", "Gateway render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // CALENDAR
  // ═══════════════════════════════════════════════════════════════════

  router.get("/root/:rootId/calendar", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { rootId } = req.params;
      const now = new Date();
      const month = Math.max(1, Math.min(12, Number(req.query.month) || (now.getMonth() + 1)));
      const year = Math.max(2000, Math.min(2100, Number(req.query.year) || now.getFullYear()));
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59);

      let calendar = [];
      try {
        const schedules = getExtension("schedules");
        if (schedules?.exports?.getCalendar) {
          calendar = await schedules.exports.getCalendar({ rootNodeId: rootId, startDate, endDate });
        }
      } catch {}

      const byDay = {};
      for (const item of calendar) {
        const d = new Date(item.scheduledDate);
        if (isNaN(d.getTime())) continue;
        const day = d.toISOString().split("T")[0];
        (byDay[day] = byDay[day] || []).push(item);
      }

      return res.send(renderers.renderCalendar({
        rootId, queryString: buildQS(req), month, year, byDay,
      }));
    } catch (err) {
      log.error("HTML", "Calendar render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // VALUES
  // ═══════════════════════════════════════════════════════════════════

  router.get("/root/:nodeId/values", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { nodeId } = req.params;
      let result = { flat: [], tree: {} };
      try {
        const values = getExtension("values");
        if (values?.exports?.getGlobalValuesTreeAndFlat) {
          result = await values.exports.getGlobalValuesTreeAndFlat(nodeId);
        }
      } catch {}

      return res.send(renderers.renderValuesPage({
        nodeId, queryString: buildQS(req), result,
      }));
    } catch (err) {
      log.error("HTML", "Values page render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // ROOT CHATS
  // ═══════════════════════════════════════════════════════════════════

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

      return res.send(renderers.renderRootChats({
        rootId, rootName: root.name, sessions, allChats, token, tokenQS: tQS,
      }));
    } catch (err) {
      log.error("HTML", "Root chats render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  // NOTES
  // ═══════════════════════════════════════════════════════════════════

  router.get("/node/:nodeId/:version/notes/editor", urlAuth, async (req, res, next) => {
    if (!isHtmlEnabled()) return next("route");
    try {
      const { nodeId, version } = req.params;
      const qs = buildQS(req);
      const tqs = tokenQS(req);
      return res.send(renderers.renderEditorPage({
        nodeId, version, noteId: null, noteContent: "", qs, tokenQS: tqs, originalLength: 0,
      }));
    } catch (err) {
      log.error("HTML", "Editor page error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.get("/node/:nodeId/:version/notes/:noteId/editor", urlAuth, async (req, res, next) => {
    if (!isHtmlEnabled()) return next("route");
    try {
      const { nodeId, version, noteId } = req.params;
      const qs = buildQS(req);
      const tqs = tokenQS(req);
      const Note = (await import("../../seed/models/note.js")).default;
      const note = await Note.findById(noteId).lean();
      if (!note) return renderers.notFoundPage?.(req, res, "This note doesn't exist or may have been removed.") || sendError(res, 404, ERR.NOTE_NOT_FOUND, "Note not found");
      if (note.contentType !== "text") return res.redirect(`/api/v1/node/${nodeId}/${version}/notes/${noteId}${tqs}`);
      return res.send(renderers.renderEditorPage({
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
      return res.send(renderers.renderNotesList({
        nodeId, version: Number(version), token, nodeName,
        notes, currentUserId: req.userId,
      }));
    } catch (err) {
      log.error("HTML", "Notes list render error:", err.message);
      sendError(res, 500, ERR.INTERNAL, err.message);
    }
  });

  router.get("/node/:nodeId/:version/notes/:noteId", optionalAuth, htmlOnly, async (req, res) => {
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

      const safeUsername = renderers.escapeHtml?.(note.userId?.username || "Unknown") || (note.userId?.username || "Unknown");
      const userLink = hasToken || req.userId
        ? `<a href="/api/v1/user/${note.userId?._id || ""}${qs}">${safeUsername}</a>`
        : `<span>${safeUsername}</span>`;

      if (note.contentType === "text") {
        return res.send(renderers.renderTextNote({ back, backText, userLink, editorButton: hasToken || !!req.userId, note, hasToken }));
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
      const mediaHtml = renderers.renderMedia?.(fileUrl, mimeType, { lazy: false }) || "";

      return res.send(renderers.renderFileNote({ back, backText, userLink, note, fileName, fileUrl, mediaHtml, fileDeleted, hasToken }));
    } catch (err) {
      log.error("HTML", "Note detail render error:", err.message);
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
      await setExtMeta(node, "modes", Object.keys(modes).length > 0 ? modes : undefined);
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
      await setExtMeta(node, "tools", Object.keys(toolConfig).length > 0 ? toolConfig : undefined);
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
      await setExtMeta(node, "extensions", Object.keys(extConfig).length > 0 ? extConfig : undefined);
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
      await setExtMeta(node, "config", config);
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

  // ── COMMAND CENTER ──────────────────────────────────────────────────
  // Full capability surface of a tree at any position.
  // Tools, modes, extensions. Color-coded. Toggleable.

  router.get("/node/:nodeId/command-center", urlAuth, htmlOnly, async (req, res) => {
    try {
      const { nodeId } = req.params;
      const node = await Node.findById(nodeId).select("name metadata parent rootOwner").lean();
      if (!node) return sendError(res, 404, ERR.NODE_NOT_FOUND, "Node not found");

      // Resolve root
      const rootId = node.rootOwner || nodeId;
      const rootNode = rootId !== nodeId ? await Node.findById(rootId).select("name").lean() : node;

      // Build path
      let path = node.name;
      try { path = await buildPathString(nodeId); } catch {}

      // Extension scope at this node
      const { getBlockedExtensionsAtNode, getToolOwner, getModeOwner, getConfinedExtensions } = await import("../../seed/tree/extensionScope.js");
      const scope = await getBlockedExtensionsAtNode(nodeId);
      const confinedSet = getConfinedExtensions();

      // All tools
      const { getAllToolNamesForBigMode, getSubModes } = await import("../../seed/ws/modes/registry.js");
      const { resolveTools } = await import("../../seed/ws/tools.js");
      const { filterToolNamesByScope } = await import("../../seed/tree/extensionScope.js");
      const { getExtMeta } = await import("../../seed/tree/extensionMetadata.js");

      const allToolNames = getAllToolNamesForBigMode("tree");
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
        if (isFiltered) status = scope.restricted?.has(owner?.extName) ? "restricted" : "blocked";
        if (isNodeBlocked) status = "blocked";

        return {
          name,
          description: def?.function?.description || "",
          extName: owner?.extName || "unknown",
          readOnly: owner?.readOnly || false,
          destructive: def?.function?.annotations?.destructiveHint || false,
          status,
          nodeBlocked: isNodeBlocked,
        };
      });

      // All modes
      const treeModes = getSubModes("tree") || [];
      const homeModes = getSubModes("home") || [];
      const landModes = getSubModes("land") || [];
      const allModes = [...treeModes, ...homeModes, ...landModes];

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

      // All extensions
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

      const qs = req.query.token ? `?token=${req.query.token}&html` : "?html";

      const { renderCommandCenter } = await import("./html/commandCenter.js");
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

  // Alias: /root/:rootId/command-center redirects to the root node's command center
  router.get("/root/:rootId/command-center", urlAuth, htmlOnly, async (req, res) => {
    const qs = req.query.token ? `?token=${req.query.token}&html` : "?html";
    return res.redirect(`/api/v1/node/${req.params.rootId}/command-center${qs}`);
  });

  return router;
}
