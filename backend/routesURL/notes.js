import express from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import mime from "mime-types";

import {
  createNote as coreCreateNote,
  getNotes as coreGetNotes,
  deleteNoteAndFile as coreDeleteNoteAndFile,
  getBook as coreGetBook,
} from "../core/notes.js";

import urlAuth from "../middleware/urlAuth.js";
import getNodeName from "./helpers/getNameById.js";
import authenticate from "../middleware/authenticate.js";

const router = express.Router();

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

function renderMedia(fileUrl, mimeType) {
  // ---------- IMAGES ----------
  if (mimeType.startsWith("image/")) {
    return `
      <img
        data-src="${fileUrl}"
        loading="lazy"
        style="max-width:100%;"
        class="lazy-media"
        alt=""
      />
    `;
  }

  // ---------- VIDEO ----------
  if (mimeType.startsWith("video/")) {
    return `
      <video
        controls
        preload="none"
        data-src="${fileUrl}"
        class="lazy-media"
        style="max-width:100%;"
      ></video>
    `;
  }

  // ---------- AUDIO ----------
  if (mimeType.startsWith("audio/")) {
    return `
      <audio
        controls
        preload="none"
        data-src="${fileUrl}"
        class="lazy-media"
      ></audio>
    `;
  }

  // ---------- PDF ----------
  if (mimeType === "application/pdf") {
    return `
      <iframe
        data-src="${fileUrl}"
        loading="lazy"
        class="lazy-media"
        style="width:100%; height:90vh; border:none;"
      ></iframe>
    `;
  }

  return ``;
}
function renderMediaImmediate(fileUrl, mimeType) {
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
      <iframe src="${fileUrl}" style="width:100%; height:90vh; border:none;"></iframe>
    `;
  }

  return ``;
}
function renderBookNode(node, depth, req, version) {
  const level = Math.min(depth, 5);
  const H = `h${level}`;
  const token = req.query.token ?? "";

  let html = `
    <section class="book-section depth-${depth}">
      <${H}>${node.nodeName ?? node.nodeId}</${H}>
  `;

  for (const note of node.notes) {
    const noteUrl = `/api/${node.nodeId}/${note.version}/notes/${note.noteId}?token=${token}&html`;

    if (note.type === "text") {
      html += `
        <div class="note-content">
          <a href="${noteUrl}" class="note-link">${note.content}</a>
        </div>
      `;
    }

    if (note.type === "file") {
      const fileUrl = `/api/uploads/${note.content}${
        token ? `?token=${token}` : ""
      }`;
      const mimeType = mime.lookup(note.content) || "";

      html += `
        <div class="file-container">
          <a href="${noteUrl}" class="note-link file-link">${note.content}</a>
          ${renderMedia(fileUrl, mimeType)}
        </div>
      `;
    }
  }

  for (const child of node.children) {
    html += renderBookNode(child, depth + 1, req, version);
  }

  html += `</section>`;
  return html;
}
const parseBool = (v) => v === "true";
function normalizeStatusFilters(query) {
  const parse = (v) =>
    v === "true" ? true : v === "false" ? false : undefined;

  const filters = {
    active: parse(query.active),
    trimmed: parse(query.trimmed),
    completed: parse(query.completed),
  };

  const hasAny = Object.values(filters).some((v) => v !== undefined);

  // 👇 THIS IS KEY
  return hasAny ? filters : null;
}

router.get("/:nodeId/:version/notes/book", urlAuth, async (req, res) => {
  try {
    const { nodeId } = req.params;

    const options = {
      latestVersionOnly: parseBool(req.query.latestVersionOnly),
      lastNoteOnly: parseBool(req.query.lastNoteOnly),
      leafNotesOnly: parseBool(req.query.leafNotesOnly),
      filesOnly: parseBool(req.query.filesOnly),
      textOnly: parseBool(req.query.textOnly),
      statusFilters: normalizeStatusFilters(req.query),
    };

    const wantHtml = req.query.html !== undefined;

    const { book } = await coreGetBook({ nodeId, options });

    const hasContent =
      !!book && (book.notes?.length > 0 || book.children?.length > 0);
    const q = req.query;

    // default ON if missing
    const isStatusActive = q.active === undefined ? true : q.active === "true";

    const isStatusCompleted =
      q.completed === undefined ? true : q.completed === "true";

    // default OFF
    const isStatusTrimmed = q.trimmed === "true";
    // ---------- HTML MODE ----------
    // Replace the HTML return in your /:nodeId/:version/notes/book route with this:

    if (wantHtml) {
      const title = book?.nodeName ?? book?.nodeId ?? `Node ${nodeId}`;
      const content = hasContent
        ? renderBookNode(book, 1, req)
        : `
    <div class="empty-state">
      <div class="empty-state-icon">📖</div>
      <div class="empty-state-text">No content</div>
      <div class="empty-state-subtext">
        This node has no notes or child notes under the current filters.
      </div>
    </div>
  `;

      return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Book: ${title}</title>
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
      color: #1a1a1a;
    }

    /* Top Navigation Bar */
    .top-nav {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      padding: 16px 20px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .top-nav-content {
      max-width: 900px;
      margin: 0 auto;
    }

    .nav-buttons {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }

    .nav-left {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    /* Back Navigation */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .back-link, .nav-button {
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

    .back-link:hover, .nav-button:hover {
      background: white;
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    .page-title {
      font-size: 20px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 12px;
    }

    /* Filters */
    .filters {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .filter-button {
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 600;
      border-radius: 8px;
      border: 2px solid #e0e0e0;
      background: white;
      color: #666;
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
      white-space: nowrap;
    }

    .filter-button:hover {
      border-color: #667eea;
      background: #f8f9fa;
      transform: translateY(-1px);
    }

    .filter-button.active {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-color: #667eea;
      color: white;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
    }

    .filter-button.active:hover {
      background: linear-gradient(135deg, #5856d6 0%, #6a3d8e 100%);
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(102, 126, 234, 0.5);
    }

    /* Content Container */
    .content-wrapper {
      padding: 32px 20px;
    }

    .content {
      max-width: 900px;
      margin: 0 auto;
      background: rgba(255, 255, 255, 0.98);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 48px 64px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      font-family: "Charter", "Georgia", "Iowan Old Style", "Times New Roman", serif;
      line-height: 1.7;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    /* Book Section Hierarchy */
    .book-section {
      margin-bottom: 40px;
    }

    .book-section.depth-1 {
      margin-bottom: 56px;
      margin-left: 0;
    }

    .book-section.depth-2 {
      margin-bottom: 40px;
      margin-left: 16px;
    }

    .book-section.depth-3 {
      margin-bottom: 32px;
      margin-left: 32px;
    }

    .book-section.depth-4 {
      margin-bottom: 24px;
      margin-left: 48px;
    }

    .book-section.depth-5 {
      margin-bottom: 20px;
      margin-left: 64px;
    }

    /* Heading Hierarchy */
    h1, h2, h3, h4, h5 {
      font-weight: 700;
      line-height: 1.3;
      margin: 0 0 16px 0;
      color: #1a1a1a;
    }

    h1 {
      font-size: 36px;
      margin-top: 48px;
      margin-bottom: 24px;
      border-bottom: 2px solid #667eea;
      padding-bottom: 16px;
      color: #667eea;
    }

    .book-section.depth-1:first-child h1 {
      margin-top: 0;
    }

    h2 {
      font-size: 30px;
      margin-top: 40px;
      margin-bottom: 20px;
      border-bottom: 1px solid #e0e0e0;
      padding-bottom: 12px;
    }

    h3 {
      font-size: 24px;
      margin-top: 32px;
      margin-bottom: 16px;
    }

    h4 {
      font-size: 20px;
      margin-top: 24px;
      margin-bottom: 12px;
    }

    h5 {
      font-size: 18px;
      margin-top: 20px;
      margin-bottom: 10px;
    }

    /* Note Content */
    .note-content {
      margin: 16px 0 28px 0;
      padding: 0;
      font-size: 18px;
      line-height: 1.8;
      color: #2c2c2c;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    .note-link {
      color: inherit;
      text-decoration: none;
      white-space: pre-wrap;
      word-wrap: break-word;
      overflow-wrap: break-word;
      display: block;
      padding: 12px 16px;
      margin: -12px -16px;
      border-radius: 8px;
      transition: all 0.2s;
    }

    .note-link:hover {
      background-color: rgba(102, 126, 234, 0.08);
      transform: translateX(4px);
    }

    .note-link:active {
      background-color: rgba(102, 126, 234, 0.12);
    }

    /* File Containers */
    .file-container {
      margin: 24px 0;
      padding: 20px;
      background: #f8f9fa;
      border: 2px solid #e0e0e0;
      border-radius: 12px;
      transition: all 0.2s;
    }

    .file-container:hover {
      border-color: #667eea;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.1);
    }

    .file-container .note-link {
      display: inline-block;
      margin-bottom: 12px;
      color: #667eea;
      font-size: 16px;
      font-weight: 600;
      padding: 4px 8px;
      margin: -4px -8px 8px;
    }

    .file-container .note-link:hover {
      background-color: rgba(102, 126, 234, 0.1);
      text-decoration: underline;
    }

    /* Media Elements */
    img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      margin-top: 12px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    video, audio {
      max-width: 100%;
      margin-top: 12px;
      border-radius: 8px;
    }

    iframe {
      width: 100%;
      height: 600px;
      border: none;
      border-radius: 8px;
      margin-top: 12px;
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 80px 40px;
    }

    .empty-state-icon {
      font-size: 64px;
      margin-bottom: 16px;
    }

    .empty-state-text {
      font-size: 24px;
      color: #666;
      margin-bottom: 8px;
      font-weight: 600;
    }

    .empty-state-subtext {
      font-size: 16px;
      color: #999;
    }

    /* Responsive Design */
    @media (max-width: 1024px) {
      .content {
        padding: 40px 48px;
      }
    }

    @media (max-width: 768px) {
      .top-nav {
        padding: 12px 16px;
      }

      .nav-button {
        padding: 8px 12px;
        font-size: 13px;
      }

      .page-title {
        font-size: 18px;
      }

      .filter-button {
        padding: 6px 12px;
        font-size: 12px;
      }

      .content-wrapper {
        padding: 24px 16px;
      }

      .content {
        padding: 32px 24px;
      }

      h1 {
        font-size: 30px;
      }

      h2 {
        font-size: 26px;
      }

      h3 {
        font-size: 22px;
      }

      h4 {
        font-size: 19px;
      }

      h5 {
        font-size: 17px;
      }

      .note-content {
        font-size: 17px;
      }

      .book-section.depth-2 {
        margin-left: 8px;
      }

      .book-section.depth-3 {
        margin-left: 16px;
      }

      .book-section.depth-4 {
        margin-left: 24px;
      }

      .book-section.depth-5 {
        margin-left: 32px;
      }
    }

    @media (max-width: 480px) {
      .nav-buttons {
        flex-direction: column;
        align-items: stretch;
      }

      .nav-left {
        width: 100%;
        flex-direction: column;
      }

      .nav-button, .back-link {
        justify-content: center;
        width: 100%;
      }

      .content {
        padding: 24px 16px;
      }

      .book-section.depth-2,
      .book-section.depth-3,
      .book-section.depth-4,
      .book-section.depth-5 {
        margin-left: 0;
      }
    }
  </style>
</head>
<body>
  <!-- Top Navigation -->
  <div class="top-nav">
    <div class="top-nav-content">
      <div class="nav-buttons">
        <div class="nav-left">
          <a href="/api/root/${nodeId}/${req.params.version}?token=${
        req.query.token ?? ""
      }&html" class="nav-button">
            ← Back to Tree
          </a>
          <a href="/api/${nodeId}/${req.params.version}?token=${
        req.query.token ?? ""
      }&html" class="nav-button">
            Back to Version
          </a>
        </div>
      </div>

      <div class="page-title">Book: ${title}</div>

      <!-- Filters -->
      <div class="filters">
        <button onclick="toggleFlag('latestVersionOnly')" class="filter-button ${
          options.latestVersionOnly ? "active" : ""
        }">
          Latest Versions Only
        </button>
        <button onclick="toggleFlag('lastNoteOnly')" class="filter-button ${
          options.lastNoteOnly ? "active" : ""
        }">
          Most Recent Note
        </button>
        <button onclick="toggleFlag('leafNotesOnly')" class="filter-button ${
          options.leafNotesOnly ? "active" : ""
        }">
          Leaf Details Only
        </button>
        <button onclick="toggleFlag('filesOnly')" class="filter-button ${
          options.filesOnly ? "active" : ""
        }">
          Files Only
        </button>
        <button onclick="toggleFlag('textOnly')" class="filter-button ${
          options.textOnly ? "active" : ""
        }">
          Text Only
        </button>
        <button onclick="toggleStatus('active')" class="filter-button ${
          isStatusActive ? "active" : ""
        }">
          Active
        </button>
        <button onclick="toggleStatus('completed')" class="filter-button ${
          isStatusCompleted ? "active" : ""
        }">
          Completed
        </button>
        <button onclick="toggleStatus('trimmed')" class="filter-button ${
          isStatusTrimmed ? "active" : ""
        }">
          Trimmed
        </button>
      </div>
    </div>
  </div>

  <!-- Content -->
  <div class="content-wrapper">
    <div class="content">
      ${content}
    </div>
  </div>

  <!-- Lazy Media Loader -->
  <script>
    const lazyObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;

          const el = entry.target;
          const src = el.dataset.src;

          if (src) {
            el.src = src;
            el.removeAttribute("data-src");
          }

          observer.unobserve(el);
        });
      },
      { rootMargin: "200px" }
    );

    document
      .querySelectorAll(".lazy-media[data-src]")
      .forEach(el => lazyObserver.observe(el));
  </script>

  <script>
    function toggleFlag(flag) {
      const url = new URL(window.location.href);

      if (url.searchParams.has(flag)) {
        url.searchParams.delete(flag);
      } else {
        url.searchParams.set(flag, "true");
      }

      url.searchParams.set("html", "true");
      window.location.href = url.toString();
    }

    function toggleStatus(flag) {
      const url = new URL(window.location.href);
      const params = url.searchParams;

      const defaults = {
        active: true,
        completed: true,
        trimmed: false,
      };

      const current = params.has(flag)
        ? params.get(flag) === "true"
        : defaults[flag];

      const next = !current;

      if (next === defaults[flag]) {
        params.delete(flag);
      } else {
        params.set(flag, String(next));
      }

      params.set("html", "true");
      window.location.href = url.toString();
    }
  </script>
</body>
</html>
  `);
    }

    return res.json({
      success: true,
      book,
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message,
    });
  }
});
/* ------------------------------------------------------------------
   GET /:nodeId/:version/notes 
   - JSON (default)
   - HTML (when ?html is used)
------------------------------------------------------------------- */
router.get("/:nodeId/:version/notes", urlAuth, async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const rawLimit = req.query.limit;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    const limit = rawLimit !== undefined ? Number(rawLimit) : undefined;

    if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
      return res.status(400).json({
        success: false,
        error: "Invalid limit: must be a positive number",
      });
    }

    const result = await coreGetNotes({
      nodeId,
      version: Number(version),
      limit,
      startDate,
      endDate,
    });

    const notes = [...result.notes].reverse().map((n) => ({
      ...n,
      content:
        n.contentType === "file" ? `/api/uploads/${n.content}` : n.content,
    }));

    // ---------- OPTIONAL HTML MODE ----------
    if (req.query.html !== undefined) {
      const base = `/api/${nodeId}/${version}`;

      const nodeName = await getNodeName(nodeId);

      let html = `
  <html>
  <head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <title>Notes for ${nodeId} version ${version}</title>
    <style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    padding: 0;
    margin: 0;
    height: 100vh;
    display: flex;
    flex-direction: column;
    background: #f5f6f7;
  }

 .header {
  padding: 20px;
  border-bottom: 1px solid #ddd;
  background: white;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

  .header h1 {
    margin: 0;
  }

  .header a {
    color: #5865f2;
    text-decoration: none;
  }

  .header a:hover {
    text-decoration: underline;
  }

  .notes-container {
    padding: 20px;
    overflow-y: auto;
    flex-grow: 1;
  }

  ul {
    padding-left: 0;
    list-style: none;
    margin: 0;
  }

  li {
    margin-bottom: 12px;
    padding: 12px;
    background: white;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
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
    margin-top: 4px;
  }

  .reflection {
    background: #f3f3f3;
  }

  .file-note {
    background: #eef7ff;
  }

  .input-bar {
    position: sticky;
    bottom: 0;
    background: white;
    padding: 16px;
    border-top: 1px solid #ddd;
    flex-shrink: 0;
  }

  .input-bar form {
    max-width: 100%;
  }

  textarea {
    width: 100%;
    padding: 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-family: inherit;
    font-size: 16px;
    resize: vertical;
    box-sizing: border-box;
  }

  input[type="file"] {
    font-size: 14px;
    max-width: 200px;
  }

  .submit-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    margin-top: 12px;
  }

  .submit-row > div {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
  }

  button {
    padding: 10px 20px;
    background: #5865f2;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
    flex-shrink: 0;
    white-space: nowrap;
  }

  button:hover {
    background: #4752c4;
  }

  @media (max-width: 600px) {
    .input-bar {
      padding: 16px;
    }

    textarea {
      font-size: 17px;
      min-height: 80px;
    }

    button {
      padding: 12px 24px;
      font-size: 17px;
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
    li a {
      color: #7289da;
    }

    li {
      background: #36393f;
      border: 1px solid #3a3c40;
    }

    .reflection {
      background: #2f3136;
    }

    .file-note {
      background: #2d3e50;
    }

    .meta {
      color: #b9bbbe;
    }

    .input-bar {
      background: #36393f;
      border-top-color: #3a3c40;
    }

    textarea {
      background: #40444b;
      color: #e3e5e8;
      border-color: #3a3c40;
    }

    button {
      background: #7289da;
    }

    button:hover {
      background: #5865f2;
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
    <h1 style="margin:0; flex-grow:1;">
      <a href="${base}?token=${
        req.query.token ?? ""
      }&html">${nodeName} v${version}</a>
      Notes
    </h1>
    <a href="/api/${nodeId}/${version}/notes/book?token=${
        req.query.token ?? ""
      }&html" class="book-button">
      Book View
    </a>
  </div>

  <div class="notes-container">
    <ul>
  `;

      for (const n of notes) {
        const preview =
          n.contentType === "text"
            ? n.content.length > 169
              ? n.content.substring(0, 160) + "..."
              : n.content
            : `${n.content.split("/").pop()}`;

        const userLabel = n.userId
          ? `<a href="/api/user/${n.userId}?token=${
              req.query.token ?? ""
            }&html">
          ${n.username ?? n.userId}
        </a>`
          : n.username ?? "Unknown user";

        html += `
<li
  class="
    note-item
    ${n.isReflection ? "reflection" : ""}
    ${n.contentType === "file" ? "file-note" : ""}
  "
  data-note-id="${n._id}"
  data-node-id="${n.nodeId}"
  data-version="${n.version}"
>
  <button class="delete-note" title="Delete note">✕</button>

  <div>
    <strong>${userLabel}:</strong>
    <a href="${base}/notes/${n._id}?token=${req.query.token ?? ""}&html">
      ${preview}
    </a>
  </div>

  <div class="meta">
    ${new Date(n.createdAt).toLocaleString()}<br />
    <a href="${base}?token=${req.query.token ?? ""}&html">
      ${nodeName} v${n.version}
    </a>
  </div>
</li>
`;
      }

      html += `
    </ul>
  </div>

  <div class="input-bar">
  <form
    method="POST"
    action="/api/${nodeId}/${version}/notes?token=${req.query.token ?? ""}&html"
    enctype="multipart/form-data"
  >
    <textarea
      name="content"
      rows="4"
      placeholder="Write a note or upload a file..."
    ></textarea>

    <div class="submit-row">
      <div>
        <label style="margin-right: 12px;">
          <input type="checkbox" name="isReflection" value="true" />
          Is Reflection
        </label>
        <input type="file" name="file" />
      </div>
      <button type="submit">Create</button>
    </div>
  </form>
</div>

  <script>
    // Scroll notes container to bottom automatically
    const container = document.querySelector('.notes-container');
    container.scrollTop = container.scrollHeight;
  </script>
  <script>
    const textarea = document.querySelector('textarea');
    const form = textarea.closest('form');

    textarea.addEventListener('keydown', (e) => {
      // Enter without Shift = submit
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        form.submit();
      }
    });
  </script>
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
    if (!data.success) throw new Error(data.error || "Delete failed");

    li.remove();
  } catch (err) {
    alert("Delete failed");
  }
});
</script>



  </body>
  </html>`;

      // Replace the HTML return in your /:nodeId/:version/notes route with this:

      // Check if we have the current user's ID (from cookie/session)
      const currentUserId = req.userId ? req.userId.toString() : null;

      return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${nodeName} — Notes</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }


    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      height: 100vh;
      display: flex;
      flex-direction: column;
      color: #1a1a1a;
      overflow: hidden;
    }

    /* Top Navigation Bar */
    .top-nav {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      padding: 16px 20px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
      flex-shrink: 0;
    }

    .top-nav-content {
      max-width: 900px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .nav-left {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .nav-button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: #f8f9fa;
      color: #667eea;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      border: 1px solid transparent;
      white-space: nowrap;
    }

    .nav-button:hover {
      background: white;
      border-color: #667eea;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
    }

    .book-button {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
    }

    .book-button:hover {
      background: linear-gradient(135deg, #5856d6 0%, #6a3d8e 100%);
      border-color: transparent;
    }

    /* Page Title */
    .page-title {
      width: 100%;
      margin-top: 12px;
      font-size: 18px;
      font-weight: 700;
      color: #1a1a1a;
    }

    .page-title a {
      color: #667eea;
      text-decoration: none;
      transition: color 0.2s;
    }

    .page-title a:hover {
      color: #764ba2;
      text-decoration: underline;
    }

    /* Notes Container */
    .notes-container {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
      background: rgba(0, 0, 0, 0.02);
    }

    .notes-wrapper {
      max-width: 900px;
      margin: 0 auto;
      width: 100%;
    }

    .notes-list {
      list-style: none;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    /* Message Bubble Styles */
    .note-item {
      display: flex;
      animation: slideIn 0.3s ease-out;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    /* Self messages (right aligned) */
    .note-item.self {
      flex-direction: row-reverse;
    }

    .note-bubble {
      position: relative;
      max-width: 70%;
      padding: 12px 16px;
      border-radius: 18px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    /* Self bubble (purple gradient) */
    .note-item.self .note-bubble {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-bottom-right-radius: 4px;
    }

    /* Other user bubble (white) */
    .note-item.other .note-bubble {
      background: white;
      color: #1a1a1a;
      border-bottom-left-radius: 4px;
    }

    /* Reflection style */
    .note-item.reflection .note-bubble {
      background: #fff9e6;
      border: 2px solid #ffd54f;
      color: #1a1a1a;
    }

    .note-item.self.reflection .note-bubble {
      background: linear-gradient(135deg, #ffd54f 0%, #ffb300 100%);
      color: #1a1a1a;
      border: none;
    }

    /* File badge */
    .file-badge {
      display: inline-block;
      padding: 4px 10px;
      background: rgba(0, 0, 0, 0.1);
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .note-content {
      font-size: 15px;
      line-height: 1.5;
      margin-bottom: 6px;
    }

    .note-content a {
      color: inherit;
      text-decoration: none;
      opacity: 0.9;
    }

    .note-content a:hover {
      opacity: 1;
    }

    .note-meta {
      font-size: 11px;
      opacity: 0.7;
      margin-top: 6px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }

    .note-author {
      font-weight: 600;
      margin-bottom: 4px;
      font-size: 13px;
    }

    .note-author a {
      color: inherit;
      text-decoration: none;
      opacity: 0.9;
    }

    .note-author a:hover {
      opacity: 1;
      text-decoration: underline;
    }

    /* Self messages don't show author */
    .note-item.self .note-author {
      display: none;
    }

    .delete-button {
      background: none;
      border: none;
      cursor: pointer;
      padding: 4px;
      opacity: 0.5;
      transition: all 0.2s;
      font-size: 14px;
    }

    .delete-button:hover {
      opacity: 1;
      transform: scale(1.2);
    }

    .note-item.self .delete-button {
      color: white;
    }

    .note-item.other .delete-button {
      color: #999;
    }

    .note-item.other .delete-button:hover {
      color: #c62828;
    }

    /* Input Bar */
    .input-bar {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      padding: 20px;
      border-top: 1px solid rgba(0, 0, 0, 0.1);
      box-shadow: 
        0 -2px 12px rgba(0, 0, 0, 0.05),
        0 -4px 20px rgba(102, 126, 234, 0);
      flex-shrink: 0;
      transition: box-shadow 0.3s ease;
    }

    .input-bar:focus-within {
      box-shadow: 
        0 -2px 12px rgba(0, 0, 0, 0.05),
        0 -8px 30px rgba(102, 126, 234, 0.4);
    }

    .input-form {
      max-width: 900px;
      margin: 0 auto;
    }

    textarea {
      width: 100%;
      padding: 14px 16px;
      border: 2px solid #e0e0e0;
      border-radius: 12px;
      font-family: inherit;
      font-size: 15px;
      line-height: 1.5;
      resize: none;
      transition: all 0.2s;
      background: white;
      height: 56px;
      max-height: 120px;
      overflow-y: hidden;
    }

    textarea:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    .input-controls {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-top: 12px;
      flex-wrap: wrap;
    }

    .input-options {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }

    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      color: #666;
      cursor: pointer;
    }

    .checkbox-label input[type="checkbox"] {
      width: 18px;
      height: 18px;
      cursor: pointer;
    }

    input[type="file"] {
      font-size: 13px;
      color: #666;
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
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
      white-space: nowrap;
    }

    .send-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(102, 126, 234, 0.4);
    }

    /* Responsive Design */
    @media (max-width: 768px) {
      .top-nav {
        padding: 12px 16px;
      }

      .nav-button {
        padding: 8px 12px;
        font-size: 13px;
      }

      .page-title {
        font-size: 16px;
      }

      .notes-container {
        padding: 16px 12px;
      }

      .note-bubble {
        max-width: 85%;
        padding: 10px 14px;
      }

      .input-bar {
        padding: 16px;
      }

      .input-controls {
        flex-direction: column;
        align-items: stretch;
      }

      .input-options {
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
      }

      .send-button {
        width: 100%;
      }

      textarea {
        font-size: 16px;
        height: 60px;
      }
    }

    @media (max-width: 480px) {
      .nav-left {
        width: 100%;
      }

      .nav-button {
        flex: 1;
        justify-content: center;
      }
    }
  </style>
</head>
<body>
  <!-- Top Navigation -->
  <div class="top-nav">
    <div class="top-nav-content">
      <div class="nav-left">
        <a href="/api/root/${nodeId}?token=${
        req.query.token ?? ""
      }&html" class="nav-button">
          ← Back to Tree
        </a>
        <a href="${base}?token=${
        req.query.token ?? ""
      }&html" class="nav-button">
          Back to Version
        </a>
      </div>
      <a href="/api/${nodeId}/${version}/notes/book?token=${
        req.query.token ?? ""
      }&html" class="nav-button book-button">
        📖 Book View
      </a>
      <div class="page-title">
        Notes for <a href="${base}?token=${
        req.query.token ?? ""
      }&html">${nodeName} v${version}</a>
      </div>
    </div>
  </div>

  <!-- Notes Container -->
  <div class="notes-container">
    <div class="notes-wrapper">
      <ul class="notes-list">
      ${notes
        .map((n) => {
          const isSelf =
            currentUserId && n.userId && n.userId.toString() === currentUserId;
          const preview =
            n.contentType === "text"
              ? n.content.length > 169
                ? n.content.substring(0, 500) + "..."
                : n.content
              : n.content.split("/").pop();

          const userLabel = n.userId
            ? `<a href="/api/user/${n.userId}?token=${
                req.query.token ?? ""
              }&html">${n.username ?? n.userId}</a>`
            : n.username ?? "Unknown user";

          return `
          <li
            class="note-item ${isSelf ? "self" : "other"} ${
            n.isReflection ? "reflection" : ""
          }"
            data-note-id="${n._id}"
            data-node-id="${n.nodeId}"
            data-version="${n.version}"
          >
            <div class="note-bubble">
              ${
                n.contentType === "file"
                  ? '<div class="file-badge">📎 File</div>'
                  : ""
              }
              ${!isSelf ? `<div class="note-author">${userLabel}</div>` : ""}
              <div class="note-content">
                <a href="${base}/notes/${n._id}?token=${
            req.query.token ?? ""
          }&html">
                  ${preview}
                </a>
              </div>
              <div class="note-meta">
                <span>${new Date(n.createdAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}</span>
                <button class="delete-button" title="Delete note">✕</button>
              </div>
            </div>
          </li>
        `;
        })
        .join("")}
    </ul>
    </div>
  </div>

  <!-- Input Bar -->
  <div class="input-bar">
    <form
      method="POST"
      action="/api/${nodeId}/${version}/notes?token=${
        req.query.token ?? ""
      }&html"
      enctype="multipart/form-data"
      class="input-form"
    >
      <textarea
        name="content"
        rows="1"
        placeholder="Write a note..."
        id="noteTextarea"
      ></textarea>

      <div class="input-controls">
        <div class="input-options">
         
          <input type="file" name="file" />
        </div>
        <button type="submit" class="send-button">Send</button>
      </div>
    </form>
  </div>

  <script>
    // Auto-scroll to bottom on load
    const container = document.querySelector('.notes-container');
    container.scrollTop = container.scrollHeight;

    // Auto-resize textarea with smooth overflow handling
    const textarea = document.getElementById('noteTextarea');
    textarea.addEventListener('input', function() {
      this.style.height = 'auto';
      const newHeight = Math.min(this.scrollHeight, 120);
      this.style.height = newHeight + 'px';
      
      // Show scrollbar only when content exceeds max height
      if (this.scrollHeight > 120) {
        this.style.overflowY = 'auto';
      } else {
        this.style.overflowY = 'hidden';
      }
    });

    // Submit on Enter (without Shift)
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        textarea.closest('form').submit();
      }
    });

    // Delete note functionality
    document.addEventListener('click', async (e) => {
      if (!e.target.classList.contains('delete-button')) return;

      const noteItem = e.target.closest('.note-item');
      const noteId = noteItem.dataset.noteId;
      const nodeId = noteItem.dataset.nodeId;
      const version = noteItem.dataset.version;

      if (!confirm('Delete this note? This cannot be undone.')) return;

      const token = new URLSearchParams(window.location.search).get('token') || '';
      const qs = token ? '?token=' + encodeURIComponent(token) : '';

      try {
        const res = await fetch(
          \`/api/\${nodeId}/\${version}/notes/\${noteId}\${qs}\`,
          { method: 'DELETE' }
        );

        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Delete failed');

        // Fade out animation
        noteItem.style.opacity = '0';
        noteItem.style.transform = 'translateY(-10px)';
        setTimeout(() => noteItem.remove(), 300);
      } catch (err) {
        alert('Failed to delete: ' + (err.message || 'Unknown error'));
      }
    });
  </script>
</body>
</html>
`);
    }

    // ---------- NORMAL OLD JSON MODE ----------
    return res.json({ success: true, notes });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

/* ------------------------------------------------------------------
   POST /:nodeId/:version/notes
------------------------------------------------------------------- */
router.post(
  "/:nodeId/:version/notes",
  authenticate,
  upload.single("file"),

  async (req, res) => {
    try {
      const { nodeId, version } = req.params;

      const contentType = req.file ? "file" : "text";
      const isReflection = req.body.isReflection === "true";

      const result = await coreCreateNote({
        contentType,
        content: contentType === "file" ? req.file.filename : req.body.content,
        userId: req.userId,
        nodeId,
        version: Number(version),
        isReflection,
        file: req.file,
      });

      const wantHtml = "html" in req.query;

      if (wantHtml) {
        return res.redirect(
          `/api/${nodeId}/${version}/notes?token=${req.query.token ?? ""}&html`
        );
      }

      // otherwise JSON (for API clients)
      return res.json({ success: true, note: result.Note });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }
);
const allowedParams = ["token", "html", "error"];

function filterQuery(req) {
  return Object.entries(req.query)
    .filter(([key]) => allowedParams.includes(key))
    .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
    .join("&");
}
/* ------------------------------------------------------------------
   GET /:nodeId/:version/notes/:noteId
   - JSON (old behavior)
   - raw file download (old behavior)
   - HTML viewer (optional)
------------------------------------------------------------------- */
router.get("/:nodeId/:version/notes/:noteId", async (req, res) => {
  try {
    const { nodeId, version, noteId } = req.params;

    const queryString = filterQuery(req);
    const qs = queryString ? `?${queryString}` : "";

    // Check if token exists in query
    const hasToken = req.query.token !== undefined;

    const Note = (await import("../db/models/notes.js")).default;
    const note = await Note.findById(noteId)
      .populate("userId", "username")
      .lean();

    if (!note) return res.status(404).send("Note not found");

    const back = hasToken
      ? `/api/${nodeId}/${version}/notes${qs}`
      : "https://tree.tabors.site";
    const backText = hasToken ? "← Back to Notes" : "← Back to Home";
    const nodeUrl = `/api/${nodeId}${qs}`;

    const userLink = note.userId
      ? `<a href="/api/user/${note.userId._id}${qs}">
       ${note.userId.username ?? "Unknown user"}
     </a>`
      : note.username ?? "Unknown user";

    if (req.query.html !== undefined) {
      if (note.contentType === "text") {
        return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Note by ${note.userId?.username || "User"}</title>
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

    /* Note Card */
    .note-card {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      position: relative;
      overflow: hidden;
    }

    .note-card::before {
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

    /* Copy Button Bar */
    .copy-bar {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-bottom: 16px;
    }

    .copy-btn {
      background: rgba(102, 126, 234, 0.1);
      border: 1px solid rgba(102, 126, 234, 0.2);
      cursor: pointer;
      font-size: 20px;
      padding: 8px 12px;
      border-radius: 8px;
      transition: all 0.2s;
    }

    .copy-btn:hover {
      background: rgba(102, 126, 234, 0.2);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
    }

    .copy-btn:active {
      transform: translateY(0);
    }

    /* Note Content */
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
#copyUrlBtn {
    display: inline-flex;
      align-items: center;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      color: #667eea;
      text-decoration: none;
      border-radius: 10px;
     
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);}
    /* Responsive */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .note-card {
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
      <a href="${back}" class="back-link">${backText}</a>
              <button id="copyUrlBtn" class="copy-btn" title="Copy URL to share">🔗</button>

    </div>

    <!-- Note Card -->
    <div class="note-card">
      <div class="user-info">
        ${userLink}
      </div>

      <div class="copy-bar">
        <button id="copyNoteBtn" class="copy-btn" title="Copy note">📋</button>
      </div>

      <pre id="noteContent">${note.content}</pre>
    </div>
  </div>

  <script>
    const copyNoteBtn = document.getElementById("copyNoteBtn");
    const copyUrlBtn = document.getElementById("copyUrlBtn");
    const noteContent = document.getElementById("noteContent");

    copyNoteBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(noteContent.textContent).then(() => {
        copyNoteBtn.textContent = "✔️";
        setTimeout(() => (copyNoteBtn.textContent = "📋"), 900);
      });
    });

    copyUrlBtn.addEventListener("click", () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      if (!url.searchParams.has('html')) {
        url.searchParams.set('html', '');
      }
      navigator.clipboard.writeText(url.toString()).then(() => {
        copyUrlBtn.textContent = "✔️";
        setTimeout(() => (copyUrlBtn.textContent = "🔗"), 900);
      });
    });
  </script>
</body>
</html>
`);
      }

      const fileUrl = `/api/uploads/${note.content}`;
      const filePath = path.join(uploadsFolder, note.content);
      const mimeType = mime.lookup(filePath) || "application/octet-stream";
      const mediaHtml = renderMediaImmediate(fileUrl, mimeType);
      const fileName = path.basename(note.content);

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

 

    /* Action Buttons */
    .action-bar {
      display: flex;
      gap: 12px;
      margin-bottom: 24px;
      flex-wrap: wrap;
    }

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
      border: none;
      cursor: pointer;
    }

    .download:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
    }

    .download::before {
      content: '⬇️';
      font-size: 16px;
    }

    .copy-url-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px;
      background: rgba(102, 126, 234, 0.1);
      color: #667eea;
      border: 1px solid rgba(102, 126, 234, 0.2);
      border-radius: 10px;
      font-weight: 600;
      font-size: 15px;
      transition: all 0.2s;
      cursor: pointer;
    }

    .copy-url-btn:hover {
      background: rgba(102, 126, 234, 0.2);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
    }

    .copy-url-btn::before {
      content: '🔗';
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

      .action-bar {
        flex-direction: column;
      }

      .download,
      .copy-url-btn {
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
      <a href="${back}" class="back-link">${backText}</a>
    </div>

    <!-- File Card -->
    <div class="file-card">
      <div class="user-info">
        ${userLink}
      </div>

      <h1>${fileName}</h1>

      <div class="action-bar">
        <a class="download" href="${fileUrl}" download>
          Download
        </a>
        <button id="copyUrlBtn" class="copy-url-btn">
          Share
        </button>
      </div>

      <div class="media">
        ${mediaHtml}
      </div>
    </div>
  </div>

  <script>
    const copyUrlBtn = document.getElementById("copyUrlBtn");

    copyUrlBtn.addEventListener("click", () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      if (!url.searchParams.has('html')) {
        url.searchParams.set('html', '');
      }
      navigator.clipboard.writeText(url.toString()).then(() => {
        const originalText = copyUrlBtn.textContent;
        copyUrlBtn.textContent = "✔️ Copied!";
        setTimeout(() => (copyUrlBtn.textContent = originalText), 900);
      });
    });
  </script>
</body>
</html>
`);
    }

    // ---------- DATA BEHAVIOR (NO HTML) ----------
    if (note.contentType === "text") {
      return res.json({ text: note.content });
    }

    if (note.contentType === "file") {
      const filePath = path.join(uploadsFolder, note.content);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: "File not found" });
      }
      return res.sendFile(filePath);
    }

    res.status(400).json({ error: "Unknown note type" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete(
  "/:nodeId/:version/notes/:noteId",
  authenticate,
  async (req, res) => {
    try {
      const { noteId } = req.params;

      const result = await coreDeleteNoteAndFile({
        noteId,
        userId: req.userId,
      });

      res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }
);

export default router;
