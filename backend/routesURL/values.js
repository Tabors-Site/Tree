import express from "express";
import urlAuth from "../middleware/urlAuth.js";
import { findNodeById } from "../db/utils.js";

const router = express.Router();

const allowedParams = ["token", "html"];
import authenticate from "../middleware/authenticate.js";
import { setValueForNode, setGoalForNode } from "../core/values.js";

// SET VALUE
router.post("/:nodeId/:version/value", authenticate, async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const { key, value } = req.body;

    await setValueForNode({
      nodeId,
      version,
      key,
      value,
      userId: req.userId,
    });

    if ("html" in req.query) {
      return res.redirect(
        `/api/${nodeId}/${version}/values?token=${req.query.token ?? ""}&html`
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// SET GOAL
router.post("/:nodeId/:version/goal", authenticate, async (req, res) => {
  try {
    const { nodeId, version } = req.params;
    const { key, goal } = req.body;

    await setGoalForNode({
      nodeId,
      version,
      key,
      goal,
      userId: req.userId,
    });

    if ("html" in req.query) {
      return res.redirect(
        `/api/${nodeId}/${version}/values?token=${req.query.token ?? ""}&html`
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

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
    const addRowHtml = `
<tr>
  <td colspan="3">
    <form
      method="POST"
      action="/api/${nodeId}/${parsedVersion}/value?token=${
      req.query.token ?? ""
    }&html"
      style="display:flex; gap:8px; align-items:center;"
    >
      <input
        type="text"
        name="key"
        placeholder="New key"
        required
        style="
          padding:4px 6px;
          font-size:13px;
          width:160px;
        "
      />

      <input
        type="number"
        name="value"
        value="0"
        step="any"
        style="
          padding:4px 6px;
          font-size:13px;
          width:100px;
        "
      />

      <button
        type="submit"
        style="
          padding:4px 10px;
          font-size:13px;
          border-radius:4px;
          border:1px solid #999;
          background:#eee;
          cursor:pointer;
        "
      >
        Add value
      </button>
    </form>
  </td>
</tr>
`;

    // HTML MODE
    const rowsHtml =
      allKeys.length > 0
        ? allKeys
            .map(
              (key) => `
              <tr>
                <td><code>${key}</code></td>
                <td>
  <form
    method="POST"
    action="/api/${nodeId}/${parsedVersion}/value?token=${
                req.query.token ?? ""
              }&html"
    style="display:flex; gap:6px; align-items:center;"
  >
    <input type="hidden" name="key" value="${key}" />
    <input
      type="number"
      name="value"
      value="${values[key] ?? ""}"
      step="any"
      style="width:90px; padding:4px;"
    />
    <button type="submit">Save</button>
  </form>
</td>

<td>
  <form
    method="POST"
    action="/api/${nodeId}/${parsedVersion}/goal?token=${
                req.query.token ?? ""
              }&html"
    style="display:flex; gap:6px; align-items:center;"
  >
    <input type="hidden" name="key" value="${key}" />
    <input
      type="number"
      name="goal"
      value="${goals[key] ?? ""}"
      step="any"
      style="width:90px; padding:4px;"
    />
    <button type="submit">Save</button>
  </form>
</td>

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
              <meta name="viewport" content="width=device-width, initial-scale=1.0">

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
              ${addRowHtml}

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
