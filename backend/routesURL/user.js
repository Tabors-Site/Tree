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

    // Replace the HTML return in your user route with this:

    // Replace the HTML return in your user route with this:

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
  </style>
</head>
<body>
  <div class="container">
    <!-- Header Section -->
    <div class="header">
      <h1>
        Raw Ideas for
        <a href="/api/user/${userId}${tokenQS}">${user.username}</a>
      </h1>

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
        <a href="/api/user/${userId}/tags${tokenQS}">Mail</a>
        <a href="/api/user/${userId}/contributions${tokenQS}">Contributions</a>
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

    return res.send(`
      <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Deleted Branches</title>
        <style>
          body {
            font-family: system-ui, sans-serif;
            padding: 20px;
            background: #fafafa;
          }
          ul {
            list-style: none;
            padding-left: 0;
          }
          li {
            margin-bottom: 10px;
          }
          a {
            color: #5865f2;
            text-decoration: none;
          }
          a:hover {
            text-decoration: underline;
          }
        </style>
      </head>
      <body>

        <h1>
          Deleted Branches for
          <a href="/api/user/${userId}${tokenQS}">
            ${user.username}
          </a>
        </h1>

        ${deletedHtml}

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

export default router;
