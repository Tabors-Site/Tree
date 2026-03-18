import express from "express";
import urlAuth from "../middleware/urlAuth.js";
import { findNodeById } from "../db/utils.js";
import Node from "../db/models/node.js";
import { resolveVersion } from "../core/treeFetch.js";

const router = express.Router();

// Resolve "latest" to actual prestige number for any route with :version
router.param("version", async (req, res, next, val) => {
  try {
    req.params.version = String(await resolveVersion(req.params.nodeId, val));
    next();
  } catch (err) {
    return res.status(404).json({ error: err.message });
  }
});

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
router.post("/node/:nodeId/:version/value", authenticate, async (req, res) => {
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
        `/api/v1/node/${nodeId}/${version}/values?token=${req.query.token ?? ""}&html`,
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// SET GOAL
router.post("/node/:nodeId/:version/goal", authenticate, async (req, res) => {
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
        `/api/v1/node/${nodeId}/${version}/values?token=${req.query.token ?? ""}&html`,
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get("/node/:nodeId/:version/values", urlAuth, async (req, res) => {
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
      new Set([...Object.keys(values), ...Object.keys(goals)]),
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
  /* =========================================================
   GLOBAL VARIABLES — matches root route
   ========================================================= */

:root {
  --glass-water-rgb: 115, 111, 230;
  --glass-alpha: 0.28;
  --glass-alpha-hover: 0.38;
}

/* =========================================================
   RESET & BASE
   ========================================================= */

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto",
    "Oxygen", "Ubuntu", "Cantarell", sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  min-height: 100dvh;
  padding: 20px;
  color: #1a1a1a;
  position: relative;
  overflow-x: hidden;
  touch-action: manipulation;
}

/* =========================================================
   ANIMATED BACKGROUND
   ========================================================= */

body::before,
body::after {
  content: "";
  position: fixed;
  border-radius: 50%;
  opacity: 0.08;
  animation: float 20s infinite ease-in-out;
  pointer-events: none;
}

body::before {
  width: 600px;
  height: 600px;
  background: white;
  top: -300px;
  right: -200px;
  animation-delay: -5s;
}

body::after {
  width: 400px;
  height: 400px;
  background: white;
  bottom: -200px;
  left: -100px;
  animation-delay: -10s;
}

@keyframes float {
  0%,
  100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-30px) rotate(5deg);
  }
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* =========================================================
   LAYOUT
   ========================================================= */

.container {
  max-width: 900px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* =========================================================
   UNIFIED GLASS BUTTON SYSTEM
   ========================================================= */

.glass-btn,
button,
.back-link,
.value-form button {
  position: relative;
  overflow: hidden;

  padding: 10px 20px;
  border-radius: 980px;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;

  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);

  color: white;
  text-decoration: none;
  font-family: inherit;

  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.2px;

  border: 1px solid rgba(255, 255, 255, 0.28);

  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);

  cursor: pointer;

  transition:
    background 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.3s ease;
}

/* Liquid light layer */
.glass-btn::before,
button::before,
.back-link::before,
.value-form button::before {
  content: "";
  position: absolute;
  inset: -40%;

  background:
    radial-gradient(
      120% 60% at 0% 0%,
      rgba(255, 255, 255, 0.35),
      transparent 60%
    ),
    linear-gradient(
      120deg,
      transparent 30%,
      rgba(255, 255, 255, 0.25),
      transparent 70%
    );

  opacity: 0;
  transform: translateX(-30%) translateY(-10%);
  transition:
    opacity 0.35s ease,
    transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);

  pointer-events: none;
}

/* Hover motion */
.glass-btn:hover,
button:hover,
.back-link:hover,
.value-form button:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-2px);
}

.glass-btn:hover::before,
button:hover::before,
.back-link:hover::before,
.value-form button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Active press */
.glass-btn:active,
button:active,
.value-form button:active {
  background: rgba(var(--glass-water-rgb), 0.45);
  transform: translateY(0);
}

/* Button variants */
.save-btn {
  padding: 8px 14px;
  font-size: 13px;
  --glass-water-rgb: 72, 187, 178;
  --glass-alpha: 0.34;
  --glass-alpha-hover: 0.46;
}

.add-button {
  --glass-water-rgb: 72, 187, 178;
  --glass-alpha: 0.34;
  --glass-alpha-hover: 0.46;
  font-weight: 600;
}

/* =========================================================
   CONTENT CARDS - UPDATED TO MATCH ROOT ROUTE
   ========================================================= */

.header {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 16px;
  padding: 28px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.28);
  margin-bottom: 24px;
  animation: fadeInUp 0.6s ease-out;
  animation-fill-mode: both;
  animation-delay: 0.1s;
  position: relative;
  overflow: hidden;
}

.header::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.18),
    rgba(255, 255, 255, 0.05)
  );
  pointer-events: none;
}

.header h1 {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.5px;
  line-height: 1.3;
  margin-bottom: 8px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  color: white;
  word-break: break-word;
}

.header h1 a {
  color: white;
  text-decoration: none;
  transition: opacity 0.2s;
}

.header h1 a:hover {
  opacity: 0.8;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: white;
  letter-spacing: -0.3px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  margin-bottom: 20px;
}

/* =========================================================
   NAV
   ========================================================= */

.back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
  animation: fadeInUp 0.5s ease-out;
}

/* =========================================================
   BADGES & NODE ID
   ========================================================= */

.version-badge {
  display: inline-block;
  padding: 6px 14px;
  background: rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(10px);
  color: white;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
  margin-top: 8px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.node-id-container {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  width: 100%;
}

code {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-size: 13px;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  color: white;
  word-break: break-all;
  flex: 1;
  min-width: 0;
  overflow-wrap: break-word;
}

#copyNodeIdBtn {
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 6px;
  opacity: 1;
  font-size: 16px;
  transition: all 0.2s;
  flex-shrink: 0;
}

#copyNodeIdBtn:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: scale(1.1);
}

#copyNodeIdBtn::before {
  display: none;
}

/* =========================================================
   TABLE - NO BACKGROUND PANEL
   ========================================================= */

.table-section {
  background: transparent;
  border: none;
  box-shadow: none;
  padding: 0;
  margin-bottom: 24px;
}

table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0 8px;
  background: transparent;
  margin-top: 0;
}

thead th {
  padding: 0 0 12px 0;
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.7);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  text-align: left;
  border: none;
  background: transparent;
}

/* Hide Key and Value headers, keep only Goal */
thead th:nth-child(1),
thead th:nth-child(2),
thead th:nth-child(3) {
  opacity: 0;
  pointer-events: none;
}

tbody tr {
  background: rgba(var(--glass-water-rgb), 0.15);
  backdrop-filter: blur(10px) saturate(120%);
  -webkit-backdrop-filter: blur(10px) saturate(120%);
  border-radius: 10px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.22);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
  overflow: hidden;
}

tbody tr::before {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    180deg,
    rgba(255, 255, 255, 0.15),
    rgba(255, 255, 255, 0.04)
  );
  pointer-events: none;
}

tbody tr:hover {
  background: rgba(var(--glass-water-rgb), 0.22);
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);
}

td {
  padding: 16px 20px;
  border-bottom: none;
  color: rgba(255, 255, 255, 0.85);
  word-break: break-word;
  background: transparent;
  position: relative;
}

td code {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-weight: 600;
  border: none;
  color: rgba(255, 255, 255, 0.85);
  font-size: 14px;
  display: inline-block;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: help;
  position: relative;
}

/* Tooltip for full number on hover */
td code::after {
  content: attr(data-full);
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.9);
  color: white;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s;
  margin-bottom: 5px;
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

td code::before {
  content: '';
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-top-color: rgba(0, 0, 0, 0.9);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s;
  margin-bottom: -5px;
  z-index: 1000;
}

td code:hover::after,
td code:hover::before {
  opacity: 1;
}

/* Mobile tap behavior */
td code.show-tooltip::after,
td code.show-tooltip::before {
  opacity: 1;
}

.add-row {
  background: rgba(var(--glass-water-rgb), 0.12);
  margin-top: 4px;
}

.add-row:hover {
  background: rgba(var(--glass-water-rgb), 0.18);
}

.add-row td {
  padding: 16px 20px;
}

/* =========================================================
   FORMS
   ========================================================= */

.value-form {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.value-form input[type="text"],
.value-form input[type="number"] {
  padding: 8px 12px;
  font-size: 14px;
  border-radius: 8px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  transition: all 0.2s;
  background: rgba(255, 255, 255, 0.15);
  color: white;
  font-family: inherit;
  font-weight: 500;
  min-width: 0;
}

.value-form input[type="text"]::placeholder,
.value-form input[type="number"]::placeholder {
  color: rgba(255, 255, 255, 0.5);
}

.value-form input[type="text"]:focus,
.value-form input[type="number"]:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.6);
  background: rgba(255, 255, 255, 0.25);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.15);
  transform: translateY(-2px);
}

.value-form input[type="text"] {
  flex: 1;
  min-width: 120px;
}

.value-form input[type="number"] {
  width: 100px;
}

/* =========================================================
   EMPTY STATE
   ========================================================= */

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: rgba(255, 255, 255, 0.7);
  font-style: italic;
}

/* =========================================================
   RESPONSIVE
   ========================================================= */

@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .container {
    max-width: 100%;
  }

  .header {
    padding: 20px;
  }

  .header h1 {
    font-size: 24px;
  }

  .back-nav {
    flex-direction: column;
  }

  .back-link {
    width: 100%;
    justify-content: center;
  }

  th, td {
    padding: 10px 8px;
    font-size: 13px;
  }

  .value-form {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
  }

  .value-form input[type="text"],
  .value-form input[type="number"],
  .value-form button {
    width: 100%;
  }

  code {
    font-size: 12px;
    word-break: break-all;
  }
}

@media (min-width: 641px) and (max-width: 1024px) {
  .container {
    max-width: 700px;
  }
}

html, body {
  background: #736fe6;
  margin: 0;
  padding: 0;
}
</style>

  </head>
  <body>
    <div class="container">
      <!-- Back Navigation -->
      <div class="back-nav">
        <a href="/api/v1/root/${nodeId}${queryString}" class="back-link">
          ← Back to Tree
        </a>
        <a href="/api/v1/node/${nodeId}/${nodeVersion}${queryString}" class="back-link">
          Back to Version
        </a>
        <a
          href="/api/v1/node/${nodeId}/${parsedVersion}/values/solana${queryString}"
          class="back-link"
        >
          Solana Wallet
        </a>
      </div>

      <!-- Header -->
      <div class="header">
        <h1>
          <a href="/api/v1/node/${nodeId}/${nodeVersion}${queryString}">
            ${nodeName}
          </a>
        </h1>

        <span class="version-badge">Version ${nodeVersion}</span>

        <div class="node-id-container">
          <code id="nodeIdCode">${nodeId}</code>
          <button id="copyNodeIdBtn" title="Copy ID">📋</button>
        </div>

        <!-- Values & Goals Title -->
        <div class="section-title" style="margin-top: 24px; margin-bottom: 0;">Values & Goals</div>
      </div>

      <!-- Table Section (no background) -->
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
                        : (values[key] ?? "");

                      return `
      <tr>
        <td><code>${displayName}</code></td>

        <td>
          ${
            isAuto
              ? `<code data-full="${displayValue}">${displayValue}</code>`
              : `
                <form
                  method="POST"
                  action="/api/v1/node/${nodeId}/${parsedVersion}/value?token=${
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
                  <button type="submit" class="save-btn" style="display:none;">Save</button>
                </form>
              `
          }
        </td>

        <!-- GOALS ARE ALWAYS EDITABLE -->
        <td>
          <form
            method="POST"
            action="/api/v1/node/${nodeId}/${parsedVersion}/goal?token=${
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
            <button type="submit" class="save-btn" style="display:none;">Save</button>
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
                  action="/api/v1/node/${nodeId}/${parsedVersion}/value?token=${
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

      // Mobile tap to show tooltip
      document.querySelectorAll("td code[data-full]").forEach((codeEl) => {
        let tapTimeout;
        
        codeEl.addEventListener("click", (e) => {
          e.stopPropagation();
          
          // Remove show-tooltip from all other elements
          document.querySelectorAll("td code.show-tooltip").forEach((el) => {
            if (el !== codeEl) el.classList.remove("show-tooltip");
          });
          
          // Toggle tooltip
          codeEl.classList.toggle("show-tooltip");
          
          // Auto-hide after 3 seconds
          clearTimeout(tapTimeout);
          if (codeEl.classList.contains("show-tooltip")) {
            tapTimeout = setTimeout(() => {
              codeEl.classList.remove("show-tooltip");
            }, 3000);
          }
        });
      });
      
      // Hide tooltip when clicking elsewhere
      document.addEventListener("click", () => {
        document.querySelectorAll("td code.show-tooltip").forEach((el) => {
          el.classList.remove("show-tooltip");
        });
      });
    </script>

    <script>
      // Handle save button visibility for ALL value and goal forms
      document.querySelectorAll(".value-form").forEach((form) => {
        // Skip the "Add New" form at the bottom
        if (form.querySelector('input[name="key"][type="text"]')) {
          return;
        }

        // Get the number input (either value or goal)
        const input = form.querySelector("input[type='number']");
        const button = form.querySelector(".save-btn");

        if (!input || !button) return;

        // Get the original value from data attribute
        const original = input.dataset.original ?? "";

        function updateButton() {
          // Compare current value with original
          const currentValue = input.value.trim();
          const originalValue = original.trim();
          const changed = currentValue !== originalValue;
          
          // Show button only if value changed
          if (changed) {
            button.style.display = "inline-flex";
          } else {
            button.style.display = "none";
          }
        }

        // Set initial state (button should be hidden)
        updateButton();

        // Watch for changes in real-time
        input.addEventListener("input", updateButton);
        
        // Also check on blur to handle edge cases
        input.addEventListener("blur", updateButton);
      });
    </script>
  </body>
  </html>
  `);
  } catch (err) {
    console.error("Error in /node/:nodeId/:version/values:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get(
  "/node/:nodeId/:version/values/solana",
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
    /* =========================================================
   GLOBAL VARIABLES
   ========================================================= */

:root {
  --glass-water-rgb: 115, 111, 230;
  --glass-alpha: 0.28;
  --glass-alpha-hover: 0.38;
}

/* =========================================================
   RESET & BASE
   ========================================================= */

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto",
    "Oxygen", "Ubuntu", "Cantarell", sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  min-height: 100dvh;
  padding: 20px;
  color: #1a1a1a;
  position: relative;
  overflow-x: hidden;
  touch-action: manipulation;
}

/* =========================================================
   ANIMATED BACKGROUND
   ========================================================= */

body::before,
body::after {
  content: "";
  position: fixed;
  border-radius: 50%;
  opacity: 0.08;
  animation: float 20s infinite ease-in-out;
  pointer-events: none;
}

body::before {
  width: 600px;
  height: 600px;
  background: white;
  top: -300px;
  right: -200px;
  animation-delay: -5s;
}

body::after {
  width: 400px;
  height: 400px;
  background: white;
  bottom: -200px;
  left: -100px;
  animation-delay: -10s;
}

@keyframes float {
  0%,
  100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-30px) rotate(5deg);
  }
}

/* =========================================================
   LAYOUT
   ========================================================= */

.container {
  max-width: 900px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* =========================================================
   UNIFIED GLASS BUTTON SYSTEM
   ========================================================= */

.glass-btn,
button,
.back-link,
.create-button {
  position: relative;
  overflow: hidden;

  padding: 10px 20px;
  border-radius: 980px;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;

  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);

  color: white;
  text-decoration: none;
  font-family: inherit;

  font-size: 15px;
  font-weight: 500;
  letter-spacing: -0.2px;

  border: 1px solid rgba(255, 255, 255, 0.28);

  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);

  cursor: pointer;

  transition:
    background 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.3s ease;
}

/* Liquid light layer */
.glass-btn::before,
button::before,
.back-link::before,
.create-button::before {
  content: "";
  position: absolute;
  inset: -40%;

  background:
    radial-gradient(
      120% 60% at 0% 0%,
      rgba(255, 255, 255, 0.35),
      transparent 60%
    ),
    linear-gradient(
      120deg,
      transparent 30%,
      rgba(255, 255, 255, 0.25),
      transparent 70%
    );

  opacity: 0;
  transform: translateX(-30%) translateY(-10%);
  transition:
    opacity 0.35s ease,
    transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);

  pointer-events: none;
}

/* Hover motion */
.glass-btn:hover,
button:hover,
.back-link:hover,
.create-button:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-1px);
  animation: waterDrift 2.2s ease-in-out infinite alternate;
}

.glass-btn:hover::before,
button:hover::before,
.back-link:hover::before,
.create-button:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Active press */
.glass-btn:active,
button:active,
.create-button:active {
  background: rgba(var(--glass-water-rgb), 0.45);
  transform: translateY(0);
  animation: none;
}

@keyframes waterDrift {
  0% { transform: translateY(-1px); }
  100% { transform: translateY(1px); }
}

/* Button variants */
.create-button {
  --glass-alpha: 0.34;
  --glass-alpha-hover: 0.46;
  font-weight: 600;
  padding: 14px 32px;
  font-size: 16px;
}

/* =========================================================
   CONTENT CARDS
   ========================================================= */

.header,
.empty-state {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 14px;
  padding: 28px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  margin-bottom: 24px;
}

.header h1 {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.5px;
  line-height: 1.3;
  margin-bottom: 8px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  color: white;
}

.version-badge {
  display: inline-block;
  padding: 6px 14px;
  background: rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(10px);
  color: white;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
  margin-top: 8px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.empty-state {
  padding: 60px 40px;
  text-align: center;
}

.empty-state-icon {
  font-size: 64px;
  margin-bottom: 16px;
}

.empty-state-text {
  font-size: 18px;
  color: rgba(255, 255, 255, 0.9);
  margin-bottom: 24px;
}

/* =========================================================
   NAV
   ========================================================= */

.back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

/* =========================================================
   RESPONSIVE
   ========================================================= */

@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .container {
    max-width: 100%;
  }

  .header,
  .empty-state {
    padding: 20px;
  }

  .header h1 {
    font-size: 24px;
  }

  .empty-state {
    padding: 40px 24px;
  }

  .back-nav {
    flex-direction: column;
  }

  .back-link {
    width: 100%;
    justify-content: center;
  }
}

html, body {
  background: #736fe6;
  margin: 0;
  padding: 0;
}
  </style>
</head>
<body>
  <div class="container">
    <div class="back-nav">
      <a href="/api/v1/root/${nodeId}${queryString}" class="back-link">← Back to Tree</a>
      <a href="/api/v1/node/${nodeId}/${parsedVersion}/values${queryString}" class="back-link">Back to Values</a>
    </div>

    <div class="header">
      <h1>🪙 Solana Wallet</h1>
      <span class="version-badge">Version ${parsedVersion}</span>
    </div>

    <div class="empty-state">
      <div class="empty-state-icon">👛</div>
      <div class="empty-state-text">No wallet exists for this version</div>
      <form method="POST" action="/api/v1/node/${nodeId}/${parsedVersion}/values/solana?token=${
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
    /* =========================================================
   GLOBAL VARIABLES
   ========================================================= */

:root {
  --glass-water-rgb: 115, 111, 230;
  --glass-alpha: 0.28;
  --glass-alpha-hover: 0.38;
}

/* =========================================================
   RESET & BASE
   ========================================================= */

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  -webkit-tap-highlight-color: transparent;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto",
    "Oxygen", "Ubuntu", "Cantarell", sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  min-height: 100dvh;
  padding: 20px;
  color: #1a1a1a;
  position: relative;
  overflow-x: hidden;
  touch-action: manipulation;
}

/* =========================================================
   ANIMATED BACKGROUND
   ========================================================= */

body::before,
body::after {
  content: "";
  position: fixed;
  border-radius: 50%;
  opacity: 0.08;
  animation: float 20s infinite ease-in-out;
  pointer-events: none;
}

body::before {
  width: 600px;
  height: 600px;
  background: white;
  top: -300px;
  right: -200px;
  animation-delay: -5s;
}

body::after {
  width: 400px;
  height: 400px;
  background: white;
  bottom: -200px;
  left: -100px;
  animation-delay: -10s;
}

@keyframes float {
  0%,
  100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-30px) rotate(5deg);
  }
}

/* =========================================================
   LAYOUT
   ========================================================= */

.container {
  max-width: 900px;
  margin: 0 auto;
  position: relative;
  z-index: 1;
}

/* =========================================================
   UNIFIED GLASS BUTTON SYSTEM
   ========================================================= */

.glass-btn,
button,
.back-link,
.external-link {
  position: relative;
  overflow: hidden;

  padding: 10px 20px;
  border-radius: 980px;

  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;

  background: rgba(var(--glass-water-rgb), var(--glass-alpha));
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);

  color: white;
  text-decoration: none;
  font-family: inherit;

  font-size: 15px;
  font-weight: 500;
  letter-spacing: -0.2px;

  border: 1px solid rgba(255, 255, 255, 0.28);

  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.25);

  cursor: pointer;

  transition:
    background 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    transform 0.3s cubic-bezier(0.4, 0, 0.2, 1),
    box-shadow 0.3s ease;
}

/* Liquid light layer */
.glass-btn::before,
button::before,
.back-link::before,
.external-link::before {
  content: "";
  position: absolute;
  inset: -40%;

  background:
    radial-gradient(
      120% 60% at 0% 0%,
      rgba(255, 255, 255, 0.35),
      transparent 60%
    ),
    linear-gradient(
      120deg,
      transparent 30%,
      rgba(255, 255, 255, 0.25),
      transparent 70%
    );

  opacity: 0;
  transform: translateX(-30%) translateY(-10%);
  transition:
    opacity 0.35s ease,
    transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);

  pointer-events: none;
}

/* Hover motion */
.glass-btn:hover,
button:hover,
.back-link:hover,
.external-link:hover {
  background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover));
  transform: translateY(-1px);
  animation: waterDrift 2.2s ease-in-out infinite alternate;
}

.glass-btn:hover::before,
button:hover::before,
.back-link:hover::before,
.external-link:hover::before {
  opacity: 1;
  transform: translateX(30%) translateY(10%);
}

/* Active press */
.glass-btn:active,
button:active,
.external-link:active {
  background: rgba(var(--glass-water-rgb), 0.45);
  transform: translateY(0);
  animation: none;
}

@keyframes waterDrift {
  0% { transform: translateY(-1px); }
  100% { transform: translateY(1px); }
}

/* Button variants */
button[type="submit"] {
  --glass-alpha: 0.34;
  --glass-alpha-hover: 0.46;
  font-weight: 600;
  padding: 14px 24px;
  width: 100%;
  margin-top: 8px;
}

.external-link {
  padding: 8px 16px;
  font-size: 13px;
}

/* =========================================================
   CONTENT CARDS
   ========================================================= */

.header,
.card {
  background: rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(22px) saturate(140%);
  -webkit-backdrop-filter: blur(22px) saturate(140%);
  border-radius: 14px;
  padding: 28px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  color: white;
  margin-bottom: 24px;
}

.card {
  padding: 24px;
  margin-bottom: 16px;
}

.header h1 {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.5px;
  line-height: 1.3;
  margin-bottom: 8px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  color: white;
}

.card h3 {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 16px;
  color: white;
  letter-spacing: -0.3px;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.version-badge {
  display: inline-block;
  padding: 6px 14px;
  background: rgba(255, 255, 255, 0.25);
  backdrop-filter: blur(10px);
  color: white;
  border-radius: 20px;
  font-size: 14px;
  font-weight: 600;
  margin-top: 8px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

/* =========================================================
   NAV
   ========================================================= */

.back-nav {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}

/* =========================================================
   WALLET COMPONENTS
   ========================================================= */

.address-box {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
}

.address-code {
  flex: 1;
  min-width: 0;
  background: rgba(255, 255, 255, 0.2);
  padding: 12px 16px;
  border-radius: 10px;
  font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
  font-size: 13px;
  color: white;
  word-break: break-all;
  font-weight: 600;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.balance-display {
  margin-top: 20px;
  padding: 20px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  border: 2px solid rgba(255, 255, 255, 0.3);
}

.balance-label {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
  margin-bottom: 6px;
}

.balance-amount {
  font-size: 32px;
  font-weight: 700;
  color: white;
}

/* =========================================================
   TABLES
   ========================================================= */

table {
  width: 100%;
  margin-top: 16px;
  border-collapse: separate;
  border-spacing: 0;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  overflow: hidden;
}

th {
  text-align: left;
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
  padding: 12px 8px;
  border-bottom: 2px solid rgba(255, 255, 255, 0.2);
  background: rgba(255, 255, 255, 0.15);
}

td {
  padding: 14px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 14px;
  color: white;
}

tr:last-child td {
  border-bottom: none;
}

tbody tr {
  transition: background 0.2s;
}

tbody tr:hover {
  background: rgba(255, 255, 255, 0.05);
}

.token-mint {
  font-family: 'SF Mono', Monaco, monospace;
  font-size: 12px;
  color: white;
  font-weight: 600;
}

.token-mint:hover {
  opacity: 0.8;
}

.empty-tokens {
  text-align: center;
  padding: 40px 20px;
  color: rgba(255, 255, 255, 0.7);
  font-style: italic;
}

/* =========================================================
   FORMS
   ========================================================= */

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

input,
select {
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.3);
  font-size: 15px;
  font-family: inherit;
  transition: all 0.2s;
  background: rgba(255, 255, 255, 0.2);
  color: white;
}

input::placeholder {
  color: rgba(255, 255, 255, 0.6);
}

input:focus,
select:focus {
  outline: none;
  border-color: rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.25);
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.1);
}

select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L6 6L11 1' stroke='white' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 36px;
}

.swap-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  font-size: 20px;
  color: white;
  font-weight: 700;
}

.info-box {
  margin-top: 16px;
  padding: 16px;
  background: rgba(255, 193, 7, 0.2);
  border-left: 4px solid #ffa500;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.9);
}

.info-box strong {
  color: white;
}

.swap-container {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  padding: 20px;
  margin-top: 8px;
}

.swap-input-group {
  background: rgba(255, 255, 255, 0.15);
  padding: 16px;
  border-radius: 10px;
  margin-bottom: 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.swap-label {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.8);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* =========================================================
   ALERTS
   ========================================================= */

.alert {
  padding: 12px 14px;
  border-radius: 10px;
  margin-bottom: 16px;
  font-size: 14px;
  border: 1px solid;
}

.alert-success {
  background: rgba(16, 185, 129, 0.2);
  border-color: rgba(16, 185, 129, 0.5);
  color: white;
}

.alert-error {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.5);
  color: white;
}

.alert strong {
  font-weight: 600;
}

.alert a {
  color: white;
  text-decoration: underline;
}

/* =========================================================
   RESPONSIVE
   ========================================================= */

@media (max-width: 640px) {
  body {
    padding: 16px;
  }

  .container {
    max-width: 100%;
  }

  .header,
  .card {
    padding: 20px;
  }

  .header h1 {
    font-size: 24px;
  }

  .balance-amount {
    font-size: 24px;
  }

  .back-nav {
    flex-direction: column;
  }

  .back-link {
    width: 100%;
    justify-content: center;
  }

  .address-box {
    flex-direction: column;
  }

  .external-link {
    width: 100%;
    text-align: center;
  }

  .form-row {
    flex-direction: column;
  }

  .swap-arrow {
    transform: rotate(90deg);
  }

  table {
    font-size: 12px;
  }

  th,
  td {
    padding: 10px 6px;
  }
}

html, body {
  background: #736fe6;
  margin: 0;
  padding: 0;
}
  </style>
</head>
<body>
  <div class="container">
${
  req.query.success
    ? `
      <div class="alert alert-success">
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
      <div class="alert alert-error">
        <strong>Transaction failed:</strong><br/>
        ${req.query.error}
      </div>
    `
    : ""
}

    <div class="back-nav">
      <a href="/api/v1/root/${nodeId}${queryString}" class="back-link">← Back to Tree</a>
      <a href="/api/v1/node/${nodeId}/${parsedVersion}/values${queryString}" class="back-link">Back to Values</a>
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
          4,
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
                      6,
                    )}…${t.mint.slice(-4)}</span>
                  </a>
                </td>
                <td>${Number(t.uiAmount)
                  .toFixed(6)
                  .replace(/\.?0+$/, "")}</td>
                <td>${t.usd != null ? `$${t.usd.toFixed(2)}` : "—"}</td>
              </tr>
            `,
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
      <form method="POST" action="/api/v1/node/${nodeId}/${parsedVersion}/values/solana/send?token=${
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
      <form method="POST" action="/api/v1/node/${nodeId}/${parsedVersion}/values/solana/transaction?token=${
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
      console.error("Error in /node/:nodeId/:version/values/solana:", err);
      res.status(500).json({ error: err.message });
    }
  },
);

router.post(
  "/node/:nodeId/:version/values/solana",
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
          `/api/v1/node/${nodeId}/${parsedVersion}/values/solana?token=${
            req.query.token ?? ""
          }&html`,
        );
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  },
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
  "/node/:nodeId/:version/values/solana/send",
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
          `/api/v1/node/${nodeId}/${parsedVersion}/values/solana?token=${
            req.query.token ?? ""
          }&html`,
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
  },
);

router.post(
  "/node/:nodeId/:version/values/solana/transaction",
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
          `/api/v1/node/${nodeId}/${parsedVersion}/values/solana?` +
            `success=1&sig=${result.signature}&token=${
              req.query.token ?? ""
            }&html`,
        );
      }

      return res.json({ success: true, ...result });
    } catch (err) {
      console.error("Swap transaction error:", err);

      /* ---------------- FAILURE ---------------- */

      if ("html" in req.query) {
        return res.redirect(
          `/api/v1/node/${nodeId}/${parsedVersion}/values/solana?` +
            `error=${encodeURIComponent(err.message)}&token=${
              req.query.token ?? ""
            }&html`,
        );
      }

      res.status(500).json({ error: err.message });
    }
  },
);

export default router;
