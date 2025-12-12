import express from "express";
import urlAuth from "../middleware/urlAuth.js";
import { getAllData } from "../controllers/treeDataFetching.js";

const router = express.Router();

// Only allow these params to remain in querystring
const allowedParams = ["token", "html"];

router.get("/root/:nodeId", urlAuth, async (req, res) => {
  try {
    const { nodeId } = req.params;

    // CLEAN QUERY STRING (keep only token + html)
    const filtered = Object.entries(req.query)
      .filter(([key]) => allowedParams.includes(key))
      .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
      .join("&");

    const queryString = filtered ? `?${filtered}` : "";

    // CALL getAllData(rootId)
    const fakeReq = { ...req, body: { rootId: nodeId } };
    let allData = null;

    const fakeRes = {
      json(data) {
        allData = data;
      },
    };

    await getAllData(fakeReq, fakeRes);
    if (!allData) return res.status(500).send("getAllData failed");

    // DEFAULT JSON MODE
    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    if (!wantHtml) return res.json(allData);

    // CHILDREN RENDERING (unchanged)
    const renderTree = (node) => {
      let html = `
        <li>
          <a href="/api/root/${node._id}${queryString}">
            ${node.name} (${node._id})
          </a>
      `;

      if (node.children && node.children.length > 0) {
        html += `<ul>`;
        for (const c of node.children) html += renderTree(c);
        html += `</ul>`;
      }

      html += `</li>`;
      return html;
    };

    // ONE PARENT (direct from allData.parent)
    let parentHtml = "";

    if (allData.parent) {
      const pr = allData.parent;
      parentHtml = `
        <ul>
          <li>
            <a href="/api/root/${pr._id}${queryString}">
              ${pr.name} (${pr._id})
            </a>
          </li>
        </ul>
      `;
    } else {
      parentHtml = `<p><em>No parents</em></p>`;
    }

    // CHILDREN HTML
    const childrenHtml = `
      <ul>
        ${renderTree(allData)}
      </ul>
    `;

    // JSON DUMP (unchanged)
    const jsonDump = JSON.stringify(allData, null, 2)
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // SEND HTML
    return res.send(`
      <html>
      <head>
        <title>${allData.name} — Tree</title>
        <style>
          body { font-family: sans-serif; padding: 20px; line-height: 1.6; }
          a { color: #0077cc; text-decoration: none; }
          a:hover { text-decoration: underline; }
          ul { list-style-type: none; padding-left: 20px; }
          code { background: #eee; padding: 3px 5px; border-radius: 4px; }

          .json-box {
            margin-top: 40px;
            padding: 20px;
            background: #111;
            color: #0f0;
            border-radius: 8px;
            white-space: pre;
            overflow-x: auto;
            font-size: 14px;
          }

          .button {
            display: inline-block;
            padding: 10px 15px;
            margin-top: 20px;
            background: #0077cc;
            color: white;
            border-radius: 6px;
            text-decoration: none;
            font-weight: bold;
          }

          .button:hover {
            background: #005fa3;
          }
        </style>
      </head>
      <body>

        <h1>${allData.name}</h1>
        <p><code>${allData._id}</code></p>

        <a class="button" href="/api/${allData._id}${queryString}">
          Node View
        </a>

        <h2>Parent</h2>
        ${parentHtml}

        <h2>Children</h2>
        ${childrenHtml}

        <h2>Full AllData JSON</h2>
        <div class="json-box">${jsonDump}</div>

      </body>
      </html>
    `);
  } catch (err) {
    console.error("Error in /root/:nodeId:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
