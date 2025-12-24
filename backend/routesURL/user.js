import express from "express";
import urlAuth from "../middleware/urlAuth.js";
import authenticate from "../middleware/authenticate.js";
import path from "path";
import fs from "fs";
import multer from "multer";
import mime from "mime-types";

import User from "../db/models/user.js";
import {
  getAllNotesByUser as coreGetAllNotesByUser,
  getAllTagsForUser as coreGetAllTagsForUser,
  searchNotesByUser as coreSearchNotesByUser,
} from "../core/notes.js";
import { getContributionsByUser } from "../core/contributions.js";

import { createNewNode } from "../core/treeManagement.js";

import { getPendingInvitesForUser, respondToInvite } from "../core/invites.js";

import {
  createRawIdea as coreCreateRawIdea,
  getRawIdeas as coreGetRawIdeas,
  searchRawIdeasByUser as coreSearchRawIdeasByUser,
  deleteRawIdeaAndFile as coreDeleteRawIdeaAndFile,
  convertRawIdeaToNote as coreConvertRawIdeaToNote,
} from "../core/rawIdea.js";

import getNodeName from "./helpers/getNameById.js";

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

const upload = multer({ storage });

const router = express.Router();

const allowedParams = ["token", "html", "limit", "startTime", "endTime", "q"];

function renderMedia(fileUrl, mimeType) {
  if (mimeType.startsWith("image/")) {
    return `<img src="${fileUrl}" style="max-width:100%;" />`;
  }

  if (mimeType.startsWith("video/")) {
    return `<video src="${fileUrl}" controls style="max-width:100%;"></video>`;
  }

  if (mimeType.startsWith("audio/")) {
    return `<audio src="${fileUrl}" controls></audio>`;
  }

  if (mimeType === "application/pdf") {
    return `
      <iframe
        src="${fileUrl}"
        style="width:100%; height:90vh; border:none;"
      ></iframe>
    `;
  }

  // Unknown / non-previewable formats (epub, zip, etc.)
  return ``;
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
        <meta name="viewport" content="width=device-width, initial-scale=1.0">

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
  <div style="margin:16px 0;">
  <form
    method="POST"
    action="/api/user/${userId}/raw-ideas?token=${req.query.token ?? ""}&html"
    enctype="multipart/form-data"
    style="display:flex; flex-direction:column; gap:8px;"
  >
    <textarea
      name="content"
      placeholder="Capture a raw idea…"
      id="rawIdeaInput"
      style="
        width:100%;
        padding:12px 14px;
        font-size:15px;
        line-height:1.5;
        border-radius:8px;
        border:1px solid #ccc;
        font-family:inherit;
        resize:vertical;
        min-height:52px;
        box-sizing:border-box;
        transition: border-color 0.2s;
      "
      rows="1"
      autofocus
    ></textarea>

    <div style="display:flex; justify-content:space-between; align-items:center;">
      <input
        type="file"
        name="file"
        style="font-size:13px;"
      />

      <button
        type="submit"
        title="Save raw idea"
        style="
          padding:8px 16px;
          font-size:14px;
          border-radius:6px;
          border:1px solid #999;
          background:#5865f2;
          color:white;
          cursor:pointer;
          font-weight:500;
        "
      >
        Send
      </button>
    </div>
  </form>
</div>





        </p>
      <ul>
      <li>
  <a href="/api/user/${userId}/invites?${filtered}">
    Invites
  </a>
</li>

     <li>   <a href="/api/user/${userId}/notes?${filtered}">Notes</a></li>
     <li> <a href="/api/user/${userId}/tags?${filtered}">Mail</a></li>
     <li> <a href="/api/user/${userId}/contributions?${filtered}">Contributions</a></li>
     <li>
  <a href="/api/user/${userId}/raw-ideas?${filtered}">
    Raw Ideas
  </a>
</li>

</ul>
        <h2>Roots</h2>
        ${rootsHtml}
        <div style="margin-top:16px;">
  <form
    method="POST"
    action="/api/user/${userId}/createRoot?token=${req.query.token ?? ""}&html"
    style="display:flex; gap:8px; align-items:center;"
  >
    <input
      type="text"
      name="name"
      placeholder="New root name"
      required
      style="
        padding:8px 10px;
        font-size:14px;
        border-radius:6px;
        border:1px solid #ccc;
        flex:1;
      "
    />

    <button
      type="submit"
      title="Create root"
      style="
        padding:8px 12px;
        font-size:18px;
        border-radius:6px;
        border:1px solid #999;
        background:#eee;
        cursor:pointer;
      "
    >
      ＋
    </button>
  </form>
</div>

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
<script>
  // Auto-resize textarea as user types
  const textarea = document.getElementById("rawIdeaInput");
  
  function autoResize() {
    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';
    
    // Set height based on content, with a max height
    const maxHeight = 400; // Maximum height in pixels
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = newHeight + 'px';
    
    // Add scrollbar if content exceeds max height
    if (textarea.scrollHeight > maxHeight) {
      textarea.style.overflowY = 'auto';
    } else {
      textarea.style.overflowY = 'hidden';
    }
  }
  
  // Auto-resize on input
  textarea.addEventListener('input', autoResize);
  
  // Auto-resize on page load (in case there's pre-filled content)
  autoResize();
  
  // Optional: Submit with Cmd/Ctrl+Enter
  textarea.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      textarea.closest('form').submit();
    }
  });
  
  // Focus styling
  textarea.addEventListener('focus', () => {
    textarea.style.borderColor = '#5865f2';
    textarea.style.outline = 'none';
    textarea.style.boxShadow = '0 0 0 3px rgba(88, 101, 242, 0.1)';
  });
  
  textarea.addEventListener('blur', () => {
    textarea.style.borderColor = '#ccc';
    textarea.style.boxShadow = 'none';
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
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <title>${user.username} — Notes</title>
  <style>
  body {
    margin: 0;
    padding: 0;
    background: #f5f6f7;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
    

  .header {
    padding: 20px;
    border-bottom: 1px solid #ddd;
    background: white;
    flex-shrink: 0;
  }

  .header h1 {
    margin: 0 0 12px 0;
    font-size: 24px;
    font-weight: 600;
  }

  .header a {
    color: #5865f2;
    text-decoration: none;
  }

  .header a:hover {
    text-decoration: underline;
  }

  .nav {
    margin-top: 12px;
  }

  .nav a {
    color: #5865f2;
    text-decoration: none;
    margin-right: 16px;
    font-size: 14px;
  }

  .nav a:hover {
    text-decoration: underline;
  }

  .container {
    padding: 20px;
    overflow-y: auto;
    overflow-x: hidden;
    flex-grow: 1;
  }

  .user-id-box {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 8px 0;
  }

  .user-id-box code {
    background: #eee;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 13px;
  }

  .user-id-box button {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    opacity: 0.6;
    font-size: 16px;
  }

  .user-id-box button:hover {
    opacity: 1;
  }

  .search-form {
    margin-top: 12px;
  }

  .search-form input[type="text"] {
    padding: 8px 12px;
    font-size: 14px;
    width: 260px;
    border-radius: 6px;
    border: 1px solid #ddd;
    font-family: inherit;
  }

  .search-form button {
    padding: 8px 14px;
    border-radius: 6px;
    border: 1px solid #ddd;
    background: white;
    cursor: pointer;
    font-size: 14px;
    margin-left: 6px;
  }

  .search-form button:hover {
    background: #f5f6f7;
  }

  ul {
    list-style: none;
    padding-left: 0;
    margin: 0;
  }

  li {
    margin-bottom: 16px;
    padding: 14px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    border: 1px solid #e3e5e8;
  }

  li a {
    color: #5865f2;
    text-decoration: none;
  }

  li a:hover {
    text-decoration: underline;
  }

  .meta {
    color: #666;
    font-size: 13px;
    margin-top: 6px;
    line-height: 1.6;
  }

  @media (max-width: 600px) {
    .header {
      padding: 16px;
    }

    .container {
      padding: 16px;
    }

    .search-form input[type="text"] {
      width: 200px;
      font-size: 16px;
    }

    .search-form button {
      font-size: 16px;
    }
  }

  @media (prefers-color-scheme: dark) {
    body {
      background: #2f3136;
      color: #e3e5e8;
    }

    .header {
      background: #36393f;
      border-bottom-color: #3a3c40;
    }

    .header a,
    .nav a,
    li a {
      color: #7289da;
    }

    .user-id-box code {
      background: #40444b;
      color: #e3e5e8;
    }

    .search-form input[type="text"] {
      background: #40444b;
      color: #e3e5e8;
      border-color: #3a3c40;
    }

    .search-form button {
      background: #40444b;
      color: #e3e5e8;
      border-color: #3a3c40;
    }

    .search-form button:hover {
      background: #4f545c;
    }

    li {
      background: #36393f;
      border-color: #3a3c40;
    }

    .meta {
      color: #b9bbbe;
    }
  }
    .note-item {
  position: relative;
}

.delete-note {
  position: absolute;
  top: 8px;
  right: 8px;
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  color: #999;
  padding: 4px;
}

.delete-note:hover {
  color: #e03131;
}

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
      <a href="/api/user/${userId}/raw-ideas${tokenQS}">Raw Ideas</a>

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
      <li
  class="note-item"
  data-note-id="${n._id}"
  data-node-id="${n.nodeId}"
  data-version="${n.version}"
>
  <button class="delete-note" title="Delete note">✕</button>

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
<script>
document.addEventListener("click", async (e) => {
  if (!e.target.classList.contains("delete-note")) return;

  const li = e.target.closest(".note-item");
  const noteId = li.dataset.noteId;
  const nodeId = li.dataset.nodeId;
  const version = li.dataset.version;

  if (!confirm("Delete this note?")) return;

  const token =
    new URLSearchParams(window.location.search).get("token") || "";

  const qs = token ? "?token=" + encodeURIComponent(token) : "";

  try {
    const res = await fetch(
      "/api/" + nodeId + "/" + version + "/notes/" + noteId + qs,
      { method: "DELETE" }
    );

    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    li.remove();
  } catch {
    alert("Delete failed");
  }
});
</script>

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
      endDate
    );

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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <title>${user.username} — Tagged Notes</title>
  <style>
  body {
    margin: 0;
    padding: 0;
    background: #f5f6f7;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  .header {
    padding: 20px;
    border-bottom: 1px solid #ddd;
    background: white;
    flex-shrink: 0;
  }

  .header h1 {
    margin: 0 0 12px 0;
    font-size: 24px;
    font-weight: 600;
  }

  .header a {
    color: #5865f2;
    text-decoration: none;
  }

  .header a:hover {
    text-decoration: underline;
  }

  .nav {
    margin-top: 12px;
  }

  .nav a {
    color: #5865f2;
    text-decoration: none;
    margin-right: 16px;
    font-size: 14px;
  }

  .nav a:hover {
    text-decoration: underline;
  }

  .container {
    padding: 20px;
    overflow-y: auto;
    flex-grow: 1;
  }

  .user-id-box {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 8px 0;
  }

  .user-id-box code {
    background: #eee;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 13px;
  }

  .user-id-box button {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    opacity: 0.6;
    font-size: 16px;
  }

  .user-id-box button:hover {
    opacity: 1;
  }

  .search-form {
    margin-top: 12px;
  }

  .search-form input[type="text"] {
    padding: 8px 12px;
    font-size: 14px;
    width: 260px;
    border-radius: 6px;
    border: 1px solid #ddd;
    font-family: inherit;
  }

  .search-form button {
    padding: 8px 14px;
    border-radius: 6px;
    border: 1px solid #ddd;
    background: white;
    cursor: pointer;
    font-size: 14px;
    margin-left: 6px;
  }

  .search-form button:hover {
    background: #f5f6f7;
  }

  ul {
    list-style: none;
    padding-left: 0;
    margin: 0;
  }

  li {
    margin-bottom: 16px;
    padding: 14px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    border: 1px solid #e3e5e8;
  }

  li a {
    color: #5865f2;
    text-decoration: none;
  }

  li a:hover {
    text-decoration: underline;
  }

  .meta {
    color: #666;
    font-size: 13px;
    margin-top: 6px;
    line-height: 1.6;
  }

  @media (max-width: 600px) {
    .header {
      padding: 16px;
    }

    .container {
      padding: 16px;
    }

    .search-form input[type="text"] {
      width: 200px;
      font-size: 16px;
    }

    .search-form button {
      font-size: 16px;
    }
  }

  @media (prefers-color-scheme: dark) {
    body {
      background: #2f3136;
      color: #e3e5e8;
    }

    .header {
      background: #36393f;
      border-bottom-color: #3a3c40;
    }

    .header a,
    .nav a,
    li a {
      color: #7289da;
    }

    .user-id-box code {
      background: #40444b;
      color: #e3e5e8;
    }

    .search-form input[type="text"] {
      background: #40444b;
      color: #e3e5e8;
      border-color: #3a3c40;
    }

    .search-form button {
      background: #40444b;
      color: #e3e5e8;
      border-color: #3a3c40;
    }

    .search-form button:hover {
      background: #4f545c;
    }

    li {
      background: #36393f;
      border-color: #3a3c40;
    }

    .meta {
      color: #b9bbbe;
    }
  }
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
    <a href="/api/user/${userId}/raw-ideas?token=${
      req.query.token ?? ""
    }&html">Raw Ideas</a>

    
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
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
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

    const result = await getContributionsByUser(
      userId,
      limit,
      startDate,
      endDate
    );
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

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
        <a href="/api/user/${userId}/raw-ideas${queryString}">Raw Ideas</a>

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

router.post("/user/:userId/createRoot", authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const { name } = req.body;

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
      req.user
    );

    // HTML redirect support
    if ("html" in req.query) {
      return res.redirect(
        `/api/user/${userId}?token=${req.query.token ?? ""}&html`
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
          `/api/user/${userId}?token=${req.query.token ?? ""}&html`
        );
      }

      return res.status(201).json({
        success: true,
        rawIdea: result.rawIdea,
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }
);

router.get("/user/:userId/raw-ideas", urlAuth, async (req, res) => {
  try {
    const userId = req.params.userId;

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    const rawLimit = req.query.limit;
    const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return res.status(400).json({
        success: false,
        error: "Invalid limit: must be a positive number",
      });
    }

    const query = req.query.q || "";

    let result;
    if (query.trim() !== "") {
      result = await coreSearchRawIdeasByUser({
        userId,
        query,
        limit,
        startDate,
        endDate,
      });
    } else {
      result = await coreGetRawIdeas({
        userId,
        limit,
        startDate,
        endDate,
      });
    }

    const rawIdeas = result.rawIdeas.map((r) => ({
      ...r,
      content:
        r.contentType === "file"
          ? `${req.protocol}://${req.get("host")}/uploads/${r.content}`
          : r.content,
    }));

    // ---------- JSON MODE ----------
    if (!wantHtml) {
      return res.json({
        success: true,
        rawIdeas,
      });
    }

    // ---------- HTML MODE ----------
    const user = await User.findById(userId).lean();

    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;
    const searchBoxHtml = `
  <form
    method="GET"
    action="/api/user/${userId}/raw-ideas"
    style="margin-top:12px;"
  >
    <input type="hidden" name="token" value="${req.query.token ?? ""}">
    <input type="hidden" name="html" value="">

    <input
      type="text"
      name="q"
      placeholder="Search raw ideas…"
      value="${query}"
      style="
        padding:8px 12px;
        font-size:14px;
        width:260px;
        border-radius:6px;
        border:1px solid #ccc;
      "
    />

    <button
      type="submit"
      style="
        padding:8px 14px;
        border-radius:6px;
        border:1px solid #999;
        background:#eee;
        cursor:pointer;
      "
    >
      Search
    </button>
  </form>
`;

    let html = `
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${user.username} — Raw Ideas</title>

  <style>
    body {
      margin: 0;
      padding: 0;
      background: #f5f6f7;
      font-family: system-ui, sans-serif;
      display: flex;
      flex-direction: column;
      height: 100vh;
    }

    .header {
      padding: 20px;
      background: white;
      border-bottom: 1px solid #ddd;
    }

    .header h1 {
      margin: 0;
      font-size: 24px;
    }

    .nav {
      margin-top: 12px;
    }

    .nav a {
      margin-right: 14px;
      color: #5865f2;
      text-decoration: none;
      font-size: 14px;
    }

    .nav a:hover {
      text-decoration: underline;
    }

    .container {
      padding: 20px;
      overflow-y: auto;
      flex-grow: 1;
    }

    ul {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    li {
      background: white;
      padding: 14px;
      margin-bottom: 12px;
      border-radius: 8px;
      border: 1px solid #e3e5e8;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }

    .meta {
      margin-top: 6px;
      font-size: 13px;
      color: #666;
    }

    @media (prefers-color-scheme: dark) {
      body { background: #2f3136; color: #e3e5e8; }
      .header { background: #36393f; border-bottom-color: #3a3c40; }
      li { background: #36393f; border-color: #3a3c40; }
      .meta { color: #b9bbbe; }
      .nav a { color: #7289da; }
    }
      .raw-idea-item {
  position: relative;
}

.raw-idea-item {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.delete-raw-idea {
  position: absolute;
  top: 8px;
  right: 8px;
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  color: #999;
  padding: 4px;
}

.delete-raw-idea:hover {
  color: #e03131;
}


  </style>
</head>

<body>

  <div class="header">
    <h1>
      Raw Ideas for
      <a href="/api/user/${userId}${tokenQS}" style="color:#5865f2;">
        ${user.username}
      </a>
    </h1>
      ${searchBoxHtml}


    <div class="nav">
      <a href="/api/user/${userId}/notes${tokenQS}">Notes</a>
      <a href="/api/user/${userId}/tags${tokenQS}">Mail</a>
      <a href="/api/user/${userId}/contributions${tokenQS}">Contributions</a>
    </div>
  </div>

  <div class="container">
    <ul>
`;

    for (const r of rawIdeas) {
      const preview =
        r.contentType === "text" ? r.content : `[FILE] ${r.content}`;

      const ideaLink = `/api/user/${userId}/raw-ideas/${r._id}${tokenQS}`;

      html += `
<li class="raw-idea-item" data-raw-idea-id="${r._id}">
  <button class="delete-raw-idea" title="Delete raw idea">✕</button>

  <div>
    <a
      href="${ideaLink}"
      style="color:#5865f2; text-decoration:none;"
    >
      ${r.contentType === "text" ? r.content : `[FILE] ${r.content}`}
    </a>
  </div>

  <form
    method="POST"
    action="/api/user/${userId}/raw-ideas/${r._id}/transfer?token=${token}&html"
    style="margin-top:10px; display:flex; gap:6px; align-items:center;"
  >
    <input
      type="text"
      name="nodeId"
      placeholder="Target node ID"
      required
      style="
        padding:6px 8px;
        font-size:13px;
        border-radius:6px;
        border:1px solid #ccc;
        width:160px;
      "
    />

    <button
      type="submit"
      style="
        padding:6px 10px;
        font-size:13px;
        border-radius:6px;
        border:1px solid #999;
        background:#eee;
        cursor:pointer;
      "
    >
      Transfer
    </button>
  </form>

  <div class="meta">
    ${new Date(r.createdAt).toLocaleString()}
  </div>
</li>
`;
    }

    html += `
    </ul>
  </div>
<script>
document.addEventListener("click", async (e) => {
  if (!e.target.classList.contains("delete-raw-idea")) return;

  const li = e.target.closest(".raw-idea-item");
  const rawIdeaId = li.dataset.rawIdeaId;

  if (!confirm("Delete this raw idea?")) return;

  const token =
    new URLSearchParams(window.location.search).get("token") || "";

  const qs = token ? "?token=" + encodeURIComponent(token) : "";

  try {
    const res = await fetch(
      "/api/user/${userId}/raw-ideas/" + rawIdeaId + qs,
      { method: "DELETE" }
    );

    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    li.remove();
  } catch {
    alert("Delete failed");
  }
});
</script>

</body>
</html>
`;

    return res.send(html);
  } catch (err) {
    console.error("Error in /user/:userId/raw-ideas:", err);
    res.status(400).json({ success: false, error: err.message });
  }
});

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

      const result = await coreDeleteRawIdeaAndFile({
        rawIdeaId,
        userId: req.userId,
      });

      return res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }
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

      const result = await coreConvertRawIdeaToNote({
        rawIdeaId,
        userId: req.userId,
        nodeId,
      });

      // 🌐 HTML redirect support
      if ("html" in req.query) {
        return res.redirect(
          `/api/user/${userId}/raw-ideas?token=${req.query.token ?? ""}&html`
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
  }
);

router.get("/user/:userId/raw-ideas/:rawIdeaId", urlAuth, async (req, res) => {
  try {
    const { userId, rawIdeaId } = req.params;

    const RawIdea = (await import("../db/models/rawIdea.js")).default;

    const rawIdea = await RawIdea.findById(rawIdeaId)
      .populate("userId", "username")
      .lean();

    if (!rawIdea) return res.status(404).send("Raw idea not found");

    // Ownership / visibility check
    if (
      rawIdea.userId !== "empty" &&
      rawIdea.userId?._id?.toString() !== userId.toString()
    ) {
      return res.status(403).send("Not authorized");
    }

    const back = `/api/user/${userId}/raw-ideas?token=${
      req.query.token ?? ""
    }&html`;

    const userLink =
      rawIdea.userId && rawIdea.userId !== "empty"
        ? `<a href="/api/user/${rawIdea.userId._id}?token=${
            req.query.token ?? ""
          }&html">
               ${rawIdea.userId.username ?? rawIdea.userId}:
             </a>`
        : "Unknown user";

    // ---------------- HTML MODE ----------------
    if (req.query.html !== undefined) {
      // ---------- TEXT ----------
      if (rawIdea.contentType === "text") {
        return res.send(`
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<style>
  body {
    margin: 0;
    padding: 0;
    background: #f5f6f7;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    display: flex;
    justify-content: center;
  }

  .page {
    width: 100%;
    max-width: 800px;
    padding: 20px 16px;
  }

  .top-links {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 12px;
    font-size: 14px;
  }

  .top-links a {
    color: #5865f2;
    text-decoration: none;
  }

  .user-info {
    margin-bottom: 6px;
    font-size: 14px;
    opacity: 0.8;
  }

  pre {
    background: white;
    padding: 18px 20px;
    border-radius: 10px;
    font-size: 16px;
    line-height: 1.6;
    white-space: pre-wrap;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    border: 1px solid #ddd;
  }

  .copy-bar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 8px;
  }

  button {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 22px;
    opacity: 0.6;
  }

  button:hover {
    opacity: 1;
  }

  @media (prefers-color-scheme: dark) {
    body { background: #000; color: #e3e5e8; }
    pre { background: #111; border-color: #333; }
    .top-links a { color: #7289da; }
  }
</style>
</head>

<body>
  <div class="page">
    <div class="top-links">
      <a href="${back}">Back</a>
    </div>

    <div class="copy-bar">
      <button id="copyBtn">📋</button>
    </div>

    <div class="user-info"><strong>${userLink}</strong></div>

    <pre id="content">${rawIdea.content}</pre>
  </div>

<script>
  const btn = document.getElementById("copyBtn");
  const content = document.getElementById("content");

  btn.addEventListener("click", () => {
    navigator.clipboard.writeText(content.textContent).then(() => {
      btn.textContent = "✔️";
      setTimeout(() => (btn.textContent = "📋"), 900);
    });
  });
</script>
</body>
</html>
`);
      }

      // ---------- FILE ----------
      // ---------- FILE ----------
      const fileUrl = `/api/uploads/${rawIdea.content}`;
      const filePath = path.join(process.cwd(), "uploads", rawIdea.content);
      const mimeType = mime.lookup(filePath) || "application/octet-stream";
      const mediaHtml = renderMedia(fileUrl, mimeType);
      const fileName = rawIdea.content;

      return res.send(`
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${fileName}</title>

<style>
  body {
    margin: 0;
    padding: 0;
    background: #f5f6f7;
    font-family: system-ui, sans-serif;
    display: flex;
    justify-content: center;
  }

  .page {
    width: 100%;
    max-width: 800px;
    padding: 20px 16px;
  }

  .top-links {
    margin-bottom: 12px;
    font-size: 14px;
  }

  .top-links a {
    color: #5865f2;
    text-decoration: none;
  }

  .top-links a:hover {
    text-decoration: underline;
  }

  .user-info {
    margin-bottom: 12px;
    font-size: 14px;
    opacity: 0.8;
  }

  h1 {
    margin: 12px 0;
    font-size: 22px;
    font-weight: 600;
  }

  .download {
    display: inline-block;
    margin: 16px 0;
    padding: 10px 16px;
    background: #5865f2;
    color: white;
    text-decoration: none;
    border-radius: 6px;
    font-weight: 500;
  }

  .download:hover {
    background: #4752c4;
  }

  .media {
    margin-top: 16px;
  }

  @media (prefers-color-scheme: dark) {
    body { background: #000; color: #e3e5e8; }
    .top-links a { color: #7289da; }
    .download { background: #7289da; }
  }
</style>
</head>

<body>
  <div class="page">
    <div class="top-links">
      <a href="${back}">Back</a>
    </div>

    <div class="user-info"><strong>${userLink}</strong></div>

    <h1>${fileName}</h1>

    <a class="download" href="${fileUrl}" download>
      Download
    </a>

    <div class="media">
      ${mediaHtml}
    </div>
  </div>
</body>
</html>
`);
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
    if (!wantHtml) {
      return res.json({ success: true, invites });
    }

    // ---------- HTML ----------
    const rows =
      invites.length > 0
        ? invites
            .map(
              (i) => `
<li>
  <strong>${i.userInviting.username}</strong>
  invited you to
  <strong>${i.rootId.name}</strong>

  <div style="margin-top:8px; display:flex; gap:8px;">
    <form
  method="POST"
  action="/api/user/${userId}/invites/${i._id}?token=${
                req.query.token ?? ""
              }&html"
>
  <input type="hidden" name="accept" value="true" />
  <button type="submit">Accept</button>
</form>

<form
  method="POST"
  action="/api/user/${userId}/invites/${i._id}?token=${
                req.query.token ?? ""
              }&html"
>
  <input type="hidden" name="accept" value="false" />
  <button type="submit">Decline</button>
</form>

  </div>
</li>
`
            )
            .join("")
        : `<p><em>No pending invites</em></p>`;

    return res.send(`
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invites</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      padding: 20px;
      background: #fafafa;
    }
    li {
      background: white;
      padding: 14px;
      margin-bottom: 12px;
      border-radius: 8px;
      border: 1px solid #e3e5e8;
    }
    button {
      padding: 6px 10px;
      border-radius: 6px;
      border: 1px solid #999;
      background: #eee;
      cursor: pointer;
    }
  </style>
</head>
<body>

<h1>Invites</h1>

<ul>
  ${rows}
</ul>

</body>
</html>
`);
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
      const { accept } = req.body; // "true" or "false"

      if (req.userId.toString() !== userId.toString()) {
        return res.status(403).json({ error: "Not authorized" });
      }

      const acceptInvite = accept === "true";

      await respondToInvite({
        inviteId,
        userId: req.userId,
        acceptInvite,
      });

      // 🌐 HTML redirect support
      if ("html" in req.query) {
        return res.redirect(
          `/api/user/${userId}?token=${req.query.token ?? ""}&html`
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
  }
);

export default router;
