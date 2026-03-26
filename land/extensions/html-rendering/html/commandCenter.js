// Command Center renderer.
// Full capability surface of a tree at any position.
// Tools, modes, extensions. Color-coded. Toggleable. Military-grade overview.

import { esc, truncate, modeLabel } from "./utils.js";

const STATUS_COLORS = {
  active:     { bg: "rgba(74,222,128,0.12)", border: "rgba(74,222,128,0.3)", text: "#4ade80", label: "ACTIVE" },
  blocked:    { bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.3)",  text: "#ef4444", label: "BLOCKED" },
  restricted: { bg: "rgba(234,179,8,0.12)",  border: "rgba(234,179,8,0.3)",  text: "#eab308", label: "READ ONLY" },
  confined:   { bg: "rgba(59,130,246,0.12)", border: "rgba(59,130,246,0.3)", text: "#3b82f6", label: "CONFINED" },
  unavailable:{ bg: "rgba(107,114,128,0.08)",border: "rgba(107,114,128,0.2)",text: "#6b7280", label: "UNAVAILABLE" },
};

function badge(status) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.unavailable;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:0.7rem;font-weight:600;letter-spacing:0.5px;background:${c.bg};color:${c.text};border:1px solid ${c.border};">${c.label}</span>`;
}

function dot(status) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.unavailable;
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c.text};margin-right:8px;flex-shrink:0;"></span>`;
}

export function renderCommandCenter({
  nodeId, nodeName, rootId, rootName, path,
  extensions, tools, modes, toolConfig, modeOverrides,
  blocked, restricted, allowed, confined, qs,
}) {
  const totalTools = tools.length;
  const activeTools = tools.filter(t => t.status === "active").length;
  const totalModes = modes.length;
  const activeModes = modes.filter(m => m.status === "active").length;
  const totalExts = extensions.length;
  const activeExts = extensions.filter(e => e.status === "active").length;

  // Group tools by extension
  const toolsByExt = {};
  for (const tool of tools) {
    const ext = tool.extName || "unknown";
    if (!toolsByExt[ext]) toolsByExt[ext] = [];
    toolsByExt[ext].push(tool);
  }

  // Group modes by bigMode
  const modesByBig = {};
  for (const mode of modes) {
    const big = mode.bigMode || "tree";
    if (!modesByBig[big]) modesByBig[big] = [];
    modesByBig[big].push(mode);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Command Center . ${esc(nodeName)}</title>
  <style>${CSS}</style>
</head>
<body>
  <div class="cc">

    <!-- HEADER -->
    <header class="cc-header">
      <div class="cc-container">
        <div class="cc-breadcrumb">${esc(path || rootName || rootId)}</div>
        <h1 class="cc-title">Command Center</h1>
        <p class="cc-subtitle">${esc(nodeName)} . ${activeTools}/${totalTools} tools . ${activeModes}/${totalModes} modes . ${activeExts}/${totalExts} extensions</p>
      </div>
    </header>

    <!-- KEY -->
    <div class="cc-key">
      <div class="cc-container cc-key-inner">
        ${Object.entries(STATUS_COLORS).map(([k, v]) =>
          `<span class="cc-key-item">${dot(k)} ${v.label}</span>`
        ).join("")}
      </div>
    </div>

    <!-- MAIN GRID -->
    <div class="cc-container">
      <div class="cc-grid">

        <!-- EXTENSIONS COLUMN -->
        <section class="cc-col">
          <h2 class="cc-col-title">Extensions <span class="cc-count">${activeExts}/${totalExts}</span></h2>
          ${extensions.map(ext => {
            const extTools = toolsByExt[ext.name] || [];
            const extModes = modes.filter(m => m.extName === ext.name);
            return `
            <details class="cc-item">
              <summary class="cc-item-row">
                ${dot(ext.status)}
                <span class="cc-item-name">${esc(ext.name)}</span>
                <span class="cc-item-version">${esc(ext.version || "")}</span>
                ${badge(ext.status)}
              </summary>
              <div class="cc-item-detail">
                ${ext.description ? `<p class="cc-item-desc">${esc(truncate(ext.description, 200))}</p>` : ""}
                ${extTools.length > 0 ? `<div class="cc-item-sub"><strong>Tools:</strong> ${extTools.map(t => `<span style="color:${(STATUS_COLORS[t.status]||{}).text||"#888"}">${esc(t.name)}</span>`).join(", ")}</div>` : ""}
                ${extModes.length > 0 ? `<div class="cc-item-sub"><strong>Modes:</strong> ${extModes.map(m => `<span style="color:${(STATUS_COLORS[m.status]||{}).text||"#888"}">${m.emoji||""} ${esc(m.label || m.key)}</span>`).join(", ")}</div>` : ""}
                ${ext.status === "active" ? `
                  <form method="POST" action="/api/v1/node/${nodeId}/extensions${qs}" class="cc-toggle-form">
                    <input type="hidden" name="block" value="${esc(ext.name)}" />
                    <button type="submit" class="cc-btn cc-btn-red">Block at this node</button>
                  </form>
                ` : ""}
                ${ext.status === "blocked" ? `
                  <form method="POST" action="/api/v1/node/${nodeId}/extensions${qs}" class="cc-toggle-form">
                    <input type="hidden" name="allow" value="${esc(ext.name)}" />
                    <button type="submit" class="cc-btn cc-btn-green">Unblock</button>
                  </form>
                ` : ""}
              </div>
            </details>`;
          }).join("")}
        </section>

        <!-- TOOLS COLUMN -->
        <section class="cc-col">
          <h2 class="cc-col-title">Tools <span class="cc-count">${activeTools}/${totalTools}</span></h2>
          ${Object.entries(toolsByExt).map(([extName, extTools]) => `
            <details class="cc-group" ${extTools.some(t => t.status === "active") ? "open" : ""}>
              <summary class="cc-group-header">${esc(extName)} <span class="cc-count">${extTools.filter(t=>t.status==="active").length}/${extTools.length}</span></summary>
              ${extTools.map(t => `
                <div class="cc-tool-row">
                  ${dot(t.status)}
                  <div class="cc-tool-info">
                    <span class="cc-tool-name">${esc(t.name)}</span>
                    ${t.readOnly ? '<span class="cc-badge-sm cc-badge-ro">RO</span>' : ""}
                    ${t.destructive ? '<span class="cc-badge-sm cc-badge-dest">DEST</span>' : ""}
                    <div class="cc-tool-desc">${esc(truncate(t.description || "", 120))}</div>
                  </div>
                  <div class="cc-tool-actions">
                    ${t.status === "active" && !t.nodeBlocked ? `
                      <form method="POST" action="/api/v1/node/${nodeId}/tools${qs}" style="display:inline;">
                        <input type="hidden" name="block" value="${esc(t.name)}" />
                        <button type="submit" class="cc-btn-sm cc-btn-red" title="Block">X</button>
                      </form>` : ""}
                    ${t.nodeBlocked ? `
                      <form method="POST" action="/api/v1/node/${nodeId}/tools${qs}" style="display:inline;">
                        <input type="hidden" name="allow" value="${esc(t.name)}" />
                        <button type="submit" class="cc-btn-sm cc-btn-green" title="Allow">+</button>
                      </form>` : ""}
                  </div>
                </div>
              `).join("")}
            </details>
          `).join("")}
        </section>

        <!-- MODES COLUMN -->
        <section class="cc-col">
          <h2 class="cc-col-title">Modes <span class="cc-count">${activeModes}/${totalModes}</span></h2>
          ${Object.entries(modesByBig).map(([bigMode, bigModes]) => `
            <details class="cc-group" open>
              <summary class="cc-group-header">${esc(bigMode)} <span class="cc-count">${bigModes.filter(m=>m.status==="active").length}/${bigModes.length}</span></summary>
              ${bigModes.map(m => {
                const override = modeOverrides?.[m.intent];
                return `
                <div class="cc-mode-row">
                  ${dot(m.status)}
                  <span class="cc-mode-emoji">${m.emoji || ""}</span>
                  <div class="cc-mode-info">
                    <span class="cc-mode-name">${esc(m.label || m.key)}</span>
                    <span class="cc-mode-key">${esc(m.key)}</span>
                    ${m.extName ? `<span class="cc-mode-ext">${esc(m.extName)}</span>` : ""}
                    ${override ? `<div class="cc-mode-override">Override: ${esc(override)}</div>` : ""}
                  </div>
                </div>`;
              }).join("")}
            </details>
          `).join("")}
        </section>

      </div>
    </div>

    <!-- FOOTER -->
    <footer class="cc-footer">
      <div class="cc-container">
        <a href="/api/v1/node/${nodeId}?html${qs ? "&" + qs.slice(1) : ""}" class="cc-back">Back to node</a>
      </div>
    </footer>

  </div>
</body>
</html>`;
}

// ─────────────────────────────────────────────────────────────────────────
// CSS (LandingPage.css aesthetic, self-contained)
// ─────────────────────────────────────────────────────────────────────────

const CSS = `
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: #0a0a0a;
  color: #e5e5e5;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
}

.cc-container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 24px;
}

/* HEADER */
.cc-header {
  padding: 48px 0 24px;
  text-align: center;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.cc-breadcrumb {
  font-size: 0.8rem;
  color: rgba(255,255,255,0.3);
  margin-bottom: 8px;
  letter-spacing: 0.3px;
}
.cc-title {
  font-size: 36px;
  font-weight: 800;
  color: #fff;
  letter-spacing: -1px;
  margin-bottom: 8px;
}
.cc-subtitle {
  font-size: 0.9rem;
  color: rgba(255,255,255,0.4);
}

/* KEY BAR */
.cc-key {
  padding: 12px 0;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  background: rgba(255,255,255,0.02);
}
.cc-key-inner {
  display: flex;
  gap: 20px;
  justify-content: center;
  flex-wrap: wrap;
}
.cc-key-item {
  display: flex;
  align-items: center;
  font-size: 0.75rem;
  color: rgba(255,255,255,0.5);
  letter-spacing: 0.3px;
}

/* GRID */
.cc-grid {
  display: grid;
  grid-template-columns: 1fr 1.4fr 0.8fr;
  gap: 24px;
  padding: 32px 0;
  align-items: start;
}

/* COLUMNS */
.cc-col-title {
  font-size: 0.85rem;
  font-weight: 700;
  color: rgba(255,255,255,0.6);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.cc-count {
  font-weight: 400;
  color: rgba(255,255,255,0.3);
  font-size: 0.75rem;
}

/* EXTENSION ITEMS */
.cc-item {
  margin-bottom: 4px;
}
.cc-item-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  list-style: none;
}
.cc-item-row:hover {
  background: rgba(255,255,255,0.04);
}
.cc-item-row::-webkit-details-marker { display: none; }
.cc-item-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: #fff;
  flex: 1;
}
.cc-item-version {
  font-size: 0.7rem;
  color: rgba(255,255,255,0.25);
}
.cc-item-detail {
  padding: 8px 12px 16px 28px;
  font-size: 0.8rem;
}
.cc-item-desc {
  color: rgba(255,255,255,0.4);
  margin-bottom: 8px;
  line-height: 1.5;
}
.cc-item-sub {
  color: rgba(255,255,255,0.35);
  margin-bottom: 4px;
  line-height: 1.6;
}
.cc-item-sub strong {
  color: rgba(255,255,255,0.5);
}

/* TOOL GROUPS */
.cc-group {
  margin-bottom: 8px;
}
.cc-group-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.8rem;
  font-weight: 600;
  color: rgba(255,255,255,0.6);
  list-style: none;
  transition: background 0.15s;
}
.cc-group-header:hover {
  background: rgba(255,255,255,0.04);
}
.cc-group-header::-webkit-details-marker { display: none; }

/* TOOL ROWS */
.cc-tool-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px 8px 20px;
  border-radius: 6px;
  transition: background 0.15s;
}
.cc-tool-row:hover {
  background: rgba(255,255,255,0.03);
}
.cc-tool-info {
  flex: 1;
  min-width: 0;
}
.cc-tool-name {
  font-size: 0.8rem;
  font-weight: 600;
  color: #fff;
}
.cc-tool-desc {
  font-size: 0.72rem;
  color: rgba(255,255,255,0.35);
  margin-top: 2px;
  line-height: 1.4;
}
.cc-badge-sm {
  display: inline-block;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.5px;
  margin-left: 6px;
  vertical-align: middle;
}
.cc-badge-ro { background: rgba(234,179,8,0.15); color: #eab308; }
.cc-badge-dest { background: rgba(239,68,68,0.15); color: #ef4444; }

.cc-tool-actions {
  flex-shrink: 0;
}

/* MODE ROWS */
.cc-mode-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 8px 20px;
  border-radius: 6px;
  transition: background 0.15s;
}
.cc-mode-row:hover {
  background: rgba(255,255,255,0.03);
}
.cc-mode-emoji {
  font-size: 1rem;
  width: 20px;
  text-align: center;
}
.cc-mode-info {
  flex: 1;
}
.cc-mode-name {
  font-size: 0.8rem;
  font-weight: 600;
  color: #fff;
}
.cc-mode-key {
  font-size: 0.7rem;
  color: rgba(255,255,255,0.25);
  margin-left: 8px;
}
.cc-mode-ext {
  font-size: 0.65rem;
  color: rgba(255,255,255,0.2);
  margin-left: 8px;
}
.cc-mode-override {
  font-size: 0.7rem;
  color: #3b82f6;
  margin-top: 2px;
}

/* BUTTONS */
.cc-btn, .cc-btn-sm {
  border: none;
  cursor: pointer;
  border-radius: 6px;
  font-weight: 600;
  transition: all 0.15s;
}
.cc-btn {
  padding: 6px 14px;
  font-size: 0.75rem;
  margin-top: 8px;
}
.cc-btn-sm {
  padding: 3px 8px;
  font-size: 0.7rem;
}
.cc-btn-red {
  background: rgba(239,68,68,0.15);
  color: #ef4444;
  border: 1px solid rgba(239,68,68,0.3);
}
.cc-btn-red:hover { background: rgba(239,68,68,0.25); }
.cc-btn-green {
  background: rgba(74,222,128,0.15);
  color: #4ade80;
  border: 1px solid rgba(74,222,128,0.3);
}
.cc-btn-green:hover { background: rgba(74,222,128,0.25); }
.cc-toggle-form { display: inline; }

/* FOOTER */
.cc-footer {
  padding: 32px 0;
  border-top: 1px solid rgba(255,255,255,0.06);
  text-align: center;
}
.cc-back {
  color: rgba(255,255,255,0.4);
  text-decoration: none;
  font-size: 0.85rem;
  transition: color 0.15s;
}
.cc-back:hover { color: rgba(255,255,255,0.7); }

/* ── RESPONSIVE ── */
@media (max-width: 1024px) {
  .cc-grid { grid-template-columns: 1fr 1fr; }
  .cc-col:nth-child(3) { grid-column: 1 / -1; }
}

@media (max-width: 768px) {
  .cc-header { padding: 32px 0 16px; }
  .cc-title { font-size: 28px; }
  .cc-grid {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .cc-col {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 12px;
    padding: 16px;
  }
  .cc-key-inner { gap: 12px; }
  .cc-key-item { font-size: 0.7rem; }
}

@media (max-width: 480px) {
  .cc-container { padding: 0 16px; }
  .cc-title { font-size: 24px; }
  .cc-tool-row, .cc-mode-row { padding: 6px 8px 6px 12px; }
}
`;
