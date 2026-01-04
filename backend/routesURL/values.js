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
  syncVersionTokenHoldings,
  sendSOLFromVersion,
  swapFromVersion,
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
      await syncVersionTokenHoldings(node, parsedVersion);
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

      // Replace both HTML returns in your /:nodeId/:version/values/solana route with these:

      // FIRST - No wallet exists (create wallet page)
      if (!walletInfo.exists) {
        return res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#667eea">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Solana Wallet — Version ${parsedVersion}</title>
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
      max-width: 900px;
      margin: 0 auto;
    }

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
    }

    .version-badge {
      display: inline-block;
      padding: 6px 14px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 600;
      margin-top: 8px;
    }

    .empty-state {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 60px 40px;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .empty-state-icon {
      font-size: 64px;
      margin-bottom: 16px;
    }

    .empty-state-text {
      font-size: 18px;
      color: #666;
      margin-bottom: 24px;
    }

    .create-button {
      padding: 14px 32px;
      border-radius: 10px;
      border: none;
      font-weight: 700;
      font-size: 16px;
      cursor: pointer;
      color: white;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      transition: all 0.2s;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
    }

    .create-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(102, 126, 234, 0.5);
    }

    @media (max-width: 640px) {
      body { padding: 16px; }
      .header { padding: 20px; }
      .header h1 { font-size: 24px; }
      .empty-state { padding: 40px 24px; }
      .back-nav { flex-direction: column; }
      .back-link { justify-content: center; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="back-nav">
      <a href="/api/root/${nodeId}${queryString}" class="back-link">← Back to Tree</a>
      <a href="/api/${nodeId}/${parsedVersion}/values${queryString}" class="back-link">Back to Values</a>
    </div>

    <div class="header">
      <h1>🪙 Solana Wallet</h1>
      <span class="version-badge">Version ${parsedVersion}</span>
    </div>

    <div class="empty-state">
      <div class="empty-state-icon">👛</div>
      <div class="empty-state-text">No wallet exists for this version</div>
      <form method="POST" action="/api/${nodeId}/${parsedVersion}/values/solana?token=${
          req.query.token ?? ""
        }&html">
        <button type="submit" class="create-button">Create Wallet</button>
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
  <title>Solana Wallet — Version ${parsedVersion}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #1a1a1a;
    }

    .container { max-width: 900px; margin: 0 auto; }

    .back-nav { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }

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

    .header {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 24px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .header h1 { font-size: 28px; font-weight: 700; color: #1a1a1a; margin-bottom: 8px; }

    .version-badge {
      display: inline-block;
      padding: 6px 14px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 600;
      margin-top: 8px;
    }

    .card {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }

    .card h3 { font-size: 18px; font-weight: 700; margin-bottom: 16px; color: #1a1a1a; }

    .address-box {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 12px;
    }

    .address-code {
      flex: 1;
      background: #f0f0f0;
      padding: 12px 16px;
      border-radius: 10px;
      font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      font-size: 13px;
      color: #667eea;
      word-break: break-all;
      font-weight: 600;
    }

    .external-link {
      padding: 8px 16px;
      background: #667eea;
      color: white;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 13px;
      white-space: nowrap;
      transition: all 0.2s;
    }

    .external-link:hover {
      background: #5856d6;
      transform: translateY(-1px);
    }

    .balance-display {
      margin-top: 20px;
      padding: 20px;
      background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
      border-radius: 12px;
      border: 2px solid rgba(102, 126, 234, 0.2);
    }

    .balance-label { font-size: 14px; color: #666; margin-bottom: 6px; }
    .balance-amount { font-size: 32px; font-weight: 700; color: #667eea; }

    table { width: 100%; margin-top: 16px; border-collapse: separate; border-spacing: 0; }
    
    th {
      text-align: left;
      font-size: 13px;
      font-weight: 600;
      color: #888;
      padding: 12px 8px;
      border-bottom: 2px solid #e0e0e0;
    }

    td {
      padding: 14px 8px;
      border-bottom: 1px solid #f0f0f0;
      font-size: 14px;
    }

    tr:last-child td { border-bottom: none; }

    .token-mint {
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 12px;
      color: #667eea;
      font-weight: 600;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .form-row {
      display: flex;
      gap: 10px;
      align-items: stretch;
    }

    input, select {
      padding: 12px 16px;
      border-radius: 10px;
      border: 1px solid #d0d0d0;
      font-size: 15px;
      font-family: inherit;
      transition: all 0.2s;
      background: white;
    }

    input:focus, select:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }

    .swap-arrow {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 12px;
      font-size: 20px;
      color: #667eea;
      font-weight: 700;
    }

    button[type="submit"] {
      padding: 14px 24px;
      border-radius: 10px;
      border: none;
      font-weight: 700;
      font-size: 15px;
      cursor: pointer;
      color: white;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      transition: all 0.2s;
      box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
      width: 100%;
      margin-top: 8px;
    }

    button[type="submit"]:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 25px rgba(102, 126, 234, 0.4);
    }

    .info-box {
      margin-top: 16px;
      padding: 16px;
      background: #fff9e6;
      border-left: 4px solid #ffd54f;
      border-radius: 8px;
      font-size: 14px;
      line-height: 1.6;
      color: #666;
    }

    .info-box strong { color: #1a1a1a; }

    .swap-container {
      background: #f8f9fa;
      border-radius: 12px;
      padding: 20px;
      margin-top: 8px;
    }

    .swap-input-group {
      background: white;
      padding: 16px;
      border-radius: 10px;
      margin-bottom: 12px;
    }

    .swap-label {
      font-size: 12px;
      font-weight: 600;
      color: #888;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .empty-tokens {
      text-align: center;
      padding: 40px 20px;
      color: #999;
    }

    @media (max-width: 640px) {
      body { padding: 16px; }
      .header { padding: 20px; }
      .header h1 { font-size: 24px; }
      .card { padding: 20px; }
      .balance-amount { font-size: 24px; }
      .back-nav { flex-direction: column; }
      .back-link { justify-content: center; }
      .address-box { flex-direction: column; }
      .external-link { width: 100%; text-align: center; }
      .form-row { flex-direction: column; }
      .swap-arrow { transform: rotate(90deg); }
      table { font-size: 12px; }
      th, td { padding: 10px 6px; }
    }
  </style>
</head>
<body>
${
  req.query.success
    ? `
      <div style="
        background:#e6fffa;
        border:1px solid #81e6d9;
        color:#065f46;
        padding:12px 14px;
        border-radius:10px;
        margin-bottom:16px;
        font-size:14px;
      ">
        <strong>Swap successful!</strong><br/>
        ${
          req.query.sig
            ? `<a href="https://solscan.io/tx/${req.query.sig}" target="_blank">
                View transaction
              </a>`
            : ""
        }
      </div>
    `
    : ""
}

${
  req.query.error
    ? `
      <div style="
        background:#ffe6e6;
        border:1px solid #ffb3b3;
        color:#7f1d1d;
        padding:12px 14px;
        border-radius:10px;
        margin-bottom:16px;
        font-size:14px;
      ">
        <strong>Transaction failed:</strong><br/>
        ${req.query.error}
      </div>
    `
    : ""
}

  <div class="container">
    <div class="back-nav">
      <a href="/api/root/${nodeId}${queryString}" class="back-link">← Back to Tree</a>
      <a href="/api/${nodeId}/${parsedVersion}/values${queryString}" class="back-link">Back to Values</a>
    </div>

    <div class="header">
      <h1>🪙 Solana Wallet</h1>
      <span class="version-badge">Version ${parsedVersion}</span>
    </div>

    <!-- Wallet Address -->
    <div class="card">
      <h3>Wallet Address</h3>
      <div class="address-box">
        <div class="address-code">${walletInfo.publicKey}</div>
        <a href="https://solscan.io/account/${
          walletInfo.publicKey
        }" target="_blank" rel="noopener noreferrer" class="external-link">
          View on Solscan →
        </a>
      </div>

      <div class="balance-display">
        <div class="balance-label">SOL Balance</div>
        <div class="balance-amount">${(walletInfo.solBalance / 1e9).toFixed(
          4
        )} SOL</div>
      </div>
    </div>

    <!-- Token Balances -->
    <div class="card">
      <h3>Token Balances</h3>
      ${
        walletInfo.tokens?.length
          ? `
        <table>
          <thead>
            <tr>
              <th>Token</th>
              <th>Amount</th>
              <th>USD Value</th>
            </tr>
          </thead>
          <tbody>
            ${walletInfo.tokens
              .map(
                (t) => `
              <tr>
                <td>
                  <a href="https://solscan.io/token/${
                    t.mint
                  }" target="_blank" rel="noopener noreferrer" style="text-decoration: none;">
                    <span class="token-mint">${t.mint.slice(
                      0,
                      6
                    )}…${t.mint.slice(-4)}</span>
                  </a>
                </td>
                <td>${Number(t.uiAmount)
                  .toFixed(6)
                  .replace(/\.?0+$/, "")}</td>
                <td>${t.usd != null ? `$${t.usd.toFixed(2)}` : "—"}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      `
          : `<div class="empty-tokens">No SPL tokens found</div>`
      }
    </div>

    <!-- Send SOL -->
    <div class="card">
      <h3>💸 Send SOL</h3>
      <form method="POST" action="/api/${nodeId}/${parsedVersion}/values/solana/send?token=${
        req.query.token ?? ""
      }&html">
        <div class="form-group">
          <input type="text" name="destination" placeholder="Destination address or node ID" required />
          <input type="number" name="amount" step="any" min="0" placeholder="Amount in SOL" required />
          <button type="submit">Send SOL</button>
        </div>
      </form>
      <div class="info-box">
        <strong>Transaction Fee:</strong> Each transaction requires a small network fee. Minimum balance of 0.001 SOL recommended. New wallets require 0.0009 SOL rent-exempt minimum.
      </div>
    </div>

    <!-- Swap -->
    <div class="card">
      <h3>🔄 Swap Tokens</h3>
      <form method="POST" action="/api/${nodeId}/${parsedVersion}/values/solana/transaction?token=${
        req.query.token ?? ""
      }&html">
        <div class="swap-container">
          <div class="swap-input-group">
            <div class="swap-label">From</div>
            <div class="form-row">
              <select name="fromType" id="fromType" required style="flex: 1;">
                <option value="sol">SOL</option>
                <option value="token">Token</option>
              </select>
              <input type="number" name="amount" step="any" min="0" placeholder="Amount" required style="flex: 2;" />
            </div>
            <input type="text" name="inputMint" id="fromTokenMint" placeholder="Token Mint Address" style="display:none; margin-top: 8px;" />
          </div>

          <div class="swap-arrow">↓</div>

          <div class="swap-input-group">
            <div class="swap-label">To</div>
            <div class="form-row">
              <select name="toType" id="toType" required style="flex: 1;">
                <option value="token">Token</option>
                <option value="sol">SOL</option>
              </select>
              <input type="text" name="outputMint" id="toTokenMint" placeholder="Token Mint Address" style="flex: 2;" />
            </div>
          </div>
        </div>

        <button type="submit">Execute Swap</button>
      </form>
      
    </div>
  </div>

  <script>
    const fromType = document.getElementById("fromType");
    const toType = document.getElementById("toType");
    const fromTokenMint = document.getElementById("fromTokenMint");
    const toTokenMint = document.getElementById("toTokenMint");
    const SOL_MINT = "So11111111111111111111111111111111111111112";

    function updateSwapFields() {
      // Prevent SOL -> SOL
      if (fromType.value === "sol" && toType.value === "sol") {
        toType.value = "token";
      }

      // FROM field
      if (fromType.value === "token") {
        fromTokenMint.style.display = "block";
        fromTokenMint.required = true;
        if (fromTokenMint.value === SOL_MINT) {
          fromTokenMint.value = "";
        }
      } else {
        fromTokenMint.style.display = "none";
        fromTokenMint.required = false;
        fromTokenMint.value = SOL_MINT;
      }

      // TO field
      if (toType.value === "token") {
        toTokenMint.style.display = "block";
        toTokenMint.required = true;
        if (toTokenMint.value === SOL_MINT) {
          toTokenMint.value = "";
        }
      } else {
        toTokenMint.style.display = "none";
        toTokenMint.required = false;
        toTokenMint.value = SOL_MINT;
      }
    }

    fromType.addEventListener("change", updateSwapFields);
    toType.addEventListener("change", updateSwapFields);
    updateSwapFields();
  </script>
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

router.post(
  "/:nodeId/:version/values/solana/transaction",
  authenticate,

  async (req, res) => {
    const { nodeId, version } = req.params;
    const parsedVersion = Number(version);

    try {
      if (!Number.isInteger(parsedVersion) || parsedVersion < 0) {
        throw new Error("Invalid version");
      }

      const { fromType, toType, amount, slippageBps } = req.body;
      const SOL_MINT = "So11111111111111111111111111111111111111112";

      if (!["sol", "token"].includes(fromType)) {
        throw new Error("Invalid fromType");
      }
      if (!["sol", "token"].includes(toType)) {
        throw new Error("Invalid toType");
      }
      if (fromType === "sol" && toType === "sol") {
        throw new Error("SOL to SOL swap is not allowed");
      }

      const inputMint = fromType === "sol" ? SOL_MINT : req.body.inputMint;
      const outputMint = toType === "sol" ? SOL_MINT : req.body.outputMint;

      const uiAmount = Number(amount);
      if (!Number.isFinite(uiAmount) || uiAmount <= 0) {
        throw new Error("Invalid amount");
      }

      const result = await swapFromVersion({
        nodeId,
        versionIndex: parsedVersion,
        inputMint,
        outputMint,
        amountUi: uiAmount,
        slippageBps,
      });

      /* ---------------- SUCCESS ---------------- */

      if ("html" in req.query) {
        return res.redirect(
          `/api/${nodeId}/${parsedVersion}/values/solana?` +
            `success=1&sig=${result.signature}&token=${
              req.query.token ?? ""
            }&html`
        );
      }

      return res.json({ success: true, ...result });
    } catch (err) {
      console.error("Swap transaction error:", err);

      /* ---------------- FAILURE ---------------- */

      if ("html" in req.query) {
        return res.redirect(
          `/api/${nodeId}/${parsedVersion}/values/solana?` +
            `error=${encodeURIComponent(err.message)}&token=${
              req.query.token ?? ""
            }&html`
        );
      }

      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
