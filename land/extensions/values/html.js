/* ------------------------------------------------- */
/* HTML renderer for values page                      */
/* ------------------------------------------------- */

import { baseStyles } from "../html-rendering/html/baseStyles.js";

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

export function renderValues({
  nodeId,
  version,
  nodeName,
  nodeVersion,
  allKeys,
  values,
  goals,
  queryString,
  token,
}) {
  const parsedVersion = Number(version);

  const tableRows =
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
                  action="/api/v1/node/${nodeId}/${parsedVersion}/value?token=${token}&html"
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
            action="/api/v1/node/${nodeId}/${parsedVersion}/goal?token=${token}&html"
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
              `;

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#667eea">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <title>${nodeName} — Values & Goals</title>
<style>
${baseStyles}

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
            ${tableRows}

            <!-- Add New Row -->
            <tr class="add-row">
              <td colspan="3">
                <form
                  method="POST"
                  action="/api/v1/node/${nodeId}/${parsedVersion}/value?token=${token}&html"
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
  `;
}
