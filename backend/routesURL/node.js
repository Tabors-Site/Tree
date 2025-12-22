import express from "express";
import urlAuth from "../middleware/urlAuth.js";
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
      const host = `${req.protocol}://${req.get("host")}`;

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
          </style>
        </head>
        <body>
       
          <h1>${node.name}</h1>
           <h3>
          <a href="${rootUrl}">BACK TO TREE</a>
          </h3>
          <p><strong>ID:</strong> <code>${node._id}</code></p>
          <p><strong>Type:</strong> ${node.type ?? "<em>None</em>"}</p>
          <p><strong>Prestige:</strong> ${node.prestige}</p>
               
          <h1>${versionHtml}</h1>
 
         

    

          <h2>Scripts</h2>
          <ul>${scriptsHtml}</ul>

           <h2>Parent</h2>
          <p>${parentHtml}</p>

          <h2>Children</h2>
          <ul>${childrenHtml}</ul>

          
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
            </style>
          </head>
          <body>

            <h1>
              <a href="${backUrl}">${node.name}</a>
              — Version ${version}
            </h1>
            <code>${node._id}</code>

               <h3>
          <a href="${backTreeUrl}">BACK TO TREE</a>
          </h3>

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

export default router;
