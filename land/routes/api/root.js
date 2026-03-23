import express from "express";
import urlAuth from "../../middleware/urlAuth.js";
import authenticate from "../../middleware/authenticate.js";

import { getAllData, getTreeStructure } from "../../core/tree/treeDataFetching.js";
import { createInvite } from "../../core/tree/invites.js";
import { sendRemoteInvite } from "../../core/tree/remoteInvites.js";
// Schedules: dynamic import, stub if extension not installed
let getCalendar = async () => ({ nodes: [] });
try { ({ getCalendar } = await import("../../extensions/schedules/core.js")); } catch {}
// Values: dynamic import, stub if extension not installed
let getGlobalValuesTreeAndFlat = async () => ({ flat: {}, tree: {} });
try { ({ getGlobalValuesTreeAndFlat } = await import("../../extensions/values/core.js")); } catch {}

import Node from "../../db/models/node.js";
import mongoose from "mongoose";
import { getConnectionsForUser, ROOT_LLM_SLOTS } from "../../core/llms/customLLM.js";
import { getNodeAIChats } from "../../core/llms/aichat.js";
import { buildPathString } from "../../core/tree/treeFetch.js";

import {
  renderRootOverview,
  renderCalendar,
  renderGateway,
  renderValuesPage,
} from "./html/root.js";
import { renderQueryPage } from "./html/query.js";
import { registerWithDirectory } from "../../canopy/directory.js";

const router = express.Router();

// Only allow these params to remain in querystring
const allowedParams = [
  "token",
  "html",
  "trimmed",
  "active",
  "completed",
  "startDate",
  "endDate",
  "month",
  "year",
];

router.get("/root/:nodeId", urlAuth, async (req, res) => {
  try {
    const { nodeId } = req.params;

    // CLEAN QUERY STRING (keep only token + html)
    const filtered = Object.entries(req.query)
      .filter(([key]) => allowedParams.includes(key))
      .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
      .join("&");

    const queryString = filtered ? `?${filtered}` : "";

    // Lightweight tree structure (no versions/notes/contributions/scripts)
    const allData = await getTreeStructure(nodeId, {
      active: req.query.active !== "false",
      trimmed: req.query.trimmed === "true",
      completed: req.query.completed !== "false",
    });

    // Load owner + contributors + llm assignments
    const rootMeta = await Node.findById(nodeId)
      .populate("rootOwner", "username _id profileType planExpiresAt")
      .populate("contributors", "username _id isRemote homeLand")
      .select(
        "rootOwner contributors metadata llmDefault dreamTime lastDreamAt visibility",
      )
      .lean()
      .exec();
    const rootNode = await Node.findById(nodeId).select("parent rootOwner").lean();
    const isDeleted = rootNode.parent === "deleted";

    const isRoot = !!rootNode.rootOwner;
    let rootNameColor = "rgba(255, 255, 255, 0.4)"; // subtle white edge

    if (isDeleted) {
      rootNameColor = "#b00020"; // red
    }

    const isPublicAccess = !!req.isPublicAccess;
    const isOwner =
      rootMeta?.rootOwner?._id?.toString() === req.userId?.toString();
    const queryAvailable = isPublicAccess
      ? !!((rootMeta?.llmDefault && rootMeta.llmDefault !== "none") || req.canopyVisitor)
      : false;

    // JSON MODE
    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      const json = {
        ...allData,
        rootOwner: rootMeta?.rootOwner || null,
        contributors: rootMeta?.contributors || [],
        dreamsEnabled: !!mongoose.models.ShortMemory,
      };

      // Strip sensitive data for public visitors
      if (isPublicAccess) {
        delete json.contributors;
        json.rootOwner = rootMeta?.rootOwner?.username
          ? { username: rootMeta.rootOwner.username }
          : null;
        json.isPublicAccess = true;
        json.queryAvailable = queryAvailable;
      }

      return res.json(json);
    }

    const currentUserId = req.userId ? req.userId.toString() : null;
    const token = req.query.token ?? "";

    // Load deferred items if dreams extension is loaded (skip for public visitors)
    let deferredItems = [];
    if (!isPublicAccess && mongoose.models.ShortMemory) {
      deferredItems = await mongoose.models.ShortMemory.find({
        rootId: nodeId,
        status: { $in: ["pending", "escalated"] },
      })
        .sort({ createdAt: -1 })
        .lean();
    }

    // Load owner LLM connections (for AI Models section, owner only)
    let ownerConnections = [];
    if (!isPublicAccess && isOwner && rootMeta?.rootOwner) {
      ownerConnections = await getConnectionsForUser(
        rootMeta.rootOwner._id.toString(),
      );
    }

    return res.send(
      renderRootOverview({
        allData,
        rootMeta,
        ancestors: allData.ancestors || [],
        isOwner,
        isDeleted,
        isRoot,
        isPublicAccess,
        queryAvailable,
        currentUserId,
        queryString,
        nodeId,
        userId: req.userId,
        token,
        deferredItems,
        ownerConnections,
      }),
    );
  } catch (err) {
    console.error("Error in /root/:nodeId:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /root/:rootId/all — full tree with versions, notes, contributions, scripts
// GET /root/:rootId/query?html — Public query page
router.get("/root/:rootId/query", urlAuth, async (req, res) => {
  try {
    const { rootId } = req.params;
    const wantHtml = req.query.html !== undefined;

    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.status(400).json({ error: "Use POST /root/:rootId/query to submit queries. Add ?html for the query page." });
    }

    const root = await Node.findById(rootId)
      .select("name rootOwner llmDefault metadata contributors")
      .populate("rootOwner", "username")
      .lean();

    if (!root) return res.status(404).json({ error: "Tree not found" });

    // Only show query page for public trees, or to the owner/contributors
    const isPublicAccess = !!req.isPublicAccess;
    const isAuthenticated = !!req.userId;
    const isOwner = isAuthenticated && String(root.rootOwner?._id) === String(req.userId);
    const isContributor = isAuthenticated && (root.contributors || []).map(String).includes(String(req.userId));

    if ((root.metadata?.visibility?.level || "private") !== "public" && !isOwner && !isContributor) {
      return res.status(403).json({ error: "This tree is not public." });
    }

    const treeHasLlm = !!(root.llmDefault && root.llmDefault !== "none");
    const queryAvailable = treeHasLlm || (isOwner || isContributor);

    return res.send(
      renderQueryPage({
        treeName: root.name || "Untitled",
        ownerUsername: root.rootOwner?.username || "unknown",
        rootId,
        queryAvailable,
        isAuthenticated,
      }),
    );
  } catch (err) {
    console.error("Error in /root/:rootId/query:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/root/:rootId/all", urlAuth, async (req, res) => {
  try {
    const { rootId } = req.params;

    const fakeReq = { ...req, body: { rootId } };
    let allData = null;

    const fakeRes = {
      json(data) {
        allData = data;
      },
      status() {
        return { json(d) { allData = null; } };
      },
    };

    await getAllData(fakeReq, fakeRes);
    if (!allData) return res.status(500).json({ error: "Failed to fetch tree data" });

    // Strip sensitive payment/transaction data from contributions
    const stripContributions = (node) => {
      if (node.contributions) {
        node.contributions = node.contributions.map((c) => {
          const clean = { ...c._doc || c };
          delete clean.purchaseMeta;
          delete clean.transactionMeta;
          return clean;
        });
      }
      if (node.children) {
        node.children.forEach(stripContributions);
      }
    };
    stripContributions(allData);

    return res.json(allData);
  } catch (err) {
    console.error("Error in /root/:rootId/all:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /root/:rootId/visibility
router.post("/root/:rootId/visibility", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const { visibility } = req.body;

    const validValues = ["private", "public"];
    if (!validValues.includes(visibility)) {
      return res.status(400).json({
        error: `visibility must be one of: ${validValues.join(", ")}`,
      });
    }

    const root = await Node.findById(rootId).select("rootOwner").lean();
    if (!root) {
      return res.status(404).json({ error: "Tree not found" });
    }
    if (String(root.rootOwner) !== String(req.userId)) {
      return res.status(403).json({ error: "Only the tree owner can change visibility" });
    }

    await Node.findByIdAndUpdate(rootId, {
      $set: { "metadata.visibility": { level: visibility } },
    });

    // Immediately re-sync with directory so public/private change is reflected
    registerWithDirectory().catch((err) =>
      console.error("[Land] Directory re-sync after visibility change failed:", err)
    );

    return res.json({ success: true, visibility });
  } catch (err) {
    console.error("Error in /root/:rootId/visibility:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /root/:rootId/invite
router.post("/root/:rootId/invite", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const { userReceiving } = req.body;

    if (!userReceiving) {
      return res.status(400).json({
        success: false,
        error: "userReceiving is required",
      });
    }

    // Detect cross-land invite (username@domain.tld format)
    // Must have @ with text before and after, and a dot after the @
    const atIndex = userReceiving.indexOf("@");
    const afterAt = atIndex > 0 ? userReceiving.slice(atIndex + 1) : "";
    if (atIndex > 0 && afterAt.includes(".") && afterAt.length > 2) {
      const result = await sendRemoteInvite({
        userInvitingId: req.userId,
        canopyId: userReceiving,
        rootId,
      });

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/root/${rootId}?token=${req.query.token ?? ""}&html`,
        );
      }
      return res.json({ success: true, remote: true, ...result });
    }

    await createInvite({
      userInvitingId: req.userId,
      userReceiving, // username OR userId
      rootId,
      isToBeOwner: false,
      isUninviting: false,
    });

    // HTML redirect support
    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/root/${rootId}?token=${req.query.token ?? ""}&html`,
      );
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }
});

// POST /root/:rootId/transfer-owner
router.post("/root/:rootId/transfer-owner", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const { userReceiving } = req.body;

    if (!userReceiving) {
      return res.status(400).json({
        success: false,
        error: "userReceiving is required",
      });
    }

    await createInvite({
      userInvitingId: req.userId,
      userReceiving, // username OR userId
      rootId,
      isToBeOwner: true, // ⭐ THIS is the key
      isUninviting: false,
    });

    // HTML redirect support
    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/root/${rootId}?token=${req.query.token ?? ""}&html`,
      );
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }
});

// POST /root/:rootId/remove-user
router.post("/root/:rootId/remove-user", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const { userReceiving } = req.body;

    if (!userReceiving) {
      return res.status(400).json({
        success: false,
        error: "userReceiving is required",
      });
    }

    await createInvite({
      userInvitingId: req.userId,
      userReceiving, // userId
      rootId,
      isToBeOwner: false,
      isUninviting: true, // ⭐ THIS triggers removal logic
    });

    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/user/${req.userId}?token=${req.query.token ?? ""}&html`,
      );
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }
});

// POST /root/:rootId/retire
router.post("/root/:rootId/retire", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;

    await createInvite({
      userInvitingId: req.userId,
      userReceiving: req.userId,
      rootId,
      isToBeOwner: false,
      isUninviting: true,
    });

    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/user/${req.userId}?token=${req.query.token ?? ""}&html`,
      );
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// ROOT LLM ASSIGNMENT
// ─────────────────────────────────────────────────────────────────────────

router.post("/root/:rootId/llm-assign", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const { slot, connectionId } = req.body;

    if (!ROOT_LLM_SLOTS.includes(slot)) {
      return res.status(400).json({
        error: `Invalid slot. Must be one of: ${ROOT_LLM_SLOTS.join(", ")}`,
      });
    }

    // Validate root and ownership
    const root = await Node.findById(rootId).select("rootOwner").lean();
    if (!root) return res.status(404).json({ error: "Root not found" });
    if (!root.rootOwner)
      return res.status(400).json({ error: "Node is not a root" });
    if (root.rootOwner.toString() !== req.userId.toString()) {
      return res
        .status(403)
        .json({ error: "Only the root owner can assign LLM connections" });
    }

    // "none" is a special value for the default slot to disable LLM
    if (connectionId === "none" && slot === "default") {
      // Valid, skip connection check
    } else if (connectionId) {
      // Verify connection belongs to root owner
      const { default: CustomLlmConnection } =
        await import("../../db/models/customLlmConnection.js");
      const conn = await CustomLlmConnection.findOne({
        _id: connectionId,
        userId: req.userId,
      }).lean();
      if (!conn) return res.status(404).json({ error: "Connection not found" });
    }

    // "default" slot goes to llmDefault field, extension slots go to metadata.llm.slots
    if (slot === "default") {
      await Node.findByIdAndUpdate(rootId, {
        $set: { llmDefault: connectionId || null },
      });
    } else {
      await Node.findByIdAndUpdate(rootId, {
        $set: { [`metadata.llm.slots.${slot}`]: connectionId || null },
      });
    }

    // Bust client cache for owner so changes take effect immediately
    const { clearUserClientCache } = await import("../../ws/conversation.js");
    clearUserClientCache(req.userId);

    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/root/${rootId}?token=${req.query.token ?? ""}&html`,
      );
    }

    return res.json({
      success: true,
      slot,
      connectionId: connectionId || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GATEWAY PAGE (HTML)
// ─────────────────────────────────────────────────────────────────────────

router.get("/root/:rootId/gateway", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;
    const queryString = req.query.token
      ? `?token=${req.query.token}&html`
      : "?html";

    const root = await Node.findById(rootId)
      .select("name rootOwner contributors")
      .lean();
    if (!root) return res.status(404).json({ error: "Root not found" });
    if (!root.rootOwner)
      return res.status(400).json({ error: "Node is not a root" });

    const isOwner = root.rootOwner.toString() === req.userId.toString();
    if (!isOwner)
      return res
        .status(403)
        .json({ error: "Only the root owner can manage the gateway" });

    const { getChannelsForRoot } =
      await import("../../extensions/gateway/core.js");
    const channels = await getChannelsForRoot(rootId);

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json({ rootId, channels });
    }

    return res.send(
      renderGateway({
        rootId,
        rootName: root.name,
        queryString,
        channels,
      }),
    );
  } catch (err) {
    console.error("Error in /root/:rootId/gateway:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GATEWAY CHANNELS (API)
// ─────────────────────────────────────────────────────────────────────────

router.get(
  "/root/:rootId/gateway/vapid-key",
  authenticate,
  async (req, res) => {
    return res.json({ key: process.env.VAPID_PUBLIC_KEY || null });
  },
);

router.get("/root/:rootId/gateway/channels", authenticate, async (req, res) => {
  try {
    const { rootId } = req.params;

    const root = await Node.findById(rootId)
      .select("rootOwner contributors")
      .lean();
    if (!root) return res.status(404).json({ error: "Root not found" });
    if (!root.rootOwner)
      return res.status(400).json({ error: "Node is not a root" });

    const isOwner = root.rootOwner.toString() === req.userId.toString();
    const isContributor = (root.contributors || []).some(
      (c) => c.toString() === req.userId.toString(),
    );
    if (!isOwner && !isContributor) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const { getChannelsForRoot } =
      await import("../../extensions/gateway/core.js");
    const channels = await getChannelsForRoot(rootId);
    return res.json({ success: true, channels });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post(
  "/root/:rootId/gateway/channels",
  authenticate,
  async (req, res) => {
    try {
      const { rootId } = req.params;
      const {
        name,
        type,
        direction,
        mode,
        config,
        notificationTypes,
        queueBehavior,
      } = req.body;

      const { addGatewayChannel } =
        await import("../../extensions/gateway/core.js");
      const channel = await addGatewayChannel(req.userId, rootId, {
        name,
        type,
        direction,
        mode,
        config,
        notificationTypes,
        queueBehavior,
      });

      return res.status(201).json({ success: true, channel });
    } catch (err) {
      var status = err.message.includes("not found")
        ? 404
        : err.message.includes("Not authorized") ||
            err.message.includes("Only the root")
          ? 403
          : 400;
      return res.status(status).json({ error: err.message });
    }
  },
);

router.put(
  "/root/:rootId/gateway/channels/:channelId",
  authenticate,
  async (req, res) => {
    try {
      const { channelId } = req.params;
      const { name, enabled, config, notificationTypes } = req.body;

      const { updateGatewayChannel } =
        await import("../../extensions/gateway/core.js");
      const channel = await updateGatewayChannel(req.userId, channelId, {
        name,
        enabled,
        config,
        notificationTypes,
      });

      return res.json({ success: true, channel });
    } catch (err) {
      var status = err.message.includes("not found") ? 404 : 400;
      return res.status(status).json({ error: err.message });
    }
  },
);

router.delete(
  "/root/:rootId/gateway/channels/:channelId",
  authenticate,
  async (req, res) => {
    try {
      const { channelId } = req.params;

      const { deleteGatewayChannel } =
        await import("../../extensions/gateway/core.js");
      await deleteGatewayChannel(req.userId, channelId);

      return res.json({ success: true, removed: true });
    } catch (err) {
      var status = err.message.includes("not found") ? 404 : 400;
      return res.status(status).json({ error: err.message });
    }
  },
);

router.post(
  "/root/:rootId/gateway/channels/:channelId/test",
  authenticate,
  async (req, res) => {
    try {
      const { rootId, channelId } = req.params;

      // Verify root access
      const root = await Node.findById(rootId)
        .select("rootOwner contributors")
        .lean();
      if (!root) return res.status(404).json({ error: "Root not found" });
      if (!root.rootOwner)
        return res.status(400).json({ error: "Node is not a root" });

      const isOwner = root.rootOwner.toString() === req.userId.toString();
      const isContributor = (root.contributors || []).some(
        (c) => c.toString() === req.userId.toString(),
      );
      if (!isOwner && !isContributor) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const { dispatchTestNotification } =
        await import("../../extensions/gateway/dispatch.js");
      var result = await dispatchTestNotification(channelId);

      return res.json(result);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────
// DREAM TIME
// ─────────────────────────────────────────────────────────────────────────

router.post("/root/:rootId/dream-time", authenticate, async (req, res) => {
  try {
    if (!!!mongoose.models.ShortMemory) {
      return res.status(400).json({ error: "Dreams extension is not enabled on this land" });
    }

    const { rootId } = req.params;
    const { dreamTime } = req.body;

    // Validate root and ownership
    const root = await Node.findById(rootId).select("rootOwner").lean();
    if (!root) return res.status(404).json({ error: "Root not found" });
    if (!root.rootOwner)
      return res.status(400).json({ error: "Node is not a root" });
    if (root.rootOwner.toString() !== req.userId.toString()) {
      return res
        .status(403)
        .json({ error: "Only the root owner can set dream time" });
    }

    // Validate format (HH:MM or null/empty to disable)
    if (dreamTime) {
      const match = /^([01]\d|2[0-3]):([0-5]\d)$/.test(dreamTime);
      if (!match) {
        return res
          .status(400)
          .json({ error: "Invalid time format — use HH:MM (24h)" });
      }
    }

    await Node.findByIdAndUpdate(rootId, {
      $set: { "metadata.dreams.dreamTime": dreamTime || null },
    });

    return res.json({ success: true, dreamTime: dreamTime || null });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get("/root/:rootId/calendar", urlAuth, async (req, res) => {
  try {
    const { rootId } = req.params;

    // ✅ SAME QUERY CLEANING LOGIC AS /root/:nodeId
    const filtered = Object.entries(req.query)
      .filter(([key]) => allowedParams.includes(key))
      .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
      .join("&");

    const queryString = filtered ? `?${filtered}` : "";

    const now = new Date();

    let month = Number(req.query.month);
    let year = Number(req.query.year);

    if (!Number.isInteger(month) || month < 0 || month > 11) {
      month = now.getMonth();
    }

    if (!Number.isInteger(year) || year < 1970 || year > 3000) {
      year = now.getFullYear();
    }

    // ✅ Month → date range (this matches your core getCalendar)
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, month + 1, 0, 23, 59, 59, 999);

    const calendar = await getCalendar({
      rootNodeId: rootId,
      startDate,
      endDate,
    });

    // JSON MODE
    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json({ calendar });
    }

    // Group by YYYY-MM-DD
    const byDay = {};
    for (const item of calendar) {
      const day = new Date(item.schedule).toISOString().slice(0, 10);
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(item);
    }

    return res.send(
      renderCalendar({ rootId, queryString, month, year, byDay }),
    );
  } catch (err) {
    console.error("Calendar error:", err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Transaction policy endpoint moved to extensions/transactions/routes.js

// This is the glassified version of the /root/:nodeId/values route
// Replace your existing values route with this code

router.get("/root/:nodeId/values", urlAuth, async (req, res) => {
  try {
    const { nodeId } = req.params;

    const filtered = Object.entries(req.query)
      .filter(([key]) => allowedParams.includes(key))
      .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
      .join("&");

    const queryString = filtered ? `?${filtered}` : "";

    const result = await getGlobalValuesTreeAndFlat(nodeId);

    // JSON MODE (default)
    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json(result);
    }

    return res.send(renderValuesPage({ nodeId, queryString, result }));
  } catch (err) {
    console.error("Error in /root/:nodeId/values:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /root/:rootId/chats
// AI chat history for an entire tree (root + all descendants)
// ─────────────────────────────────────────────────────────────────────────
router.get("/root/:rootId/chats", urlAuth, async (req, res) => {
  try {
    const { rootId } = req.params;
    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

    const rawLimit = req.query.limit;
    let limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return res.status(400).json({ error: "Invalid limit" });
    }
    if (limit > 10) {
      limit = 10;
    }

    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;
    let sessionId = req.query.sessionId;

    if (typeof sessionId === "string") {
      sessionId = sessionId.replace(/^"+|"+$/g, "");
    }

    const node = await Node.findById(rootId).select("name rootOwner").lean();
    if (!node) {
      return res.status(404).json({ error: "Root not found" });
    }

    const { sessions } = await getNodeAIChats({
      nodeId: rootId,
      sessionLimit: limit || 10,
      sessionId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      includeChildren: true,
    });

    const allChats = sessions.flatMap((s) => s.chats);

    if (!wantHtml) {
      return res.json({
        rootId,
        rootName: node.name,
        count: allChats.length,
        sessions,
      });
    }

    // ── HTML rendering ─────────────────────────────────────
    const rootName = node.name || "Unknown tree";

    const esc = (str = "") =>
      String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const truncate = (str, len = 200) => {
      if (!str) return "";
      const clean = esc(str);
      return clean.length > len ? clean.slice(0, len) + "..." : clean;
    };

    const linkifyNodeIds = (html) =>
      html.replace(
        /Placed on node ([0-9a-f-]{36})/g,
        (_, id) =>
          `Placed on node <a class="node-link" href="/api/v1/root/${id}${token ? `?token=${token}&html` : "?html"}">${id}</a>`,
      );

    const formatTime = (d) => (d ? new Date(d).toLocaleString() : "--");

    const formatDuration = (start, end) => {
      if (!start || !end) return null;
      const ms = new Date(end) - new Date(start);
      if (ms < 1000) return `${ms}ms`;
      if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
      return `${(ms / 60000).toFixed(1)}m`;
    };

    const formatContent = (str) => {
      if (!str) return "";
      const s = String(str).trim();
      if (
        (s.startsWith("{") && s.endsWith("}")) ||
        (s.startsWith("[") && s.endsWith("]"))
      ) {
        try {
          const parsed = JSON.parse(s);
          const pretty = JSON.stringify(parsed, null, 2);
          return `<span class="chain-json">${esc(pretty)}</span>`;
        } catch (_) {}
      }
      return esc(s);
    };

    const modeLabel = (path) => {
      if (!path) return "unknown";
      if (path === "translator") return "Translator";
      if (path.startsWith("tree:orchestrator:plan:")) {
        const num = path.split(":")[3];
        return `Plan Step ${num}`;
      }
      const parts = path.split(":");
      const labels = { home: "Home", tree: "Tree", rawIdea: "Raw Idea" };
      const subLabels = {
        default: "Default",
        chat: "Chat",
        structure: "Structure",
        edit: "Edit",
        be: "Be",
        reflect: "Reflect",
        navigate: "Navigate",
        understand: "Understand",
        getContext: "Context",
        respond: "Respond",
        notes: "Notes",
        start: "Start",
        chooseRoot: "Choose Root",
        complete: "Placed",
        stuck: "Stuck",
      };
      const big = labels[parts[0]] || parts[0];
      const sub = subLabels[parts[1]] || parts[1] || "";
      return sub ? `${big} ${sub}` : big;
    };

    const sourceLabel = (src) => {
      const map = {
        user: "User",
        api: "API",
        orchestrator: "Chain",
        background: "Background",
        script: "Script",
        system: "System",
      };
      return map[src] || src;
    };

    const actionLabel = (action) => {
      const map = {
        create: "Created",
        editStatus: "Status",
        editValue: "Values",
        prestige: "Prestige",
        trade: "Trade",
        delete: "Deleted",
        invite: "Invite",
        editSchedule: "Schedule",
        editGoal: "Goal",
        transaction: "Transaction",
        note: "Note",
        updateParent: "Moved",
        editScript: "Script",
        executeScript: "Ran script",
        updateChildNode: "Child",
        editNameNode: "Renamed",
        rawIdea: "Raw idea",
        branchLifecycle: "Branch",
        purchase: "Purchase",
        understanding: "Understanding",
      };
      return map[action] || action;
    };

    const actionColor = (action) => {
      switch (action) {
        case "create":
          return "#48bb78";
        case "delete":
        case "branchLifecycle":
          return "#c85050";
        case "editStatus":
        case "editValue":
        case "editGoal":
        case "editSchedule":
        case "editNameNode":
        case "editScript":
          return "#5082dc";
        case "executeScript":
          return "#38bdd2";
        case "prestige":
          return "#c8aa32";
        case "note":
        case "rawIdea":
          return "#9b64dc";
        case "invite":
          return "#d264a0";
        case "transaction":
        case "trade":
          return "#dc8c3c";
        case "purchase":
          return "#34be82";
        case "updateParent":
        case "updateChildNode":
          return "#3caab4";
        case "understanding":
          return "#6464d2";
        default:
          return "#736fe6";
      }
    };

    const renderTreeContext = (tc) => {
      if (!tc) return "";
      const parts = [];
      const tcNodeId = tc.targetNodeId?._id || tc.targetNodeId;
      const tcNodeName = tc.targetNodeId?.name || tc.targetNodeName;
      if (tcNodeId && tcNodeName && typeof tcNodeId === "string") {
        parts.push(
          `<a href="/api/v1/node/${tcNodeId}${tokenQS}" class="tree-target-link">${esc(tcNodeName)}</a>`,
        );
      } else if (tcNodeName) {
        parts.push(`<span class="tree-target-name">${esc(tcNodeName)}</span>`);
      } else if (tc.targetPath) {
        const pathParts = tc.targetPath.split(" / ");
        const last = pathParts[pathParts.length - 1];
        parts.push(`<span class="tree-target-name">${esc(last)}</span>`);
      }
      if (tc.planStepIndex != null && tc.planTotalSteps != null) {
        parts.push(
          `<span class="badge badge-step">${tc.planStepIndex}/${tc.planTotalSteps}</span>`,
        );
      }
      if (tc.stepResult) {
        const resultClasses = {
          success: "badge-done",
          failed: "badge-stopped",
          skipped: "badge-skipped",
          pending: "badge-pending",
        };
        const resultIcons = {
          success: "done",
          failed: "failed",
          skipped: "skip",
          pending: "...",
        };
        parts.push(
          `<span class="badge ${resultClasses[tc.stepResult] || "badge-pending"}">${resultIcons[tc.stepResult] || ""} ${tc.stepResult}</span>`,
        );
      }
      if (parts.length === 0) return "";
      return `<div class="tree-context-bar">${parts.join("")}</div>`;
    };

    const renderDirective = (tc) => {
      if (!tc?.directive) return "";
      return `<div class="tree-directive">${esc(tc.directive)}</div>`;
    };

    const getTargetName = (tc) => {
      if (!tc) return null;
      return tc.targetNodeId?.name || tc.targetNodeName || null;
    };

    const renderModelBadge = (chat) => {
      const connName = chat.llmProvider?.connectionId?.name;
      const model = connName || chat.llmProvider?.model;
      if (!model) return "";
      return `<span class="chain-model">${esc(model)}</span>`;
    };

    const groupIntoChains = (chats) => {
      const chainMap = new Map();
      const chainOrder = [];
      for (const chat of chats) {
        const key = chat.rootChatId || chat._id;
        if (!chainMap.has(key)) {
          chainMap.set(key, { root: null, steps: [] });
          chainOrder.push(key);
        }
        const chain = chainMap.get(key);
        if (chat.chainIndex === 0 || chat._id === key) {
          chain.root = chat;
        } else {
          chain.steps.push(chat);
        }
      }
      return chainOrder
        .map((key) => {
          const chain = chainMap.get(key);
          chain.steps.sort((a, b) => a.chainIndex - b.chainIndex);
          return chain;
        })
        .filter((c) => c.root);
    };

    const groupStepsIntoPhases = (steps) => {
      const phases = [];
      let currentPlan = null;
      for (const step of steps) {
        const mode = step.aiContext?.path || "";
        if (mode === "translator") {
          currentPlan = null;
          phases.push({ type: "translate", step });
        } else if (mode.startsWith("tree:orchestrator:plan:")) {
          currentPlan = { type: "plan", marker: step, substeps: [] };
          phases.push(currentPlan);
        } else if (mode === "tree:respond") {
          currentPlan = null;
          phases.push({ type: "respond", step });
        } else if (currentPlan) {
          currentPlan.substeps.push(step);
        } else {
          phases.push({ type: "step", step });
        }
      }
      return phases;
    };

    const renderSubstep = (chat) => {
      const duration = formatDuration(
        chat.startMessage?.time,
        chat.endMessage?.time,
      );
      const stopped = chat.endMessage?.stopped;
      const tc = chat.treeContext;
      const dotClass = stopped
        ? "chain-dot-stopped"
        : tc?.stepResult === "failed"
          ? "chain-dot-stopped"
          : tc?.stepResult === "skipped"
            ? "chain-dot-skipped"
            : chat.endMessage?.time
              ? "chain-dot-done"
              : "chain-dot-pending";
      const targetName = getTargetName(tc);
      const inputFull = formatContent(chat.startMessage?.content);
      const outputFull = formatContent(chat.endMessage?.content);

      return `
      <details class="chain-substep">
        <summary class="chain-substep-summary">
          <span class="chain-dot ${dotClass}"></span>
          <span class="chain-step-mode">${modeLabel(chat.aiContext?.path)}</span>
          ${targetName ? `<span class="chain-step-target">${esc(targetName)}</span>` : ""}
          ${tc?.stepResult === "failed" ? `<span class="chain-step-failed">FAILED</span>` : ""}
          ${tc?.resultDetail && tc.stepResult === "failed" ? `<span class="chain-step-fail-reason">${truncate(tc.resultDetail, 60)}</span>` : ""}
          ${renderModelBadge(chat)}
          ${duration ? `<span class="chain-step-duration">${duration}</span>` : ""}
        </summary>
        <div class="chain-step-body">
          ${renderTreeContext(tc)}
          ${renderDirective(tc)}
          <div class="chain-step-input"><span class="chain-io-label chain-io-in">IN</span>${inputFull}</div>
          ${outputFull ? `<div class="chain-step-output"><span class="chain-io-label chain-io-out">OUT</span>${outputFull}</div>` : ""}
        </div>
      </details>`;
    };

    const renderPhases = (steps) => {
      const phases = groupStepsIntoPhases(steps);
      if (phases.length === 0) return "";

      const phaseHtml = phases
        .map((phase) => {
          if (phase.type === "translate") {
            const s = phase.step;
            const tc = s.treeContext;
            const duration = formatDuration(
              s.startMessage?.time,
              s.endMessage?.time,
            );
            const outputFull = formatContent(s.endMessage?.content);
            return `
          <details class="chain-phase chain-phase-translate">
            <summary class="chain-phase-summary">
              <span class="chain-phase-icon">T</span>
              <span class="chain-phase-label">Translator</span>
              ${tc?.planTotalSteps ? `<span class="chain-step-counter">${tc.planTotalSteps}-step plan</span>` : ""}
              ${tc?.directive ? `<span class="chain-plan-summary-text">${truncate(tc.directive, 80)}</span>` : ""}
              ${renderModelBadge(s)}
              ${duration ? `<span class="chain-step-duration">${duration}</span>` : ""}
            </summary>
            ${outputFull ? `<div class="chain-step-body"><div class="chain-step-output"><span class="chain-io-label chain-io-out">PLAN</span>${outputFull}</div></div>` : ""}
          </details>`;
          }

          if (phase.type === "plan") {
            const m = phase.marker;
            const tc = m.treeContext;
            const targetName = getTargetName(tc);
            const hasSubsteps = phase.substeps.length > 0;
            const counts = { success: 0, failed: 0, skipped: 0 };
            for (const sub of phase.substeps) {
              const r = sub.treeContext?.stepResult;
              if (r && counts[r] !== undefined) counts[r]++;
            }
            const countBadges = [
              counts.success > 0
                ? `<span class="badge badge-done">${counts.success} done</span>`
                : "",
              counts.failed > 0
                ? `<span class="badge badge-stopped">${counts.failed} failed</span>`
                : "",
              counts.skipped > 0
                ? `<span class="badge badge-skipped">${counts.skipped} skipped</span>`
                : "",
            ]
              .filter(Boolean)
              .join("");

            const directiveText = tc?.directive || "";
            const inputFull = directiveText
              ? esc(directiveText)
              : formatContent(m.startMessage?.content);

            return `
          <div class="chain-phase chain-phase-plan">
            <div class="chain-phase-header">
              <span class="chain-phase-icon">P</span>
              <span class="chain-phase-label">${modeLabel(m.aiContext?.path)}</span>
              ${targetName ? `<span class="chain-step-target">${esc(targetName)}</span>` : ""}
              ${tc?.planStepIndex != null && tc?.planTotalSteps != null ? `<span class="chain-step-counter">Step ${tc.planStepIndex} of ${tc.planTotalSteps}</span>` : ""}
              ${countBadges}
              ${renderModelBadge(m)}
            </div>
            <div class="chain-plan-directive">${inputFull}</div>
            ${hasSubsteps ? `<div class="chain-substeps">${phase.substeps.map(renderSubstep).join("")}</div>` : ""}
          </div>`;
          }

          if (phase.type === "respond") {
            const s = phase.step;
            const tc = s.treeContext;
            const duration = formatDuration(
              s.startMessage?.time,
              s.endMessage?.time,
            );
            const inputFull = formatContent(s.startMessage?.content);
            const outputFull = formatContent(s.endMessage?.content);
            return `
          <details class="chain-phase chain-phase-respond">
            <summary class="chain-phase-summary">
              <span class="chain-phase-icon">R</span>
              <span class="chain-phase-label">${modeLabel(s.aiContext?.path)}</span>
              ${renderModelBadge(s)}
              ${duration ? `<span class="chain-step-duration">${duration}</span>` : ""}
            </summary>
            <div class="chain-step-body">
              ${renderTreeContext(tc)}
              ${inputFull ? `<div class="chain-step-input"><span class="chain-io-label chain-io-in">IN</span>${inputFull}</div>` : ""}
              ${outputFull ? `<div class="chain-step-output"><span class="chain-io-label chain-io-out">OUT</span>${outputFull}</div>` : ""}
            </div>
          </details>`;
          }

          return renderSubstep(phase.step);
        })
        .join("");

      const summaryParts = phases
        .map((p) => {
          if (p.type === "translate") {
            const tc = p.step.treeContext;
            return tc?.planTotalSteps ? `T ${tc.planTotalSteps}-step` : "T";
          }
          if (p.type === "plan") {
            const tc = p.marker.treeContext;
            const targetName = getTargetName(tc);
            const sub = p.substeps
              .map((s) => {
                const stc = s.treeContext;
                const icon =
                  stc?.stepResult === "failed"
                    ? "X "
                    : stc?.stepResult === "skipped"
                      ? "- "
                      : stc?.stepResult === "success"
                        ? "v "
                        : "";
                return `${icon}${modeLabel(s.aiContext?.path)}`;
              })
              .join(" > ");
            const label = targetName ? `P ${esc(targetName)}` : "P";
            return sub ? `${label}: ${sub}` : label;
          }
          if (p.type === "respond") return "R";
          return modeLabel(p.step?.aiContext?.path);
        })
        .join("  ");

      return `
      <details class="chain-dropdown">
        <summary class="chain-summary">
          ${phases.length} phase${phases.length !== 1 ? "s" : ""}
          <span class="chain-modes">${summaryParts}</span>
        </summary>
        <div class="chain-phases">${phaseHtml}</div>
      </details>`;
    };

    const renderChain = (chain) => {
      const chat = chain.root;
      const steps = chain.steps;
      const duration = formatDuration(
        chat.startMessage?.time,
        chat.endMessage?.time,
      );
      const stopped = chat.endMessage?.stopped;
      const contribs = chat.contributions || [];
      const hasContribs = contribs.length > 0;
      const hasSteps = steps.length > 0;
      const modelName =
        chat.llmProvider?.connectionId?.name ||
        chat.llmProvider?.model ||
        "unknown";

      const tc = chat.treeContext;
      const treeNodeId = tc?.targetNodeId?._id || tc?.targetNodeId;
      const treeNodeName = tc?.targetNodeId?.name || tc?.targetNodeName;
      const treeLink =
        treeNodeId && treeNodeName
          ? `<a href="/api/v1/node/${treeNodeId}${tokenQS}" class="tree-target-link">${esc(treeNodeName)}</a>`
          : treeNodeName
            ? `<span class="tree-target-name">${esc(treeNodeName)}</span>`
            : "";

      const statusBadge = stopped
        ? `<span class="badge badge-stopped">Stopped</span>`
        : chat.endMessage?.time
          ? `<span class="badge badge-done">Done</span>`
          : `<span class="badge badge-pending">Pending</span>`;

      const contribRows = contribs
        .map((c) => {
          const nId = c.nodeId?._id || c.nodeId;
          const nName = c.nodeId?.name || nId || "--";
          const nodeRef = nId
            ? `<a href="/api/v1/node/${nId}${tokenQS}">${esc(nName)}</a>`
            : `<span style="opacity:0.5">--</span>`;
          const aiBadge = c.wasAi
            ? `<span class="mini-badge mini-ai">AI</span>`
            : "";
          const cEnergyBadge =
            c.energyUsed > 0
              ? `<span class="mini-badge mini-energy">E${c.energyUsed}</span>`
              : "";
          const understandingLink =
            c.action === "understanding" &&
            c.understandingMeta?.understandingRunId &&
            c.understandingMeta?.rootNodeId
              ? ` <a class="understanding-link" href="/api/v1/root/${c.understandingMeta.rootNodeId}/understandings/run/${c.understandingMeta.understandingRunId}${tokenQS}">View run</a>`
              : "";
          const color = actionColor(c.action);
          return `
        <tr class="contrib-row">
          <td><span class="action-dot" style="background:${color}"></span>${esc(actionLabel(c.action))}${understandingLink}</td>
          <td>${nodeRef}</td>
          <td>${aiBadge}${cEnergyBadge}</td>
          <td class="contrib-time">${formatTime(c.date)}</td>
        </tr>`;
        })
        .join("");

      const stepsHtml = hasSteps ? renderPhases(steps) : "";

      return `
      <li class="note-card">
        <div class="chat-header">
          <div class="chat-header-left">
            <span class="chat-mode">${modeLabel(chat.aiContext?.path)}</span>
            ${treeLink}
            <span class="chat-model">${esc(modelName)}</span>
          </div>
          <div class="chat-badges">
            ${statusBadge}
            ${duration ? `<span class="badge badge-duration">${duration}</span>` : ""}
            <span class="badge badge-source">${sourceLabel(chat.startMessage?.source)}</span>
          </div>
        </div>

        <div class="note-content">
          <div class="chat-message chat-user">
            <span class="msg-label">You</span>
            <div class="msg-text msg-clamp">${esc(chat.startMessage?.content || "")}</div>
            ${(chat.startMessage?.content || "").length > 300 ? `<button class="expand-btn" onclick="toggleExpand(this)">Show more</button>` : ""}
          </div>
          ${
            chat.endMessage?.content
              ? `
          <div class="chat-message chat-ai">
            <span class="msg-label">AI</span>
            <div class="msg-text msg-clamp">${linkifyNodeIds(esc(chat.endMessage.content))}</div>
            ${chat.endMessage.content.length > 300 ? `<button class="expand-btn" onclick="toggleExpand(this)">Show more</button>` : ""}
          </div>`
              : ""
          }
        </div>

        ${stepsHtml}

        ${
          hasContribs
            ? `
        <details class="contrib-dropdown">
          <summary class="contrib-summary">
            ${contribs.length} contribution${contribs.length !== 1 ? "s" : ""} during this chat
          </summary>
          <div class="contrib-table-wrap">
            <table class="contrib-table">
              <thead><tr><th>Action</th><th>Node</th><th></th><th>Time</th></tr></thead>
              <tbody>${contribRows}</tbody>
            </table>
          </div>
        </details>`
            : ""
        }

        <div class="note-meta">
          ${formatTime(chat.startMessage?.time)}
          <span class="meta-separator">|</span>
          <code class="contribution-id">${esc(chat._id)}</code>
        </div>
      </li>`;
    };

    const sessionGroups = sessions;

    const renderedSections = sessionGroups
      .map((group) => {
        const chatCount = group.chatCount;
        const sessionTime = formatTime(group.startTime);
        const shortId = group.sessionId.slice(0, 8);
        const chains = groupIntoChains(group.chats);
        const chatCards = chains.map(renderChain).join("");

        return `
      <div class="session-group">
        <div class="session-pane">
          <div class="session-pane-header">
            <div class="session-header-left">
              <span class="session-id">${esc(shortId)}</span>
              <span class="session-info">${chatCount} chat${chatCount !== 1 ? "s" : ""}</span>
            </div>
            <span class="session-time">${sessionTime}</span>
          </div>
          <ul class="notes-list">${chatCards}</ul>
        </div>
      </div>`;
      })
      .join("");

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${esc(rootName)} -- TreeOS AI Chats</title>
  <style>
:root {
  --glass-alpha: 0.28;
  --glass-alpha-hover: 0.38;
}

* { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
html, body { background: #736fe6; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh; min-height: 100dvh;
  padding: 20px; color: #1a1a1a;
  position: relative; overflow-x: hidden; touch-action: manipulation;
}

body::before, body::after {
  content: ''; position: fixed; border-radius: 50%; opacity: 0.08;
  animation: float 20s infinite ease-in-out; pointer-events: none;
}
body::before { width: 600px; height: 600px; background: white; top: -300px; right: -200px; animation-delay: -5s; }
body::after { width: 400px; height: 400px; background: white; bottom: -200px; left: -100px; animation-delay: -10s; }

@keyframes float {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-30px) rotate(5deg); }
}
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(30px); }
  to { opacity: 1; transform: translateY(0); }
}

.container { max-width: 900px; margin: 0 auto; position: relative; z-index: 1; }

.back-nav { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; animation: fadeInUp 0.5s ease-out; }
.back-link {
  display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px;
  background: rgba(115,111,230,var(--glass-alpha)); backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%); color: white; text-decoration: none;
  border-radius: 980px; font-weight: 600; font-size: 14px;
  transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
  box-shadow: 0 8px 24px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.28); position: relative; overflow: hidden;
}
.back-link::before {
  content: ""; position: absolute; inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,0.35), transparent 60%);
  opacity: 0; transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22,1,0.36,1); pointer-events: none;
}
.back-link:hover { background: rgba(115,111,230,var(--glass-alpha-hover)); transform: translateY(-1px); }
.back-link:hover::before { opacity: 1; transform: translateX(30%) translateY(10%); }

.header {
  position: relative; overflow: hidden;
  background: rgba(115,111,230,var(--glass-alpha)); backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px; padding: 32px; margin-bottom: 24px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.28); color: white;
  animation: fadeInUp 0.6s ease-out 0.1s both;
}
.header::before {
  content: ""; position: absolute; inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,0.35), transparent 60%);
  opacity: 0; transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22,1,0.36,1); pointer-events: none;
}
.header:hover::before { opacity: 1; transform: translateX(30%) translateY(10%); }
.header h1 {
  font-size: 28px; font-weight: 600; color: white; margin-bottom: 8px;
  line-height: 1.3; letter-spacing: -0.5px; text-shadow: 0 2px 8px rgba(0,0,0,0.2);
}
.header h1 a { color: white; text-decoration: none; border-bottom: 1px solid rgba(255,255,255,0.3); transition: all 0.2s; }
.header h1 a:hover { border-bottom-color: white; text-shadow: 0 0 12px rgba(255,255,255,0.8); }
.message-count {
  display: inline-block; padding: 6px 14px; background: rgba(255,255,255,0.25); color: white;
  border-radius: 980px; font-size: 14px; font-weight: 600; margin-left: 12px; border: 1px solid rgba(255,255,255,0.3);
}
.header-subtitle { font-size: 14px; color: rgba(255,255,255,0.9); margin-bottom: 8px; font-weight: 400; line-height: 1.5; }

.session-group { margin-bottom: 20px; animation: fadeInUp 0.6s ease-out both; }
.session-pane {
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 20px; overflow: hidden; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}
.session-pane-header {
  display: flex; align-items: center; justify-content: space-between; padding: 14px 20px;
  background: rgba(255,255,255,0.08); border-bottom: 1px solid rgba(255,255,255,0.1);
}
.session-header-left { display: flex; align-items: center; gap: 10px; }
.session-id {
  font-family: 'SF Mono', 'Fira Code', monospace; font-size: 11px; font-weight: 600;
  color: rgba(255,255,255,0.55); background: rgba(255,255,255,0.1); padding: 3px 8px;
  border-radius: 6px; border: 1px solid rgba(255,255,255,0.12);
}
.session-info { font-size: 13px; color: rgba(255,255,255,0.7); font-weight: 600; }
.session-time { font-size: 12px; color: rgba(255,255,255,0.4); font-weight: 500; }

.notes-list { list-style: none; display: flex; flex-direction: column; gap: 16px; padding: 16px; }
.note-card {
  --card-rgb: 115, 111, 230; position: relative;
  background: rgba(var(--card-rgb), var(--glass-alpha)); backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%); border-radius: 16px; padding: 24px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.28); transition: all 0.3s cubic-bezier(0.4,0,0.2,1);
  color: white; overflow: hidden; opacity: 0; transform: translateY(30px);
}
.note-card.visible { animation: fadeInUp 0.6s cubic-bezier(0.4,0,0.2,1) forwards; }
.note-card::before {
  content: ""; position: absolute; inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,0.35), transparent 60%);
  opacity: 0; transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22,1,0.36,1); pointer-events: none;
}
.note-card:hover { background: rgba(var(--card-rgb), var(--glass-alpha-hover)); transform: translateY(-2px); box-shadow: 0 12px 32px rgba(0,0,0,0.18); }
.note-card:hover::before { opacity: 1; transform: translateX(30%) translateY(10%); }

.chat-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
.chat-header-left { display: flex; align-items: center; gap: 8px; }
.chat-mode {
  font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.7); background: rgba(255,255,255,0.1);
  padding: 3px 10px; border-radius: 980px; border: 1px solid rgba(255,255,255,0.15);
}
.chat-model {
  font-size: 11px; font-weight: 500; color: rgba(255,255,255,0.45);
  font-family: 'SF Mono', 'Fira Code', monospace; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; max-width: 200px;
}
.chat-badges { display: flex; flex-wrap: wrap; gap: 6px; }

.note-content { margin-bottom: 16px; display: flex; flex-direction: column; gap: 14px; }
.chat-message { display: flex; gap: 10px; align-items: flex-start; }
.msg-label {
  flex-shrink: 0; font-weight: 700; font-size: 10px; text-transform: uppercase;
  letter-spacing: 0.5px; padding: 3px 10px; border-radius: 980px; margin-top: 3px;
}
.chat-user .msg-label { background: rgba(255,255,255,0.2); color: white; }
.chat-ai .msg-label   { background: rgba(100,220,255,0.25); color: white; }
.msg-text { color: rgba(255,255,255,0.95); word-wrap: break-word; min-width: 0; font-size: 15px; line-height: 1.65; font-weight: 400; }
.msg-clamp {
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
  overflow: hidden; max-height: calc(1.65em * 4); transition: max-height 0.3s ease;
}
.msg-clamp.expanded { -webkit-line-clamp: unset; max-height: none; overflow: visible; }
.expand-btn {
  background: none; border: none; color: rgba(100,220,255,0.9); cursor: pointer;
  font-size: 12px; font-weight: 600; padding: 2px 0; margin-top: 2px; transition: color 0.2s;
}
.expand-btn:hover { color: rgba(100,220,255,1); text-decoration: underline; }
.node-link { color: #7effc0; text-decoration: none; background: rgba(50,220,120,0.15); padding: 1px 6px; border-radius: 4px; font-family: monospace; font-size: 13px; }
.node-link:hover { background: rgba(50,220,120,0.3); }
.understanding-link {
  color: rgba(100,100,210,0.9); text-decoration: none; font-size: 11px; font-weight: 500;
  margin-left: 4px; transition: color 0.2s;
}
.understanding-link:hover { color: rgba(130,130,255,1); text-decoration: underline; }
.chat-user .msg-text { font-weight: 500; }

.chain-dropdown { margin-bottom: 12px; }
.chain-summary {
  cursor: pointer; font-size: 13px; font-weight: 600;
  color: rgba(255,255,255,0.85); padding: 8px 14px;
  background: rgba(255,255,255,0.1); border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.15);
  transition: all 0.2s; list-style: none;
  display: flex; align-items: center; gap: 8px;
}
.chain-summary::-webkit-details-marker { display: none; }
.chain-summary::before { content: ">"; font-size: 10px; transition: transform 0.15s; display: inline-block; }
details[open] > .chain-summary::before { transform: rotate(90deg); }
.chain-summary:hover { background: rgba(255,255,255,0.18); }
.chain-modes { font-size: 11px; color: rgba(255,255,255,0.5); font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chain-phases { margin-top: 12px; display: flex; flex-direction: column; gap: 12px; }

.chain-phase { border-radius: 10px; overflow: hidden; }
.chain-phase-header {
  display: flex; align-items: center; gap: 8px; padding: 8px 12px; font-size: 12px; font-weight: 600; flex-wrap: wrap;
}
.chain-phase-icon { font-size: 14px; }
.chain-phase-label { color: rgba(255,255,255,0.85); }
.chain-phase-translate { background: rgba(100,100,220,0.12); border: 1px solid rgba(100,100,220,0.2); }
.chain-phase-plan { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); }
.chain-phase-respond { background: rgba(72,187,120,0.1); border: 1px solid rgba(72,187,120,0.2); }
.chain-plan-directive { padding: 6px 12px 10px; font-size: 12px; color: rgba(255,255,255,0.6); line-height: 1.5; white-space: pre-wrap; }

.chain-phase-summary, .chain-substep-summary {
  cursor: pointer; list-style: none;
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; font-size: 12px; font-weight: 600; flex-wrap: wrap;
}
.chain-phase-summary::-webkit-details-marker,
.chain-substep-summary::-webkit-details-marker { display: none; }
.chain-phase-summary::before,
.chain-substep-summary::before {
  content: ">"; font-size: 8px; color: rgba(255,255,255,0.35);
  transition: transform 0.15s; display: inline-block;
}
details[open] > .chain-phase-summary::before,
details[open] > .chain-substep-summary::before { transform: rotate(90deg); }
.chain-phase-summary:hover, .chain-substep-summary:hover { background: rgba(255,255,255,0.05); }

.chain-substeps { display: flex; flex-direction: column; gap: 2px; padding: 0 8px 8px; }
.chain-substep { border-radius: 6px; background: rgba(255,255,255,0.04); }
.chain-substep:hover { background: rgba(255,255,255,0.07); }

.chain-dot {
  display: inline-block; width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
  border: 2px solid rgba(255,255,255,0.3);
}
.chain-dot-done    { background: rgba(72,187,120,0.8); border-color: rgba(72,187,120,0.4); }
.chain-dot-stopped { background: rgba(200,80,80,0.8); border-color: rgba(200,80,80,0.4); }
.chain-dot-pending { background: rgba(255,200,50,0.8); border-color: rgba(255,200,50,0.4); }
.chain-dot-skipped { background: rgba(160,160,160,0.6); border-color: rgba(160,160,160,0.3); }

.chain-step-mode {
  font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.8);
  background: rgba(255,255,255,0.12); padding: 2px 8px; border-radius: 6px;
}
.chain-step-duration { font-size: 10px; color: rgba(255,255,255,0.45); }
.chain-model {
  font-size: 10px; font-family: 'SF Mono', 'Fira Code', monospace;
  color: rgba(255,255,255,0.4); margin-left: auto; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; max-width: 150px;
}

.chain-step-body { padding: 10px 12px; border-top: 1px solid rgba(255,255,255,0.08); }
.chain-io-label {
  display: inline-block; font-size: 9px; font-weight: 700; letter-spacing: 0.5px;
  padding: 1px 6px; border-radius: 4px; margin-right: 8px; vertical-align: middle;
}
.chain-io-in  { background: rgba(100,220,255,0.2); color: rgba(100,220,255,0.9); }
.chain-io-out { background: rgba(72,187,120,0.2); color: rgba(72,187,120,0.9); }

.chain-step-input {
  font-size: 12px; color: rgba(255,255,255,0.8); line-height: 1.6;
  word-break: break-word; white-space: pre-wrap;
  font-family: 'SF Mono', 'Fira Code', monospace;
}
.chain-step-output {
  font-size: 12px; color: rgba(255,255,255,0.65); line-height: 1.6;
  margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);
  word-break: break-word; white-space: pre-wrap;
  font-family: 'SF Mono', 'Fira Code', monospace;
}
.chain-json { color: rgba(255,255,255,0.8); }

.tree-context-bar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 6px 12px; margin-bottom: 6px;
  background: rgba(255,255,255,0.06); border-radius: 6px; font-size: 12px;
}
.tree-target-link {
  color: rgba(100,220,255,0.95); text-decoration: none;
  border-bottom: 1px solid rgba(100,220,255,0.3);
  font-weight: 600; font-size: 12px; transition: all 0.2s;
}
.tree-target-link:hover {
  border-bottom-color: rgba(100,220,255,0.8);
  text-shadow: 0 0 8px rgba(100,220,255,0.5);
}
.tree-target-name { color: rgba(255,255,255,0.8); font-weight: 600; font-size: 12px; }
.tree-directive {
  padding: 4px 12px 8px; font-size: 11px; color: rgba(255,255,255,0.55);
  line-height: 1.5; font-style: italic;
  border-left: 2px solid rgba(255,255,255,0.15); margin: 0 12px 8px;
}
.chain-step-counter {
  font-size: 10px; color: rgba(255,255,255,0.5); font-weight: 500;
  background: rgba(255,255,255,0.08); padding: 2px 8px; border-radius: 4px;
}
.chain-step-target {
  font-size: 10px; color: rgba(100,220,255,0.7); font-weight: 500;
  max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.chain-step-failed {
  font-size: 9px; font-weight: 700; color: rgba(200,80,80,0.9);
  background: rgba(200,80,80,0.15); padding: 1px 6px; border-radius: 4px; letter-spacing: 0.5px;
}
.chain-step-fail-reason {
  font-size: 10px; color: rgba(200,80,80,0.7); font-weight: 400;
  font-style: italic; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.badge-step {
  background: rgba(255,255,255,0.12); color: rgba(255,255,255,0.7);
  font-family: 'SF Mono', 'Fira Code', monospace; font-size: 10px;
}
.badge-skipped { background: rgba(160,160,160,0.25); color: rgba(255,255,255,0.7); }
.chain-plan-summary-text {
  font-size: 11px; color: rgba(255,255,255,0.45); font-weight: 400;
  font-style: italic; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; max-width: 300px;
}

.contrib-dropdown { margin-bottom: 12px; }
.contrib-summary {
  cursor: pointer; font-size: 13px; font-weight: 600;
  color: rgba(255,255,255,0.85); padding: 8px 14px;
  background: rgba(255,255,255,0.1); border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.15);
  transition: all 0.2s; list-style: none;
  display: flex; align-items: center; gap: 6px;
}
.contrib-summary::-webkit-details-marker { display: none; }
.contrib-summary::before { content: ">"; font-size: 10px; transition: transform 0.2s; display: inline-block; }
details[open] .contrib-summary::before { transform: rotate(90deg); }
.contrib-summary:hover { background: rgba(255,255,255,0.18); }
.contrib-table-wrap { margin-top: 10px; overflow-x: auto; -webkit-overflow-scrolling: touch; }
.contrib-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.contrib-table thead th {
  text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.5px; color: rgba(255,255,255,0.55); padding: 6px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.15);
}
.contrib-row td {
  padding: 7px 10px; border-bottom: 1px solid rgba(255,255,255,0.08);
  color: rgba(255,255,255,0.88); vertical-align: middle; white-space: nowrap;
}
.contrib-row:last-child td { border-bottom: none; }
.contrib-row a { color: white; text-decoration: none; border-bottom: 1px solid rgba(255,255,255,0.3); transition: all 0.2s; }
.contrib-row a:hover { border-bottom-color: white; text-shadow: 0 0 12px rgba(255,255,255,0.8); }
.contrib-time { font-size: 11px; color: rgba(255,255,255,0.5); }
.action-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }

.mini-badge {
  display: inline-flex; align-items: center; padding: 1px 7px; border-radius: 980px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.2px; margin-right: 3px;
}
.mini-ai    { background: rgba(255,200,50,0.35); color: #fff; }
.mini-energy { background: rgba(100,220,255,0.3); color: #fff; }

.badge {
  display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 980px;
  font-size: 11px; font-weight: 700; letter-spacing: 0.3px; border: 1px solid rgba(255,255,255,0.2);
}
.badge-done     { background: rgba(72,187,120,0.35); color: #fff; }
.badge-stopped  { background: rgba(200,80,80,0.35); color: #fff; }
.badge-pending  { background: rgba(255,200,50,0.3); color: #fff; }
.badge-duration { background: rgba(255,255,255,0.15); color: rgba(255,255,255,0.9); }
.badge-source   { background: rgba(100,100,210,0.3); color: #fff; }

.note-meta {
  padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.2);
  font-size: 12px; color: rgba(255,255,255,0.85); line-height: 1.8;
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
}
.meta-separator { color: rgba(255,255,255,0.5); }
.contribution-id {
  background: rgba(255,255,255,0.12); padding: 2px 6px; border-radius: 4px;
  font-size: 11px; font-family: 'SF Mono', 'Fira Code', monospace;
  color: rgba(255,255,255,0.6); border: 1px solid rgba(255,255,255,0.1);
}

.empty-state {
  position: relative; overflow: hidden;
  background: rgba(115,111,230,var(--glass-alpha)); backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px; padding: 60px 40px; text-align: center;
  box-shadow: 0 8px 32px rgba(0,0,0,0.12), inset 0 1px 0 rgba(255,255,255,0.25);
  border: 1px solid rgba(255,255,255,0.28); color: white;
}
.empty-state::before {
  content: ""; position: absolute; inset: -40%;
  background: radial-gradient(120% 60% at 0% 0%, rgba(255,255,255,0.35), transparent 60%);
  opacity: 0; transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22,1,0.36,1); pointer-events: none;
}
.empty-state:hover::before { opacity: 1; transform: translateX(30%) translateY(10%); }
.empty-state-icon { font-size: 64px; margin-bottom: 16px; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.2)); }
.empty-state-text { font-size: 20px; color: white; margin-bottom: 8px; font-weight: 600; text-shadow: 0 2px 8px rgba(0,0,0,0.2); }
.empty-state-subtext { font-size: 14px; color: rgba(255,255,255,0.85); }

@media (max-width: 640px) {
  body { padding: 16px; }
  .header { padding: 24px 20px; }
  .header h1 { font-size: 24px; }
  .message-count { display: block; margin-left: 0; margin-top: 8px; width: fit-content; }
  .note-card { padding: 20px 16px; }
  .back-nav { flex-direction: column; }
  .back-link { width: 100%; justify-content: center; }
  .empty-state { padding: 40px 24px; }
  .chat-header { flex-direction: column; align-items: flex-start; }
  .contrib-row td { font-size: 12px; padding: 5px 6px; }
  .session-pane-header { flex-direction: column; align-items: flex-start; gap: 6px; padding: 12px 16px; }
  .notes-list { padding: 12px; gap: 12px; }
  .chat-model { max-width: 140px; }
  .msg-text { font-size: 14px; }
  .chain-plan-directive { font-size: 11px; }
  .chain-step-target { max-width: 100px; }
  .chain-plan-summary-text { max-width: 160px; }
  .chain-step-fail-reason { max-width: 120px; }
}
@media (min-width: 641px) and (max-width: 1024px) {
  .container { max-width: 700px; }
}
  </style>
</head>
<body>
  <div class="container">
    <div class="back-nav">
      <a href="/api/v1/root/${rootId}${tokenQS}" class="back-link">&lt;- Back to Tree</a>
    </div>

    <div class="header">
      <h1>
        AI Chats for
        <a href="/api/v1/root/${rootId}${tokenQS}">${esc(rootName)}</a>
        ${allChats.length > 0 ? `<span class="message-count">${allChats.length}</span>` : ""}
      </h1>
      <div class="header-subtitle">
        All AI sessions across this tree and its descendants.
      </div>
    </div>

    ${
      sessionGroups.length
        ? renderedSections
        : `
    <div class="empty-state">
      <div class="empty-state-icon">AI</div>
      <div class="empty-state-text">No AI chats yet</div>
      <div class="empty-state-subtext">AI conversations involving this tree will appear here</div>
    </div>`
    }
  </div>

  <script>
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry, index) {
        if (entry.isIntersecting) {
          setTimeout(function() { entry.target.classList.add('visible'); }, index * 50);
          observer.unobserve(entry.target);
        }
      });
    }, { root: null, rootMargin: '50px', threshold: 0.1 });
    document.querySelectorAll('.note-card').forEach(function(card) { observer.observe(card); });

    function toggleExpand(btn) {
      var text = btn.previousElementSibling;
      if (!text) return;
      var expanded = text.classList.toggle('expanded');
      btn.textContent = expanded ? 'Show less' : 'Show more';
    }
  </script>
</body>
</html>
`);
  } catch (err) {
    console.error("Root chats error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
