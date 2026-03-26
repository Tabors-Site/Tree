/* ------------------------------------------------- */
/* Values page (extracted from root.js)              */
/* ------------------------------------------------- */

import { page } from "../layout.js";

export function renderValuesPage({ nodeId, queryString, result }) {
  const rootNodeName = result.tree.nodeName || "Unknown";

  const flatSummary =
    Object.entries(result.flat).length > 0
      ? Object.entries(result.flat)
          .sort(([, a], [, b]) => b - a)
          .map(
            ([key, value]) => `
            <div class="value-card">
              <div class="value-key">${key}</div>
              <div class="value-amount">${value.toLocaleString()}</div>
            </div>
          `,
          )
          .join("")
      : `<div class="empty-state-small">No values yet</div>`;

  function renderTree(node, depth = 0) {
    const hasChildren = node.children && node.children.length > 0;
    const hasLocalValues =
      node.localValues && Object.keys(node.localValues).length > 0;
    const hasTotalValues =
      node.totalValues && Object.keys(node.totalValues).length > 0;

    let localValuesHtml = "";
    if (hasLocalValues) {
      localValuesHtml = Object.entries(node.localValues)
        .map(
          ([k, v]) => `
            <div class="node-value-item" title="${k}: ${v.toLocaleString()}">
              <span class="value-key-small">${k}</span>
              <span class="value-amount-small">${v.toLocaleString()}</span>
            </div>
          `,
        )
        .join("");
    }

    let totalValuesHtml = "";
    if (hasTotalValues) {
      totalValuesHtml = Object.entries(node.totalValues)
        .map(
          ([k, v]) => `
            <div class="node-value-item" title="${k}: ${v.toLocaleString()}">
              <span class="value-key-small">${k}</span>
              <span class="value-amount-small">${v.toLocaleString()}</span>
            </div>
          `,
        )
        .join("");
    }

    const childrenHtml = hasChildren
      ? node.children.map((c) => renderTree(c, depth + 1)).join("")
      : "";

    const valueCount = Math.max(
      Object.keys(node.localValues || {}).length,
      Object.keys(node.totalValues || {}).length,
    );

    return `
        <div class="tree-node" data-depth="${depth}">
          <div class="tree-node-header ${hasChildren ? "has-children" : ""}">
            ${
              hasChildren
                ? `<button class="tree-toggle" onclick="toggleNode(this)" aria-label="Toggle children">▼</button>`
                : '<span class="tree-spacer"></span>'
            }
            <div class="tree-node-info">
              <a href="/api/v1/node/${
                node.nodeId
              }${queryString}" class="tree-node-name" title="${node.nodeName}">
                ${node.nodeName}
              </a>
              ${
                valueCount > 0
                  ? `<span class="value-count">${valueCount} value${
                      valueCount !== 1 ? "s" : ""
                    }</span>`
                  : ""
              }
            </div>
          </div>

          ${
            hasLocalValues || hasTotalValues
              ? `
            <div class="tree-node-values local-values">
              ${
                localValuesHtml ||
                '<div class="empty-values">No local values</div>'
              }
            </div>
            <div class="tree-node-values total-values" style="display: none;">
              ${
                totalValuesHtml ||
                '<div class="empty-values">No total values</div>'
              }
            </div>
          `
              : ""
          }

          ${
            hasChildren
              ? `
            <div class="tree-children">
              ${childrenHtml}
            </div>
          `
              : ""
          }
        </div>
      `;
  }

  const css = `
    body { color: white; }
    .container { max-width: 1000px; }

    /* Glass Card Base */
    .glass-card {
      background: rgba(var(--glass-water-rgb), var(--glass-alpha));
      backdrop-filter: blur(22px) saturate(140%);
      -webkit-backdrop-filter: blur(22px) saturate(140%);
      border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      border: 1px solid rgba(255, 255, 255, 0.28);
      position: relative;
      overflow: hidden;
    }

    .glass-card::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(
        180deg,
        rgba(255,255,255,0.18),
        rgba(255,255,255,0.05)
      );
      pointer-events: none;
    }

    /* Header */
    .header {
      padding: 28px;
      margin-bottom: 24px;
      animation: fadeInUp 0.6s ease-out;
      animation-delay: 0.1s;
      animation-fill-mode: both;
    }

    .header h1 {
      font-size: 28px;
      font-weight: 700;
      color: white;
      margin-bottom: 8px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      letter-spacing: -0.5px;
    }

    .header h1::before {
      content: '\uD83D\uDC8E ';
      font-size: 26px;
    }

    .header-subtitle {
      font-size: 14px;
      color: rgba(255, 255, 255, 0.85);
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    /* Section */
    .section {
      padding: 28px;
      margin-bottom: 24px;
      animation: fadeInUp 0.6s ease-out;
      animation-fill-mode: both;
    }

    .section:nth-child(3) { animation-delay: 0.2s; }
    .section:nth-child(4) { animation-delay: 0.3s; }

    .section-title {
      font-size: 20px;
      font-weight: 600;
      color: white;
      margin-bottom: 20px;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
      letter-spacing: -0.3px;
    }

    /* Flat Summary Cards */
    .flat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 16px;
    }

    .value-card {
      background: rgba(255, 255, 255, 0.15);
      backdrop-filter: blur(10px);
      padding: 20px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.25);
      position: relative;
      overflow: hidden;
    }

    .value-card::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: inherit;
      background: linear-gradient(
        180deg,
        rgba(255,255,255,0.15),
        rgba(255,255,255,0.05)
      );
      pointer-events: none;
    }

    .value-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.2);
      background: rgba(255, 255, 255, 0.25);
      border-color: rgba(255, 255, 255, 0.4);
    }

    .value-key {
      font-size: 14px;
      font-weight: 600;
      color: white;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
      word-break: break-all;
      overflow-wrap: break-word;
      hyphens: auto;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      position: relative;
      z-index: 1;
    }

    .value-amount {
      font-size: 32px;
      font-weight: 700;
      color: white;
      font-family: 'SF Mono', Monaco, monospace;
      text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      position: relative;
      z-index: 1;
    }

    /* Tree View */
    .tree-container {
      position: relative;
    }

    .tree-node {
      position: relative;
      margin-bottom: 4px;
    }

    .tree-node-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      background: rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      border: 1px solid rgba(255, 255, 255, 0.15);
    }

    .tree-node-header:hover {
      background: rgba(255, 255, 255, 0.2);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      transform: translateX(4px);
      border-color: rgba(255, 255, 255, 0.3);
    }

    .tree-toggle {
      width: 24px;
      height: 24px;
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.25);
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      flex-shrink: 0;
      color: white;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .tree-toggle:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: scale(1.1);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .tree-toggle.collapsed {
      transform: rotate(-90deg);
    }

    .tree-toggle.collapsed:hover {
      transform: rotate(-90deg) scale(1.1);
    }

    .tree-spacer {
      width: 24px;
      flex-shrink: 0;
    }

    .tree-node-info {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      min-width: 0;
    }

    .tree-node-name {
      font-size: 15px;
      font-weight: 600;
      color: white;
      text-decoration: none;
      transition: all 0.2s;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 300px;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .tree-node-name:hover {
      text-shadow: 0 0 10px rgba(255, 255, 255, 0.8);
      transform: translateX(2px);
    }

    .value-count {
      font-size: 12px;
      color: white;
      padding: 2px 8px;
      background: rgba(255, 255, 255, 0.15);
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.2);
      flex-shrink: 0;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    }

    .tree-node-values {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 8px;
      margin: 12px 0 12px 36px;
      padding: 12px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 8px;
      border-left: 3px solid rgba(255, 255, 255, 0.4);
    }

    .tree-node-values.total-values {
      border-left-color: rgba(16, 185, 129, 0.6);
    }

    .node-value-item {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.15);
      border-radius: 6px;
      transition: all 0.2s;
      min-height: 60px;
      cursor: help;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.15);
    }

    .node-value-item:hover {
      background: rgba(255, 255, 255, 0.25);
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    }

    .value-key-small {
      font-size: 11px;
      font-weight: 600;
      color: white;
      letter-spacing: 0.3px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
      line-height: 1.3;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }

    .value-amount-small {
      font-size: 16px;
      font-weight: 700;
      color: white;
      font-family: 'SF Mono', Monaco, monospace;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
      text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .empty-values {
      font-size: 13px;
      color: rgba(255, 255, 255, 0.6);
      font-style: italic;
      padding: 8px;
    }

    .tree-children {
      margin-left: 20px;
      padding-left: 12px;
      border-left: 2px solid rgba(255, 255, 255, 0.2);
      margin-top: 4px;
      transition: all 0.3s;
    }

    .tree-children.collapsed {
      display: none;
    }

    /* Empty States */
    .empty-state-small {
      text-align: center;
      padding: 40px;
      color: rgba(255, 255, 255, 0.7);
      font-style: italic;
    }

    /* Controls */
    .tree-controls {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }

    .btn-control {
      padding: 8px 16px;
      background: rgba(255, 255, 255, 0.15);
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 980px;
      font-size: 14px;
      font-weight: 600;
      color: white;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1),
        inset 0 1px 0 rgba(255, 255, 255, 0.2);
      position: relative;
      overflow: hidden;
    }

    .btn-control::before {
      content: "";
      position: absolute;
      inset: -40%;
      background: radial-gradient(
        120% 60% at 0% 0%,
        rgba(255, 255, 255, 0.3),
        transparent 60%
      );
      opacity: 0;
      transform: translateX(-30%) translateY(-10%);
      transition: opacity 0.35s ease, transform 0.6s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }

    .btn-control:hover {
      background: rgba(255, 255, 255, 0.25);
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
    }

    .btn-control:hover::before {
      opacity: 1;
      transform: translateX(30%) translateY(10%);
    }

    .btn-control.active {
      background: rgba(255, 255, 255, 0.3);
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2),
        inset 0 1px 0 rgba(255, 255, 255, 0.4);
    }

    .controls-group {
      display: flex;
      gap: 8px;
      background: rgba(255, 255, 255, 0.1);
      padding: 4px;
      border-radius: 980px;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    .controls-group .btn-control {
      border: none;
      background: transparent;
      box-shadow: none;
    }

    .controls-group .btn-control:hover {
      background: rgba(255, 255, 255, 0.2);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .controls-group .btn-control.active {
      background: rgba(255, 255, 255, 0.25);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    }

    /* Responsive */
    @media (max-width: 640px) {
      body {
        padding: 16px;
      }

      .header,
      .section {
        padding: 20px;
      }

      .header h1 {
        font-size: 24px;
      }

      .flat-grid {
        grid-template-columns: 1fr;
      }

      .tree-children {
        margin-left: 20px;
        padding-left: 12px;
      }

      .tree-node-values {
        margin-left: 36px;
        grid-template-columns: 1fr;
      }

      .back-nav {
        flex-direction: column;
      }

      .back-link {
        justify-content: center;
      }

      .value-amount {
        font-size: 24px;
      }

      .tree-node-name {
        max-width: 200px;
      }

      .tree-controls {
        flex-direction: column;
      }

      .controls-group {
        width: 100%;
      }

      .controls-group .btn-control {
        flex: 1;
        text-align: center;
      }
    }

    @media (min-width: 641px) and (max-width: 1024px) {
      .container {
        max-width: 800px;
      }

      .flat-grid {
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      }
    }
`;

  const body = `
  <div class="container">
    <!-- Back Navigation -->
    <div class="back-nav">
      <a href="/api/v1/root/${nodeId}${queryString}" class="back-link">
        <- Back to Tree
      </a>
    </div>

    <!-- Header -->
    <div class="glass-card header">
      <h1>Global Values</h1>
      <div class="header-subtitle">Cumulative values across all nodes</div>
    </div>

    <!-- Flat Summary -->
    <div class="glass-card section">
      <div class="section-title">Total Summary</div>
      <div class="flat-grid">
        ${flatSummary}
      </div>
    </div>

    <!-- Tree View -->
    <div class="glass-card section">
      <div class="tree-controls">
        <div class="controls-group">
          <button class="btn-control active" id="showLocalBtn" onclick="showLocalValues()">
            Local Values
          </button>
          <button class="btn-control" id="showTotalBtn" onclick="showTotalValues()">
            Total Values
          </button>
        </div>
        <button class="btn-control" onclick="expandAll()">Expand All</button>
        <button class="btn-control" onclick="collapseAll()">Collapse All</button>
      </div>
      <div class="tree-container">
        ${renderTree(result.tree)}
      </div>
    </div>
  </div>
`;

  const js = `
    let currentView = 'local';

    function showLocalValues() {
      currentView = 'local';
      document.getElementById('showLocalBtn').classList.add('active');
      document.getElementById('showTotalBtn').classList.remove('active');

      document.querySelectorAll('.local-values').forEach(el => {
        el.style.display = 'grid';
      });
      document.querySelectorAll('.total-values').forEach(el => {
        el.style.display = 'none';
      });
    }

    function showTotalValues() {
      currentView = 'total';
      document.getElementById('showTotalBtn').classList.add('active');
      document.getElementById('showLocalBtn').classList.remove('active');

      document.querySelectorAll('.local-values').forEach(el => {
        el.style.display = 'none';
      });
      document.querySelectorAll('.total-values').forEach(el => {
        el.style.display = 'grid';
      });
    }

    function toggleNode(button) {
      button.classList.toggle('collapsed');
      const treeNode = button.closest('.tree-node');
      const children = treeNode.querySelector('.tree-children');
      if (children) {
        children.classList.toggle('collapsed');
      }
    }

    function expandAll() {
      document.querySelectorAll('.tree-toggle').forEach(btn => {
        btn.classList.remove('collapsed');
      });
      document.querySelectorAll('.tree-children').forEach(children => {
        children.classList.remove('collapsed');
      });
    }

    function collapseAll() {
      document.querySelectorAll('.tree-toggle').forEach(btn => {
        btn.classList.add('collapsed');
      });
      document.querySelectorAll('.tree-children').forEach(children => {
        children.classList.add('collapsed');
      });
    }
`;

  return page({
    title: `Global Values - ${rootNodeName}`,
    css,
    body,
    js,
  });
}
