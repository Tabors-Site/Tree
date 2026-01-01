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

import { getDeletedBranchesForUser } from "../core/treeFetch.js";

import {
  createNewNode,
  reviveNodeBranch,
  reviveNodeBranchAsRoot,
} from "../core/treeManagement.js";

import { getPendingInvitesForUser, respondToInvite } from "../core/invites.js";

import {
  createRawIdea as coreCreateRawIdea,
  getRawIdeas as coreGetRawIdeas,
  searchRawIdeasByUser as coreSearchRawIdeasByUser,
  deleteRawIdeaAndFile as coreDeleteRawIdeaAndFile,
  convertRawIdeaToNote as coreConvertRawIdeaToNote,
} from "../core/rawIdea.js";

import {
  createApiKey,
  listApiKeys,
  deleteApiKey,
} from "../controllers/users.js";

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

    return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${user.username} — User Profile</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
    }

    .container {
      max-width: 800px;
      margin: 0 auto;
    }

    /* Header Section */
    .header {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .user-info h1 {
      font-size: 28px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 12px;
    }

    .user-id-container {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    code {
      background: #f0f0f0;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 13px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      color: #666;
      word-break: break-all;
    }

    #copyNodeIdBtn {
      background: none;
      border: none;
      cursor: pointer;
      padding: 6px;
      opacity: 0.6;
      font-size: 18px;
      transition: opacity 0.2s, transform 0.2s;
    }

    #copyNodeIdBtn:hover {
      opacity: 1;
      transform: scale(1.1);
    }

    /* Raw Ideas Capture Box - The Star of the Show */
    .raw-ideas-section {
      background: rgba(255, 255, 255, 0.98);
      backdrop-filter: blur(20px);
      border-radius: 20px;
      padding: 32px;
      margin-bottom: 32px;
      box-shadow: 
        0 20px 60px rgba(102, 126, 234, 0.3),
        0 0 0 1px rgba(255, 255, 255, 0.5) inset;
      position: relative;
      overflow: hidden;
    }

    .raw-ideas-section::before {
      content: '';
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: radial-gradient(
        circle,
        rgba(102, 126, 234, 0.08) 0%,
        transparent 70%
      );
      animation: pulse 8s ease-in-out infinite;
      pointer-events: none;
    }

    @keyframes pulse {
      0%, 100% {
        transform: scale(1) rotate(0deg);
        opacity: 0.5;
      }
      50% {
        transform: scale(1.1) rotate(180deg);
        opacity: 0.8;
      }
    }

    .raw-ideas-section h2 {
      font-size: 18px;
      font-weight: 600;
      color: #667eea;
      margin-bottom: 16px;
      position: relative;
      z-index: 1;
    }

    .raw-idea-form {
      display: flex;
      flex-direction: column;
      gap: 12px;
      position: relative;
      z-index: 1;
    }

    #rawIdeaInput {
      width: 100%;
      padding: 16px 18px;
      font-size: 16px;
      line-height: 1.6;
      border-radius: 12px;
      border: 2px solid transparent;
      background: white;
      font-family: inherit;
      resize: vertical;
      min-height: 64px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
    }

    #rawIdeaInput:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 
        0 0 0 4px rgba(102, 126, 234, 0.15),
        0 8px 30px rgba(102, 126, 234, 0.2);
      transform: translateY(-2px);
    }

    #rawIdeaInput::placeholder {
      color: #999;
    }

    .form-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .file-input-wrapper {
      position: relative;
      flex: 1;
      min-width: 140px;
    }

    input[type="file"] {
      font-size: 13px;
      color: #666;
      cursor: pointer;
    }

    input[type="file"]::file-selector-button {
      padding: 8px 14px;
      border-radius: 8px;
      border: 1px solid #d0d0d0;
      background: white;
      color: #666;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.2s;
      margin-right: 8px;
    }

    input[type="file"]::file-selector-button:hover {
      background: #f5f5f5;
      border-color: #999;
    }

    .send-button {
      padding: 12px 28px;
      font-size: 15px;
      font-weight: 600;
      border-radius: 10px;
      border: none;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
      white-space: nowrap;
    }

    .send-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(102, 126, 234, 0.5);
    }

    .send-button:active {
      transform: translateY(0);
    }

    /* Navigation Links */
    .nav-section {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .nav-section h2 {
      font-size: 16px;
      font-weight: 600;
      color: #555;
      margin-bottom: 16px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .nav-links {
      list-style: none;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 10px;
    }

    .nav-links li {
      margin: 0;
    }

    .nav-links a {
      display: block;
      padding: 12px 16px;
      background: #f8f9fa;
      border-radius: 10px;
      color: #667eea;
      text-decoration: none;
      font-weight: 500;
      font-size: 14px;
      transition: all 0.2s;
      border: 1px solid transparent;
    }

    .nav-links a:hover {
      background: white;
      border-color: #667eea;
      transform: translateX(4px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.15);
    }

    /* Roots Section */
    .roots-section {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .roots-section h2 {
      font-size: 20px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 16px;
    }

    .roots-list {
      list-style: none;
      margin-bottom: 20px;
    }

    .roots-list li {
      margin: 8px 0;
      transition: all 0.2s;
      border: 1px solid transparent;
    }

    .roots-list li:hover {
      background: white;
      border-color: #e0e0e0;
      transform: translateX(4px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
    }

    .roots-list a {
      display: block;
      padding: 12px 16px;
      background: #f8f9fa;
      border-radius: 10px;
      color: #1a1a1a;
      text-decoration: none;
      font-weight: 500;
      font-size: 15px;
      transition: all 0.2s;
    }

    .roots-list a:hover {
      color: #667eea;
      background: white;
    }

    .roots-list em {
      color: #999;
      font-style: normal;
    }

    /* Create Root Form */
    .create-root-form {
      display: flex;
      gap: 10px;
      align-items: stretch;
    }

    .create-root-form input[type="text"] {
      flex: 1;
      padding: 12px 16px;
      font-size: 15px;
      border-radius: 10px;
      border: 1px solid #d0d0d0;
      background: white;
      font-family: inherit;
      transition: all 0.2s;
    }

    .create-root-form input[type="text"]:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    .create-root-button {
      padding: 12px 18px;
      font-size: 24px;
      line-height: 1;
      border-radius: 10px;
      border: 1px solid #d0d0d0;
      background: white;
      color: #667eea;
      cursor: pointer;
      transition: all 0.2s;
      font-weight: 300;
    }

    .create-root-button:hover {
      background: #667eea;
      color: white;
      border-color: #667eea;
      transform: scale(1.05);
    }

    /* Responsive Design */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .header,
      .raw-ideas-section,
      .nav-section,
      .roots-section {
        padding: 20px;
      }

      .user-info h1 {
        font-size: 24px;
      }

      .raw-ideas-section {
        padding: 24px 20px;
      }

      #rawIdeaInput {
        font-size: 15px;
        padding: 14px 16px;
      }

      .form-actions {
        flex-direction: column;
        align-items: stretch;
      }

      .file-input-wrapper {
        order: 2;
      }

      .send-button {
        order: 1;
        width: 100%;
      }

      .nav-links {
        grid-template-columns: 1fr;
      }

      .create-root-form {
        flex-direction: column;
      }

      .create-root-button {
        width: 100%;
      }

      code {
        font-size: 11px;
        max-width: 200px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 700px;
      }

      .nav-links {
        grid-template-columns: repeat(2, 1fr);
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <div class="user-info">
        <h1>${user.username}</h1>
        <div class="user-id-container">
          <code id="nodeIdCode">${user._id}</code>
          <button id="copyNodeIdBtn" title="Copy ID">📋</button>
        </div>
      </div>
    </div>

    <!-- Raw Ideas Capture - Featured Section -->
    <div class="raw-ideas-section">
      <h2>Capture a Raw Idea</h2>
      <form
        method="POST"
        action="/api/user/${userId}/raw-ideas?token=${
      req.query.token ?? ""
    }&html"
        enctype="multipart/form-data"
        class="raw-idea-form"
      >
        <textarea
          name="content"
          placeholder="What's on your mind?"
          id="rawIdeaInput"
          rows="1"
          autofocus
        ></textarea>

        <div class="form-actions">
          <div class="file-input-wrapper">
            <input type="file" name="file" />
          </div>
          <button type="submit" class="send-button" title="Save raw idea">
            Send
          </button>
        </div>
      </form>
    </div>

    <!-- Navigation Links -->
    <div class="nav-section">
      <h2>Quick Links</h2>
      <ul class="nav-links">
        <li><a href="/api/user/${userId}/raw-ideas?${filtered}">Raw Ideas</a></li>
        <li><a href="/api/user/${userId}/invites?${filtered}">Invites</a></li>
        <li><a href="/api/user/${userId}/notes?${filtered}">Notes</a></li>
        <li><a href="/api/user/${userId}/tags?${filtered}">Mail</a></li>
        <li><a href="/api/user/${userId}/contributions?${filtered}">Contributions</a></li>
        <li><a href="/api/user/${userId}/deleted?${filtered}">Deleted</a></li>
        <li><a href="/api/user/${userId}/api-keys?${filtered}">API Keys</a></li>

      </ul>
    </div>

    <!-- Roots Section -->
    <div class="roots-section">
      <h2>Roots</h2>
      ${
        roots.length > 0
          ? `
        <ul class="roots-list">
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
          : `<p class="roots-list"><em>No roots yet</em></p>`
      }
      
      <form
        method="POST"
        action="/api/user/${userId}/createRoot?token=${
      req.query.token ?? ""
    }&html"
        class="create-root-form"
      >
        <input
          type="text"
          name="name"
          placeholder="New root name"
          required
        />
        <button type="submit" class="create-root-button" title="Create root">
          ＋
        </button>
      </form>
    </div>
  </div>

  <script>
    // Copy ID functionality
    const btn = document.getElementById("copyNodeIdBtn");
    const code = document.getElementById("nodeIdCode");

    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(code.textContent).then(() => {
        btn.textContent = "✔️";
        setTimeout(() => (btn.textContent = "📋"), 900);
      });
    });

    // Auto-resize textarea
    const textarea = document.getElementById("rawIdeaInput");
    
    function autoResize() {
      textarea.style.height = 'auto';
      const maxHeight = 400;
      const newHeight = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = newHeight + 'px';
      
      if (textarea.scrollHeight > maxHeight) {
        textarea.style.overflowY = 'auto';
      } else {
        textarea.style.overflowY = 'hidden';
      }
    }
    
    textarea.addEventListener('input', autoResize);
    autoResize();
    
    // Submit with Cmd/Ctrl+Enter
   textarea.addEventListener("keydown", (e) => {
  // Detect mobile keyboards (rough but effective)
  const isMobile =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // ENTER (desktop only) → submit
  if (!isMobile && e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    textarea.closest("form").submit();
    return;
  }

  // SHIFT + ENTER → newline (default behavior)
  // do nothing
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

    // Process notes outside the template literal
    const processedNotes = await Promise.all(
      notes.map(async (n) => {
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
      data-note-id="${n._id}"
      data-node-id="${n.nodeId}"
      data-version="${n.version}"
    >
      <button class="delete-button" title="Delete note">✕</button>

      <div class="note-content">
        <div class="note-author">${user.username}</div>
        <a
          href="/api/${n.nodeId}/${n.version}/notes/${n._id}${tokenQS}"
          class="note-link"
        >
          ${
            n.contentType === "file"
              ? `<span class="file-badge">FILE</span>`
              : ""
          }${preview}
        </a>
      </div>

      <div class="note-meta">
        ${new Date(n.createdAt).toLocaleString()}
        <span class="meta-separator">•</span>
        <a href="/api/${n.nodeId}/${n.version}${tokenQS}">
          ${nodeName} v${n.version}
        </a>
        <span class="meta-separator">•</span>
        <a href="/api/${n.nodeId}/${n.version}/notes${tokenQS}">
          View Notes
        </a>
      </div>
    </li>
  `;
      })
    );

    return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${user.username} — Notes</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
    }

    /* Back Navigation */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      color: #667eea;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .back-link:hover {
      background: white;
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    /* Header Section */
    .header {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .header h1 {
      font-size: 28px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 16px;
      line-height: 1.3;
    }

    .header h1 a {
      color: #667eea;
      text-decoration: none;
      transition: color 0.2s;
    }

    .header h1 a:hover {
      color: #764ba2;
      text-decoration: underline;
    }

    /* Search Box */
    .search-form {
      display: flex;
      gap: 10px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }

    .search-form input[type="text"] {
      flex: 1;
      min-width: 200px;
      padding: 12px 16px;
      font-size: 15px;
      border-radius: 10px;
      border: 1px solid #d0d0d0;
      background: white;
      font-family: inherit;
      transition: all 0.2s;
    }

    .search-form input[type="text"]:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    .search-form button {
      padding: 12px 24px;
      font-size: 15px;
      font-weight: 600;
      border-radius: 10px;
      border: none;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
      white-space: nowrap;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
    }

    .search-form button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(102, 126, 234, 0.4);
    }

    /* Navigation Links */
    .nav-links {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }

    .nav-links a {
      padding: 8px 16px;
      background: #f8f9fa;
      border-radius: 8px;
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      border: 1px solid transparent;
    }

    .nav-links a:hover {
      background: white;
      border-color: #667eea;
      transform: translateY(-2px);
      box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
    }

    /* Notes List */
    .notes-list {
      list-style: none;
    }

    .note-card {
      position: relative;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
      transition: all 0.2s;
    }

    .note-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
    }

    .delete-button {
      position: absolute;
      top: 16px;
      right: 16px;
      background: none;
      border: none;
      font-size: 20px;
      cursor: pointer;
      color: #999;
      padding: 8px;
      border-radius: 6px;
      transition: all 0.2s;
      line-height: 1;
    }

    .delete-button:hover {
      background: #ffebee;
      color: #c62828;
      transform: scale(1.1);
    }

    .note-content {
      padding-right: 40px;
      margin-bottom: 12px;
    }

    .note-author {
      font-weight: 600;
      color: #667eea;
      font-size: 14px;
      margin-bottom: 6px;
    }

    .note-link {
      color: #1a1a1a;
      text-decoration: none;
      font-size: 15px;
      line-height: 1.6;
      display: block;
      word-wrap: break-word;
      transition: color 0.2s;
    }

    .note-link:hover {
      color: #667eea;
    }

    .file-badge {
      display: inline-block;
      padding: 4px 10px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      margin-right: 8px;
    }

    /* Note Meta */
    .note-meta {
      padding-top: 12px;
      border-top: 1px solid #e9ecef;
      font-size: 13px;
      color: #888;
      line-height: 1.8;
    }

    .note-meta a {
      color: #667eea;
      text-decoration: none;
      font-weight: 500;
      transition: color 0.2s;
    }

    .note-meta a:hover {
      color: #764ba2;
      text-decoration: underline;
    }

    .meta-separator {
      margin: 0 6px;
      color: #ccc;
    }

    /* Empty State */
    .empty-state {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 60px 40px;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .empty-state-icon {
      font-size: 64px;
      margin-bottom: 16px;
    }

    .empty-state-text {
      font-size: 18px;
      color: #666;
      margin-bottom: 8px;
    }

    .empty-state-subtext {
      font-size: 14px;
      color: #999;
    }

    /* Responsive Design */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .header {
        padding: 20px;
      }

      .header h1 {
        font-size: 24px;
      }

      .search-form {
        flex-direction: column;
      }

      .search-form input[type="text"] {
        width: 100%;
        min-width: 0;
      }

      .search-form button {
        width: 100%;
      }

      .nav-links {
        flex-direction: column;
        gap: 8px;
      }

      .nav-links a {
        text-align: center;
      }

      .note-card {
        padding: 16px;
      }

      .delete-button {
        top: 12px;
        right: 12px;
      }

      .back-nav {
        flex-direction: column;
      }

      .back-link {
        justify-content: center;
      }

      .empty-state {
        padding: 40px 24px;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 700px;
      }
    }
           .header-subtitle {
    font-size: 14px;
    color: #888;
    margin-bottom: 16px;
  }

  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="/api/user/${userId}${tokenQS}" class="back-link">
        ← Back to Profile
      </a>
    </div>

    <!-- Header Section -->
    <div class="header">
      <h1>
        Notes by
        <a href="/api/user/${userId}${tokenQS}">${user.username}</a>
      </h1>
<div class="header-subtitle">
  View and manage all of your notes across every tree
</div>

      <!-- Search Form -->
      <form method="GET" action="/api/user/${userId}/notes" class="search-form">
        <input type="hidden" name="token" value="${token}">
        <input type="hidden" name="html" value="">
        <input
          type="text"
          name="q"
          placeholder="Search notes..."
          value="${query.replace(/"/g, "&quot;")}"
        />
        <button type="submit">Search</button>
      </form>

      <!-- Navigation Links -->
      <div class="nav-links">
        <a href="/api/user/${userId}/raw-ideas${tokenQS}">Raw Ideas</a>

        <a href="/api/user/${userId}/invites${tokenQS}">Invites</a>
        <a href="/api/user/${userId}/tags${tokenQS}">Mail</a>
        <a href="/api/user/${userId}/contributions${tokenQS}">Contributions</a>
        <a href="/api/user/${userId}/deleted${tokenQS}">Deleted</a>
      </div>
    </div>

    <!-- Notes List -->
    ${
      notes.length > 0
        ? `
    <ul class="notes-list">
      ${processedNotes.join("")}
    </ul>
    `
        : `
    <div class="empty-state">
      <div class="empty-state-icon">📝</div>
      <div class="empty-state-text">No notes yet</div>
      <div class="empty-state-subtext">
        ${
          query.trim() !== ""
            ? "Try a different search term"
            : "Notes will appear here as you create them"
        }
      </div>
    </div>
    `
    }
  </div>

  <script>
    document.addEventListener("click", async (e) => {
      if (!e.target.classList.contains("delete-button")) return;

      const card = e.target.closest(".note-card");
      const noteId = card.dataset.noteId;
      const nodeId = card.dataset.nodeId;
      const version = card.dataset.version;

      if (!confirm("Delete this note? This cannot be undone.")) return;

      const token = new URLSearchParams(window.location.search).get("token") || "";
      const qs = token ? "?token=" + encodeURIComponent(token) : "";

      try {
        const res = await fetch(
          \`/api/\${nodeId}/\${version}/notes/\${noteId}\${qs}\`,
          { method: "DELETE" }
        );

        const data = await res.json();
        if (!data.success) throw new Error(data.error || "Delete failed");

        // Fade out animation
        card.style.opacity = "0";
        card.style.transform = "translateX(-20px)";
        setTimeout(() => card.remove(), 300);
      } catch (err) {
        alert("Failed to delete: " + (err.message || "Unknown error"));
      }
    });
  </script>
</body>
</html>
`);
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

    // Replace the HTML return in your /user/:userId/tags route with this:

    // Replace the HTML return in your /user/:userId/tags route with this:

    return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${user.username} — Mail</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
    }

    /* Back Navigation */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      color: #667eea;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .back-link:hover {
      background: white;
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    /* Header Section */
    .header {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .header h1 {
      font-size: 28px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 8px;
      line-height: 1.3;
    }

    .header h1::before {
      content: '📨 ';
      font-size: 26px;
    }

    .unread-badge {
      display: inline-block;
      padding: 4px 10px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 12px;
      font-size: 13px;
      font-weight: 700;
      margin-left: 12px;
      box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
      animation: pulse-badge 2s ease-in-out infinite;
    }

    @keyframes pulse-badge {
      0%, 100% {
        transform: scale(1);
      }
      50% {
        transform: scale(1.05);
      }
    }

    .header h1 a {
      color: #667eea;
      text-decoration: none;
      transition: color 0.2s;
    }

    .header h1 a:hover {
      color: #764ba2;
      text-decoration: underline;
    }

    .header-subtitle {
      font-size: 14px;
      color: #888;
      margin-bottom: 16px;
    }

    /* Navigation Links */
    .nav-links {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }

    .nav-links a {
      padding: 8px 16px;
      background: #f8f9fa;
      border-radius: 8px;
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      border: 1px solid transparent;
    }

    .nav-links a:hover {
      background: white;
      border-color: #667eea;
      transform: translateY(-2px);
      box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
    }

    /* Notes List */
    .notes-list {
      list-style: none;
    }

    .note-card {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      border-left: 4px solid #667eea;
      position: relative;
      overflow: hidden;
    }

    .note-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.03) 0%, rgba(118, 75, 162, 0.03) 100%);
      opacity: 0;
      transition: opacity 0.3s;
      pointer-events: none;
    }

    .note-card:hover {
      transform: translateX(8px) translateY(-4px);
      box-shadow: 0 12px 32px rgba(102, 126, 234, 0.2);
      border-left-color: #764ba2;
    }

    .note-card:hover::before {
      opacity: 1;
    }

    .note-card.unread {
      background: linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(252, 252, 255, 0.98) 100%);
      border-left-width: 5px;
      box-shadow: 0 6px 20px rgba(102, 126, 234, 0.15);
    }

    .note-card.unread::after {
      content: '';
      position: absolute;
      top: 16px;
      right: 16px;
      width: 10px;
      height: 10px;
      background: #667eea;
      border-radius: 50%;
      box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.2);
      animation: pulse-dot 2s ease-in-out infinite;
    }

    @keyframes pulse-dot {
      0%, 100% {
        box-shadow: 0 0 0 4px rgba(102, 126, 234, 0.2);
      }
      50% {
        box-shadow: 0 0 0 8px rgba(102, 126, 234, 0.1);
      }
    }

    .note-content {
      margin-bottom: 12px;
    }

    .note-author {
      font-weight: 700;
      color: #667eea;
      font-size: 15px;
      margin-right: 6px;
      position: relative;
      display: inline-block;
    }

    .note-author::before {
      content: '  ';
      margin-right: 6px;
      font-size: 14px;
      opacity: 0.8;
    }

    .note-author a {
      color: #667eea;
      text-decoration: none;
      transition: color 0.2s;
    }

    .note-author a:hover {
      color: #764ba2;
      text-decoration: underline;
    }

    .note-link {
      color: #1a1a1a;
      text-decoration: none;
      font-size: 15px;
      line-height: 1.6;
      word-wrap: break-word;
      transition: color 0.2s;
    }

    .note-link:hover {
      color: #667eea;
    }

    .file-badge {
      display: inline-block;
      padding: 4px 10px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      margin-right: 8px;
    }

    /* Note Meta */
    .note-meta {
      padding-top: 12px;
      border-top: 1px solid #e9ecef;
      font-size: 13px;
      color: #888;
      line-height: 1.8;
    }

    .note-meta a {
      color: #667eea;
      text-decoration: none;
      font-weight: 500;
      transition: color 0.2s;
    }

    .note-meta a:hover {
      color: #764ba2;
      text-decoration: underline;
    }

    .meta-separator {
      margin: 0 6px;
      color: #ccc;
    }

    /* Empty State */
    .empty-state {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 60px 40px;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .empty-state-icon {
      font-size: 64px;
      margin-bottom: 16px;
    }

    .empty-state-text {
      font-size: 18px;
      color: #666;
      margin-bottom: 8px;
    }

    .empty-state-subtext {
      font-size: 14px;
      color: #999;
    }

    /* Responsive Design */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .header {
        padding: 20px;
      }

      .header h1 {
        font-size: 24px;
      }

      .nav-links {
        flex-direction: column;
        gap: 8px;
      }

      .nav-links a {
        text-align: center;
      }

      .note-card {
        padding: 16px;
      }

      .back-nav {
        flex-direction: column;
      }

      .back-link {
        justify-content: center;
      }

      .empty-state {
        padding: 40px 24px;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 700px;
      }
    }
      
  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="/api/user/${userId}${tokenQS}" class="back-link">
        ← Back to Profile
      </a>
    </div>

    <!-- Header Section -->
    <div class="header">
      <h1>
        Mail for
        <a href="/api/user/${userId}${tokenQS}">@${user.username}</a>
        ${
          notes.length > 0
            ? `<span class="unread-badge">${notes.length} ${
                notes.length === 1 ? "message" : "messages"
              }</span>`
            : ""
        }
      </h1>
      <div class="header-subtitle">Notes where others have mentioned you</div>

      <!-- Navigation Links -->
      <div class="nav-links">
        <a href="/api/user/${userId}/raw-ideas${tokenQS}">Raw Ideas</a>
                <a href="/api/user/${userId}/notes${tokenQS}">Notes</a>

        <a href="/api/user/${userId}/invites${tokenQS}">Invites</a>
        <a href="/api/user/${userId}/contributions${tokenQS}">Contributions</a>
        <a href="/api/user/${userId}/deleted${tokenQS}">Deleted</a>
      </div>
    </div>

    <!-- Notes List -->
    ${
      notes.length > 0
        ? `
    <ul class="notes-list">
      ${await Promise.all(
        notes.map(async (n) => {
          const nodeName = await getNodeName(n.nodeId);
          const preview =
            n.contentType === "text"
              ? n.content.length > 120
                ? n.content.substring(0, 120) + "…"
                : n.content
              : n.content.split("/").pop();

          const author = n.userId.username || n.userId._id;

          return `
          <li class="note-card unread">
            <div class="note-content">
              <span class="note-author">
                <a href="/api/user/${n.userId._id}${tokenQS}">
                  ${author}
                </a>
              </span>
              <a href="/api/${n.nodeId}/${n.version}/notes/${
            n._id
          }${tokenQS}" class="note-link">
                ${
                  n.contentType === "file"
                    ? `<span class="file-badge">FILE</span>`
                    : ""
                }${preview}
              </a>
            </div>

            <div class="note-meta">
              ${new Date(n.createdAt).toLocaleString()}
              <span class="meta-separator">•</span>
              <a href="/api/${n.nodeId}/${n.version}${tokenQS}">
                ${nodeName} v${n.version}
              </a>
              <span class="meta-separator">•</span>
              <a href="/api/${n.nodeId}/${n.version}/notes${tokenQS}">
                View Notes
              </a>
            </div>
          </li>
        `;
        })
      ).then((results) => results.join(""))}
    </ul>
    `
        : `
    <div class="empty-state">
      <div class="empty-state-icon">📬</div>
      <div class="empty-state-text">No tagged notes yet</div>
      <div class="empty-state-subtext">
        Notes where you're tagged will appear here
      </div>
    </div>
    `
    }
  </div>
</body>
</html>
`);
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
                  c.scheduleEdited.date
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
                  c.executeScript.logs.join("\n")
                )}</code></pre>`
              : ""
          }
          ${
            c.executeScript?.error
              ? `<div>Error: <code>${escapeHtml(
                  c.executeScript.error
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
                  queryString
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
              value
            )}</code></li>`
        )
        .join("")}
    </ul>
  `;
};
const escapeHtml = (str = "") =>
  String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

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
    ? `<a href="/api/${id}${queryString}"><code>${id}</code></a>`
    : `<code>unknown</code>`;

const renderVersionLink = (
  nodeId,
  version,
  queryString,
  label = `Version ${version}`
) =>
  `<a href="/api/${nodeId}/${version}${queryString}">
    <code>${label}</code>
  </a>`;

export const contributionRenderers = ({
  nodeId,
  version,
  nextVersion,
  queryString,
}) => ({
  create: () => `created node`,
  editStatus: (c) => `changed status to <code>${c.statusEdited}</code>`,
  editValue: () => `updated values`,
  prestige: () =>
    nodeId
      ? `added new version ${renderVersionLink(
          nodeId,
          nextVersion,
          queryString
        )}`
      : `added new version`,
  transaction: () =>
    nodeId
      ? `completed <a href="/api/${nodeId}/${version}/transactions${queryString}">
          <code>transaction</code>
        </a>`
      : `completed <code>transaction</code>`,
  delete: () => `deleted node`,
  editSchedule: () => `updated schedule`,
  editGoal: () => `updated goal`,
  editNameNode: (c) =>
    `renamed node from <code>${c.editNameNode?.oldName}</code> to <code>${c.editNameNode?.newName}</code>`,
  updateParent: (c) =>
    `changed parent from ${renderLink(
      c.updateParent?.oldParentId,
      queryString
    )} to ${renderLink(c.updateParent?.newParentId, queryString)}`,
  updateChildNode: (c) =>
    `${c.updateChildNode?.action} child ${renderLink(
      c.updateChildNode?.childId,
      queryString
    )}`,
  note: (c) =>
    `${c.noteAction?.action === "add" ? "added" : "removed"} note
   <a href="/api/${c.nodeId}/${c.nodeVersion}/notes/${
      c.noteAction?.noteId
    }${queryString}">
     <code>${c.noteAction?.noteId}</code>
   </a>`,
  editScript: (c) => `updated script <code>${c.editScript?.scriptName}</code>`,
  executeScript: (c) =>
    `executed script <code>${c.executeScript?.scriptName}</code>`,
  rawIdea: (c) => {
    const { action, rawIdeaId, targetNodeId } = c.rawIdeaAction || {};

    if (action === "add") {
      return `added raw idea
      <a href="/api/user/${c.userId?._id}/raw-ideas/${rawIdeaId}${queryString}">
        <code>${rawIdeaId}</code>
      </a>`;
    }

    if (action === "delete") {
      return `deleted raw idea
      <code>${rawIdeaId}</code>`;
    }

    if (action === "place" && targetNodeId) {
      return `placed raw idea
      <code>${rawIdeaId}</code>
      into ${renderLink(targetNodeId, queryString)}`;
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

const contributionsCss = `<style>
  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto',
      'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    padding: 20px;
    color: #1a1a1a;
  }

  .container {
    max-width: 900px;
    margin: 0 auto;
  }

  /* Back Navigation */
  .back-nav {
    display: flex;
    gap: 12px;
    margin-bottom: 20px;
    flex-wrap: wrap;
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 16px;
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    color: #667eea;
    text-decoration: none;
    border-radius: 10px;
    font-weight: 600;
    font-size: 14px;
    transition: all 0.2s;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .back-link:hover {
    background: white;
    transform: translateY(-2px);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
  }

  /* Header Section */
  .header {
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    border-radius: 16px;
    padding: 28px;
    margin-bottom: 24px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  }

  .header h1 {
    font-size: 28px;
    font-weight: 700;
    color: #1a1a1a;
    margin-bottom: 8px;
    line-height: 1.3;
  }

  .header h1::before {
    content: '📊 ';
    font-size: 26px;
  }

  .header h1 a {
    color: #667eea;
    text-decoration: none;
    transition: color 0.2s;
  }

  .header h1 a:hover {
    color: #764ba2;
    text-decoration: underline;
  }

  .header-subtitle {
    font-size: 14px;
    color: #888;
    margin-bottom: 16px;
  }

  /* Navigation Links */
  .nav-links {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }

  .nav-links a {
    padding: 8px 16px;
    background: #f8f9fa;
    border-radius: 8px;
    color: #667eea;
    text-decoration: none;
    font-weight: 600;
    font-size: 14px;
    transition: all 0.2s;
    border: 1px solid transparent;
  }

  .nav-links a:hover {
    background: white;
    border-color: #667eea;
    transform: translateY(-2px);
    box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
  }

  /* Contributions List */
  .contributions-list {
    list-style: none;
  }

  .contribution-item {
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    border-radius: 12px;
    padding: 20px;
    margin-bottom: 16px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    border-left: 4px solid #667eea;
    position: relative;
    overflow: hidden;
  }

  .contribution-item::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, rgba(102, 126, 234, 0.03) 0%, rgba(118, 75, 162, 0.03) 100%);
    opacity: 0;
    transition: opacity 0.3s;
    pointer-events: none;
  }

  .contribution-item:hover {
    transform: translateX(8px) translateY(-4px);
    box-shadow: 0 12px 32px rgba(102, 126, 234, 0.2);
    border-left-color: #764ba2;
  }

  .contribution-item:hover::before {
    opacity: 1;
  }

  .contribution-user {
    font-weight: 700;
    color: #667eea;
    font-size: 15px;
    margin-bottom: 4px;
    position: relative;
    display: inline-block;
  }

  .contribution-user::before {
    content: '👤';
    margin-right: 6px;
    font-size: 14px;
    opacity: 0.8;
  }

  .contribution-action {
    font-size: 15px;
    line-height: 1.6;
    color: #1a1a1a;
    margin-bottom: 6px;
  }

  .contribution-time {
    font-size: 13px;
    color: #888;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #e9ecef;
    display: block;
  }

  .contribution-details {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #e9ecef;
  }

  .contribution-details strong {
    color: #667eea;
    font-size: 14px;
    display: block;
    margin-bottom: 8px;
  }

  .contribution-details ul {
    list-style: none;
    padding-left: 0;
    margin-top: 8px;
  }

  .contribution-details li {
    padding: 8px 12px;
    background: #f8f9fa;
    border-radius: 6px;
    margin-bottom: 6px;
    font-size: 14px;
  }

  /* Code + Links */
  code {
    background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 13px;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    color: #667eea;
    font-weight: 600;
    word-break: break-word;
  }

  pre {
    background: #2d2d2d;
    color: #a9b7c6;
    padding: 12px;
    border-radius: 8px;
    overflow-x: auto;
    margin-top: 8px;
    font-size: 13px;
    line-height: 1.5;
  }

  pre code {
    background: none;
    color: inherit;
    padding: 0;
    font-weight: 400;
  }

  a {
    color: #667eea;
    text-decoration: none;
    font-weight: 500;
    transition: color 0.2s;
  }

  a:hover {
    color: #764ba2;
    text-decoration: underline;
  }

  /* Empty State */
  .empty-state {
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    border-radius: 16px;
    padding: 60px 40px;
    text-align: center;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  }

  .empty-state-icon {
    font-size: 64px;
    margin-bottom: 16px;
  }

  .empty-state-text {
    font-size: 18px;
    color: #666;
    margin-bottom: 8px;
  }

  .empty-state-subtext {
    font-size: 14px;
    color: #999;
  }

  /* Responsive */
  @media (max-width: 640px) {
    body {
      padding: 16px;
    }

    .header {
      padding: 20px;
    }

    .header h1 {
      font-size: 24px;
    }

    .back-nav {
      flex-direction: column;
    }

    .back-link {
      justify-content: center;
    }

    .nav-links {
      flex-direction: column;
      gap: 8px;
    }

    .nav-links a {
      text-align: center;
    }

    .contribution-item {
      padding: 16px;
    }

    code {
      font-size: 12px;
    }

    pre {
      font-size: 12px;
    }

    .empty-state {
      padding: 40px 24px;
    }
  }

  @media (min-width: 641px) and (max-width: 1024px) {
    .container {
      max-width: 700px;
    }
  }
</style>`;

router.get("/user/:userId/contributions", urlAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

    const limit =
      req.query.limit !== undefined ? Number(req.query.limit) : undefined;

    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return res.status(400).json({ error: "Invalid limit" });
    }

    const filtered = Object.entries(req.query)
      .filter(([k]) => ["token", "html"].includes(k))
      .map(([k, v]) => (v === "" ? k : `${k}=${v}`))
      .join("&");

    const queryString = filtered ? `?${filtered}` : "";

    const { contributions = [] } = await getContributionsByUser(
      userId,
      limit,
      req.query.startDate,
      req.query.endDate
    );

    if (!wantHtml) {
      return res.json({ userId, contributions });
    }

    const user = await User.findById(userId).lean();
    const username = user?.username || "Unknown user";

    const renderers = contributionRenderers({
      nodeId: null,
      version: null,
      nextVersion: null,
      queryString,
    });

    const items = await Promise.all(
      contributions.map(async (c) => {
        const nodeId = c.nodeId?._id || c.nodeId;
        const version = Number(c.nodeVersion ?? 0);
        const time = new Date(c.date).toLocaleString();
        const nodeName = nodeId ? await getNodeName(nodeId) : "Unknown node";

        const render = renderers[c.action] || (() => c.action);
        const details = renderDetails(c, queryString);

        return `
<li class="contribution-item">
  <div class="contribution-user">${username}</div>
  <div class="contribution-action">
    ${render(c)}
    ${
      nodeId
        ? ` on <a href="/api/${nodeId}/${version}${queryString}">
            <code>${nodeName}</code>
          </a>`
        : ""
    }
  </div>
  <span class="contribution-time">${time}</span>
  ${details ? `<div class="contribution-details">${details}</div>` : ""}
</li>`;
      })
    );

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${username} — Contributions</title>
  ${contributionsCss}
</head>

<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="/api/user/${userId}${queryString}" class="back-link">
        ← Back to Profile
      </a>
    </div>

    <!-- Header Section -->
    <div class="header">
      <h1>
        Contributions by
        <a href="/api/user/${userId}${queryString}">@${username}</a>
      </h1>
      <div class="header-subtitle">Activity & change history</div>

      <!-- Navigation Links -->
      <div class="nav-links">
        <a href="/api/user/${userId}/raw-ideas${queryString}">Raw Ideas</a>
        <a href="/api/user/${userId}/notes${queryString}">Notes</a>
        <a href="/api/user/${userId}/tags${queryString}">Mail</a>
        <a href="/api/user/${userId}/invites${queryString}">Invites</a>
        <a href="/api/user/${userId}/deleted${queryString}">Deleted</a>
      </div>
    </div>

    <!-- Contributions List -->
    ${
      items.length
        ? `<ul class="contributions-list">${items.join("")}</ul>`
        : `
    <div class="empty-state">
      <div class="empty-state-icon">📊</div>
      <div class="empty-state-text">No contributions yet</div>
      <div class="empty-state-subtext">
        Contributions and activity will appear here
      </div>
    </div>`
    }
  </div>
</body>
</html>
`);
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
        `/api/root/${rootNode._id}?token=${req.query.token ?? ""}&html`
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

    // Replace the HTML return in your /user/:userId/raw-ideas route with this:

    return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${user.username} — Raw Ideas</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
    }

    /* Header Section */
    .header {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .header h1 {
      font-size: 28px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 16px;
      line-height: 1.3;
    }

    .header h1 a {
      color: #667eea;
      text-decoration: none;
      transition: color 0.2s;
    }

    .header h1 a:hover {
      color: #764ba2;
      text-decoration: underline;
    }

    /* Search Box */
    .search-form {
      display: flex;
      gap: 10px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }

    .search-form input[type="text"] {
      flex: 1;
      min-width: 200px;
      padding: 12px 16px;
      font-size: 15px;
      border-radius: 10px;
      border: 1px solid #d0d0d0;
      background: white;
      font-family: inherit;
      transition: all 0.2s;
    }

    .search-form input[type="text"]:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    .search-form button {
      padding: 12px 24px;
      font-size: 15px;
      font-weight: 600;
      border-radius: 10px;
      border: none;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
      white-space: nowrap;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
    }

    .search-form button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(102, 126, 234, 0.4);
    }

    /* Navigation */
    .nav-links {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }

    .nav-links a {
      padding: 8px 16px;
      background: #f8f9fa;
      border-radius: 8px;
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      border: 1px solid transparent;
    }

    .nav-links a:hover {
      background: white;
      border-color: #667eea;
      transform: translateY(-2px);
      box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
    }

    /* Raw Ideas List */
    .ideas-list {
      list-style: none;
    }

    .idea-card {
      position: relative;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
      transition: all 0.2s;
    }

    .idea-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
    }

    .delete-button {
      position: absolute;
      top: 16px;
      right: 16px;
      background: none;
      border: none;
      font-size: 20px;
      cursor: pointer;
      color: #999;
      padding: 8px;
      border-radius: 6px;
      transition: all 0.2s;
      line-height: 1;
    }

    .delete-button:hover {
      background: #ffebee;
      color: #c62828;
      transform: scale(1.1);
    }

    .idea-content {
      padding-right: 40px;
      margin-bottom: 12px;
    }

    .idea-link {
      color: #1a1a1a;
      text-decoration: none;
      font-size: 15px;
      line-height: 1.6;
      display: block;
      word-wrap: break-word;
      transition: color 0.2s;
    }

    .idea-link:hover {
      color: #667eea;
    }

    .file-badge {
      display: inline-block;
      padding: 4px 10px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      margin-right: 8px;
    }

    /* Transfer Form */
    .transfer-form {
      display: flex;
      gap: 10px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #e9ecef;
      flex-wrap: wrap;
    }

    .transfer-form input[type="text"] {
      flex: 1;
      min-width: 160px;
      padding: 10px 14px;
      font-size: 14px;
      border-radius: 8px;
      border: 1px solid #d0d0d0;
      background: white;
      font-family: inherit;
      transition: all 0.2s;
    }

    .transfer-form input[type="text"]:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    .transfer-form button {
      padding: 10px 18px;
      font-size: 14px;
      font-weight: 600;
      border-radius: 8px;
      border: none;
      background: #667eea;
      color: white;
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
      white-space: nowrap;
    }

    .transfer-form button:hover {
      background: #5856d6;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
    }

    /* Metadata */
    .idea-meta {
      margin-top: 12px;
      font-size: 13px;
      color: #888;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .idea-meta::before {
      content: "🕐";
      font-size: 14px;
    }

    /* Empty State */
    .empty-state {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 60px 40px;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .empty-state-icon {
      font-size: 64px;
      margin-bottom: 16px;
    }

    .empty-state-text {
      font-size: 18px;
      color: #666;
      margin-bottom: 8px;
    }

    .empty-state-subtext {
      font-size: 14px;
      color: #999;
    }

    /* Responsive Design */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .header {
        padding: 20px;
      }

      .header h1 {
        font-size: 24px;
      }

      .search-form {
        flex-direction: column;
      }

      .search-form input[type="text"] {
        width: 100%;
        min-width: 0;
      }

      .search-form button {
        width: 100%;
      }

      .nav-links {
        flex-direction: column;
        gap: 8px;
      }

      .nav-links a {
        text-align: center;
      }

      .idea-card {
        padding: 16px;
      }

      .delete-button {
        top: 12px;
        right: 12px;
      }

      .transfer-form {
        flex-direction: column;
      }

      .transfer-form input[type="text"] {
        width: 100%;
        min-width: 0;
      }

      .transfer-form button {
        width: 100%;
      }

      .empty-state {
        padding: 40px 24px;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 700px;
      }
    }
    .back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  color: #667eea;
  text-decoration: none;
  border-radius: 10px;
  font-weight: 600;
  font-size: 14px;
  transition: all 0.2s;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}
  .header-subtitle {
    font-size: 14px;
    color: #888;
    margin-bottom: 16px;
  }
  </style>
</head>
<body>
  <div class="container">
  
    <!-- Header Section -->
     <div class="back-nav">
      <a href="/api/user/${userId}${tokenQS}" class="back-link">
        ← Back to Profile
      </a>
    </div>
    <div class="header">
      <h1>
        Raw Ideas for
        <a href="/api/user/${userId}${tokenQS}">${user.username}</a>
      </h1>
<div class="header-subtitle">
  Organize raw ideas by placing them as notes on the appropriate node. You can use the ChatGPT connector to automate this process.
</div>

      <!-- Search Form -->
      <form method="GET" action="/api/user/${userId}/raw-ideas" class="search-form">
        <input type="hidden" name="token" value="${token}">
        <input type="hidden" name="html" value="">
        <input
          type="text"
          name="q"
          placeholder="Search raw ideas..."
          value="${query}"
        />
        <button type="submit">Search</button>
      </form>

      <!-- Navigation Links -->
      <div class="nav-links">

        <a href="/api/user/${userId}/notes${tokenQS}">Notes</a>
                        <a href="/api/user/${userId}/invites${tokenQS}">Invites</a>

        <a href="/api/user/${userId}/tags${tokenQS}">Mail</a>
        <a href="/api/user/${userId}/contributions${tokenQS}">Contributions</a>
                        <a href="/api/user/${userId}/deleted${tokenQS}">Deleted</a>



      </div>
    </div>

    <!-- Raw Ideas List -->
    ${
      rawIdeas.length > 0
        ? `
    <ul class="ideas-list">
      ${rawIdeas
        .map(
          (r) => `
        <li class="idea-card" data-raw-idea-id="${r._id}">
          <button class="delete-button" title="Delete raw idea">✕</button>

          <div class="idea-content">
            <a
              href="/api/user/${userId}/raw-ideas/${r._id}${tokenQS}"
              class="idea-link"
            >
              ${
                r.contentType === "file"
                  ? `<span class="file-badge">FILE</span>${r.content}`
                  : r.content
              }
            </a>
          </div>

          <form
            method="POST"
            action="/api/user/${userId}/raw-ideas/${
            r._id
          }/transfer?token=${token}&html"
            class="transfer-form"
          >
            <input
              type="text"
              name="nodeId"
              placeholder="Target node ID"
              required
            />
            <button type="submit">Transfer to Node</button>
          </form>

          <div class="idea-meta">${new Date(r.createdAt).toLocaleString()}
          </div>
        </li>
      `
        )
        .join("")}
    </ul>
    `
        : `
    <div class="empty-state">
      <div class="empty-state-icon">💭</div>
      <div class="empty-state-text">No raw ideas yet</div>
      <div class="empty-state-subtext">
        ${
          query.trim() !== ""
            ? "Try a different search term"
            : "Start capturing your ideas from the user page"
        }
      </div>
    </div>
    `
    }
  </div>

  <script>
    document.addEventListener("click", async (e) => {
      if (!e.target.classList.contains("delete-button")) return;

      const card = e.target.closest(".idea-card");
      const rawIdeaId = card.dataset.rawIdeaId;

      if (!confirm("Delete this raw idea? This cannot be undone.")) return;

      const token = new URLSearchParams(window.location.search).get("token") || "";
      const qs = token ? "?token=" + encodeURIComponent(token) : "";

      try {
        const res = await fetch(
          "/api/user/${userId}/raw-ideas/" + rawIdeaId + qs,
          { method: "DELETE" }
        );

        const data = await res.json();
        if (!data.success) throw new Error(data.error);

        // Fade out animation
        card.style.opacity = "0";
        card.style.transform = "translateX(-20px)";
        setTimeout(() => card.remove(), 300);
      } catch (err) {
        alert("Failed to delete: " + (err.message || "Unknown error"));
      }
    });
  </script>
</body>
</html>
`);
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

    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;

    const back = `/api/user/${userId}/raw-ideas${tokenQS}`;

    const userLink =
      rawIdea.userId && rawIdea.userId !== "empty"
        ? `<a href="/api/user/${rawIdea.userId._id}${tokenQS}">
               ${rawIdea.userId.username ?? rawIdea.userId}
             </a>`
        : "Unknown user";

    // ---------------- HTML MODE ----------------
    if (req.query.html !== undefined) {
      // ---------- TEXT ----------
      if (rawIdea.contentType === "text") {
        return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Raw Idea by ${rawIdea.userId?.username || "User"}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
    }

    /* Back Navigation */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      color: #667eea;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .back-link:hover {
      background: white;
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    /* Raw Idea Card */
    .raw-idea-card {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      position: relative;
      overflow: hidden;
    }

    .raw-idea-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 4px;
      background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
    }

    /* User Info */
    .user-info {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid #e9ecef;
    }

    .user-info::before {
      content: '💡';
      font-size: 18px;
    }

    .user-info a {
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      transition: color 0.2s;
    }

    .user-info a:hover {
      color: #764ba2;
      text-decoration: underline;
    }

    /* Copy Button */
    .copy-bar {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 16px;
    }

    #copyBtn {
      background: rgba(102, 126, 234, 0.1);
      border: 1px solid rgba(102, 126, 234, 0.2);
      cursor: pointer;
      font-size: 20px;
      padding: 8px 12px;
      border-radius: 8px;
      transition: all 0.2s;
    }

    #copyBtn:hover {
      background: rgba(102, 126, 234, 0.2);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
    }

    #copyBtn:active {
      transform: translateY(0);
    }

    /* Raw Idea Content */
    pre {
      background: #f8f9fa;
      padding: 20px;
      border-radius: 12px;
      font-size: 16px;
      line-height: 1.7;
      white-space: pre-wrap;
      word-wrap: break-word;
      border: 1px solid #e9ecef;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      color: #1a1a1a;
    }

    /* Responsive */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .raw-idea-card {
        padding: 20px;
      }

      pre {
        font-size: 17px;
        padding: 16px;
      }

      .back-nav {
        flex-direction: column;
      }

      .back-link {
        justify-content: center;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 700px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="${back}" class="back-link">← Back to Raw Ideas</a>
    </div>

    <!-- Raw Idea Card -->
    <div class="raw-idea-card">
      <div class="user-info">
        ${userLink}
      </div>

      <div class="copy-bar">
        <button id="copyBtn" title="Copy raw idea">📋</button>
      </div>

      <pre id="content">${rawIdea.content}</pre>
    </div>
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
      const fileUrl = `/api/uploads/${rawIdea.content}`;
      const filePath = path.join(process.cwd(), "uploads", rawIdea.content);
      const mimeType = mime.lookup(filePath) || "application/octet-stream";
      const mediaHtml = renderMedia(fileUrl, mimeType);
      const fileName = rawIdea.content;

      return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${fileName}</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
    }

    /* Back Navigation */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      color: #667eea;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .back-link:hover {
      background: white;
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    /* File Card */
    .file-card {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      position: relative;
      overflow: hidden;
    }

    .file-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 4px;
      background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
    }

    /* User Info */
    .user-info {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid #e9ecef;
    }

     .user-info::before {
      content: '👤';
      font-size: 18px;
    }

    .user-info a {
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      transition: color 0.2s;
    }

    .user-info a:hover {
      color: #764ba2;
      text-decoration: underline;
    }

    /* File Header */
    h1 {
      font-size: 24px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 20px;
      word-break: break-word;
    }

    h1::before {
      content: '📎 ';
      font-size: 22px;
    }

    /* Download Button */
    .download {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 15px;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
      margin-bottom: 24px;
    }

    .download:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
    }

    .download::before {
      content: '⬇️';
      font-size: 16px;
    }

    /* Media Container */
    .media {
      margin-top: 24px;
      padding-top: 24px;
      border-top: 1px solid #e9ecef;
    }

    .media img,
    .media video,
    .media audio {
      max-width: 100%;
      border-radius: 12px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
    }

    /* Responsive */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .file-card {
        padding: 20px;
      }

      h1 {
        font-size: 22px;
      }

      .download {
        padding: 12px 18px;
        font-size: 16px;
        width: 100%;
        justify-content: center;
      }

      .back-nav {
        flex-direction: column;
      }

      .back-link {
        justify-content: center;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 700px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="${back}" class="back-link">← Back to Raw Ideas</a>
    </div>

    <!-- File Card -->
    <div class="file-card">
      <div class="user-info">
        ${userLink}
      </div>

      <h1>${fileName}</h1>

      <a class="download" href="${fileUrl}" download>
        Download
      </a>

      <div class="media">
        ${mediaHtml}
      </div>
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
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Invites</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
    }

    /* Back Navigation */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      color: #667eea;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .back-link:hover {
      background: white;
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    /* Header Section */
    .header {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .header h1 {
      font-size: 28px;
      font-weight: 700;
      color: #1a1a1a;
      line-height: 1.3;
      margin-bottom: 16px;
    }

   
    .header h1 a {
      color: #667eea;
      text-decoration: none;
      transition: color 0.2s;
    }

    .header h1 a:hover {
      color: #764ba2;
      text-decoration: underline;
    }

    /* Navigation Links */
    .nav-links {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }

    .nav-links a {
      padding: 8px 16px;
      background: #f8f9fa;
      border-radius: 8px;
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      border: 1px solid transparent;
    }

    .nav-links a:hover {
      background: white;
      border-color: #667eea;
      transform: translateY(-2px);
      box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
    }

    /* Invites List */
    .invites-section {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .invites-list {
      list-style: none;
    }

    .invite-card {
      background: linear-gradient(135deg, #fdfbf7 0%, #fff9f0 100%);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
      border-left: 4px solid #d4af37;
      transition: all 0.2s;
      box-shadow: 0 2px 8px rgba(212, 175, 55, 0.1);
    }

    .invite-card:hover {
      background: linear-gradient(135deg, #fffef9 0%, #fffbf4 100%);
      transform: translateX(4px);
      box-shadow: 0 6px 20px rgba(212, 175, 55, 0.2);
      border-left-color: #f4d03f;
    }

    .invite-card:last-child {
      margin-bottom: 0;
    }

    .invite-text {
      font-size: 15px;
      line-height: 1.6;
      color: #1a1a1a;
      margin-bottom: 12px;
    }

    .invite-text strong:first-child {
      color: #c9a227;
      font-weight: 700;
    }

    .invite-text strong:last-child {
      color: #1a1a1a;
      font-weight: 700;
    }

    .invite-actions {
      display: flex;
      gap: 10px;
      margin-top: 12px;
      flex-wrap: wrap;
    }

    .invite-actions form {
      margin: 0;
    }

    .accept-button {
      padding: 10px 20px;
      border-radius: 8px;
      border: none;
      background: linear-gradient(135deg, #d4af37 0%, #f4d03f 100%);
      color: #1a1a1a;
      cursor: pointer;
      font-weight: 700;
      font-size: 14px;
      transition: all 0.2s;
      font-family: inherit;
      box-shadow: 0 4px 15px rgba(212, 175, 55, 0.3);
    }

    .accept-button:hover {
      background: linear-gradient(135deg, #f4d03f 0%, #ffd700 100%);
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(212, 175, 55, 0.4);
    }

    .decline-button {
      padding: 10px 20px;
      border-radius: 8px;
      border: 2px solid #e0e0e0;
      background: white;
      color: #666;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      font-family: inherit;
    }

    .decline-button:hover {
      border-color: #c62828;
      color: #c62828;
      background: #fff5f5;
      transform: translateY(-1px);
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 60px 40px;
      color: #999;
    }

    .empty-state-icon {
      font-size: 64px;
      margin-bottom: 16px;
    }

    .empty-state-text {
      font-size: 18px;
      color: #666;
    }

    /* Responsive Design */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .header,
      .invites-section {
        padding: 20px;
      }

      .header h1 {
        font-size: 24px;
      }

      .invite-card {
        padding: 16px;
      }

      .invite-actions {
        flex-direction: column;
      }

      .accept-button,
      .decline-button {
        width: 100%;
      }

      .back-nav {
        flex-direction: column;
      }

      .back-link {
        justify-content: center;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 700px;
      }
    }
        .header-subtitle {
    font-size: 14px;
    color: #888;
    margin-bottom: 16px;
  }
  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="/api/user/${userId}?token=${
      req.query.token ?? ""
    }&html" class="back-link">
        ← Back to Profile
      </a>
    </div>

    <!-- Header -->
    <div class="header">

    <h1>
     Invites
      </h1>
          <div class="header-subtitle">Join other people's trees</div>

      <!-- Navigation Links -->
      <div class="nav-links">
        <a href="/api/user/${userId}/raw-ideas?token=${
      req.query.token ?? ""
    }&html">Raw Ideas</a>
        <a href="/api/user/${userId}/notes?token=${
      req.query.token ?? ""
    }&html">Notes</a>
    
        <a href="/api/user/${userId}/tags?token=${
      req.query.token ?? ""
    }&html">Mail</a>
        <a href="/api/user/${userId}/contributions?token=${
      req.query.token ?? ""
    }&html">Contributions</a>
  
        <a href="/api/user/${userId}/deleted?token=${
      req.query.token ?? ""
    }&html">Deleted</a>
      </div>
    </div>

    <!-- Invites Section -->
    <div class="invites-section">
      ${
        invites.length > 0
          ? `
        <ul class="invites-list">
          ${invites
            .map(
              (i) => `
            <li class="invite-card">
              <div class="invite-text">
                <strong>${i.userInviting.username}</strong>
                invited you to
                <strong>${i.rootId.name}</strong>
              </div>

              <div class="invite-actions">
                <form
                  method="POST"
                  action="/api/user/${userId}/invites/${i._id}?token=${
                req.query.token ?? ""
              }&html"
                >
                  <input type="hidden" name="accept" value="true" />
                  <button type="submit" class="accept-button">Accept</button>
                </form>

                <form
                  method="POST"
                  action="/api/user/${userId}/invites/${i._id}?token=${
                req.query.token ?? ""
              }&html"
                >
                  <input type="hidden" name="accept" value="false" />
                  <button type="submit" class="decline-button">Decline</button>
                </form>
              </div>
            </li>
          `
            )
            .join("")}
        </ul>
      `
          : `
        <div class="empty-state">
          <div class="empty-state-icon">📬</div>
          <div class="empty-state-text">No pending invites</div>
        </div>
      `
      }
    </div>
  </div>
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

router.get("/user/:userId/deleted", urlAuth, async (req, res) => {
  try {
    const { userId } = req.params;

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

    const deleted = await getDeletedBranchesForUser(userId);

    // ---------- JSON MODE ----------
    if (!wantHtml) {
      return res.json({
        userId,
        deleted,
      });
    }

    // ---------- HTML MODE ----------
    const user = await User.findById(userId).lean();
    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;
    const deletedItems = await Promise.all(
      deleted.map(async ({ _id, name }) => {
        return `
<li style="margin-bottom:14px; padding:12px; background:white; border-radius:8px; border:1px solid #ddd;">
  <div style="margin-bottom:6px;">
    <a href="/api/root/${_id}${tokenQS}">
      <strong>${name || "Untitled"}</strong>
    </a>
    <div style="font-size:12px; opacity:0.6;">${_id}</div>
  </div>

  <!-- Revive as root -->
  <form
    method="POST"
    action="/api/user/${userId}/deleted/${_id}/reviveAsRoot?token=${token}&html"
    style="margin-bottom:6px;"
  >
    <button type="submit">Revive as Root</button>
  </form>

  <!-- Revive into existing branch -->
  <form
    method="POST"
    action="/api/user/${userId}/deleted/${_id}/revive?token=${token}&html"
    style="display:flex; gap:6px; align-items:center;"
  >
    <input
      type="text"
      name="targetParentId"
      placeholder="Target parent node ID"
      required
      style="padding:6px 8px;font-size:13px;border-radius:6px;border:1px solid #ccc;width:220px;"
    />

    <button type="submit">Revive into Branch</button>
  </form>
</li>
`;
      })
    );

    const deletedHtml = deletedItems.length
      ? `<ul>${deletedItems.join("")}</ul>`
      : `<p><em>No deleted branches</em></p>`;

    // Replace the HTML return in your /user/:userId/deleted route with this:

    return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${user.username} — Deleted Branches</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
    }

    /* Back Navigation */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      color: #667eea;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .back-link:hover {
      background: white;
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    /* Header Section */
    .header {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .header h1 {
      font-size: 28px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 16px;
      line-height: 1.3;
    }

    .header h1 a {
      color: #667eea;
      text-decoration: none;
      transition: color 0.2s;
    }

    .header h1 a:hover {
      color: #764ba2;
      text-decoration: underline;
    }

    /* Navigation Links */
    .nav-links {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
    }

    .nav-links a {
      padding: 8px 16px;
      background: #f8f9fa;
      border-radius: 8px;
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      border: 1px solid transparent;
    }

    .nav-links a:hover {
      background: white;
      border-color: #667eea;
      transform: translateY(-2px);
      box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
    }

    /* Deleted Items List */
    .deleted-list {
      list-style: none;
    }

    .deleted-card {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 16px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
      transition: all 0.2s;
      border-left: 4px solid #c62828;
    }

    .deleted-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
    }

    .deleted-info {
      margin-bottom: 16px;
    }

    .deleted-name {
      font-size: 18px;
      font-weight: 700;
      margin-bottom: 6px;
    }

    .deleted-name a {
      color: #1a1a1a;
      text-decoration: none;
      transition: color 0.2s;
    }

    .deleted-name a:hover {
      color: #667eea;
    }

    .deleted-id {
      font-size: 13px;
      color: #888;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    }

    /* Revival Forms */
    .revival-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding-top: 16px;
      border-top: 1px solid #e9ecef;
    }

    .revive-as-root-form button {
      padding: 10px 20px;
      border-radius: 8px;
      border: none;
      background: linear-gradient(135deg, #4caf50 0%, #66bb6a 100%);
      color: white;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      font-family: inherit;
      box-shadow: 0 4px 15px rgba(76, 175, 80, 0.3);
      width: 100%;
    }

    .revive-as-root-form button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(76, 175, 80, 0.4);
    }

    .revive-into-branch-form {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .revive-into-branch-form input[type="text"] {
      flex: 1;
      min-width: 200px;
      padding: 10px 14px;
      font-size: 14px;
      border-radius: 8px;
      border: 1px solid #d0d0d0;
      background: white;
      font-family: inherit;
      transition: all 0.2s;
    }

    .revive-into-branch-form input[type="text"]:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    .revive-into-branch-form button {
      padding: 10px 20px;
      font-size: 14px;
      font-weight: 600;
      border-radius: 8px;
      border: none;
      background: #667eea;
      color: white;
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
      white-space: nowrap;
    }

    .revive-into-branch-form button:hover {
      background: #5856d6;
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
    }

    /* Empty State */
    .empty-state {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 60px 40px;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .empty-state-icon {
      font-size: 64px;
      margin-bottom: 16px;
    }

    .empty-state-text {
      font-size: 18px;
      color: #666;
      margin-bottom: 8px;
    }

    .empty-state-subtext {
      font-size: 14px;
      color: #999;
    }

    /* Responsive Design */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .header {
        padding: 20px;
      }

      .header h1 {
        font-size: 24px;
      }

      .nav-links {
        flex-direction: column;
        gap: 8px;
      }

      .nav-links a {
        text-align: center;
      }

      .deleted-card {
        padding: 16px;
      }

      .deleted-name {
        font-size: 16px;
      }

      .revive-as-root-form button {
        width: 100%;
      }

      .revive-into-branch-form {
        flex-direction: column;
      }

      .revive-into-branch-form input[type="text"] {
        width: 100%;
        min-width: 0;
      }

      .revive-into-branch-form button {
        width: 100%;
      }

      .back-nav {
        flex-direction: column;
      }

      .back-link {
        justify-content: center;
      }

      .empty-state {
        padding: 40px 24px;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 700px;
      }
    }
        .header-subtitle {
    font-size: 14px;
    color: #888;
    margin-bottom: 16px;
  }
  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="/api/user/${userId}${tokenQS}" class="back-link">
        ← Back to Profile
      </a>
    </div>

    <!-- Header Section -->
    <div class="header">
      <h1>
        Deleted Branches for
        <a href="/api/user/${userId}${tokenQS}">${user.username}</a>
      </h1>
<div class="header-subtitle">
  Recover deleted trees and branches as new trees or merge them into existing ones.
</div>


      <!-- Navigation Links -->
      <div class="nav-links">
        <a href="/api/user/${userId}/raw-ideas${tokenQS}">Raw Ideas</a>
                <a href="/api/user/${userId}/notes${tokenQS}">Notes</a>

        <a href="/api/user/${userId}/invites${tokenQS}">Invites</a>
        <a href="/api/user/${userId}/tags${tokenQS}">Mail</a>
        <a href="/api/user/${userId}/contributions${tokenQS}">Contributions</a>
      </div>
    </div>

    <!-- Deleted Items List -->
    ${
      deleted.length > 0
        ? `
    <ul class="deleted-list">
      ${deleted
        .map(
          ({ _id, name }) => `
        <li class="deleted-card">
          <div class="deleted-info">
            <div class="deleted-name">
              <a href="/api/root/${_id}${tokenQS}">
                ${name || "Untitled"}
              </a>
            </div>
            <div class="deleted-id">${_id}</div>
          </div>

          <div class="revival-section">
            <!-- Revive as Root -->
            <form
              method="POST"
              action="/api/user/${userId}/deleted/${_id}/reviveAsRoot?token=${token}&html"
              class="revive-as-root-form"
            >
              <button type="submit">Revive as Root</button>
            </form>

            <!-- Revive into Branch -->
            <form
              method="POST"
              action="/api/user/${userId}/deleted/${_id}/revive?token=${token}&html"
              class="revive-into-branch-form"
            >
              <input
                type="text"
                name="targetParentId"
                placeholder="Target parent node ID"
                required
              />
              <button type="submit">Revive into Branch</button>
            </form>
          </div>
        </li>
      `
        )
        .join("")}
    </ul>
    `
        : `
    <div class="empty-state">
      <div class="empty-state-icon">🗑️</div>
      <div class="empty-state-text">No deleted branches</div>
      <div class="empty-state-subtext">
        Deleted branches will appear here and can be revived
      </div>
    </div>
    `
    }
  </div>
</body>
</html>
`);
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
          `/api/root/${nodeId}?token=${req.query.token ?? ""}&html`
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
  }
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
          `/api/root/${nodeId}?token=${req.query.token ?? ""}&html`
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
  }
);

router.post("/user/:userId/api-keys", authenticate, async (req, res) => {
  if (req.userId.toString() !== req.params.userId.toString()) {
    return res.status(403).json({ message: "Not authorized" });
  }

  return createApiKey(req, res);
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
    if (!wantHtml) {
      return res.json(
        apiKeys.map((k) => ({
          id: k._id,
          name: k.name,
          createdAt: k.createdAt,
          lastUsedAt: k.lastUsedAt,
          usageCount: k.usageCount,
          revoked: k.revoked,
        }))
      );
    }

    // ---------- HTML MODE ----------
    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;

    return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${user.username} — API Keys</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
    }

    .back-link {
      display: inline-block;
      margin-bottom: 16px;
      padding: 10px 16px;
      background: white;
      border-radius: 10px;
      color: #667eea;
      font-weight: 600;
      text-decoration: none;
    }

    .header {
      background: white;
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.1);
    }

    .header h1 {
      margin-bottom: 8px;
    }

    .header-subtitle {
      font-size: 14px;
      color: #888;
      margin-bottom: 16px;
    }

    .nav-links {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    .nav-links a {
      padding: 8px 14px;
      background: #f5f6fa;
      border-radius: 8px;
      color: #667eea;
      font-weight: 600;
      text-decoration: none;
    }

    .card {
      background: white;
      border-radius: 14px;
      padding: 20px;
      margin-bottom: 16px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.08);
    }

    .card h3 {
      margin-bottom: 6px;
    }

    .meta {
      font-size: 13px;
      color: #666;
      margin-bottom: 8px;
    }

    .badge {
      display: inline-block;
      padding: 4px 10px;
      font-size: 12px;
      border-radius: 999px;
      font-weight: 600;
    }

    .badge.active {
      background: #e8f5e9;
      color: #2e7d32;
    }

    .badge.revoked {
      background: #ffebee;
      color: #c62828;
    }

    .actions {
      margin-top: 12px;
    }

    .actions button {
      background: #c62828;
      color: white;
      border: none;
      padding: 8px 14px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
    }

    .create-form {
      margin-bottom: 24px;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .create-form input {
      padding: 10px 14px;
      border-radius: 8px;
      border: 1px solid #ccc;
      flex: 1;
      min-width: 200px;
    }

    .create-form button {
      padding: 10px 18px;
      border-radius: 8px;
      border: none;
      background: #667eea;
      color: white;
      font-weight: 700;
      cursor: pointer;
    }

    .empty {
      background: white;
      border-radius: 16px;
      padding: 48px;
      text-align: center;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="container">
    <a class="back-link" href="/api/user/${
      req.userId
    }${tokenQS}">← Back to Profile</a>

    <div class="header">
      <h1>API Keys</h1>
      <div class="header-subtitle">
        Manage programmatic access to your account
      </div>

      <div class="nav-links">
        <a href="/api/user/${req.userId}/raw-ideas${tokenQS}">Raw Ideas</a>
        <a href="/api/user/${req.userId}/notes${tokenQS}">Notes</a>
        <a href="/api/user/${req.userId}/invites${tokenQS}">Invites</a>
        <a href="/api/user/${
          req.userId
        }/contributions${tokenQS}">Contributions</a>
      </div>
    </div>

    <!-- Create API Key -->
    <div class="card">
      <form class="create-form" method="POST" action="/api/user/${
        req.userId
      }/api-keys?token=${token}&html">
        <input type="text" name="name" placeholder="API key name (optional)" />
        <button type="submit">＋ Create New API Key</button>
      </form>
      <div class="meta">
        You will only see the key once after creation.
      </div>
    </div>

    <!-- API Keys List -->
    ${
      apiKeys.length > 0
        ? apiKeys
            .map(
              (k) => `
      <div class="card">
        <h3>${k.name}</h3>
        <div class="meta">Created: ${new Date(
          k.createdAt
        ).toLocaleString()}</div>
        <div class="meta">Usage count: ${k.usageCount}</div>
        <div class="meta">
          Status:
          <span class="badge ${k.revoked ? "revoked" : "active"}">
            ${k.revoked ? "Revoked" : "Active"}
          </span>
        </div>

        ${
          !k.revoked
            ? `
        <div class="actions">
         <button
  class="revoke-button"
  data-key-id="${k._id}"
>
  Revoke
</button>

        </div>
        `
            : ""
        }
      </div>
      `
            )
            .join("")
        : `
      <div class="empty">
        No API keys yet. Create one above to get started.
      </div>
      `
    }
  </div>
  <script>
document.addEventListener("click", async (e) => {
  if (!e.target.classList.contains("revoke-button")) return;

  const keyId = e.target.dataset.keyId;

  if (!confirm("Revoke this API key? This cannot be undone.")) return;

  const token =
    new URLSearchParams(window.location.search).get("token") || "";
  const qs = token ? "?token=" + encodeURIComponent(token) : "";

  try {
    const res = await fetch(
  "/api/user/${req.userId}/api-keys/" + keyId + qs,
  { method: "DELETE" }
);


    const data = await res.json();
    if (!data.message) throw new Error("Revoke failed");

    location.reload();
  } catch (err) {
    alert("Failed to revoke API key");
  }
});
</script>

</body>
</html>
`);
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
  }
);

export default router;
