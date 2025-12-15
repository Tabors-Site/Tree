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

    const result = await coreGetNotes({
      nodeId,
      version: Number(version),
    });

    const notes = result.notes.map((n) => ({
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
      const realBase = `${req.protocol}://${req.get("host")}/api/${nodeId}`;

      const nodeViewUrl = `${req.protocol}://${req.get(
        "host"
      )}/api/${nodeId}?token=${req.query.token ?? ""}&html`;

      let html = `
<html>
<head>
  <title>Notes for ${nodeId} version ${version}</title>
  <style>
    body { font-family: sans-serif; padding: 20px; line-height: 1.6; }
    a { color: #0077cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    li { margin-bottom: 16px; }
    .meta { color: #444; font-size: 0.9em; }
    .top-links { margin-bottom: 20px; }
    form { margin-bottom: 30px; padding: 12px; border: 1px solid #ccc; }
    textarea { width: 100%; }
  </style>
</head>
<body>





 

  <h1><a href="${realBase}?token=${
        req.query.token ?? ""
      }&html">${nodeId}</a> (version: <a href="${base}?token=${
        req.query.token ?? ""
      }&html">${version}</a>) Notes</h1>
 

  <!-- ✅ CREATE NOTE FORM -->
<form
  method="POST"
  action="/api/${nodeId}/${version}/notes?token=${req.query.token ?? ""}"
  enctype="multipart/form-data"
>


  <div>
   
    <textarea
      name="content"
      rows="8"
      placeholder="Write a note (leave empty if uploading a file)"
    ></textarea>
  </div>

  <br />

  <div>
    <label>Upload File</label><br />
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

<ul>
`;

      for (const n of notes) {
        const preview =
          n.contentType === "text"
            ? n.content.substring(0, 80)
            : `[FILE] ${n.content}`;

        const userLabel = n.userId
          ? `<a href="/api/user/${n.userId}?token=${
              req.query.token ?? ""
            }&html">
               ${n.username ?? n.userId}
             </a>`
          : n.username ?? "Unknown user";

        html += `
    <li>
      <div class="meta"><strong>${userLabel}</strong></div>
      <a href="${base}/notes/${n._id}?token=${req.query.token ?? ""}&html">
        ${preview}
      </a>
      <div class="meta">${new Date(n.createdAt).toLocaleString()}</div>
    </li>`;
      }

      html += `</ul></body></html>`;
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
<body>
  <a href="${back}">Notes</a> | <a href="${nodeUrl}">Node View</a>
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
  </style>
</head>
<body>

<div class="top-links">
  <a href="${back}">← Back to Notes</a> |
  <a href="${nodeUrl}">Node Home</a>
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
