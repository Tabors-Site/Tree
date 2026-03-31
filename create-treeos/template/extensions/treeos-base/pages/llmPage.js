/**
 * Standalone LLM Connections page.
 * View, add, edit, remove LLM connections. Assign to slots.
 */

import { page } from "../../html-rendering/html/layout.js";
import { baseStyles, glassHeaderStyles, glassCardStyles, responsiveBase } from "../../html-rendering/html/baseStyles.js";

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderLlmPage({ userId, username, connections, mainAssignment, userSlots, allUserSlots = [], treeSlots, rootId, rootName, qs }) {
  const activeConn = mainAssignment ? connections.find(c => c._id === mainAssignment) : null;

  const connCards = connections.length > 0
    ? connections.map(c => {
        const isDefault = c._id === mainAssignment;
        return `
          <div class="note-card${isDefault ? " glass-green" : ""}" data-id="${esc(c._id)}">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <strong>${esc(c.name || c._id)}</strong>
              ${isDefault ? '<span style="font-size:11px;background:rgba(72,187,120,0.2);color:rgba(72,187,120,0.9);padding:2px 8px;border-radius:8px;">default</span>' : ""}
            </div>
            <div style="font-size:13px;color:rgba(255,255,255,0.7);line-height:1.8;">
              <div>Model: <code>${esc(c.model)}</code></div>
              <div>URL: <code>${esc(c.baseUrl)}</code></div>
              <div style="font-size:11px;color:rgba(255,255,255,0.4);">ID: ${esc(c._id)}</div>
            </div>
            <div style="display:flex;gap:8px;margin-top:12px;">
              ${!isDefault ? `<button class="action-btn set-default-btn" data-id="${esc(c._id)}">Set Default</button>` : ""}
              <button class="action-btn delete-btn" data-id="${esc(c._id)}" style="background:rgba(200,80,80,0.2);color:rgba(255,120,120,0.9);">Remove</button>
            </div>
          </div>`;
      }).join("")
    : '<div style="text-align:center;padding:24px;color:rgba(255,255,255,0.4);">No connections. Add one below.</div>';

  // Slot assignments: dynamic dropdowns from registered slots
  const slotRows = allUserSlots.map(slot => {
    const connId = slot === "main" ? mainAssignment : (userSlots[slot] || null);
    const options = connections.map(c =>
      `<option value="${esc(c._id)}"${c._id === connId ? " selected" : ""}>${esc(c.name || c.model)}</option>`
    ).join("");
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05);gap:12px;">
      <code style="color:#4ade80;font-size:0.85rem;min-width:100px;">${esc(slot)}</code>
      <select class="slot-select" data-slot="${esc(slot)}" style="flex:1;max-width:260px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:8px 12px;color:white;font-size:13px;">
        <option value=""${!connId ? " selected" : ""}>${slot === "main" ? "Account default" : "Use default"}</option>
        ${options}
      </select>
    </div>`;
  }).join("");

  const body = `
    <div class="container">
      <div class="back-nav">
        <a href="/api/v1/user/${esc(userId)}${qs}" class="back-link">Home</a>
        ${rootId ? `<a href="/api/v1/root/${esc(rootId)}${qs}" class="back-link">Back to ${esc(rootName || "Tree")}</a>` : ""}
      </div>

      <div class="header">
        <h1>LLM Connections</h1>
        <div class="header-subtitle">Manage your AI model connections and slot assignments.</div>
      </div>

      <div class="notes-list">
        ${connCards}
      </div>

      <!-- Add Connection -->
      <div class="header" style="margin-top:24px;">
        <h1 style="font-size:20px;">Add Connection</h1>
        <form id="addForm" style="margin-top:12px;">
          <div style="display:grid;gap:10px;">
            <input type="text" name="name" placeholder="Connection name (e.g. my-ollama)" required
              style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:10px 14px;color:white;font-size:14px;">
            <input type="text" name="baseUrl" placeholder="Base URL (e.g. http://localhost:11434/v1)" required
              style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:10px 14px;color:white;font-size:14px;">
            <input type="text" name="model" placeholder="Model (e.g. qwen3:32b)" required
              style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:10px 14px;color:white;font-size:14px;">
            <input type="text" name="apiKey" placeholder="API Key (press enter for none)"
              style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:10px 14px;color:white;font-size:14px;">
            <button type="submit" class="action-btn" style="width:100%;">Add Connection</button>
          </div>
          <div id="addStatus" style="margin-top:8px;font-size:13px;"></div>
        </form>
      </div>

      <!-- Slot Assignments -->
      <div class="header" style="margin-top:24px;">
        <h1 style="font-size:20px;">Slot Assignments</h1>
        <div class="header-subtitle">Each slot can use a different model. Unassigned slots use your default. Changes save automatically.</div>
        <div style="margin-top:12px;">
          ${slotRows || '<div style="color:rgba(255,255,255,0.4);font-size:13px;">No slots registered. Install extensions that use LLM.</div>'}
        </div>
        <div id="slotStatus" style="margin-top:8px;font-size:12px;min-height:16px;"></div>
      </div>

      <!-- Free LLM Guide -->
      <div style="text-align:center;margin-top:24px;font-size:13px;color:rgba(255,255,255,0.4);">
        Free LLM setup guide: <a href="https://www.youtube.com/watch?v=_cXGZXdiVgw" style="color:rgba(74,222,128,0.8);" target="_blank">YouTube</a>
      </div>
    </div>
  `;

  const css = `
    ${baseStyles}
    ${glassHeaderStyles}
    ${glassCardStyles}
    ${responsiveBase}
    .action-btn {
      background: rgba(115, 111, 230, 0.3);
      border: 1px solid rgba(255,255,255,0.2);
      color: white;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .action-btn:hover { background: rgba(115, 111, 230, 0.5); }
    .slot-select {
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='rgba(255,255,255,0.5)' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
      padding-right: 32px;
    }
    .slot-select option { background: #2d1b4e; color: white; }
    .back-nav { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
    .back-link {
      display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px;
      background: rgba(115, 111, 230, 0.28); backdrop-filter: blur(22px);
      color: white; text-decoration: none; border-radius: 980px;
      font-weight: 600; font-size: 14px; border: 1px solid rgba(255,255,255,0.28);
    }
    .back-link:hover { background: rgba(115, 111, 230, 0.38); }
    .container > * {
      animation: fadeInUp 0.5s ease-out both;
    }
    .container > :nth-child(1) { animation-delay: 0s; }
    .container > :nth-child(2) { animation-delay: 0.08s; }
    .container > :nth-child(3) { animation-delay: 0.16s; }
    .container > :nth-child(4) { animation-delay: 0.24s; }
    .container > :nth-child(5) { animation-delay: 0.32s; }
    .container > :nth-child(6) { animation-delay: 0.4s; }
    .container > :nth-child(7) { animation-delay: 0.48s; }
  `;

  const js = `
    var userId = "${esc(userId)}";
    var qs = "${esc(qs)}";

    document.getElementById("addForm").onsubmit = async function(e) {
      e.preventDefault();
      var form = e.target;
      var status = document.getElementById("addStatus");
      try {
        var res = await fetch("/api/v1/user/" + userId + "/custom-llm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            name: form.name.value,
            baseUrl: form.baseUrl.value,
            model: form.model.value,
            apiKey: form.apiKey.value || "none",
          }),
        });
        var data = await res.json();
        if (!res.ok) { status.innerHTML = '<span style="color:#f87171;">' + ((data.error && data.error.message) || data.error || "Failed") + '</span>'; return; }
        status.innerHTML = '<span style="color:#4ade80;">Added. Refreshing...</span>';
        setTimeout(function() { location.reload(); }, 500);
      } catch (err) {
        status.innerHTML = '<span style="color:#f87171;">' + err.message + '</span>';
      }
    };

    document.querySelectorAll(".set-default-btn").forEach(function(btn) {
      btn.onclick = async function() {
        try {
          await fetch("/api/v1/user/" + userId + "/llm-assign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ slot: "main", connectionId: btn.dataset.id }),
          });
          location.reload();
        } catch {}
      };
    });

    document.querySelectorAll(".delete-btn").forEach(function(btn) {
      btn.onclick = async function() {
        if (!confirm("Remove this connection?")) return;
        try {
          await fetch("/api/v1/user/" + userId + "/custom-llm/" + btn.dataset.id, {
            method: "DELETE",
            credentials: "include",
          });
          location.reload();
        } catch {}
      };
    });

    // Slot assignment dropdowns: auto-save on change
    document.querySelectorAll(".slot-select").forEach(function(sel) {
      sel.onchange = async function() {
        var slot = sel.dataset.slot;
        var connId = sel.value || null;
        var status = document.getElementById("slotStatus");
        try {
          var res = await fetch("/api/v1/user/" + userId + "/llm-assign", {
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

  return page({ title: "LLM Connections", css, body, js });
}
