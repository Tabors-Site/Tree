import express from "express";
import urlAuth from "../middleware/urlAuth.js";
import authenticate from "../middleware/authenticate.js";
import { createNewNode } from "../core/treeManagement.js";
import { updateParentRelationship } from "../core/treeManagement.js";

import { editStatus, addPrestige } from "../core/statuses.js";

import Node from "../db/models/node.js";

const router = express.Router();

import getNodeName from "./helpers/getNameById.js";

// Allowed query params for HTML mode
const allowedParams = ["token", "html"];

// Utility: keep only allowed query params
function filterQuery(req) {
  return Object.entries(req.query)
    .filter(([key]) => allowedParams.includes(key))
    .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
    .join("&");
}

router.post("/:nodeId/:version/editStatus", authenticate, async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const userId = req.userId;

    const status = req.body?.status || req.query?.status;
    const ALLOWED_STATUSES = ["active", "completed", "trimmed"];

    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        error: "Invalid status. Must be active, completed, or trimmed.",
      });
    }
    const isInherited =
      req.body?.isInherited === "true" ||
      req.body?.isInherited === true ||
      req.query?.isInherited === "true";

    if (!status) {
      return res.status(400).json({ error: "status is required" });
    }

    const result = await editStatus({
      nodeId,
      status,
      version: Number(version),
      isInherited,
      userId,
    });

    // HTML redirect support
    if ("html" in req.query) {
      return res.redirect(
        `/api/${nodeId}/${version}?token=${req.query.token ?? ""}&html`
      );
    }

    res.json({ success: true, ...result });
  } catch (err) {
    console.error("editStatus error:", err);
    res.status(400).json({ error: err.message });
  }
});

router.post("/:nodeId/:version/prestige", authenticate, async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const userId = req.userId;

    const nextVersion = Number(version) + 1;

    if (Number.isNaN(nextVersion)) {
      return res.status(400).json({ error: "Invalid version" });
    }

    const result = await addPrestige({
      nodeId,
      userId,
    });

    // HTML redirect support
    if ("html" in req.query) {
      return res.redirect(
        `/api/${nodeId}/${nextVersion}?token=${req.query.token ?? ""}&html`
      );
    }

    res.json({ success: true, ...result });
  } catch (err) {
    console.error("prestige error:", err);
    res.status(400).json({ error: err.message });
  }
});

router.post("/:nodeId/updateParent", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params; // child
    const userId = req.userId;

    // new parent can come from body OR query
    const newParentId =
      req.body?.newParentId ||
      req.query?.newParentId ||
      req.body?.parentId ||
      req.query?.parentId;

    if (!newParentId) {
      return res.status(400).json({
        error: "newParentId is required",
      });
    }

    const result = await updateParentRelationship(nodeId, newParentId, userId);

    // HTML redirect support
    if ("html" in req.query) {
      return res.redirect(`/api/${nodeId}?token=${req.query.token ?? ""}&html`);
    }

    res.json({
      success: true,
      nodeChild: result.nodeChild,
      nodeNewParent: result.nodeNewParent,
    });
  } catch (err) {
    console.error("updateParent error:", err);
    res.status(400).json({ error: err.message });
  }
});
// -----------------------------------------------------------------------------
// GET /api/:nodeId
// Returns the node + all versions (no notes)
// Supports JSON or ?html mode
// Shows full node data, parent + children clickable
// -----------------------------------------------------------------------------
router.get("/:nodeId", urlAuth, async (req, res) => {
  try {
    const { nodeId } = req.params;
    const node = await Node.findById(nodeId).lean();

    if (!node) return res.status(404).json({ error: "Node not found" });

    const queryString = filterQuery(req);
    const qs = queryString ? `?${queryString}` : "";

    // ---------------------------------------------------------
    // HTML MODE
    // ---------------------------------------------------------
    if (req.query.html !== undefined) {
      const host = `https://${req.get("host")}`;

      // Versions
      const versionHtml = `
  <ul>
    ${[...node.versions]
      .reverse()
      .map(
        (_, i, arr) =>
          `<li><a href="${host}/api/${nodeId}/${arr.length - 1 - i}${qs}">
            Version ${arr.length - 1 - i}
          </a></li>`
      )
      .join("")}
  </ul>
`;

      // Scripts
      const scriptsHtml =
        node.scripts && node.scripts.length
          ? node.scripts
              .map(
                (s) => `
          <li>
            <strong>${s.name}</strong>
            <pre>${s.script}</pre>
          </li>`
              )
              .join("")
          : `<li><em>No scripts</em></li>`;

      const parentName = node.parent
        ? (await Node.findById(node.parent, "name").lean())?.name
        : null;
      // Parent link
      const parentHtml = node.parent
        ? `<a href="${host}/api/${node.parent}${qs}">${parentName}</a>`
        : `<em>None</em>`;

      const children = await Node.find({ _id: { $in: node.children } })
        .select("name _id")
        .lean();

      const childrenHtml =
        node.children && node.children.length
          ? node.children
              .map((c) => {
                const child = children.find((child) => child._id === c);
                const name = child ? child.name : c; // fallback to raw ID if missing

                return `<li><a href="${host}/api/${c}${qs}">${name}</a></li>`;
              })
              .join("")
          : `<li><em>No children</em></li>`;

      // ---------------------------------------------------------
      // NEW: Root View button
      // ---------------------------------------------------------
      const rootUrl = `${host}/api/root/${nodeId}${qs}`;

      return res.send(`
        <html>
        <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">

          <title>Node ${node.name}</title>
          <style>
            body { font-family: sans-serif; padding: 20px; }
            pre { background: #eee; padding: 10px; border-radius: 6px; }
            a { color: #0077cc; text-decoration: none; }
            a:hover { text-decoration: underline; }
            li { margin-bottom: 8px; }
            .button {
              display: inline-block;
              padding: 10px 14px;
              background: #0077cc;
              color: #fff;
              border-radius: 6px;
              margin-bottom: 20px;
              text-decoration: none;
            }
            .button:hover { background: #005fa3; }
            code {
            background: #eee;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
          }
          </style>
        </head>
        <body>
                 <h3>
                 <a href="${rootUrl}">BACK TO TREE</a>
          </h3>  

          <h1>${node.name}</h1>
         
<p style="display:flex;align-items:center;gap:6px;">
  <code id="nodeIdCode">${node._id}</code>

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
          <p><strong>Type:</strong> ${node.type ?? "<em>None</em>"}</p>
          <p><strong>Prestige:</strong> ${node.prestige}</p>
               
          <h1>${versionHtml}</h1>
 
         

    

          <h2>Scripts</h2>
          <ul>${scriptsHtml}</ul>

           <h2>Parent</h2>
          <p>${parentHtml}</p>
          <h3>Change Parent</h3>

<form
  method="POST"
  action="${host}/api/${nodeId}/updateParent${qs}"
  style="margin-top:10px;"
>
  <input
    type="text"
    name="newParentId"
    placeholder="New parent node ID"
    required
    style="
      padding:8px;
      font-size:14px;
      border-radius:6px;
      border:1px solid #ccc;
      width:260px;
    "
  />

  <button
    type="submit"
    style="
      padding:8px 14px;
      margin-left:6px;
      font-size:14px;
      border-radius:6px;
      border:none;
      background:#cc5500;
      color:white;
      cursor:pointer;
    "
  >
    Move
  </button>
</form>


          <h2>Children</h2>

<ul>${childrenHtml}</ul>

<h3>Add Child</h3>

<form
  method="POST"
  action="${host}/api/${nodeId}/createChild${qs}"
  style="margin-top:12px;"
>
  <input
    type="text"
    name="name"
    placeholder="Child name"
    required
    style="
      padding:8px;
      font-size:14px;
      border-radius:6px;
      border:1px solid #ccc;
      width:220px;
    "
  />

  <button
    type="submit"
    style="
      padding:8px 14px;
      margin-left:6px;
      font-size:14px;
      border-radius:6px;
      border:none;
      background:#0077cc;
      color:white;
      cursor:pointer;
    "
  >
    Create
  </button>
</form>

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
    }

    // ---------------------------------------------------------
    // JSON MODE
    // ---------------------------------------------------------
    res.json({ node });
  } catch (err) {
    console.error("Error fetching node:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// -----------------------------------------------------------------------------
// GET /api/:nodeId/:version
// Returns a single version (includes Notes link)
// Supports JSON or ?html mode
// -----------------------------------------------------------------------------
router.get("/:nodeId/:version", urlAuth, async (req, res) => {
  try {
    const { nodeId, version, parent } = req.params;
    const v = Number(version);

    const node = await Node.findById(nodeId).lean();
    if (!node) return res.status(404).json({ error: "Node not found" });

    if (isNaN(v) || v < 0 || v >= node.versions.length)
      return res.status(400).json({ error: "Invalid version index" });

    const data = node.versions[v];

    const ALL_STATUSES = ["active", "completed", "trimmed"];
    const STATUS_LABELS = {
      active: "Activate",
      completed: "Complete",
      trimmed: "Trim",
    };

    const statusButtonsHtml = ALL_STATUSES.filter((s) => s !== data.status)
      .map(
        (s) => `
      <button
        type="submit"
        name="status"
        value="${s}"
        style="padding:8px 12px;margin-right:6px;"
      >
        ${STATUS_LABELS[s]}
      </button>
    `
      )
      .join("");

    const showPrestige = v === node.prestige;

    // ----------------------------
    // HTML BROWSER MODE
    // ----------------------------
    if (req.query.html !== undefined) {
      const queryString = filterQuery(req);
      const qs = queryString ? `?${queryString}` : "";

      const backUrl = `${req.protocol}://${req.get("host")}/api/${nodeId}${qs}`;
      const backTreeUrl = `${req.protocol}://${req.get(
        "host"
      )}/api/root/${nodeId}${qs}`;
      const createdDate = data.dateCreated
        ? new Date(data.dateCreated).toLocaleString()
        : "Unknown";

      const scheduleHtml = data.schedule
        ? new Date(data.schedule).toLocaleString()
        : "None";

      const reeffectTime =
        data.reeffectTime !== undefined ? data.reeffectTime : "<em>None</em>";

      return res.send(`
        <html>
          <head>
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">

            <title>${node.name} v${version}</title>
            <style>
              body { font-family: sans-serif; padding: 20px; }
              pre { background: #eee; padding: 15px; border-radius: 6px; }
              a.button {
                display: inline-block;
                margin-bottom: 20px;
                padding: 10px 15px;
                background: #0077cc;
                color: white;
                text-decoration: none;
                border-radius: 6px;
              }
              a.button:hover { background: #005fa3; }
              .meta div { margin-bottom: 6px; }
              code {
            background: #eee;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
          }
            </style>
          </head>
          <body>
      <h3>
          <a href="${backTreeUrl}">BACK TO TREE</a>
          </h3>
            <h1>
              <a href="${backUrl}">${node.name}</a>
              — Version ${version}
            </h1>
            <p style="display:flex;align-items:center;gap:6px;">
  <code id="nodeIdCode">${node._id}</code>

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


         

            <div class="meta">
            <div>
                <strong>Status: </strong> ${data.status}
              </div>
              <div>
                <strong>Date Created:</strong> ${createdDate}
              </div>
   <div>
                <strong>Scheduled:</strong>
                ${scheduleHtml}
              </div>
              <div>
                <strong>Repeat Hours:</strong> ${reeffectTime}
              </div>

           
            </div>

            <h2>
              <a href="/api/${nodeId}/${version}/notes${qs}">Notes</a><br />
              <a href="/api/${nodeId}/${version}/values${qs}">Values / Goals</a><br />
              <a href="/api/${nodeId}/${version}/contributions${qs}">Contributions</a><br />
              <a href="/api/${nodeId}/${version}/transactions${qs}">Transactions</a>
            </h2>


<div style="margin-bottom:16px;">
  <strong>Change Status</strong>
</div>

<form
  method="POST"
  action="https://${req.get("host")}/api/${nodeId}/${version}/editStatus${qs}"
  onsubmit="return confirm('This will apply to all children. Is that ok?')"
>
  <input type="hidden" name="isInherited" value="true" />

 ${statusButtonsHtml}
</form>



${
  showPrestige
    ? `

  <form
    method="POST"
    action="https://${req.get("host")}/api/${nodeId}/${version}/prestige${qs}"
    onsubmit="return confirm('This will complete the current version and create a new prestige level. Continue?')"
  >
    <button
      type="submit"
      style="
        padding:10px 16px;
        background:#0077cc;
        color:white;
        border:none;
        border-radius:6px;
        cursor:pointer;
      "
    >
      Add New Version
    </button>
  </form>
`
    : ""
}



        
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
    }

    // ----------------------------
    // JSON MODE
    // ----------------------------
    res.json({
      id: node._id,
      name: node.name,
      version: v,
      data,
    });
  } catch (err) {
    console.error("Error fetching version:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/:nodeId/createChild", authenticate, async (req, res) => {
  try {
    const { nodeId } = req.params; // parent id
    const { name } = req.body;
    const userId = req.userId;

    if (!name || typeof name !== "string") {
      return res.status(400).json({
        success: false,
        error: "Name is required",
      });
    }

    // Load parent
    const parentNode = await Node.findById(nodeId);
    if (!parentNode) {
      return res.status(404).json({
        success: false,
        error: "Parent node not found",
      });
    }

    // Create child
    const childNode = await createNewNode(
      name,
      null, // schedule
      null, // reeffectTime
      parentNode._id, // parentNodeID
      false, // isRoot
      userId, // userId (from token)
      {}, // values
      {}, // goals
      null // note
    );

    // HTML redirect support (same pattern)
    if ("html" in req.query) {
      return res.redirect(`/api/${nodeId}?token=${req.query.token ?? ""}&html`);
    }

    res.status(201).json({
      success: true,
      childId: childNode._id,
      child: childNode,
    });
  } catch (err) {
    console.error("createChild error:", err);
    res.status(400).json({ success: false, error: err.message });
  }
});

export default router;
