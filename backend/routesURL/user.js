import express from "express";
import urlAuth from "../middleware/urlAuth.js";
import User from "../db/models/user.js";
import {
  getAllNotesByUser as coreGetAllNotesByUser,
  getAllTagsForUser as coreGetAllTagsForUser,
} from "../core/notes.js";

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
                  ${r.name || "Untitled"} <code>${r._id}</code>
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
          <code>${user._id}</code>
        </p>
      <ul>
     <li>   <a href="/api/user/${userId}/notes?${filtered}">Notes</a></li>
     <li> <a href="/api/user/${userId}/tags?${filtered}">Tags</a></li>
</ul>
        <h2>Roots</h2>
        ${rootsHtml}

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
    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    const token = req.query.token ?? "";
    const tokenQS = token ? `?token=${token}&html` : `?html`;

    const result = await coreGetAllNotesByUser(userId);

    const notes = result.notes.map((n) => ({
      ...n,
      content:
        n.contentType === "file"
          ? `${req.protocol}://${req.get("host")}/uploads/${n.content}`
          : n.content,
    }));

    if (!wantHtml) {
      return res.json({ success: true, notes });
    }

    const user = await User.findById(userId).lean();

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
      Notes by   <a href="/api/user/${userId}${tokenQS}">${user.username}</a>
    </h1>

    <div class="nav">
      <a href="/api/user/${userId}/tags${tokenQS}">Tags</a>
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

      html += `
      <li>
        <div>
          <strong>${user.username}:</strong>
          <a href="/api/${n.nodeId}/${n.version}/notes/${
        n._id
      }${tokenQS}">${preview}</a>
        </div>

        <div class="meta">
        
          ${new Date(n.createdAt).toLocaleString()}<br />
          node 
          <a href="/api/${n.nodeId}${tokenQS}">
            <code>${n.nodeId}</code>
          </a> 
          <a href="/api/${n.nodeId}/${n.version}${tokenQS}">
            (${n.version})
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

    const result = await coreGetAllTagsForUser(userId);

    const notes = result.notes.reverse().map((n) => ({
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
      Tags for <a href="/api/user/${userId}?token=${
      req.query.token ?? ""
    }&html">
        @${user.username}
      </a>
    </h1>

    <div class="nav">
 
      <a href="/api/user/${userId}/notes?token=${
      req.query.token ?? ""
    }&html">Notes</a>
    
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

      const author = n.userId.username || n.userId._id;

      html += `
      <li>
        <div>
          <a href="/api/user/${n.userId._id}?token=${
        req.query.token ?? ""
      }&html">
            <strong>${author}:</strong>
          </a>
          <a href="/api/${n.nodeId}/${n.version}/notes/${n._id}?token=${
        req.query.token ?? ""
      }&html">
            ${preview}
          </a>
        </div>

        <div class="meta">
          ${new Date(n.createdAt).toLocaleString()}<br />
          node 
          <a href="/api/${n.nodeId}?token=${req.query.token ?? ""}&html">
            <code>${n.nodeId}</code>
          </a>
          <a href="/api/${n.nodeId}/${n.version}?token=${
        req.query.token ?? ""
      }&html">
            (v${n.version})
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

export default router;
