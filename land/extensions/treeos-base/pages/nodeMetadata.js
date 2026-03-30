/**
 * Node Metadata Page
 *
 * Shows all metadata namespaces for a node. Each extension's data
 * is displayed in its own collapsible section. Read-only inspector.
 */

import { page } from "../../html-rendering/html/layout.js";
import { esc } from "../../html-rendering/html/utils.js";
import { glassCardStyles, glassHeaderStyles, responsiveBase } from "../../html-rendering/html/baseStyles.js";

function renderValue(val, depth = 0) {
  if (val === null || val === undefined) return `<span class="mv-null">null</span>`;
  if (typeof val === "boolean") return `<span class="mv-bool">${val}</span>`;
  if (typeof val === "number") return `<span class="mv-num">${val}</span>`;
  if (typeof val === "string") {
    if (val.length > 200) return `<span class="mv-str">"${esc(val.slice(0, 200))}..."</span>`;
    return `<span class="mv-str">"${esc(val)}"</span>`;
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return `<span class="mv-null">[]</span>`;
    if (depth > 3) return `<span class="mv-null">[${val.length} items]</span>`;
    return `<div class="mv-array">[${val.map((v, i) =>
      `<div class="mv-indent">${renderValue(v, depth + 1)}${i < val.length - 1 ? "," : ""}</div>`
    ).join("")}]</div>`;
  }
  if (typeof val === "object") {
    const entries = Object.entries(val);
    if (entries.length === 0) return `<span class="mv-null">{}</span>`;
    if (depth > 3) return `<span class="mv-null">{${entries.length} keys}</span>`;
    return `<div class="mv-obj">{${entries.map(([k, v], i) =>
      `<div class="mv-indent"><span class="mv-key">${esc(k)}</span>: ${renderValue(v, depth + 1)}${i < entries.length - 1 ? "," : ""}</div>`
    ).join("")}}</div>`;
  }
  return `<span class="mv-null">${esc(String(val))}</span>`;
}

export function renderNodeMetadata({ node, nodeId, qs, parentName, backUrl }) {
  const metadata = node.metadata instanceof Map
    ? Object.fromEntries(node.metadata)
    : (node.metadata || {});

  const namespaces = Object.entries(metadata).sort(([a], [b]) => a.localeCompare(b));

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
    .ns-count { font-size: 0.75rem; color: rgba(255,255,255,0.3); }
    .ns-toggle { color: rgba(255,255,255,0.3); font-size: 0.8rem; transition: transform 0.2s; }
    .ns-body { padding: 0 16px 16px; font-family: monospace; font-size: 0.82rem; line-height: 1.6; overflow-x: auto; }

    .mv-key { color: #60a5fa; }
    .mv-str { color: #fbbf24; }
    .mv-num { color: #4ade80; }
    .mv-bool { color: #c084fc; }
    .mv-null { color: rgba(255,255,255,0.25); }
    .mv-indent { padding-left: 16px; }
    .mv-obj, .mv-array { display: inline; }

    .empty-state { color: rgba(255,255,255,0.35); font-size: 0.9rem; padding: 2rem 0; font-style: italic; text-align: center; }

    .role-badge {
      display: inline-block; padding: 2px 8px; border-radius: 8px; font-size: 0.7rem;
      background: rgba(72,187,120,0.1); border: 1px solid rgba(72,187,120,0.25); color: #48bb78;
      margin-left: 8px;
    }
  `;

  const namespacesHtml = namespaces.length > 0
    ? namespaces.map(([ns, data], idx) => {
        const keys = typeof data === "object" && data !== null ? Object.keys(data) : [];
        const hasRole = data?.role;
        return `
          <div class="ns-card">
            <div class="ns-header" onclick="this.parentElement.classList.toggle('open');this.querySelector('.ns-toggle').textContent=this.parentElement.classList.contains('open')?'\u25BC':'\u25B6'">
              <div>
                <span class="ns-name">${esc(ns)}</span>
                ${hasRole ? `<span class="role-badge">role: ${esc(data.role)}</span>` : ""}
                <span class="ns-count">${keys.length} key${keys.length !== 1 ? "s" : ""}</span>
              </div>
              <span class="ns-toggle">${idx === 0 ? "\u25BC" : "\u25B6"}</span>
            </div>
            <div class="ns-body" style="display:${idx === 0 ? "block" : "none"}">
              ${renderValue(data)}
            </div>
          </div>`;
      }).join("")
    : '<div class="empty-state">No metadata on this node.</div>';

  const js = `
    document.querySelectorAll('.ns-card').forEach(card => {
      const header = card.querySelector('.ns-header');
      const body = card.querySelector('.ns-body');
      header.addEventListener('click', () => {
        body.style.display = body.style.display === 'none' ? 'block' : 'none';
      });
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
        ${esc(nodeId)} . ${namespaces.length} namespace${namespaces.length !== 1 ? "s" : ""}
      </div>
      ${namespacesHtml}
    </div>
  `;

  return page({
    title: `${node.name} . Metadata`,
    css,
    body,
    js,
  });
}
