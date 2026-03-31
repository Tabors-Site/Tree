/**
 * Node-level LLM page.
 * Assign models per tree. Default + per-slot overrides.
 */

import { page } from "../../html-rendering/html/layout.js";
import { baseStyles, glassHeaderStyles, glassCardStyles, responsiveBase } from "../../html-rendering/html/baseStyles.js";

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderNodeLlmPage({ nodeId, nodeName, connections, defaultLlm, slots, allSlots = [], qs, userId }) {
  const activeConn = defaultLlm ? connections.find(c => c._id === defaultLlm) : null;

  // Slot assignment rows
  const slotRows = [
    { key: "default", label: "Default", isDefault: true },
    ...allSlots.filter(s => s !== "default").map(s => ({ key: s, label: s.charAt(0).toUpperCase() + s.slice(1) })),
  ].map(slot => {
    const connId = slot.key === "default" ? defaultLlm : (slots[slot.key] || null);
    const options = connections.map(c =>
      `<option value="${esc(c._id)}"${c._id === connId ? " selected" : ""}>${esc(c.name || c.model)}</option>`
    ).join("");
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);gap:12px;">
      <code style="color:#4ade80;font-size:0.85rem;min-width:100px;">${esc(slot.label)}</code>
      <select class="slot-select" data-slot="${esc(slot.key)}" style="flex:1;max-width:280px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:8px 12px;color:white;font-size:13px;">
        <option value=""${!connId ? " selected" : ""}>${slot.isDefault ? "Account default" : "Use tree default"}</option>
        ${options}
        ${slot.isDefault ? `<option value="none"${connId === "none" ? " selected" : ""} style="color:rgba(255,107,107,0.8);">Off (no AI)</option>` : ""}
      </select>
    </div>`;
  }).join("");

  const body = `
    <div class="container">
      <div class="back-nav">
        <a href="/api/v1/root/${esc(nodeId)}${qs}" class="back-link">\u2190 Back to ${esc(nodeName || "Tree")}</a>
        <a href="/api/v1/node/${esc(nodeId)}/command-center${qs}" class="back-link">Command Center</a>
        <a href="/api/v1/user/${esc(userId)}/llm${qs}" class="back-link">User LLM</a>
      </div>

      <div class="header">
        <h1>Tree LLM Assignments</h1>
        <div class="header-subtitle">${esc(nodeName || "Tree")}</div>
      </div>

      ${connections.length === 0
        ? `<div class="header" style="margin-top:16px;text-align:center;">
            <div style="color:rgba(255,255,255,0.5);font-size:14px;line-height:1.8;">
              No LLM connections configured.<br/>
              <a href="/api/v1/user/${esc(userId)}/llm${qs}" style="color:#4ade80;">Add one on your profile</a>
            </div>
          </div>`
        : `
      <div class="header" style="margin-top:16px;">
        <h1 style="font-size:20px;">Slot Assignments</h1>
        <div class="header-subtitle">
          Set a default LLM for this tree. All modes fall back to it.
          Per-mode overrides below. "Off" disables AI entirely.
          Unassigned slots use your account default.
        </div>
        <div style="margin-top:16px;">
          ${slotRows}
        </div>
        <div id="slotStatus" style="margin-top:8px;font-size:12px;min-height:16px;"></div>
      </div>

      <!-- Current assignment summary -->
      <div class="header" style="margin-top:16px;">
        <h1 style="font-size:18px;">Active Model</h1>
        ${activeConn
          ? `<div style="font-size:14px;color:rgba(255,255,255,0.7);line-height:1.8;margin-top:8px;">
              <div><strong>${esc(activeConn.name)}</strong></div>
              <div>Model: <code>${esc(activeConn.model)}</code></div>
              <div>URL: <code>${esc(activeConn.baseUrl)}</code></div>
            </div>`
          : defaultLlm === "none"
            ? '<div style="color:rgba(255,107,107,0.8);font-size:14px;">AI disabled for this tree</div>'
            : '<div style="color:rgba(255,255,255,0.4);font-size:14px;">Using account default</div>'
        }
      </div>
      `}
    </div>
  `;

  const css = `
    ${baseStyles}
    ${glassHeaderStyles}
    ${glassCardStyles}
    ${responsiveBase}
    .slot-select {
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='rgba(255,255,255,0.5)' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
      padding-right: 32px;
    }
    .slot-select option { background: #1a1145; color: white; }
    .back-nav { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    .back-link {
      display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px;
      background: rgba(var(--glass-water-rgb), var(--glass-alpha)); backdrop-filter: blur(22px);
      color: white; text-decoration: none; border-radius: 980px;
      font-weight: 600; font-size: 14px; border: 1px solid rgba(255,255,255,0.12);
    }
    .back-link:hover { background: rgba(var(--glass-water-rgb), var(--glass-alpha-hover)); }
  `;

  const js = `
    var nodeId = "${esc(nodeId)}";

    document.querySelectorAll(".slot-select").forEach(function(sel) {
      sel.onchange = async function() {
        var slot = sel.dataset.slot;
        var connId = sel.value || null;
        var status = document.getElementById("slotStatus");
        try {
          var res = await fetch("/api/v1/root/" + nodeId + "/llm-assign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ slot: slot, connectionId: connId }),
          });
          var data = await res.json();
          if (!res.ok) {
            status.innerHTML = '<span style="color:#f87171;">' + ((data.error && data.error.message) || data.error || "Failed") + '</span>';
            return;
          }
          status.innerHTML = '<span style="color:#4ade80;">' + slot + ' updated</span>';
          setTimeout(function() { status.innerHTML = ""; }, 2000);
        } catch (err) {
          status.innerHTML = '<span style="color:#f87171;">' + err.message + '</span>';
        }
      };
    });
  `;

  return page({ title: `${nodeName || "Tree"} . Tree LLM Assignments`, css, body, js });
}
