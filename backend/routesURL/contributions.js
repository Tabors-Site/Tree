import express from "express";
import urlAuth from "../middleware/urlAuth.js";
import { getContributions } from "../core/contributions.js";
import getNodeName from "./helpers/getNameById.js";

const router = express.Router();

const allowedParams = ["token", "html"];

router.get("/:nodeId/:version/contributions", urlAuth, async (req, res) => {
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

    const parsedVersion = Number(version);
    if (isNaN(parsedVersion)) {
      return res.status(400).json({
        error: "Invalid version: must be a number",
      });
    }

    const filtered = Object.entries(req.query)
      .filter(([key]) => allowedParams.includes(key))
      .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
      .join("&");

    const queryString = filtered ? `?${filtered}` : "";

    const result = await getContributions({
      nodeId,
      version: parsedVersion,
      limit,
    });

    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");

    // JSON MODE
    if (!wantHtml) {
      return res.json({
        nodeId,
        version: parsedVersion,
        ...result,
      });
    }
    const nodeName = await getNodeName(nodeId);
    // HTML MODE
    const contributions = result.contributions || [];

    const contributionsHtml =
      contributions.length > 0
        ? `
      <ul>
        ${contributions
          .map((c) => {
            const user = c.username || "Unknown user";
            const time = new Date(c.date).toLocaleString();

            // --- TRANSACTION RENDER ---
            if (c.action === "transaction" && c.tradeId) {
              const tradeLink = `/api/${nodeId}/${parsedVersion}/transactions${queryString}`;

              const a = c.additionalInfo?.nodeA;
              const b = c.additionalInfo?.nodeB;

              return `
                <li>
                  <strong>${user} </strong>
                  made a 
                  <a href="${tradeLink}">
                    <code>transaction</code>
                  </a>
                  <br/>
                  <small>${time}</small>

                  <div style="margin-top:6px; padding-left:12px;">
                    <div>
                      <strong>${a?.name}</strong>
                      (${a?.versionIndex}) →
                      <code>${JSON.stringify(a?.valuesSent)}</code>
                    </div>

                    <div>
                      <strong>${b?.name}</strong>
                      (${b?.versionIndex}) →
                      <code>${JSON.stringify(b?.valuesSent)}</code>
                    </div>
                  </div>
                </li>
              `;
            }

            // --- CUSTOM RENDERS FOR NEW CONTRIBUTIONS ---

            if (c.action === "editNameNode") {
              const { oldName, newName } = c.editNameNode || {};

              return `
    <li>
      <strong>${user}</strong>
      renamed node
      <code>${oldName}</code>
      →
      <code>${newName}</code>
      <br/>
      <small>${time}</small>
    </li>
  `;
            }

            if (c.action === "updateParent") {
              const { oldParentId, newParentId } = c.updateParent || {};
              return `
    <li>
      <strong>${user}</strong>
      changed parent:
      <a href="/api/${oldParentId}${queryString}">
      <code>${oldParentId}</code></a>
      →
      <a href="/api/${newParentId}${queryString}">
      <code>${newParentId}</code></a>
      <br/>
      <small>${time}</small>
    </li>
  `;
            }

            if (c.action === "updateChildNode") {
              const { action, childId } = c.updateChildNode || {};
              return `
    <li>
      <strong>${user}</strong>
      <code>${action}</code> child
      <a href="/api/${childId}${queryString}">
      <code>${childId}</code></a>
      <br/>
      <small>${time}</small>
    </li>
  `;
            }

            if (c.action === "editScript") {
              const { scriptName } = c.editScript || {};
              return `
    <li>
      <strong>${user}</strong>
      updated script
      <code>${scriptName}</code>
      <br/>
      <small>${time}</small>
    </li>
  `;
            }

            if (c.action === "note") {
              const { action, noteId } = c.noteAction || {};
              return `
    <li>
      <strong>${user}</strong>
      ${action === "add" ? "added" : "removed"} note
       <a href="/api/${nodeId}/${parsedVersion}/notes/${noteId}${queryString}">
      <code>${noteId}</code></a>
      <br/>
      <small>${time}</small>
    </li>
  `;
            }

            // --- DEFAULT FALLBACK ---
            return `
              <li>
                <strong>${user}</strong>
                <code>${c.action}</code>
                <br/>
                <small>${time}</small>

                ${
                  c.additionalInfo
                    ? `
                      <div style="margin-top:6px; padding-left:12px;">
                        <code>${JSON.stringify(c.additionalInfo)}</code>
                      </div>
                    `
                    : ""
                }
              </li>
            `;
          })
          .join("")}
      </ul>
    `
        : `<p><em>No contributions found</em></p>`;

    return res.send(`
        <html>
        <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">

          <title>Contributions</title>
          <style>
            body {
              font-family: system-ui, sans-serif;
              padding: 20px;
              line-height: 1.6;
              background: #fafafa;
            }

            h1 { margin-bottom: 6px; }
            h2 { margin-top: 28px; }

            ul {
              list-style: none;
              padding-left: 18px;
            }

            li {
              margin-bottom: 12px;
            }

            code {
              background: #eee;
              padding: 2px 6px;
              border-radius: 4px;
              font-size: 12px;
            }

            small {
              color: #555;
            }
          </style>
        </head>

        <body>

        <h1>
          <a href="/api/${nodeId}/${parsedVersion}${queryString}">
            ${nodeName} v${parsedVersion}
          </a>
                  </h1>

          <br/>


        <h2>Contributions</h2>
        ${contributionsHtml}

        </body>
        </html>
      `);
  } catch (err) {
    console.error("Error in /node/:nodeId/:version/contributions:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
