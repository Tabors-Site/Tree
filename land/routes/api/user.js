import express from "express";
import urlAuth from "../../middleware/urlAuth.js";
import authenticate from "../../middleware/authenticate.js";

import path from "path";
import fs from "fs";
import multer from "multer";
import mime from "mime-types";

import User from "../../db/models/user.js";
import { getAIChats } from "../../core/llms/aichat.js";

import { createPurchaseSession } from "../billing/purchase.js";
import { notFoundPage } from "../../middleware/notFoundPage.js";
import {
  addCustomLlmConnection,
  updateCustomLlmConnection,
  deleteCustomLlmConnection,
  getConnectionsForUser,
  assignConnection,
} from "../../core/llms/customLLM.js";

import {
  getAllNotesByUser as coreGetAllNotesByUser,
  getAllTagsForUser as coreGetAllTagsForUser,
  searchNotesByUser as coreSearchNotesByUser,
} from "../../core/tree/notes.js";
import { getNotifications } from "../../core/tree/notifications.js";
import { getContributionsByUser } from "../../core/tree/contributions.js";

import { getDeletedBranchesForUser } from "../../core/tree/treeFetch.js";

import { setHtmlShareToken } from "../../core/tree/user.js";
import { maybeResetEnergy } from "../../core/tree/energy.js";
import preUploadCheck from "../../middleware/preUploadCheck.js";

import {
  createNewNode,
  reviveNodeBranch,
  reviveNodeBranchAsRoot,
} from "../../core/tree/treeManagement.js";

import {
  getPendingInvitesForUser,
  respondToInvite,
} from "../../core/tree/invites.js";

import {
  createRawIdea as coreCreateRawIdea,
  getRawIdeas as coreGetRawIdeas,
  searchRawIdeasByUser as coreSearchRawIdeasByUser,
  deleteRawIdeaAndFile as coreDeleteRawIdeaAndFile,
  convertRawIdeaToNote as coreConvertRawIdeaToNote,
  toggleAutoPlace as coreToggleAutoPlace,
  AUTO_PLACE_ELIGIBLE,
} from "../../core/tree/rawIdea.js";
import RawIdea from "../../db/models/rawIdea.js";

import {
  createApiKey,
  generateApiKey,
  listApiKeys,
  deleteApiKey,
} from "../../core/users.js";

import getNodeName from "./helpers/getNameById.js";

import { processPurchase } from "../../core/billing/processPurchase.js";
import { getLandUrl } from "../../canopy/identity.js";

import {
  renderUserProfile,
  renderUserNotes,
  renderUserTags,
  renderUserContributions,
  renderResetPasswordExpired,
  renderResetPasswordForm,
  renderResetPasswordMismatch,
  renderResetPasswordInvalid,
  renderResetPasswordSuccess,
  renderRawIdeasList,
  renderRawIdeaText,
  renderRawIdeaFile,
  renderInvites,
  renderDeletedBranches,
  renderApiKeyCreated,
  renderApiKeysList,
  renderShareToken,
  renderEnergy,
  renderChats,
  renderNotifications,
} from "./html/user.js";

const uploadsFolder = path.join(process.cwd(), "uploads");

if (!fs.existsSync(uploadsFolder)) {
  fs.mkdirSync(uploadsFolder);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsFolder),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + "-" + Math.random().toString(36).slice(2);
    cb(null, name + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
});

const router = express.Router();

const allowedParams = ["token", "html", "limit", "startTime", "endTime", "q"];

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

router.get("/user/:userId", urlAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    const filtered = Object.entries(req.query)
      .filter(([key]) => allowedParams.includes(key))
      .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
      .join("&");

    const queryString = filtered ? `?${filtered}` : "";

    const user = await User.findById(userId)
      .populate("roots", "name _id")
      .lean()
      .exec();

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    maybeResetEnergy(user);

    const roots = user.roots || [];
    const profileType = user.profileType || "basic";
    const energy = user.availableEnergy;
    const extraEnergy = user.additionalEnergy;

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json({
        userId: user._id,
        username: user.username,
        roots,
        remoteRoots: user.remoteRoots || [],
        profileType,
        energy,
      });
    }

    const ENERGY_RESET_MS = 24 * 60 * 60 * 1000;
    const storageUsedKB = user.storageUsage || 0;

    const lastResetAt = energy?.lastResetAt
      ? new Date(energy.lastResetAt)
      : null;

    const nextResetAt = lastResetAt
      ? new Date(lastResetAt.getTime() + ENERGY_RESET_MS)
      : null;

    const resetTimeLabel = nextResetAt
      ? nextResetAt.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—";

    return res.send(
      renderUserProfile({
        userId,
        user,
        roots,
        profileType,
        energy,
        extraEnergy: user.additionalEnergy,
        queryString,
        resetTimeLabel,
        storageUsedKB,
      }),
    );
  } catch (err) {
    console.error("Error in /user/:userId:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/user/:userId/notes", urlAuth, async (req, res) => {
  try {
    const userId = req.params.userId;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    // NEW: search query
    const query = req.query.q || "";

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;

    const rawLimit = req.query.limit;
    let limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

    if (limit >= 200 || limit == undefined) {
      limit = 200;
    }
    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return res.status(400).json({
        success: false,
        error: "Invalid limit: must be a positive number",
      });
    }

    // NEW: If search term exists → run search
    let result;
    if (query.trim() !== "") {
      result = await coreSearchNotesByUser({
        userId,
        query,
        limit,
        startDate,
        endDate,
      });
    } else {
      result = await coreGetAllNotesByUser(userId, limit, startDate, endDate);
    }

    const notes = result.notes.map((n) => ({
      ...n,
      // Normalize _id (some queries return id, others _id)
      _id: n._id || n.id,
      content:
        n.contentType === "file" ? `/api/v1/uploads/${n.content}` : n.content,
    }));
    // JSON MODE (no HTML)
    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json({ success: true, notes, query });
    }

    // HTML MODE
    const user = await User.findById(userId).lean();

    // Process notes outside the template literal
    const processedNotes = await Promise.all(
      notes.map(async (n) => {
        const noteId = n._id || n.id;
        const preview =
          n.contentType === "text"
            ? n.content.length > 120
              ? n.content.substring(0, 120) + "…"
              : n.content
            : n.content.split("/").pop();

        const nodeName = await getNodeName(n.nodeId);

        return `
    <li
      class="note-card"
      data-note-id="${noteId}"
      data-node-id="${n.nodeId}"
      data-version="${n.version}"
    >
      <div class="card-actions">
        ${
          n.contentType === "text"
            ? `<a href="/api/v1/node/${n.nodeId}/${n.version}/notes/${noteId}/editor${tokenQS}" class="edit-button" title="Edit note">✎</a>`
            : ""
        }
        <button class="delete-button" title="Delete note">✕</button>
      </div>

      <div class="note-content">
<div class="note-author">${escapeHtml(user.username)}</div>
        <a
          href="/api/v1/node/${n.nodeId}/${n.version}/notes/${noteId}${tokenQS}"
          class="note-link"
        >
          ${
            n.contentType === "file"
              ? `<span class="file-badge">FILE</span>`
              : ""
          }${escapeHtml(preview)}
        </a>
      </div>

      <div class="note-meta">
        ${new Date(n.createdAt).toLocaleString()}
        <span class="meta-separator">•</span>
        <a href="/api/v1/node/${n.nodeId}/${n.version}${tokenQS}">
${escapeHtml(nodeName)} v${n.version}
        </a>
        <span class="meta-separator">•</span>
        <a href="/api/v1/node/${n.nodeId}/${n.version}/notes${tokenQS}">
          View Notes
        </a>
      </div>
    </li>
  `;
      }),
    );

    return res.send(
      renderUserNotes({ userId, user, notes, processedNotes, query, token }),
    );
  } catch (err) {
    console.error("Error in /user/:userId/notes:", err);
    res.status(400).json({ success: false, error: err.message });
  }
});

/* ------------------------------------------------------------------
   GET /user/:userId/tags
   Returns all notes where this user was tagged
------------------------------------------------------------------- */
router.get("/user/:userId/tags", urlAuth, async (req, res) => {
  try {
    const userId = req.params.userId;
    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;
    const rawLimit = req.query.limit;
    const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return res.status(400).json({
        success: false,
        error: "Invalid limit: must be a positive number",
      });
    }

    const result = await coreGetAllTagsForUser(
      userId,
      limit,
      startDate,
      endDate,
    );

    const notes = result.notes.map((n) => ({
      ...n,
      content:
        n.contentType === "file" ? `/api/v1/uploads/${n.content}` : n.content,
    }));

    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json({
        success: true,
        taggedBy: result.taggedBy,
        notes,
      });
    }

    const user = await User.findById(userId).lean();

    return res.send(
      await renderUserTags({ userId, user, notes, getNodeName, token }),
    );
  } catch (err) {
    console.error("Error in /user/:userId/tags:", err);
    res.status(400).json({ success: false, error: err.message });
  }
});

const renderDetails = (c, queryString) => {
  switch (c.action) {
    case "editValue":
      return `
        <div style="margin-left:12px;">
          <strong>Values updated</strong>
          ${renderKeyValueMap(c.valueEdited)}
        </div>
      `;

    case "editGoal":
      return `
        <div style="margin-left:12px;">
          <strong>Goal updated</strong>
          ${renderKeyValueMap(c.goalEdited)}
        </div>
      `;

    case "editSchedule":
      return `
        <div style="margin-left:12px;">
          ${
            c.scheduleEdited?.date
              ? `<div>Date: <code>${new Date(
                  c.scheduleEdited.date,
                ).toLocaleString()}</code></div>`
              : ""
          }
          ${
            c.scheduleEdited?.reeffectTime !== undefined
              ? `<div>Re-effect time: <code>${c.scheduleEdited.reeffectTime}</code></div>`
              : ""
          }
        </div>
      `;

    case "executeScript":
      return `
        <div style="margin-left:12px;">
          <div>Status: <code>${
            c.executeScript?.success ? "success" : "failed"
          }</code></div>
          ${
            c.executeScript?.logs?.length
              ? `<pre><code>${escapeHtml(
                  c.executeScript.logs.join("\n"),
                )}</code></pre>`
              : ""
          }
          ${
            c.executeScript?.error
              ? `<div>Error: <code>${escapeHtml(
                  c.executeScript.error,
                )}</code></div>`
              : ""
          }
        </div>
      `;

    case "branchLifecycle":
      return `
        <div style="margin-left:12px;">
          ${
            c.branchLifecycle?.fromParentId
              ? `From: ${renderLink(
                  c.branchLifecycle.fromParentId,
                  queryString,
                )}<br/>`
              : ""
          }
          ${
            c.branchLifecycle?.toParentId
              ? `To: ${renderLink(c.branchLifecycle.toParentId, queryString)}`
              : ""
          }
        </div>
      `;

    default:
      return "";
  }
};
const renderKeyValueMap = (data) => {
  if (!data) return "";

  const entries =
    data instanceof Map
      ? [...data.entries()]
      : typeof data === "object"
        ? Object.entries(data)
        : [];

  if (entries.length === 0) return "";

  return `
    <ul>
      ${entries
        .map(
          ([key, value]) =>
            `<li><code>${escapeHtml(key)}</code>: <code>${escapeHtml(
              value,
            )}</code></li>`,
        )
        .join("")}
    </ul>
  `;
};

/* ------------------------- GENERIC HELPERS ------------------------- */

const renderUser = (user) => {
  if (!user) return `<code>unknown user</code>`;

  // populated user object
  if (typeof user === "object") {
    if (user.username) {
      return `<code>${escapeHtml(user.username)}</code>`;
    }
    if (user._id) {
      return `<code>${escapeHtml(user._id)}</code>`;
    }
  }

  // string id
  if (typeof user === "string") {
    return `<code>${escapeHtml(user)}</code>`;
  }

  return `<code>unknown user</code>`;
};

const renderLink = (id, queryString) =>
  id
    ? `<a href="/api/v1/node/${id}${queryString}"><code>${escapeHtml(id)}</code></a>`
    : `<code>unknown</code>`;

const renderVersionLink = (
  nodeId,
  version,
  queryString,
  label = `Version ${version}`,
) =>
  `<a href="/api/v1/node/${nodeId}/${version}${queryString}">
    <code>${escapeHtml(label)}</code>
  </a>`;

export const contributionRenderers = ({
  nodeId,
  version,
  nextVersion,
  queryString,
}) => ({
  create: () => `created node`,
  editStatus: (c) =>
    `changed status to <code>${escapeHtml(c.statusEdited)}</code>`,
  editValue: () => `updated values`,
  prestige: () =>
    nodeId
      ? `added new version ${renderVersionLink(
          nodeId,
          nextVersion,
          queryString,
        )}`
      : `added new version`,
  transaction: () =>
    nodeId
      ? `completed <a href="/api/v1/node/${nodeId}/${version}/transactions${queryString}">
          <code>transaction</code>
        </a>`
      : `completed <code>transaction</code>`,
  delete: () => `deleted node`,
  editSchedule: () => `updated schedule`,
  editGoal: () => `updated goal`,
  editNameNode: (c) =>
    `renamed node from <code>${escapeHtml(c.editNameNode?.oldName)}</code> to <code>${escapeHtml(c.editNameNode?.newName)}</code>`,
  updateParent: (c) =>
    `changed parent from ${renderLink(
      c.updateParent?.oldParentId,
      queryString,
    )} to ${renderLink(c.updateParent?.newParentId, queryString)}`,
  updateChildNode: (c) =>
    `${c.updateChildNode?.action} child ${renderLink(
      c.updateChildNode?.childId,
      queryString,
    )}`,
  note: (c) =>
    `${c.noteAction?.action === "add" ? "added" : "removed"} note
   <a href="/api/v1/node/${c.nodeId}/${c.nodeVersion}/notes/${
     c.noteAction?.noteId
   }${queryString}">
     <code>${escapeHtml(c.noteAction?.noteId)}</code>
   </a>`,
  editScript: (c) =>
    `updated script <code>${escapeHtml(c.editScript?.scriptName)}</code>`,
  executeScript: (c) =>
    `executed script <code>${escapeHtml(c.executeScript?.scriptName)}</code>`,
  rawIdea: (c) => {
    const { action, rawIdeaId, targetNodeId } = c.rawIdeaAction || {};
    const ideaLink = `<a href="/api/v1/user/${c.userId?._id}/raw-ideas/${rawIdeaId}${queryString}"><code>${escapeHtml(rawIdeaId)}</code></a>`;

    if (action === "add") {
      return `added raw idea ${ideaLink}`;
    }

    if (action === "delete") {
      return `deleted raw idea <code>${escapeHtml(rawIdeaId)}</code>`;
    }

    if (action === "placed" && targetNodeId) {
      return `placed raw idea ${ideaLink} into ${renderLink(targetNodeId, queryString)}`;
    }

    if (action === "aiStarted") {
      return `AI started processing raw idea ${ideaLink}`;
    }

    if (action === "aiFailed") {
      return `AI failed to place raw idea ${ideaLink}`;
    }

    return "updated raw idea";
  },

  branchLifecycle: (c) =>
    c.branchLifecycle?.action === "retired"
      ? "retired branch"
      : c.branchLifecycle?.action === "revived"
        ? "revived branch"
        : "revived branch as root",
  invite: (c) => {
    const { action, receivingId } = c.inviteAction || {};
    const target = renderUser(receivingId);
    if (action === "invite") return `invited contributor ${target}`;
    if (action === "acceptInvite") return `accepted invitation from ${target}`;
    if (action === "denyInvite") return `declined invitation from ${target}`;
    if (action === "removeContributor") return `removed contributor ${target}`;
    if (action === "switchOwner") return `transferred ownership to ${target}`;
    return "updated collaboration";
  },
});

router.get("/user/:userId/contributions", urlAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

    const limit =
      req.query.limit !== undefined ? Number(req.query.limit) : undefined;

    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return res.status(400).json({ error: "Invalid limit" });
    }

    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;

    const { contributions = [] } = await getContributionsByUser(
      userId,
      100, // hard limit to prevent abuse
      req.query.startDate,
      req.query.endDate,
    );

    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json({ userId, contributions });
    }

    const user = await User.findById(userId).lean();
    const username = user?.username || "Unknown user";

    return res.send(
      await renderUserContributions({
        userId,
        contributions,
        username,
        getNodeName,
        token,
      }),
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/user/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.send(renderResetPasswordExpired());
    }

    return res.send(renderResetPasswordForm({ token }));
  } catch (err) {
    console.error("Error loading reset password page:", err);
    res.status(500).send("Server error");
  }
});

/* -----------------------------------------------------------
   HANDLE RESET PASSWORD FORM POST
----------------------------------------------------------- */
router.post("/user/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { password, confirm } = req.body;

    if (password !== confirm) {
      return res.send(renderResetPasswordMismatch({ token }));
    }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.send(renderResetPasswordInvalid());
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpiry = undefined;

    await user.save();

    return res.send(renderResetPasswordSuccess());
  } catch (err) {
    console.error("Error resetting password:", err);
    res.status(500).send("Server error");
  }
});

router.post("/user/:userId/createRoot", authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, type } = req.body;

    if (req.userId.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, error: "Not authorized" });
    }

    if (!name || typeof name !== "string") {
      return res.status(400).json({
        success: false,
        error: "Name is required",
      });
    }

    const rootNode = await createNewNode(
      name,
      null,
      0,
      null,
      true, // isRoot
      userId,
      {},
      {},
      null,
      req.user,
      false, // wasAi
      null, // aiChatId
      null, // sessionId
      type || null,
    );

    // HTML redirect support
    if ("html" in req.query) {
      return res.redirect(
        `/api/v1/root/${rootNode._id}?token=${req.query.token ?? ""}&html`,
      );
    }

    res.status(201).json({
      success: true,
      rootId: rootNode._id,
      root: rootNode,
    });
  } catch (err) {
    console.error("createRoot error:", err);
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post(
  "/user/:userId/raw-ideas",
  authenticate,
  preUploadCheck,
  upload.single("file"),

  async (req, res) => {
    try {
      const { userId } = req.params;

      if (req.userId.toString() !== userId.toString()) {
        return res
          .status(403)
          .json({ success: false, error: "Not authorized" });
      }

      const contentType = req.file ? "file" : "text";

      const result = await coreCreateRawIdea({
        contentType,
        content: contentType === "file" ? req.file.filename : req.body.content,
        userId: req.userId,
        file: req.file,
      });

      const wantHtml = "html" in req.query;

      if (wantHtml) {
        return res.redirect(
          `/api/v1/user/${userId}?token=${req.query.token ?? ""}&html`,
        );
      }

      return res.status(201).json({
        success: true,
        rawIdea: result.rawIdea,
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  },
);

router.get("/user/:userId/raw-ideas", urlAuth, async (req, res) => {
  try {
    const userId = req.params.userId;

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    const rawLimit = req.query.limit;
    let limit = rawLimit !== undefined ? Number(rawLimit) : undefined;
    if (limit >= 200 || limit == undefined) {
      limit = 200;
    }
    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return res.status(400).json({
        success: false,
        error: "Invalid limit: must be a positive number",
      });
    }

    const query = req.query.q || "";

    // status filter: "pending" (default) | "processing" | "succeeded" | "stuck" | "deleted" | "all"
    const statusFilter = req.query.status || "pending";

    let result;
    if (query.trim() !== "") {
      result = await coreSearchRawIdeasByUser({
        userId,
        query,
        limit,
        startDate,
        endDate,
        status: statusFilter,
      });
    } else {
      result = await coreGetRawIdeas({
        userId,
        limit,
        startDate,
        endDate,
        status: statusFilter,
      });
    }

    const rawIdeas = result.rawIdeas.map((r) => ({
      ...r,
      content:
        r.contentType === "file" ? `/api/v1/uploads/${r.content}` : r.content,
    }));

    // ---------- JSON MODE ----------
    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json({
        success: true,
        rawIdeas,
      });
    }

    // ---------- HTML MODE ----------
    const user = await User.findById(userId).lean();

    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;

    // Build tab URLs — preserve token + html, swap status
    const tabUrl = (s) => {
      const base = `/api/v1/user/${userId}/raw-ideas`;
      const params = new URLSearchParams();
      if (token) params.set("token", token);
      params.set("html", "");
      if (s !== "pending") params.set("status", s);
      return `${base}?${params.toString()}`;
    };
    const tabs = [
      { key: "pending", label: "Pending" },
      { key: "processing", label: "Active" },
      { key: "succeeded", label: "Finished" },
      { key: "stuck", label: "Stuck" },
      { key: "deferred", label: "Deferred" },
      { key: "deleted", label: "Deleted" },
    ];

    return res.send(
      renderRawIdeasList({
        userId,
        user,
        rawIdeas,
        query,
        statusFilter,
        tabs,
        tabUrl,
        token,
        AUTO_PLACE_ELIGIBLE,
      }),
    );
  } catch (err) {
    console.error("Error in /user/:userId/raw-ideas:", err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── Toggle raw idea auto-place ───────────────────────────────────────────────
router.post(
  "/user/:userId/raw-ideas/auto-place",
  authenticate,
  async (req, res) => {
    try {
      if (req.userId.toString() !== req.params.userId.toString()) {
        return res
          .status(403)
          .json({ success: false, error: "Not authorized" });
      }

      const enabled = req.body?.enabled;
      if (typeof enabled !== "boolean") {
        return res
          .status(400)
          .json({ success: false, error: "enabled (boolean) is required" });
      }

      const result = await coreToggleAutoPlace({ userId: req.userId, enabled });
      return res.json({ success: true, enabled: result.enabled });
    } catch (err) {
      const status = err.message.includes("only available on") ? 403 : 500;
      return res.status(status).json({ success: false, error: err.message });
    }
  },
);

router.delete(
  "/user/:userId/raw-ideas/:rawIdeaId",
  authenticate,
  async (req, res) => {
    try {
      const { userId, rawIdeaId } = req.params;

      if (req.userId.toString() !== userId.toString()) {
        return res
          .status(403)
          .json({ success: false, error: "Not authorized" });
      }

      const rawIdea = await RawIdea.findById(rawIdeaId);
      if (!rawIdea) {
        return res
          .status(404)
          .json({ success: false, error: "Raw idea not found" });
      }
      if (rawIdea.status === "processing" || rawIdea.status === "succeeded") {
        return res.status(409).json({
          success: false,
          error: `Cannot delete a raw idea with status "${rawIdea.status}"`,
        });
      }

      const result = await coreDeleteRawIdeaAndFile({
        rawIdeaId,
        userId: req.userId,
      });

      return res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  },
);

router.post(
  "/user/:userId/raw-ideas/:rawIdeaId/transfer",
  authenticate,

  async (req, res) => {
    try {
      const { userId, rawIdeaId } = req.params;
      const { nodeId } = req.body;

      // 🔐 ownership check (same pattern as others)
      if (req.userId.toString() !== userId.toString()) {
        return res
          .status(403)
          .json({ success: false, error: "Not authorized" });
      }

      if (!rawIdeaId || !nodeId) {
        return res.status(400).json({
          success: false,
          error: "raw-idea Id and nodeId are required",
        });
      }

      const rawIdeaCheck = await RawIdea.findById(rawIdeaId).lean();
      if (rawIdeaCheck?.status === "processing") {
        return res.status(409).json({
          success: false,
          error: "Cannot transfer a raw idea while it is being processed",
        });
      }

      const result = await coreConvertRawIdeaToNote({
        rawIdeaId,
        userId: req.userId,
        nodeId,
      });

      // 🌐 HTML redirect support
      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/user/${userId}/raw-ideas?token=${req.query.token ?? ""}&html`,
        );
      }

      // 📦 JSON response
      return res.json({
        success: true,
        note: result.note,
      });
    } catch (err) {
      console.error("raw-idea transfer error:", err);
      return res.status(400).json({
        success: false,
        error: err.message,
      });
    }
  },
);

router.get("/user/:userId/raw-ideas/:rawIdeaId", async (req, res) => {
  try {
    const { userId, rawIdeaId } = req.params;

    const RawIdea = (await import("../../db/models/rawIdea.js")).default;

    const rawIdea = await RawIdea.findById(rawIdeaId)
      .populate("userId", "username")
      .lean();

    if (!rawIdea)
      return notFoundPage(
        req,
        res,
        "This raw idea doesn't exist or may have been removed.",
      );

    // Block soft-deleted or orphaned raw ideas
    const rawUserId = rawIdea.userId?._id?.toString?.() ?? rawIdea.userId;
    if (["deleted", "empty", "null", "system"].includes(rawUserId)) {
      return notFoundPage(
        req,
        res,
        "This raw idea doesn't exist or may have been removed.",
      );
    }

    // Chain validation: URL userId must match the record's actual owner
    if (rawUserId !== userId.toString()) {
      return notFoundPage(
        req,
        res,
        "This raw idea doesn't exist or may have been removed.",
      );
    }

    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;

    const hasToken = !!token;
    const back = hasToken
      ? `/api/v1/user/${userId}/raw-ideas${tokenQS}`
      : getLandUrl();
    const backText = hasToken ? "← Back to Raw Ideas" : "← Back to Home";
    const userLink =
      rawIdea.userId && rawIdea.userId !== "empty"
        ? `<a href="/api/v1/user/${rawIdea.userId._id}${tokenQS}">
               ${escapeHtml(rawIdea.userId.username ?? String(rawIdea.userId))}
             </a>`
        : "Unknown user";

    // ---------------- HTML MODE ----------------
    if (
      req.query.html !== undefined &&
      process.env.ENABLE_FRONTEND_HTML === "true"
    ) {
      // ---------- TEXT ----------
      if (rawIdea.contentType === "text") {
        return res.send(
          renderRawIdeaText({
            userId,
            rawIdea,
            back,
            backText,
            userLink,
            hasToken,
            token,
          }),
        );
      }

      // ---------- FILE ----------

      return res.send(
        renderRawIdeaFile({
          userId,
          rawIdea,
          back,
          backText,
          userLink,
          hasToken,
          token,
        }),
      );
    }

    // ---------------- API MODE ----------------
    if (rawIdea.contentType === "text") {
      return res.json({ text: rawIdea.content });
    }

    if (rawIdea.contentType === "file") {
      const filePath = path.join(process.cwd(), "uploads", rawIdea.content);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
      }
      return res.sendFile(filePath);
    }

    res.status(400).json({ error: "Unknown raw idea type" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/user/:userId/invites", urlAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    // 🔐 user can only see their own invites
    if (req.userId.toString() !== userId.toString()) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const invites = await getPendingInvitesForUser(userId);

    const wantHtml = "html" in req.query;
    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json({ success: true, invites });
    }

    // ---------- HTML ----------
    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;

    return res.send(renderInvites({ userId, invites, token }));
  } catch (err) {
    console.error("invites page error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post(
  "/user/:userId/invites/:inviteId",
  authenticate,

  async (req, res) => {
    try {
      const { userId, inviteId } = req.params;
      const { accept } = req.body;

      if (req.userId.toString() !== userId.toString()) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const acceptInvite = accept === true || accept === "true";

      await respondToInvite({
        inviteId,
        userId: req.userId,
        acceptInvite,
      });

      // 🌐 HTML redirect support
      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/user/${userId}/invites?token=${req.query.token ?? ""}&html`,
        );
      }

      // 📦 JSON response
      return res.json({
        success: true,
        accepted: acceptInvite,
      });
    } catch (err) {
      console.error("respond invite error:", err);
      return res.status(400).json({
        success: false,
        error: err.message,
      });
    }
  },
);

router.get("/user/:userId/deleted", urlAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

    const deleted = await getDeletedBranchesForUser(userId);

    // ---------- JSON MODE ----------
    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json({
        userId,
        deleted,
      });
    }

    // ---------- HTML MODE ----------
    const user = await User.findById(userId).lean();
    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;

    return res.send(renderDeletedBranches({ userId, user, deleted, token }));
  } catch (err) {
    console.error("Error in /user/:userId/deleted:", err);
    res.status(500).json({ error: err.message });
  }
});
router.post(
  "/user/:userId/deleted/:nodeId/revive",
  authenticate,

  async (req, res) => {
    try {
      const { userId, nodeId } = req.params;
      const { targetParentId } = req.body;

      if (req.userId.toString() !== userId.toString()) {
        return res.status(403).json({ error: "Not authorized" });
      }

      if (!targetParentId) {
        return res.status(400).json({
          error: "targetParentId is required",
        });
      }

      const result = await reviveNodeBranch({
        deletedNodeId: nodeId,
        targetParentId,
        userId: req.userId,
      });

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/root/${nodeId}?token=${req.query.token ?? ""}&html`,
        );
      }

      return res.json({
        success: true,
        ...result,
      });
    } catch (err) {
      console.error("revive branch error:", err);
      return res.status(400).json({ error: err.message });
    }
  },
);

router.post(
  "/user/:userId/deleted/:nodeId/reviveAsRoot",
  authenticate,

  async (req, res) => {
    try {
      const { userId, nodeId } = req.params;

      if (req.userId.toString() !== userId.toString()) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const result = await reviveNodeBranchAsRoot({
        deletedNodeId: nodeId,
        userId: req.userId,
      });

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/root/${nodeId}?token=${req.query.token ?? ""}&html`,
        );
      }

      return res.json({
        success: true,
        ...result,
      });
    } catch (err) {
      console.error("revive root error:", err);
      return res.status(400).json({ error: err.message });
    }
  },
);

router.post("/user/:userId/api-keys", authenticate, async (req, res) => {
  if (req.userId.toString() !== req.params.userId.toString()) {
    return res.status(403).json({ message: "Not authorized" });
  }

  const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
  if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
    return createApiKey(req, res);
  }

  // HTML mode: create key and show it on a dedicated page
  try {
    const userId = req.userId;
    const { name, revokeOld = false } = req.body;
    const safeName = (name?.trim().slice(0, 64) || "API Key").replace(
      /<[^>]*>/g,
      "",
    );

    const user = await User.findById(userId);
    if (!user) return res.status(404).send("User not found");

    if (user.apiKeys.filter((k) => !k.revoked).length >= 10) {
      const token = req.query.token ?? "";
      const qs = token ? `?token=${token}&html` : `?html`;
      return res.redirect(`/api/v1/user/${userId}/api-keys${qs}&error=limit`);
    }

    if (revokeOld) {
      user.apiKeys.forEach((k) => (k.revoked = true));
    }

    const { rawKey, keyHash } = await generateApiKey();
    user.apiKeys.push({ keyHash, name: safeName });
    await user.save();

    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;

    return res
      .status(201)
      .send(renderApiKeyCreated({ userId, safeName, rawKey, token }));
  } catch (err) {
    console.error("API key create (html) error:", err);
    return res.status(500).send("Failed to create API key");
  }
});

router.get("/user/:userId/api-keys", authenticate, async (req, res) => {
  try {
    if (req.userId.toString() !== req.params.userId.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

    const user = await User.findById(req.userId)
      .select("username apiKeys")
      .lean();
    if (!user) return res.status(404).json({ message: "User not found" });
    const apiKeys = user.apiKeys ?? [];

    // ---------- JSON MODE ----------
    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json(
        apiKeys.map((k) => ({
          id: k._id,
          name: k.name,
          createdAt: k.createdAt,
          lastUsedAt: k.lastUsedAt,
          usageCount: k.usageCount,
          revoked: k.revoked,
        })),
      );
    }

    // ---------- HTML MODE ----------
    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;

    return res.send(
      renderApiKeysList({ userId, user, apiKeys, token, errorParam }),
    );
  } catch (err) {
    console.error("api keys page error:", err);
    res.status(500).json({ error: err.message });
  }
});
router.delete(
  "/user/:userId/api-keys/:keyId",
  authenticate,

  async (req, res) => {
    if (req.userId.toString() !== req.params.userId.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }

    return deleteApiKey(req, res);
  },
);

router.get("/user/:userId/shareToken", authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.userId.toString() !== userId.toString()) {
      return res.status(403).send("Not authorized");
    }

    const user = await User.findById(userId)
      .select("username htmlShareToken")
      .lean();

    if (!user) {
      return notFoundPage(req, res, "This user doesn't exist.");
    }

    const token = user.htmlShareToken;
    const tokenQS = req.query.token
      ? `?token=${req.query.token}&html`
      : "?html";

    return res.send(renderShareToken({ userId, user, token, tokenQS }));
  } catch (err) {
    console.error("shareToken page error:", err);
    res.status(500).send("Server error");
  }
});
router.post("/user/:userId/shareToken", authenticate, async (req, res) => {
  try {
    const { userId } = req.params;

    if (req.userId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Not authorized" });
    }

    // 1️⃣ Fetch user BEFORE updating token
    const user = await User.findById(userId).select("htmlShareToken");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const hadShareTokenBefore = Boolean(user.htmlShareToken);

    // 2️⃣ Create/update token
    const u = await setHtmlShareToken({
      userId,
      htmlShareToken: req.body.htmlShareToken,
    });

    // 3️⃣ Respond
    if ("html" in req.query) {
      if (!hadShareTokenBefore) {
        return res.redirect("/app");
      }
      return res.redirect(
        `/api/v1/user/${userId}?token=${u.htmlShareToken ?? ""}&html`,
      );
    }

    return res.json({ success: true, shareToken: u.htmlShareToken });
  } catch (err) {
    console.error("shareToken update error:", err);
    if ("html" in req.query) {
      return res
        .status(400)
        .send(err.message || "Failed to update share token");
    }
    return res
      .status(400)
      .json({ error: err.message || "Failed to update share token" });
  }
});

function buildQueryString(req) {
  const allowedParams = ["token", "html"];

  const filtered = Object.entries(req.query)
    .filter(([key]) => allowedParams.includes(key))
    .map(([key, val]) =>
      val === "" ? key : `${key}=${encodeURIComponent(val)}`,
    )
    .join("&");

  return filtered ? `?${filtered}` : "";
}
router.get("/user/:userId/energy", urlAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const qs = buildQueryString(req);
    let user = await User.findById(userId).lean().exec();
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const energyAmount = user.availableEnergy?.amount ?? 0;
    const additionalEnergy = user.additionalEnergy?.amount ?? 0;
    const profileType = (user.profileType || "basic").toLowerCase();
    const planExpiresAt = user.planExpiresAt || null;

    const llmConnections = await getConnectionsForUser(userId);
    const mainAssignment = user.llmAssignments?.main || null;
    const rawIdeaAssignment = user.llmAssignments?.rawIdea || null;
    const activeConn = mainAssignment
      ? llmConnections.find((c) => c._id === mainAssignment)
      : null;
    const hasLlm = !!activeConn;
    const connectionCount = llmConnections.length;
    const isBasic = profileType === "basic";

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json({
        userId: user._id,
        profileType,
        energy: user.availableEnergy,
        additionalEnergy: user.additionalEnergy,
        hasCustomLlm: hasLlm,
      });
    }

    return res.send(
      renderEnergy({
        userId,
        user,
        energyAmount,
        additionalEnergy,
        profileType,
        planExpiresAt,
        llmConnections,
        mainAssignment,
        rawIdeaAssignment,
        activeConn,
        hasLlm,
        connectionCount,
        isBasic,
        qs,
      }),
    );
  } catch (err) {
    console.error("Energy page error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/user/:userId/purchase", authenticate, async (req, res) => {
  // normalize payload so your existing function works
  req.body.userId = req.params.userId;

  // 🔥 TEMP BLOCK

  //return createPurchaseSession(req, res);
});

// ─────────────────────────────────────────────────────────────────────────
// ENCRYPTION
// ─────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────

// List all custom LLM connections
router.get("/user/:userId/custom-llm", authenticate, async (req, res) => {
  try {
    const connections = await getConnectionsForUser(req.params.userId);
    return res.json({ success: true, connections });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Assign a connection to a user-level slot
router.post("/user/:userId/llm-assign", authenticate, async (req, res) => {
  try {
    const { slot, connectionId } = req.body;
    if (!slot) return res.status(400).json({ error: "slot is required" });
    const result = await assignConnection(
      req.params.userId,
      slot,
      connectionId || null,
    );
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error("❌ Failed to assign custom LLM:", err.message);
    return res.status(500).json({ error: err.message });
  }
});

// Add a new connection
router.post("/user/:userId/custom-llm", authenticate, async (req, res) => {
  try {
    const { name, baseUrl, apiKey, model } = req.body;
    if (!name || !baseUrl || !apiKey || !model) {
      return res.status(400).json({
        error: "Missing required fields: name, baseUrl, apiKey, model",
      });
    }
    const result = await addCustomLlmConnection(req.params.userId, {
      name,
      baseUrl,
      apiKey,
      model,
    });

    // Auto-assign as profile chat if none is set
    try {
      const user = await User.findById(req.params.userId)
        .select("llmAssignments")
        .lean();
      if (!user?.llmAssignments?.main) {
        await assignConnection(req.params.userId, "main", result._id);
      }
    } catch (assignErr) {
      console.error("⚠️ Auto-assign main failed:", assignErr.message);
    }

    return res.status(201).json({ success: true, connection: result });
  } catch (err) {
    console.error("❌ Failed to save custom LLM:", err.message);
    const status = err.message.includes("Maximum") ? 400 : 500;
    return res.status(status).json({ error: err.message });
  }
});

// Update a connection
router.put(
  "/user/:userId/custom-llm/:connectionId",
  authenticate,
  async (req, res) => {
    try {
      const { name, baseUrl, apiKey, model } = req.body;
      if (!baseUrl || !model) {
        return res
          .status(400)
          .json({ error: "Missing required fields: baseUrl, model" });
      }
      const result = await updateCustomLlmConnection(
        req.params.userId,
        req.params.connectionId,
        { name, baseUrl, apiKey, model },
      );
      return res.json({ success: true, connection: result });
    } catch (err) {
      console.error("❌ Failed to update custom LLM:", err.message);
      return res.status(500).json({ error: err.message });
    }
  },
);

// Delete a connection
router.delete(
  "/user/:userId/custom-llm/:connectionId",
  authenticate,
  async (req, res) => {
    try {
      await deleteCustomLlmConnection(
        req.params.userId,
        req.params.connectionId,
      );
      return res.json({ success: true, removed: true });
    } catch (err) {
      console.error("❌ Failed to delete custom LLM:", err.message);
      return res.status(500).json({ error: err.message });
    }
  },
);
router.get("/user/:userId/chats", urlAuth, async (req, res) => {
  try {
    const { userId } = req.params;
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
    const { sessions } = await getAIChats({
      userId,
      sessionLimit: limit || 10,
      sessionId,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });

    const allChats = sessions.flatMap((s) => s.chats);

    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json({ userId, count: allChats.length, sessions });
    }

    const chats = allChats;

    const user = await User.findById(userId).lean();
    const username = user?.username || "Unknown user";

    return res.send(
      renderChats({ userId, chats, sessions, username, token, sessionId }),
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// GET /user/:userId/notifications
// ─────────────────────────────────────────────────────────────────────────
router.get("/user/:userId/notifications", urlAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const offset = parseInt(req.query.offset, 10) || 0;

    const { notifications, total } = await getNotifications({
      userId,
      rootId: req.query.rootId,
      limit,
      offset,
    });

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    if (!wantHtml || process.env.ENABLE_FRONTEND_HTML !== "true") {
      return res.json({ notifications, total, limit, offset });
    }

    // ── HTML view ────────────────────────────────────────────────────
    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;

    const user = await User.findById(userId).lean();
    const username = user?.username || "Unknown user";

    const esc = (str = "") =>
      String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const items = notifications
      .map((n) => {
        const icon = n.type === "dream-thought" ? "💭" : "📋";
        const typeLabel = n.type === "dream-thought" ? "Thought" : "Summary";
        const colorClass =
          n.type === "dream-thought" ? "glass-purple" : "glass-indigo";
        const date = new Date(n.createdAt).toLocaleString();

        return `
      <li class="note-card ${colorClass}">
        <div class="note-content">
          <div class="contribution-action">
            <span style="font-size:20px;margin-right:6px">${icon}</span>
            ${esc(n.title)}
            <span class="badge badge-type">${typeLabel}</span>
          </div>
          <div style="margin-top:10px;font-size:14px;color:rgba(255,255,255,0.9);line-height:1.6;white-space:pre-wrap">${esc(n.content)}</div>
        </div>
        <div class="note-meta">
          ${date}
        </div>
      </li>`;
      })
      .join("");

    return res.send(
      renderNotifications({ userId, notifications, total, username, token }),
    );
  } catch (err) {
    console.error("Notifications route error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res
      .status(413)
      .json({ success: false, error: "File exceeds maximum size of 4 GB" });
  }
  next(err);
});

export default router;
