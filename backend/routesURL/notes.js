import express from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import mime from "mime-types";

import {
  createNote as coreCreateNote,
  getNotes as coreGetNotes,
  deleteNoteAndFile as coreDeleteNoteAndFile,
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
    <h1 style="margin:0;">
    
      <a href="${base}?token=${
        req.query.token ?? ""
      }&html">${nodeName} v${version}</a>
      Notes
    </h1>
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
      const mediaHtml = renderMedia(fileUrl, mimeType);
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
