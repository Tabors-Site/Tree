import express from "express";
import urlAuth from "../middleware/urlAuth.js";
import { getContributions } from "../core/contributions.js";

const router = express.Router();

const allowedParams = ["token", "html"];

router.get("/:nodeId/:version/contributions", urlAuth, async (req, res) => {
  try {
    const { nodeId, version } = req.params;

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

    // HTML MODE
    const contributions = result.contributions || [];

    const contributionsHtml =
      contributions.length > 0
        ? `
      <ul>
        ${contributions
          .map((c) => {
            const isTransaction = c.action === "transaction" && c.tradeId;

            // --- TRANSACTION RENDER ---
            if (isTransaction) {
              const tradeLink = `/api/${nodeId}/${parsedVersion}/transactions${queryString}`;

              const a = c.additionalInfo?.nodeA;
              const b = c.additionalInfo?.nodeB;

              return `
                <li>
                  <strong>${c.username || "Unknown user"}</strong>
                  <a href="${tradeLink}">
                    <code>transaction</code>
                  </a>
                  <br/>

                  <small>${new Date(c.date).toLocaleString()}</small>

                  <div style="margin-top:6px; padding-left:12px;">
                    <div>
                      <strong>${a?.name}</strong>
                      (v${a?.versionIndex}) →
                      <code>${JSON.stringify(a?.valuesSent)}</code>
                    </div>

                    <div>
                      <strong>${b?.name}</strong>
                      (v${b?.versionIndex}) →
                      <code>${JSON.stringify(b?.valuesSent)}</code>
                    </div>
                  </div>
                </li>
              `;
            }

            // --- DEFAULT RENDER ---
            return `
              <li>
                <strong>${c.username || "Unknown user"}</strong>
                <code>${c.action}</code>
                <br/>
                <small>${new Date(c.date).toLocaleString()}</small>

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

       <p>
  <strong>Node:</strong>
  <a href="/api/${nodeId}${queryString}">
    <code>${nodeId}</code>
  </a>
  <br/>

  <strong>Version:</strong>
  <a href="/api/${nodeId}/${parsedVersion}${queryString}">
    <code>${parsedVersion}</code>
  </a>
</p>

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
