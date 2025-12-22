import express from "express";
import urlAuth from "../middleware/urlAuth.js";
import User from "../db/models/user.js";
import {
  getAllNotesByUser as coreGetAllNotesByUser,
  getAllTagsForUser as coreGetAllTagsForUser,
  searchNotesByUser as coreSearchNotesByUser,
} from "../core/notes.js";
import { getContributionsByUser } from "../core/contributions.js";

import getNodeName from "./helpers/getNameById.js";

const router = express.Router();

const allowedParams = ["token", "html"];

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

    const roots = user.roots || [];

    // JSON MODE
    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    if (!wantHtml) {
      return res.json({
        userId: user._id,
        username: user.username,
        roots,
      });
    }

    // HTML MODE
    const rootsHtml =
      roots.length > 0
        ? `
          <ul>
            ${roots
              .map(
                (r) => `
              <li>
                <a href="/api/root/${r._id}${queryString}">
                  ${r.name || "Untitled"} 
                </a>
              </li>
            `
              )
              .join("")}
          </ul>
        `
        : `<p><em>No roots found</em></p>`;

    return res.send(`
      <html>
      <head>
        <title>User — ${user.username}</title>
        <style>
          body {
            font-family: system-ui, sans-serif;
            padding: 20px;
            line-height: 1.6;
            background: #fafafa;
          }

          h1 { margin-bottom: 4px; }
          h2 { margin-top: 32px; }

          a {
            color: #0077cc;
            text-decoration: none;
            font-weight: 500;
          }

          a:hover { text-decoration: underline; }

          ul {
            list-style: none;
            padding-left: 18px;
            margin: 6px 0;
          }

          code {
            background: #eee;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
          }
        </style>
      </head>

      <body>

        <h1>User</h1>

        <p>
          <strong>${user.username}</strong><br/>
          <p style="display:flex;align-items:center;gap:6px;">
  <code id="nodeIdCode">${user._id}</code>

  <button id="copyNodeIdBtn" style="
    background:none;
    border:none;
    cursor:pointer;
    padding:2px;
    opacity:0.6;
  " title="Copy ID">
    📋
  </button>
</p>

        </p>
      <ul>
     <li>   <a href="/api/user/${userId}/notes?${filtered}">Notes</a></li>
     <li> <a href="/api/user/${userId}/tags?${filtered}">Mail</a></li>
     <li> <a href="/api/user/${userId}/contributions?${filtered}">Contributions</a></li>
</ul>
        <h2>Roots</h2>
        ${rootsHtml}
<script>
  const btn = document.getElementById("copyNodeIdBtn");
  const code = document.getElementById("nodeIdCode");

  btn.addEventListener("click", () => {
    navigator.clipboard.writeText(code.textContent).then(() => {
      btn.textContent = "✔️";
      setTimeout(() => (btn.textContent = "📋"), 900);
    });
  });
</script>

      </body>
      </html>
    `);
  } catch (err) {
    console.error("Error in /user/:userId:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/user/:userId/notes", urlAuth, async (req, res) => {
  try {
    const userId = req.params.userId;

    // NEW: search query
    const query = req.query.q || "";

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
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

    // NEW: If search term exists → run search
    let result;
    if (query.trim() !== "") {
      result = await coreSearchNotesByUser({ userId, query, limit });
    } else {
      result = await coreGetAllNotesByUser(userId, limit);
    }

    const notes = result.notes.map((n) => ({
      ...n,
      content:
        n.contentType === "file"
          ? `${req.protocol}://${req.get("host")}/uploads/${n.content}`
          : n.content,
    }));

    // JSON MODE (no HTML)
    if (!wantHtml) {
      return res.json({ success: true, notes, query });
    }

    // HTML MODE
    const user = await User.findById(userId).lean();

    // --- SEARCH BAR HTML ---
    const searchBoxHtml = `
      <form method="GET" action="/api/user/${userId}/notes" style="margin-top: 12px;">
        <input type="hidden" name="token" value="${token}">
        <input type="hidden" name="html" value="">
        <input
          type="text"
          name="q"
          placeholder="Search notes..."
          value="${query}"
          style="
            padding: 8px 12px;
            font-size: 14px;
            width: 260px;
            border-radius: 6px;
            border: 1px solid #ccc;
          "
        />
        <button
          type="submit"
          style="
            padding: 8px 14px;
            border-radius: 6px;
            border: 1px solid #999;
            background: #eee;
            cursor: pointer;
          "
        >
          Search
        </button>
      </form>
    `;

    let html = `
<html>
<head>
  <title>${user.username} — Notes</title>
  <style>
    body {
      font-family: sans-serif;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: #fafafa;
    }
    .header {
      padding: 20px;
      border-bottom: 1px solid #ddd;
      background: white;
    }
    .container {
      padding: 20px;
      overflow-y: auto;
      flex-grow: 1;
    }
    ul { list-style: none; padding-left: 0; }
    li { margin-bottom: 20px; }
    .meta { color: #555; font-size: 0.9em; }
    a { color: #0077cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .nav a { margin-right: 12px; }
  </style>
</head>

<body>

  <div class="header">
    <h1 style="margin:0;">
      Notes by <a href="/api/user/${userId}${tokenQS}">${user.username}</a>
    </h1>

    ${searchBoxHtml}

    <div class="nav">
      <a href="/api/user/${userId}/tags${tokenQS}">Mail</a>
      <a href="/api/user/${userId}/contributions${tokenQS}">Contributions</a>
    </div>
  </div>

  <div class="container">
    <ul>
`;

    for (const n of notes) {
      const preview =
        n.contentType === "text"
          ? n.content.length > 120
            ? n.content.substring(0, 120) + "…"
            : n.content
          : `[FILE] ${n.content}`;

      const nodeName = await getNodeName(n.nodeId);

      html += `
      <li>
        <div>
          <strong>${user.username}:</strong>
          <a href="/api/${n.nodeId}/${n.version}/notes/${n._id}${tokenQS}">
            ${preview}
          </a>
        </div>

        <div class="meta">
          ${new Date(n.createdAt).toLocaleString()}<br />

          <a href="/api/${n.nodeId}/${n.version}${tokenQS}">
            ${nodeName} v${n.version}
          </a>
          <br />

          <a href="/api/${n.nodeId}/${n.version}/notes${tokenQS}">
            View Notes
          </a>
        </div>
      </li>
`;
    }

    html += `
    </ul>
  </div>

</body>
</html>
`;

    return res.send(html);
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

    const result = await coreGetAllTagsForUser(userId, limit);

    const notes = result.notes.map((n) => ({
      ...n,

      content:
        n.contentType === "file"
          ? `${req.protocol}://${req.get("host")}/uploads/${n.content}`
          : n.content,
    }));

    if (!wantHtml) {
      return res.json({
        success: true,
        taggedBy: result.taggedBy,
        notes,
      });
    }

    const user = await User.findById(userId).lean();

    let html = `
<html>
<head>
  <title>${user.username} — Tagged Notes</title>
  <style>
    body {
      font-family: sans-serif;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: #fafafa;
    }
    .header {
      padding: 20px;
      border-bottom: 1px solid #ddd;
      background: white;
    }
    .container {
      padding: 20px;
      overflow-y: auto;
      flex-grow: 1;
    }
    ul { list-style: none; padding-left: 0; }
    li { margin-bottom: 20px; }
    .meta { color: #555; font-size: 0.9em; }
    a { color: #0077cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .nav a { margin-right: 12px; }
  </style>
</head>

<body>

  <div class="header">
    <h1 style="margin:0;">
      Mail for <a href="/api/user/${userId}?token=${
      req.query.token ?? ""
    }&html">
        @${user.username}
      </a>
    </h1>

    <div class="nav">
 
      <a href="/api/user/${userId}/notes?token=${
      req.query.token ?? ""
    }&html">Notes</a>
       <a href="/api/user/${userId}/contributions?token=${
      req.query.token ?? ""
    }&html">Contributions</a>
    
    </div>

    
  </div>

  <div class="container">
    <ul>
`;

    for (const n of notes) {
      const nodeName = await getNodeName(n.nodeId);
      const preview =
        n.contentType === "text"
          ? n.content.length > 120
            ? n.content.substring(0, 120) + "…"
            : n.content
          : `[FILE] ${n.content}`;

      const author = n.userId.username || n.userId._id;

      html += `
<li>
  <div>
    <a href="/api/user/${n.userId._id}?token=${req.query.token ?? ""}&html">
      <strong>${author}:</strong>
    </a>

    <a href="/api/${n.nodeId}/${n.version}/notes/${n._id}?token=${
        req.query.token ?? ""
      }&html">
      ${preview}
    </a>
  </div>

  <div class="meta">
    ${new Date(n.createdAt).toLocaleString()}<br/>

    <a href="/api/${n.nodeId}/${n.version}?token=${req.query.token ?? ""}&html">
      ${nodeName} v${n.version}
    </a>

    <br/>

    <a href="/api/${n.nodeId}/${n.version}/notes${tokenQS}">
      View Notes
    </a>
  </div>
</li>
`;
    }

    html += `
    </ul>
  </div>

</body>
</html>`;

    return res.send(html);
  } catch (err) {
    console.error("Error in /user/:userId/tags:", err);
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get("/user/:userId/contributions", urlAuth, async (req, res) => {
  try {
    const userId = req.params.userId;

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    const rawLimit = req.query.limit;
    const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return res.status(400).json({
        success: false,
        error: "Invalid limit: must be a positive number",
      });
    }

    const filtered = Object.entries(req.query)
      .filter(([key]) => ["token", "html"].includes(key))
      .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
      .join("&");

    const queryString = filtered ? `?${filtered}` : "";

    const result = await getContributionsByUser(userId, limit);
    const contributions = result.contributions || [];

    // JSON MODE
    if (!wantHtml) {
      return res.json({
        success: true,
        contributions,
      });
    }

    const user = await User.findById(userId).lean();

    // FIX: async map + Promise.all
    const processed = await Promise.all(
      contributions.map(async (c) => {
        const username = c.username ?? "Unknown user";
        const time = new Date(c.date).toLocaleString();
        const nodeId = c.nodeId?._id || c.nodeId;
        const version = c.nodeVersion;
        const nodeName = await getNodeName(nodeId);

        // Helper for node/version footer
        const footer = `
  <div class="meta" style="margin-top:6px;">
    <a href="/api/${nodeId}/${version ?? 0}${queryString}">
      ${nodeName}${version !== undefined ? ` v${version}` : ""}
    </a>
  </div>
`;

        // --------------------------
        // TRANSACTION
        // --------------------------
        if (c.action === "transaction" && c.tradeId) {
          const a = c.additionalInfo?.nodeA;
          const b = c.additionalInfo?.nodeB;

          return `
<li>
  <strong>${username}</strong>
  made a <code>transaction</code><br/>
  <small>${time}</small>

  <div style="margin-top:6px; padding-left:12px;">
    <div>
      <strong>${a?.name}</strong>
      (${a?.versionIndex}) →
      <code>${JSON.stringify(a?.valuesSent)}</code>
    </div>

    <div>
      <strong>${b?.name}</strong>
      (${b?.versionIndex}) →
      <code>${JSON.stringify(b?.valuesSent)}</code>
    </div>
  </div>

  ${footer}
</li>
`;
        }

        // --------------------------
        // EDIT NAME NODE
        // --------------------------
        if (c.action === "editNameNode") {
          const { oldName, newName } = c.additionalInfo || {};
          return `
<li>
  <strong>${username}</strong>
  renamed node <code>${oldName}</code> → <code>${newName}</code><br/>
  <small>${time}</small>
  ${footer}
</li>
`;
        }

        // --------------------------
        // UPDATE PARENT
        // --------------------------
        if (c.action === "updateParent") {
          const { oldParentId, newParentId } = c.additionalInfo || {};
          return `
<li>
  <strong>${username}</strong>
  changed parent:
  <a href="/api/${oldParentId}${queryString}">
    ${await getNodeName(oldParentId)}
  </a>
  →
  <a href="/api/${newParentId}${queryString}">
    ${await getNodeName(newParentId)}
  </a>
  <br/>
  <small>${time}</small>
  ${footer}
</li>
`;
        }

        // --------------------------
        // UPDATE CHILD NODE
        // --------------------------
        if (c.action === "updateChildNode") {
          const { action, childId } = c.additionalInfo || {};
          return `
<li>
  <strong>${username}</strong>
  <code>${action}</code> child
  <a href="/api/${childId}${queryString}">
    ${await getNodeName(childId)}
  </a>
  <br/>
  <small>${time}</small>
  ${footer}
</li>
`;
        }

        // --------------------------
        // EDIT SCRIPT
        // --------------------------
        if (c.action === "editScript") {
          const { scriptName } = c.additionalInfo || {};
          return `
<li>
  <strong>${username}</strong>
  updated script <code>${scriptName}</code>
  <br/>
  <small>${time}</small>
  ${footer}
</li>
`;
        }

        // --------------------------
        // NOTE
        // --------------------------
        if (c.action === "note") {
          const { action, noteId } = c.additionalInfo || {};
          return `
<li>
  <strong>${username}</strong>
  ${action === "add" ? "added" : "removed"} note
  <a href="/api/${nodeId}/${version}/notes/${noteId}${queryString}">
    <code>${noteId}</code>
  </a>
  <br/>
  <small>${time}</small>
  ${footer}
</li>
`;
        }

        // --------------------------
        // DEFAULT
        // --------------------------
        return `
<li>
  <strong>${username}</strong>
  <code>${c.action}</code><br/>
  <small>${time}</small>

  ${
    c.additionalInfo
      ? `<div style="margin-top:6px; padding-left:12px;">
          <code>${JSON.stringify(c.additionalInfo)}</code>
         </div>`
      : ""
  }

  ${footer}
</li>
`;
      })
    );

    const contributionsHtml =
      processed.length > 0
        ? `<ul>${processed.join("")}</ul>`
        : `<p><em>No contributions found</em></p>`;

    // FINAL HTML response
    return res.send(`
<html>
<head>
  <title>${user.username} — Contributions</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      padding: 20px;
      background: #fafafa;
      line-height: 1.6;
    }
    h1 { margin-bottom: 6px; }
    ul { list-style: none; padding-left: 18px; }
    li { margin-bottom: 14px; }
    code {
      background: #eee;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 12px;
    }
    small { color: #555; }
    a { color: #0077cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .nav a { margin-right: 12px; }
  </style>
</head>

<body>

  <h1>Contributions by <a href="/api/user/${userId}${queryString}">${user.username}</a></h1>

  <div class="nav">
    <a href="/api/user/${userId}/notes${queryString}">Notes</a>
    <a href="/api/user/${userId}/tags${queryString}">Mail</a>
  </div>

  <h2>Contributions</h2>
  ${contributionsHtml}

</body>
</html>
`);
  } catch (err) {
    console.error("Error in /user/:userId/contributions:", err);
    res.status(400).json({ success: false, error: err.message });
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
      return res.send(`
        <html>
        <body style="font-family: sans-serif; padding: 20px;">
          <h2>Reset Link Expired or Invalid</h2>
          <p>Please request a new password reset.</p>
        </body>
        </html>
      `);
    }

    // Render reset password form
    return res.send(`
      <html>
      <body style="font-family: sans-serif; padding: 20px;">
        <h2>Reset Password</h2>
        <form method="POST" action="/api/user/reset-password/${token}">
          <input type="password" name="password" placeholder="New Password" style="padding:8px; width:250px;" required />
          <br/><br/>
          <input type="password" name="confirm" placeholder="Confirm Password" style="padding:8px; width:250px;" required />
          <br/><br/>
          <button type="submit" style="padding:10px 20px;">Reset Password</button>
        </form>
      </body>
      </html>
    `);
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
      return res.send(`
        <html><body style="font-family:sans-serif; padding:20px;">
        <h2>Passwords Do Not Match</h2>
        <p><a href="/api/user/reset-password/${token}">Try Again</a></p>
        </body></html>
      `);
    }

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpiry: { $gt: Date.now() },
    });

    if (!user) {
      return res.send(`
        <html><body style="font-family:sans-serif; padding:20px;">
        <h2>Reset Link Expired or Invalid</h2>
        <p>Please request a new password reset.</p>
        </body></html>
      `);
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpiry = undefined;

    await user.save();

    return res.send(`
      <html><body style="font-family:sans-serif; padding:20px;">
      <h2>Password Reset Successfully</h2>
      <p>You can now log in with your new password.</p>
      </body></html>
    `);
  } catch (err) {
    console.error("Error resetting password:", err);
    res.status(500).send("Server error");
  }
});

export default router;
