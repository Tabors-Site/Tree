import express from "express";
import urlAuth from "../middleware/urlAuth.js";
import { findNodeById } from "../db/utils.js";

const router = express.Router();

const allowedParams = ["token", "html"];

router.get("/:nodeId/:version/values", urlAuth, async (req, res) => {
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

    const node = await findNodeById(nodeId);
    if (!node) {
      return res.status(404).json({ error: "Node not found" });
    }

    const versionData = node.versions?.[parsedVersion];
    const nodeName = node.name || nodeId;
    const nodeVersion = node.prestige || 0;

    if (!versionData) {
      return res.status(404).json({
        error: `Version ${parsedVersion} not found`,
      });
    }

    const values = Object.fromEntries(versionData.values || []);
    const goals = Object.fromEntries(versionData.goals || []);

    const allKeys = Array.from(
      new Set([...Object.keys(values), ...Object.keys(goals)])
    ).sort();

    // JSON MODE
    const wantHtml = Object.prototype.hasOwnProperty.call(req.query, "html");
    if (!wantHtml) {
      return res.json({
        nodeId,
        version: parsedVersion,
        values,
        goals,
      });
    }

    // HTML MODE
    const rowsHtml =
      allKeys.length > 0
        ? allKeys
            .map(
              (key) => `
              <tr>
                <td><code>${key}</code></td>
                <td>${values[key] ?? "—"}</td>
                <td>${goals[key] ?? "—"}</td>
              </tr>
            `
            )
            .join("")
        : `
          <tr>
            <td colspan="3"><em>No values or goals set</em></td>
          </tr>
        `;

    return res.send(`
      <html>
      <head>
        <title>Node Values</title>
        <style>
          body {
            font-family: system-ui, sans-serif;
            padding: 20px;
            background: #fafafa;
          }

          h2 {
            margin-top: 0;
          }

          table {
            border-collapse: collapse;
            width: 100%;
            max-width: 800px;
          }

          th, td {
            border: 1px solid #ddd;
            padding: 8px 10px;
            text-align: left;
          }

          th {
            background: #f0f0f0;
            font-weight: 600;
          }

          code {
            background: #eee;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 12px;
          }

          a {
            color: #0077cc;
            text-decoration: none;
          }

          a:hover {
            text-decoration: underline;
          }
        </style>
      </head>

      <body>

        <h1>
          <a href="/api/${nodeId}/${nodeVersion}${queryString}">
            ${nodeName} v${nodeVersion}
          </a>
        </h1>

        

        <h3>Values & Goals</h3>

        <table>
          <thead>
            <tr>
              <th>Key</th>
              <th>Value</th>
              <th>Goal</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>

      </body>
      </html>
    `);
  } catch (err) {
    console.error("Error in /:nodeId/:version/values:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
