import express from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import mime from "mime-types";

import {
  createNote as coreCreateNote,
  getNotes as coreGetNotes,
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
  <title>Notes for ${nodeId} version ${version}</title>
  <style>
    body {
      font-family: sans-serif;
      padding: 0;
      margin: 0;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .header {
      padding: 20px;
      border-bottom: 1px solid #ddd;
      background: white;
      flex-shrink: 0;
    }

    .notes-container {
      padding: 20px;
      overflow-y: auto;
      flex-grow: 1;
    }

    ul { padding-left: 0; list-style: none; }
    li { margin-bottom: 16px; }
    .meta { color: #444; font-size: 0.9em; }

    .input-bar {
      position: sticky;
      bottom: 0;
      background: white;
      padding: 16px;
      border-top: 1px solid #ccc;
      flex-shrink: 0;
    }
      .reflection {
  background: #f3f3f3;   /* slightly darker than white */
 
  border-radius: 6px;
}

    textarea { width: 100%; }
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
            ? n.content.length > 80
              ? n.content.substring(0, 80) + "..."
              : n.content
            : `[FILE] ${n.content}`;

        const userLabel = n.userId
          ? `<a href="/api/user/${n.userId}?token=${
              req.query.token ?? ""
            }&html">
         ${n.username ?? n.userId}
       </a>`
          : n.username ?? "Unknown user";

        html += `
    <li class="${n.isReflection ? "reflection" : ""}">


      <div>
        <strong>${userLabel}:</strong>
        <a href="${base}/notes/${n._id}?token=${req.query.token ?? ""}&html">
          ${preview}
        </a>
      </div>

      <!-- second line: timestamp -->
      <div class="meta">${new Date(n.createdAt).toLocaleString()}</div>

    </li>
  `;
      }

      html += `
  </ul>
</div>

<div class="input-bar">
  <form
    method="POST"
    action="/api/${nodeId}/${version}/notes?token=${req.query.token ?? ""}"
    enctype="multipart/form-data"
  >
    <div>
      <textarea
        name="content"
        rows="4"
        placeholder="Write a note or upload a file..."
      ></textarea>
    </div>

    <br />

    <div>
      <input type="file" name="file" />
    </div>

    <br />

    <div>
      <label>
        <input type="checkbox" name="isReflection" value="true" />
        Is Reflection
      </label>
    </div>

    <button type="submit">Create</button>
  </form>
</div>

<script>
  // Scroll notes container to bottom automatically
  const container = document.querySelector('.notes-container');
  container.scrollTop = container.scrollHeight;
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

      res.json({ success: true, note: result.Note });
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
  <style>
    body {
      font-family: sans-serif;
      padding: 20px;
    }

    pre {
      font-size: 20px;
      white-space: pre-wrap;
      word-wrap: break-word;
      max-width: 80%;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <a href="${back}">Note Log</a> | <a href="${nodeUrl}">Node</a>
  <div><strong>${userLink}</strong></div>
  <pre>${note.content}</pre>
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
  <title>${fileName}</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    .top-links { margin-bottom: 16px; }
    .download { margin-bottom: 16px; display: inline-block; }

     pre {
      font-size: 20px;          /* ← Bigger font */
      white-space: pre-wrap;    /* ← Enables wrapping */
      word-wrap: break-word;    /* ← Wrap long words */
      max-width: 80%;           /* ← Wrap at 80% of page */
      line-height: 1.4;         /* ← Easier to read */
    }
  </style>
</head>
<body>

<div class="top-links">
  <a href="${back}">← Note Log</a> |
  <a href="${nodeUrl}">Node</a>
</div>

<div><strong>${userLink}</strong></div>

<h1>${fileName}</h1>

<a class="download" href="${fileUrl}" download>
  Download file
</a>

<div class="media">
  ${mediaHtml}
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

export default router;
