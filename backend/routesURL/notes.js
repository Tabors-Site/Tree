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
    if (wantHtml) {
      const title = book?.nodeName ?? book?.nodeId ?? `Node ${nodeId}`;
      const content = hasContent
        ? renderBookNode(book, 1, req)
        : `   
    <div style="
      max-width: 900px;
      margin: 64px auto;
      padding: 32px;
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 12px;
      text-align: center;
      color: #6b7280;
    ">
      <h2 style="margin-top:0;">No content</h2>
      <p>
        This node has no notes or child notes
        under the current filters.
      </p>
    </div>
  `;

      return res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>

  <style>
* {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: "Charter", "Georgia", "Iowan Old Style", "Times New Roman", serif;
      background: #fafafa;
      color: #1a1a1a;
      line-height: 1.6;
    }

    .header {
      padding: 16px 24px;
      background: white;
      border-bottom: 1px solid #e0e0e0;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    }

    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 12px;
    }

    .header h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 600;
      color: #2c2c2c;
    }

    .back-button {
      text-decoration: none;
      padding: 6px 12px;
      border-radius: 6px;
      background: #e5e7eb;
      color: #1138F7;
      font-size: 14px;
      font-weight: 500;
      white-space: nowrap;
      transition: background 0.15s ease;
    }

    .back-button:hover {
      background: #d1d5db;
    }

    .content {
      padding: 64px 48px 96px 48px;
      max-width: 900px;
      margin: 0 auto;
    }

    /* Book section styling - minimal indentation */
    .book-section {
      margin-bottom: 40px;
    }

    .book-section.depth-1 {
      margin-bottom: 56px;
      margin-left: 0;
      page-break-after: avoid;
    }

    .book-section.depth-2 {
      margin-bottom: 40px;
      margin-left: 8px;
    }

    .book-section.depth-3 {
      margin-bottom: 32px;
      margin-left: 16px;
    }

    .book-section.depth-4 {
      margin-bottom: 24px;
      margin-left: 24px;
    }

    .book-section.depth-5 {
      margin-bottom: 20px;
      margin-left: 32px;
    }

    /* Heading hierarchy */
    h1, h2, h3, h4, h5 {
      font-weight: 600;
      line-height: 1.3;
      margin: 0 0 16px 0;
      color: #1a1a1a;
    }

    h1 {
      font-size: 32px;
      margin-top: 48px;
      margin-bottom: 24px;
      border-bottom: 1px solid #e0e0e0;
      padding-bottom: 12px;
    }

    .book-section.depth-1:first-child h1 {
      margin-top: 0;
    }

    h2 {
      font-size: 26px;
      margin-top: 40px;
      margin-bottom: 20px;
      border-bottom: 1px solid #f0f0f0;
      padding-bottom: 8px;
    }

    h3 {
      font-size: 22px;
      margin-top: 32px;
      margin-bottom: 16px;
      font-weight: 700;
    }

    h4 {
      font-size: 19px;
      margin-top: 24px;
      margin-bottom: 12px;
      font-weight: 700;
    }

    h5 {
      font-size: 17px;
      margin-top: 20px;
      margin-bottom: 10px;
      font-weight: 700;
    }

    /* Note content with clickable links */
    .note-content {
      margin: 16px 0 28px 0;
      padding: 0;
      font-size: 18px;
      line-height: 1.75;
      color: #2c2c2c;
    }

    .note-link {
      color: inherit;
      text-decoration: none;
      white-space: pre-wrap;
      display: block;
      padding: 12px 16px;
      margin: -12px -16px;
      border-radius: 6px;
      transition: background-color 0.15s ease;
    }

    .note-link:hover {
      background-color: rgba(37, 99, 235, 0.06);
    }

    .note-link:active {
      background-color: rgba(37, 99, 235, 0.12);
    }

    /* File containers */
    .file-container {
      margin: 24px 0;
      padding: 16px;
      background: white;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      transition: border-color 0.15s ease;
    }

    .file-container:hover {
      border-color: #2563eb;
    }

    .file-container .note-link {
      display: inline-block;
      margin-bottom: 12px;
      color: #2563eb;
      font-size: 15px;
      font-weight: 500;
      padding: 4px 8px;
      margin: -4px -8px 8px;
    }

    .file-container .note-link:hover {
      background-color: rgba(37, 99, 235, 0.08);
      text-decoration: underline;
    }

    /* Media elements */
    img {
      max-width: 100%;
      height: auto;
      border-radius: 4px;
      margin-top: 8px;
    }

    video, audio {
      max-width: 100%;
      margin-top: 8px;
    }

    iframe {
      width: 100%;
      height: 600px;
      border: none;
      border-radius: 4px;
      margin-top: 8px;
    }

    /* Mobile responsiveness */
    @media (max-width: 768px) {
      .header {
        padding: 12px 16px;
      }

      .header-top {
        margin-bottom: 8px;
      }

      .header h1 {
        font-size: 16px;
      }

      .back-button {
        padding: 5px 10px;
        font-size: 13px;
      }

      .filters {
        margin-top: 0;
        gap: 4px;
      }

      .filters button {
        padding: 4px 8px;
        font-size: 12px;
        border-radius: 4px;
      }

      .content {
        padding: 40px 20px 64px 20px;
        max-width: 100%;
      }

      h1 {
        font-size: 28px;
      }

      h2 {
        font-size: 24px;
      }

      h3 {
        font-size: 20px;
      }

      h4 {
        font-size: 18px;
      }

      h5 {
        font-size: 16px;
      }

      .note-content {
        font-size: 17px;
      }

      /* Reduce indentation on mobile to prevent overflow */
      .book-section.depth-2 {
        margin-left: 4px;
      }

      .book-section.depth-3 {
        margin-left: 8px;
      }

      .book-section.depth-4 {
        margin-left: 12px;
      }

      .book-section.depth-5 {
        margin-left: 16px;
      }
    }

    /* Extra small devices */
    @media (max-width: 480px) {
      .header {
        padding: 10px 12px;
      }

      .header-top {
        margin-bottom: 6px;
      }

      .header h1 {
        font-size: 14px;
      }

      .back-button {
        padding: 4px 8px;
        font-size: 12px;
      }

      .filters button {
        padding: 3px 6px;
        font-size: 11px;
      }

      .content {
        padding: 32px 16px 48px 16px;
      }

      /* Minimal indentation on very small screens */
      .book-section.depth-2,
      .book-section.depth-3,
      .book-section.depth-4,
      .book-section.depth-5 {
        margin-left: 0;
      }
    }

    /* Dark mode */
    @media (prefers-color-scheme: dark) {
      body {
        background: #1a1a1a;
        color: #e0e0e0;
      }

      .header {
        background: #2c2c2c;
        border-bottom-color: #404040;
      }

      .header h1 {
        color: #f0f0f0;
      }

      h1, h2, h3, h4, h5 {
        color: #f0f0f0;
      }

      h1 {
        border-bottom-color: #e0e0e0;
      }

      .note-content {
        color: #d0d0d0;
      }

      .note-link:hover {
        background-color: rgba(96, 165, 250, 0.12);
      }

      .note-link:active {
        background-color: rgba(96, 165, 250, 0.18);
      }

      .file-container {
        background: #2c2c2c;
        border-color: #404040;
      }

      .file-container:hover {
        border-color: #60a5fa;
      }

      .file-container .note-link {
        color: #60a5fa;
      }

      .file-container .note-link:hover {
        background-color: rgba(96, 165, 250, 0.12);
      }
    }

    /* Print styles */
    @media print {
      body {
        background: white;
      }

      .header {
        position: static;
        box-shadow: none;
        border-bottom: 2px solid #000;
      }

      .content {
        padding: 24px 16px;
      }

      .book-section.depth-1 {
        page-break-before: always;
      }

      .book-section.depth-1:first-child {
        page-break-before: avoid;
      }

      h1, h2, h3, h4, h5 {
        page-break-after: avoid;
      }

      .note-link {
        color: inherit;
        padding: 0;
        margin: 0;
      }

      .note-link:hover {
        background-color: transparent;
      }
    }

    .filters {
      margin-top: 0;
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .filters button {
      padding: 6px 12px;
      font-size: 13px;
      font-weight: 500;
      border-radius: 6px;
      border: 1px solid #d0d5dd;
      background: #f3f4f6;
      color: #374151;
      cursor: pointer;
      transition: all 0.15s ease;
      white-space: nowrap;
    }

    .filters button:hover {
      background: #e5e7eb;
    }

    .filters button.active {
      background: #2563eb;
      border-color: #2563eb;
      color: white;
    }

    .filters button.active:hover {
      background: #1d4ed8;
    }

  </style>
</head>

<body>
 <div class="header">
  <div class="header-top">
    <h1>Book: ${title}</h1>
    <a href="/api/${nodeId}/${req.params.version}/notes?token=${
        req.query.token ?? ""
      }&html" class="back-button">
      Back to Notes
    </a>
  </div>

  

 <div class="filters">
    <button onclick="toggleFlag('latestVersionOnly')" class="${
      options.latestVersionOnly ? "active" : ""
    }">
      Latest Versions Only
    </button>

    <button onclick="toggleFlag('lastNoteOnly')" class="${
      options.lastNoteOnly ? "active" : ""
    }">
      Most recent note only
    </button>

    <button onclick="toggleFlag('leafNotesOnly')" class="${
      options.leafNotesOnly ? "active" : ""
    }">
      Leaf Details Only
    </button>

    <button onclick="toggleFlag('filesOnly')" class="${
      options.filesOnly ? "active" : ""
    }">
      Files
    </button>

    <button onclick="toggleFlag('textOnly')" class="${
      options.textOnly ? "active" : ""
    }">
      Text
    </button>
    <button onclick="toggleStatus('active')" class="${
      isStatusActive ? "active" : ""
    }">
  Active
</button>

<button onclick="toggleStatus('completed')" class="${
        isStatusCompleted ? "active" : ""
      }">
  Completed
</button>

<button onclick="toggleStatus('trimmed')" class="${
        isStatusTrimmed ? "active" : ""
      }">
  Trimmed
</button>

  </div>
</div>
</div>


  


  <div class="content">
    ${content}
  </div>
  
  <!-- Lazy media loader -->
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

    // always keep html mode
    url.searchParams.set("html", "true");

    window.location.href = url.toString();
  }
</script>
<script>
function toggleStatus(flag) {
  const url = new URL(window.location.href);
  const params = url.searchParams;

  const defaults = {
    active: true,
    completed: true,
    trimmed: false,
  };

  const current =
    params.has(flag)
      ? params.get(flag) === "true"
      : defaults[flag];

  const next = !current;

  // If next matches default → REMOVE from URL
  if (next === defaults[flag]) {
    params.delete(flag);
  } else {
    // Otherwise explicitly set
    params.set(flag, String(next));
  }

  // Always keep html mode
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
        n.contentType === "file"
          ? `${req.protocol}://${req.get("host")}/uploads/${n.content}`
          : n.content,
    }));

    // ---------- OPTIONAL HTML MODE ----------
    if (req.query.html !== undefined) {
      const base = `${req.protocol}://${req.get(
        "host"
      )}/api/${nodeId}/${version}`;

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

      return res.send(html);
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

/* ------------------------------------------------------------------
   GET /:nodeId/:version/notes/:noteId
   - JSON (old behavior)
   - raw file download (old behavior)
   - HTML viewer (optional)
------------------------------------------------------------------- */
router.get("/:nodeId/:version/notes/:noteId", async (req, res) => {
  try {
    const { nodeId, version, noteId } = req.params;

    const Note = (await import("../db/models/notes.js")).default;
    const note = await Note.findById(noteId)
      .populate("userId", "username")
      .lean();

    if (!note) return res.status(404).send("Note not found");

    const back = `${req.protocol}://${req.get(
      "host"
    )}/api/${nodeId}/${version}/notes?token=${req.query.token ?? ""}&html`;

    const nodeUrl = `${req.protocol}://${req.get("host")}/api/${nodeId}?token=${
      req.query.token ?? ""
    }&html`;

    const userLink = note.userId
      ? `<a href="/api/user/${note.userId._id}?token=${
          req.query.token ?? ""
        }&html">
           ${note.userId.username ?? note.userId}:
         </a>`
      : note.username ?? "Unknown user";

    if (req.query.html !== undefined) {
      if (note.contentType === "text") {
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
    box-sizing: border-box;
  }

  .user-info {
    margin-bottom: 4px;
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
    word-wrap: break-word;
    box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    border: 1px solid #ddd;
  }

  .copy-bar {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 8px;
  }

  #copyNoteBtn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 22px;
    opacity: 0.6;
    padding: 4px;
    border-radius: 6px;
  }

  #copyNoteBtn:hover {
    opacity: 1;
    background: rgba(0,0,0,0.05);
  }

  @media (max-width: 600px) {
    pre {
      font-size: 17px;
      padding: 16px;
      border-radius: 12px;
    }
  }
    @media (prefers-color-scheme: dark) {
    body {
      background: #000000ff;
      color: #000000ff;
    }

    .top-links a {
      color: #7289da;
    }

    .download {
      background: #7289da;
    }

    .download:hover {
      background: #5865f2;
    }
      
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

.top-links a:hover {
  text-decoration: underline;
}
  

 
</style>

</head>
<body>
  <div class="page">
  <div class="top-links">
    <a href="${back}">Back</a>
  </div>
  <div class="copy-bar">
    <button id="copyNoteBtn" title="Copy note">📋</button>
  </div>
    <div class="user-info"><strong>${userLink}</strong></div>

  <pre id="noteContent">${note.content}</pre>
</div>
  <script>
  const copyBtn = document.getElementById("copyNoteBtn");
  const noteContent = document.getElementById("noteContent");

  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(noteContent.textContent).then(() => {
      copyBtn.textContent = "✔️";
      setTimeout(() => (copyBtn.textContent = "📋"), 900);
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
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${fileName}</title>
  <style>
  body {
    margin: 0;
    padding: 0;
    background: #f5f6f7;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    font-size: 16px;
    display: flex;
    justify-content: center;
  }

  .page {
    width: 100%;
    max-width: 800px;
    padding: 20px 16px;
    box-sizing: border-box;
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
    font-size: 24px;
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

  @media (max-width: 600px) {
    body {
      font-size: 17px;
    }

    h1 {
      font-size: 22px;
    }

    .download {
      padding: 12px 20px;
      font-size: 17px;
    }
  }

  @media (prefers-color-scheme: dark) {
    body {
      background: #000000ff;
      color: #e3e5e8;
    }

    .top-links a {
      color: #7289da;
    }

    .download {
      background: #7289da;
    }

    .download:hover {
      background: #5865f2;
    }
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
