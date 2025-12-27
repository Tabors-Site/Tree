import express from "express";
import urlAuth from "../middleware/urlAuth.js";
import { findNodeById } from "../db/utils.js";
import Node from "../db/models/node.js";

const router = express.Router();

const allowedParams = ["token", "html"];
import authenticate from "../middleware/authenticate.js";
import { setValueForNode, setGoalForNode } from "../core/values.js";

import {
  getVersionWalletInfo,
  ensureVersionWallet,
  syncVersionSOLBalance,
  sendSOLFromVersion,
} from "../core/solana.js";

function isAutoKey(key) {
  return key.startsWith("_auto__");
}

function formatAutoKeyName(key) {
  return key
    .replace(/^_auto__/, "")
    .replace(/_/g, " ")
    .toUpperCase();
}

function formatAutoValue(key, value) {
  if (value == null) return "";

  // SOL auto key
  if (key === "_auto__sol") {
    return Number(value / 1e9)
      .toFixed(9)
      .replace(/\.?0+$/, "");
  }

  return value;
}

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
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto',
    'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    padding: 20px;
    color: #1a1a1a;
  }

  .container {
    max-width: 900px;
    margin: 0 auto;
  }

  /* ---------------- Back Navigation ---------------- */

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

  /* ---------------- Header ---------------- */

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
    line-height: 1.3;
    margin-bottom: 6px;
  }

  .header h1 a {
    color: inherit;
    text-decoration: none;
    transition: color 0.2s;
  }

  .header h1 a:hover {
    color: #667eea;
  }

  /* Version badge (MISSING BEFORE) */
  .version-badge {
    display: inline-block;
    margin-top: 6px;
    padding: 6px 14px;
    border-radius: 20px;
    font-size: 14px;
    font-weight: 600;
    color: white;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  }

  /* Node ID + Copy (MISSING BEFORE) */
  .node-id-container {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    flex-wrap: wrap;
  }

  #copyNodeIdBtn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 6px;
    font-size: 18px;
    opacity: 0.6;
    transition: opacity 0.2s, transform 0.2s;
  }

  #copyNodeIdBtn:hover {
    opacity: 1;
    transform: scale(1.1);
  }

    .section-title {
      width: 100%;
      margin-top: 12px;
      font-size: 18px;
      font-weight: 700;
      color: #1a1a1a;
    }

    .section-title a {
      color: #667eea;
      text-decoration: none;
      transition: color 0.2s;
    }

    .section-title a:hover {
      color: #764ba2;
      text-decoration: underline;
    }

  /* ---------------- Code / Links ---------------- */

  code {
    background: #f0f0f0;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 13px;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
    color: #667eea;
    font-weight: 600;
    word-break: break-word;
  }

  a {
    color: #667eea;
    text-decoration: none;
    font-weight: 500;
    transition: color 0.2s;
  }

  a:hover {
    color: #764ba2;
    text-decoration: underline;
  }

  /* ---------------- Table Section ---------------- */

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
    font-size: 14px;
    font-weight: 600;
    color: white;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    text-align: left;
  }

  td {
    padding: 14px 16px;
    border-bottom: 1px solid #e9ecef;
  }

  tbody tr:hover {
    background: #f8f9fa;
  }

  /* ---------------- Forms ---------------- */

  .value-form {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }

  .value-form input {
    padding: 8px 12px;
    font-size: 14px;
    border-radius: 8px;
    border: 1px solid #d0d0d0;
    transition: all 0.2s;
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
  }

  .value-form button:hover {
    background: #5856d6;
    transform: translateY(-1px);
  }

  .add-row {
    background: #f8f9fa;
  }

  .add-button {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
  }

  /* ---------------- Empty State ---------------- */

  .empty-state {
    text-align: center;
    padding: 40px 20px;
    color: #999;
  }

  /* ---------------- Responsive ---------------- */

  @media (max-width: 640px) {
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

    .back-nav {
      flex-direction: column;
    }

    .back-link {
      justify-content: center;
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
         <a
    href="/api/${nodeId}/${parsedVersion}/values/solana${queryString}"
    class="back-link"
  >
    Solana Wallet
  </a>
      </div>

      <!-- Header -->
      <div class="header">
  <h1>
    <a href="/api/${nodeId}/${nodeVersion}${queryString}">
      ${nodeName}
    </a>
  </h1>

  <span class="version-badge">Version ${nodeVersion}</span>

  <div class="node-id-container">
    <code id="nodeIdCode">${nodeId}</code>
    <button id="copyNodeIdBtn" title="Copy ID">📋</button>
  </div>

  <div class="section-title">Values & Goals</div>
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
                    .map((key) => {
                      const isAuto = isAutoKey(key);
                      const displayName = isAuto ? formatAutoKeyName(key) : key;
                      const displayValue = isAuto
                        ? formatAutoValue(key, values[key])
                        : values[key] ?? "";

                      return `
      <tr>
        <td><code>${displayName}</code></td>

        <td>
          ${
            isAuto
              ? `<code>${displayValue}</code>`
              : `
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
                    value="${displayValue}"
                      data-original="${displayValue}"

                    step="any"
                    placeholder="0"
                  />
<button type="submit" class="save-btn" hidden>Save</button>
                </form>
              `
          }
        </td>

        <!-- GOALS ARE ALWAYS EDITABLE -->
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
                data-original="${goals[key] ?? ""}"

              step="any"
              placeholder="0"
            />
<button type="submit" class="save-btn" hidden>Save</button>
          </form>
        </td>
      </tr>
    `;
                    })
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
    <script>
  const btn = document.getElementById("copyNodeIdBtn");
  const code = document.getElementById("nodeIdCode");

  if (btn && code) {
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(code.textContent).then(() => {
        btn.textContent = "✔️";
        setTimeout(() => (btn.textContent = "📋"), 900);
      });
    });
  }
</script>
<script>
  document.querySelectorAll(".value-form").forEach((form) => {
    const input = form.querySelector("input[type='number']");
    const button = form.querySelector(".save-btn");

    if (!input || !button) return;

    const original = input.dataset.original ?? "";

    function updateButton() {
      const changed = String(input.value) !== String(original);
      button.hidden = !changed;
    }

    // Initial state
    updateButton();

    // Watch for changes
    input.addEventListener("input", updateButton);
  });
</script>


  </body>
  </html>
  `);
  } catch (err) {
    console.error("Error in /:nodeId/:version/values:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get(
  "/:nodeId/:version/values/solana",
  authenticate,
  async (req, res) => {
    try {
      const { nodeId, version } = req.params;
      const parsedVersion = Number(version);

      if (!Number.isInteger(parsedVersion) || parsedVersion < 0) {
        return res.status(400).json({ error: "Invalid version" });
      }

      const filtered = Object.entries(req.query)
        .filter(([key]) => allowedParams.includes(key))
        .map(([key, val]) => (val === "" ? key : `${key}=${val}`))
        .join("&");

      const queryString = filtered ? `?${filtered}` : "";
      //update values, may need to update as it happens on every page loads
      const node = await Node.findById(nodeId);
      await syncVersionSOLBalance(node, parsedVersion);
      const walletInfo = await getVersionWalletInfo(nodeId, parsedVersion);

      // JSON MODE
      if (!("html" in req.query)) {
        return res.json({
          nodeId,
          version: parsedVersion,
          ...walletInfo,
        });
      }

      /* ---------------- HTML MODE ---------------- */

      if (!walletInfo.exists) {
        return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Wallet — Version ${parsedVersion}</title>

  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto',
        'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
    }

    /* Navigation */
    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
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
      border: 1px solid transparent;
    }

    .back-link:hover {
      background: white;
      border-color: #667eea;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
    }

    /* Header */
    .header {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 16px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
    }

    .header h1 {
      font-size: 20px;
      font-weight: 700;
      line-height: 1.2;
    }

    .version-badge {
      display: inline-block;
      margin-top: 6px;
      padding: 4px 10px;
      font-size: 12px;
      font-weight: 600;
      border-radius: 14px;
      color: white;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }

    .section-title {
      margin-top: 4px;
      font-size: 14px;
      font-weight: 600;
      color: #667eea;
    }

    /* Card */
    .card {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
    }

    button {
      padding: 10px 18px;
      border-radius: 10px;
      border: none;
      font-weight: 600;
      font-size: 14px;
      cursor: pointer;
      color: white;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      transition: all 0.2s;
    }

    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
    }

    
  </style>
</head>
<body>
  <div class="container">

    <div class="back-nav">
      <a href="/api/root/${nodeId}${queryString}" class="back-link">
        Back to Tree
      </a>
      <a href="/api/${nodeId}/${parsedVersion}/values${queryString}" class="back-link">
        Back to Values
      </a>
    </div>

    <div class="header">
      <h1>Solana Wallet</h1>
      <span class="version-badge">Version ${parsedVersion}</span>
      <div class="section-title">Wallet Setup</div>
    </div>

    <div class="card">
      <p style="margin-bottom: 16px;">No wallet exists for this version.</p>

      <form
        method="POST"
        action="/api/${nodeId}/${parsedVersion}/values/solana?token=${
          req.query.token ?? ""
        }&html"
      >
        <button type="submit">Create Wallet</button>
      </form>
    </div>

  </div>
</body>
</html>
`);
      }

      return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Wallet — Version ${parsedVersion}</title>

  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto',
        'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
    }

    .container {
      max-width: 900px;
      margin: 0 auto;
    }

    .back-nav {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      padding: 10px 16px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      color: #667eea;
      text-decoration: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 14px;
      transition: all 0.2s;
      border: 1px solid transparent;
    }

    .back-link:hover {
      background: white;
      border-color: #667eea;
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.2);
    }

    .header {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 16px 20px;
      margin-bottom: 16px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
    }

    .header h1 {
      font-size: 20px;
      font-weight: 700;
      line-height: 1.2;
    }

    .version-badge {
      display: inline-block;
      margin-top: 6px;
      padding: 4px 10px;
      font-size: 12px;
      font-weight: 600;
      border-radius: 14px;
      color: white;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }

    .section-title {
      margin-top: 4px;
      font-size: 14px;
      font-weight: 600;
      color: #667eea;
    }

    .card {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
    }

    code {
      display: block;
      background: #f0f0f0;
      padding: 10px 14px;
      border-radius: 8px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      font-size: 13px;
      color: #667eea;
      word-break: break-all;
      margin-top: 6px;
      }
      .send-card {
  margin-top: 20px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-radius: 14px;
  padding: 20px;
  box-shadow: 0 4px 18px rgba(0, 0, 0, 0.1);
}

.send-card h3 {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 12px;
  color: #1a1a1a;
}

.send-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.send-form input {
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid #d0d0d0;
  font-size: 14px;
  transition: all 0.2s;
}

.send-form input:focus {
  outline: none;
  border-color: #667eea;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
}

.send-form button {
  margin-top: 6px;
}

.fee-note {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid #e6e6e6;
  font-size: 13px;
  color: #666;
  line-height: 1.4;
}

    }
  </style>
</head>
<body>
  <div class="container">

    <div class="back-nav">
      <a href="/api/root/${nodeId}${queryString}" class="back-link">Back to Tree</a>
      <a href="/api/${nodeId}/${parsedVersion}/values${queryString}" class="back-link">
        Back to Values
      </a>
    </div>

    <div class="header">
      <h1>Solana Wallet</h1>
      <span class="version-badge">Version ${parsedVersion}</span>
      <div class="section-title">Wallet Details</div>
    </div>

    <div class="card">
      <strong>Address</strong>
<a
  href="https://solscan.io/account/${walletInfo.publicKey}"
  target="_blank"
  rel="noopener noreferrer"
  style="text-decoration: none;"
>
  <code>${walletInfo.publicKey}</code>
</a>


      <p style="margin-top:16px;">
        <strong>SOL Balance:</strong>
        ${(walletInfo.solBalance / 1e9).toFixed(4)} SOL
      </p>
    </div>
<div class="send-card">
  <h3>Send SOL</h3>

  <form
    method="POST"
    action="/api/${nodeId}/${parsedVersion}/values/solana/send?token=${
        req.query.token ?? ""
      }&html"
    class="send-form"
  >
    <input
      type="text"
      name="destination"
      placeholder="Destination (address or nodeId)"
      required
    />

    <input
      type="number"
      name="amount"
      step="any"
      min="0"
      placeholder="Amount (SOL)"
      required
    />

    <button type="submit">Send SOL</button>
  </form>

  <div class="fee-note">
    <strong>Note:</strong>
    Each transaction costs a small network fee.
   <strong>If your balance is below 0.001 you may not have enough to make a transaction. </strong>
    Rent-exempt minimum is 0.0009 SOL on Solana, so to send to a new node wallet will need at least that minimum amount.
  
  </div>
</div>


  </div>
</body>
</html>
`);
    } catch (err) {
      console.error("Error in /:nodeId/:version/values/solana:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.post(
  "/:nodeId/:version/values/solana",
  authenticate,
  async (req, res) => {
    try {
      const { nodeId, version } = req.params;
      const parsedVersion = Number(version);

      if (!Number.isInteger(parsedVersion) || parsedVersion < 0) {
        return res.status(400).json({ error: "Invalid version" });
      }

      await ensureVersionWallet(nodeId, parsedVersion);

      if ("html" in req.query) {
        return res.redirect(
          `/api/${nodeId}/${parsedVersion}/values/solana?token=${
            req.query.token ?? ""
          }&html`
        );
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

function isLikelySolanaAddress(value) {
  return (
    typeof value === "string" && (value.length === 43 || value.length === 44)
  );
}

function isLikelyNodeId(value) {
  return typeof value === "string" && value.length === 36;
}
router.post(
  "/:nodeId/:version/values/solana/send",
  authenticate,
  async (req, res) => {
    try {
      const { nodeId, version } = req.params;
      const { destination, amount } = req.body;

      const parsedVersion = Number(version);
      if (!Number.isInteger(parsedVersion) || parsedVersion < 0) {
        return res.status(400).json({ error: "Invalid version" });
      }

      if (typeof destination !== "string" || !destination.trim()) {
        return res.status(400).json({ error: "Destination is required" });
      }

      const dest = destination.trim();

      let toAddress;
      let toNodeId;

      if (isLikelySolanaAddress(dest)) {
        toAddress = dest;
      } else if (isLikelyNodeId(dest)) {
        toNodeId = dest;
      } else {
        return res.status(400).json({
          error: "Destination must be a Solana address or a nodeId",
        });
      }

      const solAmount = Number(amount);
      if (!Number.isFinite(solAmount) || solAmount <= 0) {
        return res.status(400).json({ error: "Invalid SOL amount" });
      }

      // SOL → lamports
      const lamports = Math.round(solAmount * 1e9);

      const result = await sendSOLFromVersion({
        nodeId,
        versionIndex: parsedVersion,
        toAddress,
        toNodeId,
        lamports,
      });

      if ("html" in req.query) {
        return res.redirect(
          `/api/${nodeId}/${parsedVersion}/values/solana?token=${
            req.query.token ?? ""
          }&html`
        );
      }

      res.json({
        success: true,
        signature: result.signature,
        to: result.to,
      });
    } catch (err) {
      console.error("Send SOL error:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
