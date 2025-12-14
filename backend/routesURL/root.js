import express from "express";
import urlAuth from "../middleware/urlAuth.js";
import { getAllData } from "../controllers/treeDataFetching.js";
import Node from "../db/models/node.js";

const router = express.Router();

// Only allow these params to remain in querystring
const allowedParams = ["token", "html"];

// Rainbow colors by depth
const rainbow = [
  "#ff3b30",
  "#ff9500",
  "#ffcc00",
  "#34c759",
  "#32ade6",
  "#5856d6",
  "#af52de",
];

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

    // Load owner + contributors
    const rootMeta = await Node.findById(nodeId)
      .populate("rootOwner", "username _id")
      .populate("contributors", "username _id")
      .select("rootOwner contributors")
      .lean()
      .exec();

    // JSON MODE
    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    if (!wantHtml) {
      return res.json({
        ...allData,
        rootOwner: rootMeta?.rootOwner || null,
        contributors: rootMeta?.contributors || [],
      });
    }

    const renderParents = (chain) => {
      let html = "";
      let depth = 0;

      for (const node of chain) {
        const color = rainbow[depth % rainbow.length];

        html += `
      <ul>
        <li style="
          border-left: 4px solid ${color};
          padding-left: 12px;
          margin: 6px 0;
          font-weight: ${node.isCurrent ? "700" : "500"};
        ">
       ${
         node.isCurrent
           ? `<a href="/api/${node._id}${queryString}">
<strong><u>${node.name}</u></strong>
       </a> (current)`
           : `<a href="/api/root/${node._id}${queryString}">
         ${node.name}
       </a>`
       }

    `;
        depth++;
      }

      // close all opened tags
      for (let i = 0; i < chain.length; i++) {
        html += `</li></ul>`;
      }

      return html;
    };

    // DEPTH-AWARE TREE RENDERING (children only)
    const renderTree = (node, depth = 0) => {
      const color = rainbow[depth % rainbow.length];

      let html = `
        <li style="
          border-left: 4px solid ${color};
          padding-left: 12px;
          margin: 6px 0;
        ">
          <a href="/api/${node._id}${queryString}">
            ${node.name} <code>${node._id}</code>
          </a>
      `;

      if (node.children && node.children.length > 0) {
        html += `<ul>`;
        for (const c of node.children) {
          html += renderTree(c, depth + 1);
        }
        html += `</ul>`;
      }

      html += `</li>`;
      return html;
    };

    // OWNER + CONTRIBUTORS
    const ownerHtml = rootMeta?.rootOwner
      ? `
    <p>
      <a href="/api/user/${rootMeta.rootOwner._id}${queryString}">
        ${rootMeta.rootOwner.username}
      </a>
      <code>${rootMeta.rootOwner._id}</code>
    </p>
  `
      : `<p><em>No owner</em></p>`;

    const contributorsHtml = rootMeta?.contributors?.length
      ? `<ul>
        ${rootMeta.contributors
          .map(
            (u) => `
              <li>
                <a href="/api/user/${u._id}${queryString}">
                  ${u.username}
                </a>
                <code>${u._id}</code>
              </li>
            `
          )
          .join("")}
      </ul>`
      : `<p><em>No contributors</em></p>`;

    const ancestors = allData.ancestors || [];

    const parentHtml = ancestors.length
      ? renderParents([
          ...ancestors.slice().reverse(), // root → parent
          {
            _id: allData._id,
            name: allData.name,
            isCurrent: true,
          },
        ])
      : `<p><em>No parents</em></p>`;

    // CHILDREN
    const childrenHtml = allData.children?.length
      ? `<ul>${allData.children.map((c) => renderTree(c)).join("")}</ul>`
      : `<p><em>No children</em></p>`;

    // SAFE JSON
    const jsonDump = JSON.stringify(allData, null, 2)
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // SEND HTML
    return res.send(`
      <html>
      <head>
        <title>${allData.name} — Tree</title>
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

          .json-box {
            margin-top: 40px;
            padding: 20px;
            background: #111;
            color: #0f0;
            border-radius: 8px;
            white-space: pre;
            overflow-x: auto;
            font-size: 13px;
          }

          .button {
            display: inline-block;
            padding: 10px 16px;
            margin-top: 14px;
            background: #0077cc;
            color: white;
            border-radius: 8px;
            text-decoration: none;
            font-weight: 600;
          }

          .button:hover {
            background: #005fa3;
          }
        </style>
      </head>

      <body>

        <h1>
  <a href="/api/${allData._id}${queryString}">
    ${allData.name}
  </a>
</h1>

        <p><code>${allData._id}</code></p>
   
     
        <h2>Parents</h2>
        ${parentHtml}

        <h2>Children</h2>
        ${childrenHtml}
           
      
       
             <h2>Owner</h2>
        ${ownerHtml}

        <h2>Contributors</h2>
        ${contributorsHtml}
        

      

       

    

       

      </body>
      </html>
    `);
  } catch (err) {
    console.error("Error in /root/:nodeId:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
