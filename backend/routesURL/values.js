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

    // Replace the HTML return in your /:nodeId/:version/values route with this:

    return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>${nodeName} — Values & Goals</title>
  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
    }

    .container {
      max-width: 1000px;
      margin: 0 auto;
    }

    /* Back Navigation */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 20px;
      flex-wrap: wrap;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      color: #667eea;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .back-link:hover {
      background: white;
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    /* Header Section */
    .header {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .header h1 {
      font-size: 28px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 8px;
      line-height: 1.3;
    }

    .header h1 a {
      color: #1a1a1a;
      text-decoration: none;
      transition: color 0.2s;
    }

    .header h1 a:hover {
      color: #667eea;
    }

    .section-title {
      font-size: 18px;
      font-weight: 600;
      color: #667eea;
      margin-top: 8px;
    }

    /* Table Section */
    .table-section {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
    }

    thead {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }

    th {
      padding: 14px 16px;
      text-align: left;
      font-weight: 600;
      font-size: 14px;
      color: white;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    th:first-child {
      border-radius: 10px 0 0 0;
    }

    th:last-child {
      border-radius: 0 10px 0 0;
    }

    tbody tr {
      transition: background 0.2s;
    }

    tbody tr:hover {
      background: #f8f9fa;
    }

    tbody tr:last-child td:first-child {
      border-radius: 0 0 0 10px;
    }

    tbody tr:last-child td:last-child {
      border-radius: 0 0 10px 0;
    }

    td {
      padding: 14px 16px;
      border-bottom: 1px solid #e9ecef;
      vertical-align: middle;
    }

    tbody tr:last-child td {
      border-bottom: none;
    }

    code {
      background: #f0f0f0;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 13px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      color: #667eea;
      font-weight: 600;
    }

    /* Forms in Table */
    .value-form {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }

    .value-form input[type="number"],
    .value-form input[type="text"] {
      padding: 8px 12px;
      font-size: 14px;
      border-radius: 8px;
      border: 1px solid #d0d0d0;
      background: white;
      font-family: inherit;
      transition: all 0.2s;
      width: 100px;
    }

    .value-form input[type="text"] {
      width: 160px;
    }

    .value-form input:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    .value-form button {
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 600;
      border-radius: 8px;
      border: none;
      background: #667eea;
      color: white;
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
      white-space: nowrap;
    }

    .value-form button:hover {
      background: #5856d6;
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(102, 126, 234, 0.3);
    }

    /* Add New Row */
    .add-row {
      background: #f8f9fa !important;
    }

    .add-row td {
      padding: 20px 16px !important;
    }

    .add-button {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
    }

    .add-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
    }

    /* Empty State */
    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: #999;
      font-style: normal;
    }

    /* Responsive Design */
    @media (max-width: 768px) {
      body {
        padding: 16px;
      }

      .header,
      .table-section {
        padding: 20px;
      }

      .header h1 {
        font-size: 24px;
      }

      .table-section {
        padding: 16px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
      }

      table {
        min-width: 600px;
      }

      th {
        padding: 12px;
        font-size: 12px;
      }

      td {
        padding: 12px;
      }

      .value-form {
        flex-wrap: nowrap;
      }

      .value-form input[type="number"],
      .value-form input[type="text"] {
        font-size: 13px;
        padding: 6px 10px;
      }

      .value-form input[type="number"] {
        width: 80px;
      }

      .value-form input[type="text"] {
        width: 140px;
      }

      .value-form button {
        padding: 6px 12px;
        font-size: 12px;
      }

      .back-nav {
        flex-direction: column;
      }

      .back-link {
        justify-content: center;
      }
    }

    @media (min-width: 769px) and (max-width: 1024px) {
      .container {
        max-width: 800px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="/api/root/${nodeId}${queryString}" class="back-link">
        ← Back to Tree
      </a>
      <a href="/api/${nodeId}/${nodeVersion}${queryString}" class="back-link">
        Back to Version
      </a>
    </div>

    <!-- Header -->
    <div class="header">
      <h1>
        <a href="/api/${nodeId}/${nodeVersion}${queryString}">
          ${nodeName} v${nodeVersion}
        </a>
      </h1>
      <div class="section-title">📊 Values & Goals</div>
    </div>

    <!-- Table Section -->
    <div class="table-section">
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Value</th>
            <th>Goal</th>
          </tr>
        </thead>
        <tbody>
          ${
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
                    class="value-form"
                  >
                    <input type="hidden" name="key" value="${key}" />
                    <input
                      type="number"
                      name="value"
                      value="${values[key] ?? ""}"
                      step="any"
                      placeholder="0"
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
                    class="value-form"
                  >
                    <input type="hidden" name="key" value="${key}" />
                    <input
                      type="number"
                      name="goal"
                      value="${goals[key] ?? ""}"
                      step="any"
                      placeholder="0"
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
                <td colspan="3" class="empty-state">
                  No values or goals set yet. Add one below to get started! 👇
                </td>
              </tr>
            `
          }
          
          <!-- Add New Row -->
          <tr class="add-row">
            <td colspan="3">
              <form
                method="POST"
                action="/api/${nodeId}/${parsedVersion}/value?token=${
      req.query.token ?? ""
    }&html"
                class="value-form"
              >
                <input
                  type="text"
                  name="key"
                  placeholder="New key"
                  required
                />
                <input
                  type="number"
                  name="value"
                  value="0"
                  step="any"
                  placeholder="0"
                />
                <button type="submit" class="add-button">
                  ＋ Add Value
                </button>
              </form>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</body>
</html>
`);
    s;
  } catch (err) {
    console.error("Error in /:nodeId/:version/values:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
