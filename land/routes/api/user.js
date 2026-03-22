import express from "express";
import urlAuth from "../../middleware/urlAuth.js";
import authenticate from "../../middleware/authenticate.js";

import User from "../../db/models/user.js";
import { getAIChats } from "../../core/llms/aichat.js";

import { notFoundPage } from "../../middleware/notFoundPage.js";
import {
  getConnectionsForUser,
} from "../../core/llms/customLLM.js";

import {
  getAllNotesByUser as coreGetAllNotesByUser,
  getAllTagsForUser as coreGetAllTagsForUser,
  searchNotesByUser as coreSearchNotesByUser,
} from "../../core/tree/notes.js";
import { getNotifications } from "../../core/tree/notifications.js";
import { getContributionsByUser } from "../../core/tree/contributions.js";

import { getDeletedBranchesForUser } from "../../core/tree/treeFetch.js";

import { maybeResetEnergy } from "../../core/tree/energy.js";

import {
  createNewNode,
  reviveNodeBranch,
  reviveNodeBranchAsRoot,
} from "../../core/tree/treeManagement.js";

import {
  getPendingInvitesForUser,
  respondToInvite,
} from "../../core/tree/invites.js";



import getNodeName from "./helpers/getNameById.js";

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
  renderInvites,
  renderDeletedBranches,
  renderChats,
  renderNotifications,
} from "./html/user.js";

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
      .populate("roots", "name _id visibility")
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

// Raw idea routes moved to extensions/raw-ideas

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

// API key routes moved to extensions/api-keys
// Share token routes moved to extensions/visibility
// Energy routes moved to extensions/energy
// Purchase route moved to extensions/billing

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
