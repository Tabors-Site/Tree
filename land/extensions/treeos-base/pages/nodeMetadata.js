/**
 * Node Metadata Page
 *
 * Shows all metadata namespaces for a node. Each extension's data
 * is displayed in its own collapsible section. Click values to edit.
 * Delete namespaces or individual fields.
 */

import { page } from "../../html-rendering/html/layout.js";
import { esc } from "../../html-rendering/html/utils.js";
import { glassCardStyles, glassHeaderStyles, responsiveBase } from "../../html-rendering/html/baseStyles.js";

function renderValue(val, depth = 0, path = "") {
  if (val === null || val === undefined) return `<span class="mv-null">null</span>`;
  if (typeof val === "boolean") return `<span class="mv-bool mv-editable" data-path="${esc(path)}" data-type="boolean">${val}</span>`;
  if (typeof val === "number") return `<span class="mv-num mv-editable" data-path="${esc(path)}" data-type="number">${val}</span>`;
  if (typeof val === "string") {
    const display = val.length > 200 ? val.slice(0, 200) + "..." : val;
    return `<span class="mv-str mv-editable" data-path="${esc(path)}" data-type="string">"${esc(display)}"</span>`;
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return `<span class="mv-null">[]</span>`;
    if (depth > 3) return `<span class="mv-null">[${val.length} items]</span>`;
    return `<div class="mv-array">[${val.map((v, i) =>
      `<div class="mv-indent">${renderValue(v, depth + 1, `${path}[${i}]`)}${i < val.length - 1 ? "," : ""}</div>`
    ).join("")}]</div>`;
  }
  if (typeof val === "object") {
    const entries = Object.entries(val);
    if (entries.length === 0) return `<span class="mv-null">{}</span>`;
    if (depth > 3) return `<span class="mv-null">{${entries.length} keys}</span>`;
    return `<div class="mv-obj">{${entries.map(([k, v], i) =>
      `<div class="mv-indent"><span class="mv-key">${esc(k)}</span>: ${renderValue(v, depth + 1, path ? `${path}.${k}` : k)}${i < entries.length - 1 ? "," : ""}</div>`
    ).join("")}}</div>`;
  }
  return `<span class="mv-null">${esc(String(val))}</span>`;
}

export function renderNodeMetadata({ node, nodeId, qs, backUrl }) {
  const metadata = node.metadata instanceof Map
    ? Object.fromEntries(node.metadata)
    : (node.metadata || {});

  const namespaces = Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b));
  const token = qs.includes("token=") ? qs.split("token=")[1]?.split("&")[0] : "";

  const css = `
    ${glassHeaderStyles}
    ${glassCardStyles}
    ${responsiveBase}

    .meta-layout { max-width: 900px; margin: 0 auto; padding: 1.5rem; }

    .back-nav { display: flex; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
    .back-link { color: rgba(255,255,255,0.4); text-decoration: none; font-size: 0.85rem; }
    .back-link:hover { color: rgba(255,255,255,0.7); }

    .ns-card { margin-bottom: 12px; border-radius: 12px; overflow: hidden; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); }
    .ns-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 12px 16px; cursor: pointer; user-select: none;
    }
    .ns-header:hover { background: rgba(255,255,255,0.04); }
    .ns-name { font-weight: 600; color: #4ade80; font-size: 0.95rem; }
    .ns-count { font-size: 0.75rem; color: rgba(255,255,255,0.3); margin-left: 8px; }
    .ns-toggle { color: rgba(255,255,255,0.3); font-size: 0.8rem; transition: transform 0.2s; }
    .ns-actions { display: flex; gap: 8px; align-items: center; }
    .ns-delete {
      font-size: 0.7rem; color: rgba(239,68,68,0.5); cursor: pointer; padding: 2px 8px;
      border: 1px solid rgba(239,68,68,0.2); border-radius: 6px; background: none;
    }
    .ns-delete:hover { color: #ef4444; border-color: rgba(239,68,68,0.4); }
    .ns-body { padding: 0 16px 16px; font-family: monospace; font-size: 0.82rem; line-height: 1.6; overflow-x: auto; }

    .mv-key { color: #60a5fa; }
    .mv-str { color: #fbbf24; }
    .mv-num { color: #4ade80; }
    .mv-bool { color: #c084fc; }
    .mv-null { color: rgba(255,255,255,0.25); }
    .mv-indent { padding-left: 16px; }
    .mv-obj, .mv-array { display: inline; }

    .mv-editable { cursor: pointer; border-bottom: 1px dashed rgba(255,255,255,0.1); }
    .mv-editable:hover { border-bottom-color: rgba(255,255,255,0.4); }

    .mv-edit-input {
      background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.3);
      border-radius: 4px; color: #fff; font-family: monospace; font-size: 0.82rem;
      padding: 2px 6px; outline: none;
    }
    .mv-edit-input:focus { border-color: #4ade80; }

    .empty-state { color: rgba(255,255,255,0.35); font-size: 0.9rem; padding: 2rem 0; font-style: italic; text-align: center; }

    .role-badge {
      display: inline-block; padding: 2px 8px; border-radius: 8px; font-size: 0.7rem;
      background: rgba(72,187,120,0.1); border: 1px solid rgba(72,187,120,0.25); color: #48bb78;
      margin-left: 8px;
    }

    .toast {
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      background: rgba(72,187,120,0.9); color: #fff; padding: 8px 20px;
      border-radius: 8px; font-size: 0.85rem; opacity: 0; transition: opacity 0.3s;
      pointer-events: none; z-index: 100;
    }
    .toast.show { opacity: 1; }
  `;

  const namespacesHtml = namespaces.length > 0
    ? namespaces.map(([ns, data], idx) => {
        const keys = typeof data === "object" && data !== null ? Object.keys(data) : [];
        const hasRole = data?.role;
        return `
          <div class="ns-card" data-ns="${esc(ns)}">
            <div class="ns-header">
              <div onclick="toggleNs(this)">
                <span class="ns-name">${esc(ns)}</span>
                ${hasRole ? `<span class="role-badge">role: ${esc(data.role)}</span>` : ""}
                <span class="ns-count">${keys.length} key${keys.length !== 1 ? "s" : ""}</span>
              </div>
              <div class="ns-actions">
                <button class="ns-delete" onclick="deleteNs('${esc(ns)}')">delete</button>
                <span class="ns-toggle" onclick="toggleNs(this)">${idx === 0 ? "\u25BC" : "\u25B6"}</span>
              </div>
            </div>
            <div class="ns-body" style="display:${idx === 0 ? "block" : "none"}">
              ${renderValue(data, 0, "")}
            </div>
          </div>`;
      }).join("")
    : '<div class="empty-state">No metadata on this node.</div>';

  const js = `
    const nodeId = "${esc(nodeId)}";
    const token = "${esc(token)}";
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = "Bearer " + token;

    function toggleNs(el) {
      const card = el.closest('.ns-card');
      const body = card.querySelector('.ns-body');
      const toggle = card.querySelector('.ns-toggle');
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      toggle.textContent = open ? '\u25B6' : '\u25BC';
    }

    function toast(msg) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2000);
    }

    async function deleteNs(ns) {
      if (!confirm('Delete the entire ' + ns + ' namespace?')) return;
      const res = await fetch('/api/v1/node/' + nodeId + '/metadata/' + ns, {
        method: 'DELETE', headers
      });
      if (res.ok) {
        document.querySelector('[data-ns="' + ns + '"]').remove();
        toast('Deleted ' + ns);
      } else {
        toast('Failed to delete');
      }
    }

    document.addEventListener('click', function(e) {
      const el = e.target.closest('.mv-editable');
      if (!el || el.querySelector('input')) return;

      const ns = el.closest('.ns-card')?.dataset?.ns;
      const path = el.dataset.path;
      const type = el.dataset.type;
      if (!ns || !path) return;

      // Only handle top-level keys (no dots, no brackets)
      if (path.includes('.') || path.includes('[')) return;

      const currentText = el.textContent.replace(/^"|"$/g, '');
      const input = document.createElement('input');
      input.className = 'mv-edit-input';
      input.value = currentText;
      input.style.width = Math.max(60, currentText.length * 8) + 'px';

      const original = el.innerHTML;
      el.innerHTML = '';
      el.appendChild(input);
      input.focus();
      input.select();

      async function save() {
        let val = input.value;
        if (type === 'number') val = Number(val);
        else if (type === 'boolean') val = val === 'true';

        const res = await fetch('/api/v1/node/' + nodeId + '/metadata/' + ns + '/' + path, {
          method: 'POST', headers, body: JSON.stringify({ value: val })
        });
        if (res.ok) {
          if (type === 'string') el.innerHTML = '<span class="mv-str">"' + val + '"</span>';
          else if (type === 'number') el.innerHTML = '<span class="mv-num">' + val + '</span>';
          else if (type === 'boolean') el.innerHTML = '<span class="mv-bool">' + val + '</span>';
          el.dataset.path = path;
          el.dataset.type = type;
          toast('Saved ' + ns + '.' + path + ' = ' + val);
        } else {
          el.innerHTML = original;
          toast('Failed to save');
        }
      }

      input.addEventListener('keydown', function(ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); save(); }
        if (ev.key === 'Escape') { el.innerHTML = original; }
      });
      input.addEventListener('blur', save);
    });
  `;

  const body = `
    <div class="meta-layout">
      <div class="back-nav">
        ${backUrl ? `<a href="${backUrl}" class="back-link">\u2190 Back</a>` : ""}
        <a href="/api/v1/node/${esc(nodeId)}${qs}" class="back-link">Node Detail</a>
      </div>
      <h1 style="font-size:1.4rem;color:#fff;margin-bottom:4px">${esc(node.name)}</h1>
      <div style="color:rgba(255,255,255,0.3);font-size:0.8rem;margin-bottom:20px">
        ${esc(nodeId)} . ${namespaces.length} namespace${namespaces.length !== 1 ? "s" : ""} . click values to edit
      </div>
      ${namespacesHtml}
    </div>
    <div id="toast" class="toast"></div>
  `;

  return page({
    title: `${node.name} . Metadata`,
    css,
    body,
    js,
  });
}
