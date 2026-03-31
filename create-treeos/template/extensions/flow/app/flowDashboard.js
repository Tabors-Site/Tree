/**
 * Flow Dashboard
 *
 * The network operations center for your land.
 * Three sections: Pulse Strip, Tree Map, Network Layer.
 * All data from existing APIs. Polls every 10 seconds.
 */

import express from "express";
import authenticateLite from "../../html-rendering/authenticateLite.js";
import { page } from "../../html-rendering/html/layout.js";

const router = express.Router();

router.get("/dashboard/flow", authenticateLite, async (req, res) => {
  if (!req.userId) return res.redirect("/login");
  // Inject userId into the page so client JS can fetch the right endpoints
  const injectedJs = `const USER_ID = "${req.userId}";\n` + JS;
  res.send(page({
    title: "Flow Dashboard -- TreeOS",
    bare: true,
    css: CSS,
    body: BODY,
    js: injectedJs,
  }));
});

export default router;

// ── CSS ──

const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: #0a0a0a;
  color: #e5e5e5;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}

:root {
  --signal-success: #22c55e;
  --signal-pending: #eab308;
  --signal-failed: #ef4444;
  --signal-canopy: #3b82f6;
  --signal-mycelium: #a855f7;
  --node-active: rgba(34, 197, 94, 0.15);
  --node-dormant: rgba(255, 255, 255, 0.03);
  --peer-healthy: #22c55e;
  --peer-degraded: #eab308;
  --peer-dead: #ef4444;
  --glass: rgba(255, 255, 255, 0.04);
  --glass-border: rgba(255, 255, 255, 0.08);
  --text-dim: rgba(255, 255, 255, 0.4);
  --text-mid: rgba(255, 255, 255, 0.6);
  --text-bright: rgba(255, 255, 255, 0.9);
}

.flow-dashboard {
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 100vh;
}

/* ── Header ── */
.fd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0;
}
.fd-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-bright);
  letter-spacing: -0.3px;
}
.fd-subtitle {
  font-size: 13px;
  color: var(--text-dim);
  margin-top: 2px;
}
.fd-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-dim);
}
.fd-breath-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--signal-success);
  animation: breathPulse 2s ease-in-out infinite;
}
.fd-breath-dot.dormant { background: #333; animation: none; }
@keyframes breathPulse {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.2); }
}

/* ── Section container ── */
.fd-section {
  background: var(--glass);
  border: 1px solid var(--glass-border);
  border-radius: 16px;
  overflow: hidden;
}
.fd-section-header {
  padding: 14px 20px;
  border-bottom: 1px solid var(--glass-border);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-mid);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* ── Pulse Strip ── */
.pulse-strip {
  position: relative;
  height: 80px;
  overflow: hidden;
  padding: 0 20px;
}
.pulse-timeline {
  position: relative;
  height: 100%;
  width: 100%;
}
.pulse-dot {
  position: absolute;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  top: 50%;
  transform: translateY(-50%);
  opacity: 0.8;
  transition: opacity 0.3s;
}
.pulse-dot:hover { opacity: 1; transform: translateY(-50%) scale(2); }
.pulse-dot.succeeded { background: var(--signal-success); }
.pulse-dot.failed, .pulse-dot.rejected { background: var(--signal-failed); }
.pulse-dot.queued, .pulse-dot.partial, .pulse-dot.awaiting { background: var(--signal-pending); }
.pulse-dot.canopy { background: var(--signal-canopy); }
.pulse-dot.mycelium { background: var(--signal-mycelium); }
.pulse-hour-label {
  position: absolute;
  bottom: 4px;
  font-size: 10px;
  color: var(--text-dim);
  transform: translateX(-50%);
}
.pulse-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-dim);
  font-size: 13px;
}
.pulse-tooltip {
  position: fixed;
  background: rgba(0,0,0,0.9);
  border: 1px solid var(--glass-border);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-bright);
  pointer-events: none;
  z-index: 100;
  max-width: 250px;
  display: none;
}

/* ── Tree Map ── */
.tree-map {
  padding: 16px 20px;
  max-height: 500px;
  overflow-y: auto;
}
.tm-tree { margin-bottom: 12px; }
.tm-tree-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-bright);
  cursor: pointer;
  padding: 6px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.tm-tree-name:hover { color: #fff; }
.tm-chevron {
  font-size: 10px;
  transition: transform 0.2s;
  color: var(--text-dim);
}
.tm-chevron.open { transform: rotate(90deg); }
.tm-children { padding-left: 20px; border-left: 1px solid rgba(255,255,255,0.05); }
.tm-node {
  padding: 4px 8px;
  margin: 2px 0;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-mid);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background 0.3s;
}
.tm-node:hover { background: rgba(255,255,255,0.06); }
.tm-node.active { background: var(--node-active); color: var(--text-bright); }
.tm-node.pulsing { animation: nodePulse 1.5s ease-in-out infinite; }
.tm-node.dormant { color: rgba(255,255,255,0.2); }
.tm-signal-count {
  font-size: 10px;
  color: var(--text-dim);
  margin-left: auto;
}
.tm-channel-badge {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 10px;
  background: rgba(168, 85, 247, 0.15);
  color: var(--signal-mycelium);
  border: 1px solid rgba(168, 85, 247, 0.2);
}
@keyframes nodePulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
  50% { box-shadow: 0 0 8px 2px rgba(34, 197, 94, 0.2); }
}
.tm-collapsed-summary {
  font-size: 11px;
  color: var(--text-dim);
  padding: 4px 8px;
}
.tm-empty {
  padding: 20px;
  text-align: center;
  color: var(--text-dim);
  font-size: 13px;
}

/* ── Node Panel ── */
.node-panel {
  position: fixed;
  right: 0;
  top: 0;
  width: 360px;
  height: 100vh;
  background: #111;
  border-left: 1px solid var(--glass-border);
  padding: 20px;
  overflow-y: auto;
  transform: translateX(100%);
  transition: transform 0.25s ease;
  z-index: 50;
}
.node-panel.open { transform: translateX(0); }
.np-close {
  position: absolute;
  top: 12px;
  right: 12px;
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 18px;
  cursor: pointer;
}
.np-path {
  font-size: 12px;
  color: var(--signal-canopy);
  font-family: monospace;
  margin-bottom: 16px;
  word-break: break-all;
}
.np-stat {
  display: flex;
  justify-content: space-between;
  padding: 6px 0;
  font-size: 13px;
  color: var(--text-mid);
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.np-stat-label { color: var(--text-dim); }
.np-signal-list { margin-top: 16px; }
.np-signal-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}
.np-signal {
  padding: 6px 0;
  font-size: 12px;
  color: var(--text-mid);
  border-bottom: 1px solid rgba(255,255,255,0.03);
  display: flex;
  gap: 8px;
}
.np-signal-dir { color: var(--signal-success); }
.np-signal-time { color: var(--text-dim); margin-left: auto; font-size: 11px; }

/* ── Network Layer ── */
.network-layer { padding: 20px; min-height: 120px; }
.nl-graph {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 40px;
  flex-wrap: wrap;
  padding: 20px 0;
}
.nl-peer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 12px;
  border-radius: 12px;
  transition: background 0.2s;
}
.nl-peer:hover { background: rgba(255,255,255,0.04); }
.nl-peer-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}
.nl-peer-name {
  font-size: 12px;
  color: var(--text-mid);
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
}
.nl-peer-status {
  font-size: 10px;
  color: var(--text-dim);
}
.nl-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.nl-center-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--signal-canopy);
  border: 2px solid rgba(59, 130, 246, 0.3);
}
.nl-center-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-bright);
}
.nl-empty {
  text-align: center;
  color: var(--text-dim);
  font-size: 13px;
  padding: 20px;
}
.nl-hidden { display: none; }

/* ── Responsive ── */
@media (max-width: 768px) {
  .flow-dashboard { padding: 12px; gap: 12px; }
  .pulse-strip { height: 50px; }
  .node-panel { width: 100%; }
  .tree-map { max-height: 400px; }
  .nl-graph { gap: 20px; }
}
`;

// ── Body HTML ──

const BODY = `
<div class="flow-dashboard">
  <div class="fd-header">
    <div>
      <div class="fd-title">Flow Dashboard</div>
      <div class="fd-subtitle">Signal activity across your land</div>
    </div>
    <div style="display:flex;align-items:center;gap:16px;">
      <div class="fd-status">
        <div class="fd-breath-dot dormant" id="breathDot"></div>
        <span id="breathLabel">loading...</span>
      </div>
      <a href="/dashboard" style="color:var(--text-dim);text-decoration:none;font-size:0.85rem;padding:6px 14px;border:1px solid var(--glass-border);border-radius:8px;">Dashboard</a>
    </div>
  </div>

  <div class="fd-section">
    <div class="fd-section-header">Pulse Strip (last 24h)</div>
    <div class="pulse-strip" id="pulseStrip">
      <div class="pulse-timeline" id="pulseTimeline"></div>
    </div>
  </div>

  <div class="fd-section">
    <div class="fd-section-header">Tree Map</div>
    <div class="tree-map" id="treeMap">
      <div class="tm-empty">Loading trees...</div>
    </div>
  </div>

  <div class="fd-section" id="networkSection">
    <div class="fd-section-header">Network</div>
    <div class="network-layer" id="networkLayer">
      <div class="nl-empty">Loading peers...</div>
    </div>
  </div>

  <div class="node-panel" id="nodePanel">
    <button class="np-close" onclick="closePanel()">&times;</button>
    <div id="panelContent"></div>
  </div>

  <div class="pulse-tooltip" id="tooltip"></div>
</div>
`;

// ── Client-side JavaScript ──

const JS = `
const API = "/api/v1";
const POLL_INTERVAL = 10000;
const MAX_DOTS = 500;
const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;

let flowData = [];
let roots = [];        // [{ id, name }]  (id always a string)
let signalCounts = {}; // rootId -> signal count
let expandedTrees = {}; // rootId -> { tree, signalMap }
let selectedNode = null;

// ── Fetch helpers ──

async function fetchJson(url) {
  try {
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) return null;
    const j = await r.json();
    return j.data != null ? j.data : j;
  } catch { return null; }
}

// id() safely extracts a string ID from MongoDB _id (could be ObjectId or string)
function id(obj) {
  if (!obj) return "";
  if (typeof obj === "string") return obj;
  if (obj._id) return String(obj._id);
  if (obj.id) return String(obj.id);
  return String(obj);
}

// ── Load roots ──
// GET /api/v1/user/:userId -> { roots: [{ _id, name, visibility }] }

async function loadRoots() {
  const userData = await fetchJson(API + "/user/" + USER_ID);
  // Normalize: always { id: string, name: string }
  roots = (userData?.roots || []).map(r => ({
    id: id(r),
    name: r.name || id(r).slice(0, 8),
  }));
  return roots;
}

// ── Pulse Strip ──
// Fetch flow data from first few trees in parallel (just flow, not tree structure)

async function loadPulseStrip() {
  if (!roots.length) return;

  const flowFetches = roots.slice(0, 10).map(async (root) => {
    const flow = await fetchJson(API + "/node/" + root.id + "/flow?limit=100");
    return { rootId: root.id, results: flow?.results || [] };
  });

  const flowResults = await Promise.allSettled(flowFetches);
  const allSignals = [];
  const now = Date.now();
  const cutoff = now - DAY_MS;

  // Reset signal counts for tree cards
  signalCounts = {};

  for (const result of flowResults) {
    if (result.status !== "fulfilled") continue;
    const { rootId, results } = result.value;
    let count = 0;
    for (const r of results) {
      const ts = new Date(r.timestamp || r.createdAt).getTime();
      if (ts > cutoff) {
        allSignals.push({
          timestamp: ts,
          status: r.status || "succeeded",
          source: r.source,
          extName: r.extName,
        });
        count++;
      }
    }
    signalCounts[rootId] = count;
  }

  allSignals.sort((a, b) => a.timestamp - b.timestamp);
  flowData = allSignals.slice(-MAX_DOTS);
  renderPulseStrip();
  renderTreeCards(); // update signal badges on tree cards
}

function renderPulseStrip() {
  const timeline = document.getElementById("pulseTimeline");
  if (!flowData.length) {
    timeline.innerHTML = '<div class="pulse-empty">No signals in the last 24 hours</div>';
    return;
  }

  const now = Date.now();
  const start = now - DAY_MS;
  let html = "";

  for (let h = 0; h < 24; h += 4) {
    const t = start + h * HOUR_MS;
    const pct = ((t - start) / DAY_MS) * 100;
    const label = new Date(t).toLocaleTimeString([], { hour: "numeric" });
    html += '<div class="pulse-hour-label" style="left:' + pct + '%">' + label + '</div>';
  }

  for (const signal of flowData) {
    const pct = ((signal.timestamp - start) / DAY_MS) * 100;
    if (pct < 0 || pct > 100) continue;
    const y = 20 + Math.random() * 30;
    html += '<div class="pulse-dot ' + signal.status + '" '
      + 'style="left:' + pct + '%;top:' + y + 'px" '
      + 'data-ts="' + signal.timestamp + '" '
      + 'data-status="' + signal.status + '" '
      + 'data-ext="' + (signal.extName || "") + '"'
      + '></div>';
  }

  timeline.innerHTML = html;

  const tooltip = document.getElementById("tooltip");
  timeline.querySelectorAll(".pulse-dot").forEach(dot => {
    dot.addEventListener("mouseenter", (e) => {
      const ts = new Date(parseInt(dot.dataset.ts));
      const time = ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const ext = dot.dataset.ext ? " (" + dot.dataset.ext + ")" : "";
      tooltip.textContent = dot.dataset.status + ext + " at " + time;
      tooltip.style.display = "block";
      tooltip.style.left = e.clientX + 12 + "px";
      tooltip.style.top = e.clientY - 30 + "px";
    });
    dot.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });
  });
}

// ── Tree Map (lazy load) ──
// Page load: collapsed cards. Click: fetch that tree. One call per expand.

function renderTreeCards() {
  const container = document.getElementById("treeMap");
  if (!roots.length) {
    container.innerHTML = '<div class="tm-empty">No trees</div>';
    return;
  }

  let html = "";
  for (const root of roots) {
    const sig = signalCounts[root.id] || 0;
    const isExpanded = !!expandedTrees[root.id];

    html += '<div class="tm-tree" id="tcard-' + root.id + '">';
    html += '<div class="tm-tree-name" data-rid="' + root.id + '">';
    html += '<span class="tm-chevron' + (isExpanded ? " open" : "") + '">></span> ';
    html += esc(root.name);
    if (sig > 0) html += ' <span class="tm-signal-count">' + sig + '</span>';
    html += '</div>';
    html += '<div class="tm-children" id="tbody-' + root.id + '"';
    if (!isExpanded) html += ' style="display:none"';
    html += '>';

    if (isExpanded) {
      html += buildTreeHtml(expandedTrees[root.id], root.id);
    }

    html += '</div></div>';
  }

  container.innerHTML = html;
}

function buildTreeHtml(td, rootId) {
  if (!td || !td.tree) return '<div class="tm-collapsed-summary">Failed to load</div>';
  const kids = (td.tree.children || []).filter(function(n) { return n.name && n.name[0] !== "."; });
  if (!kids.length) return '<div class="tm-collapsed-summary">Empty tree</div>';
  return renderNodes(kids, td.signalMap, Date.now(), rootId, 0);
}

async function toggleTreeLazy(rootId) {
  var body = document.getElementById("tbody-" + rootId);
  var card = document.getElementById("tcard-" + rootId);
  var chevron = card ? card.querySelector(".tm-chevron") : null;

  if (expandedTrees[rootId]) {
    delete expandedTrees[rootId];
    if (body) body.style.display = "none";
    if (chevron) chevron.classList.remove("open");
    return;
  }

  // Show loading
  if (body) { body.style.display = ""; body.innerHTML = '<div class="tm-collapsed-summary">Loading...</div>'; }
  if (chevron) chevron.classList.add("open");

  try {
    // GET /root/:rootId -> { _id, name, children: [{_id, name, children, ...}], ... }
    // GET /node/:nodeId/flow -> { results: [...] }
    var results = await Promise.all([
      fetchJson(API + "/root/" + rootId),
      fetchJson(API + "/node/" + rootId + "/flow?limit=50")
    ]);
    var tree = results[0];
    var flow = results[1];

    var signalMap = {};
    var flowResults = (flow && flow.results) ? flow.results : [];
    for (var i = 0; i < flowResults.length; i++) {
      var r = flowResults[i];
      var ts = new Date(r.timestamp || r.createdAt).getTime();
      var src = r.source ? String(r.source) : null;
      var tgt = r.nodeId ? String(r.nodeId) : null;
      if (src) {
        if (!signalMap[src]) signalMap[src] = { sent: 0, received: 0, lastSignal: 0 };
        signalMap[src].sent++;
        if (ts > signalMap[src].lastSignal) signalMap[src].lastSignal = ts;
      }
      if (tgt) {
        if (!signalMap[tgt]) signalMap[tgt] = { sent: 0, received: 0, lastSignal: 0 };
        signalMap[tgt].received++;
        if (ts > signalMap[tgt].lastSignal) signalMap[tgt].lastSignal = ts;
      }
    }

    expandedTrees[rootId] = { tree: tree, signalMap: signalMap };
    if (body) body.innerHTML = buildTreeHtml(expandedTrees[rootId], rootId);
  } catch (err) {
    if (body) body.innerHTML = '<div class="tm-collapsed-summary">Error: ' + err.message + '</div>';
  }
}

function renderNodes(nodes, signalMap, now, rootId, depth) {
  var visible = [];
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].name && nodes[i].name[0] !== ".") visible.push(nodes[i]);
  }
  if (!visible.length) return "";
  if (depth > 2) {
    return '<div class="tm-collapsed-summary">' + countAll(visible) + ' deeper nodes</div>';
  }
  var html = "";
  for (var i = 0; i < visible.length; i++) {
    var node = visible[i];
    var nid = String(node._id || "");
    var sig = signalMap[nid];
    var cls = "tm-node";
    if (sig && sig.sent > 0 && (now - sig.lastSignal < HOUR_MS)) cls += " pulsing";
    else if (sig && (now - sig.lastSignal < HOUR_MS)) cls += " active";
    var badge = sig ? ' <span class="tm-signal-count">' + (sig.sent + sig.received) + '</span>' : "";
    html += '<div class="' + cls + '" data-nodeid="' + nid + '" data-rootid="' + rootId + '">' + esc(node.name) + badge + '</div>';
    var kids = node.children;
    if (kids && kids.length) {
      html += '<div class="tm-children">' + renderNodes(kids, signalMap, now, rootId, depth + 1) + '</div>';
    }
  }
  return html;
}

function countAll(nodes) {
  var c = 0;
  for (var i = 0; i < nodes.length; i++) {
    c++;
    if (nodes[i].children) c += countAll(nodes[i].children);
  }
  return c;
}

// ── Node Panel ──

async function selectNode(nodeId, rootId) {
  selectedNode = nodeId;
  const panel = document.getElementById("nodePanel");
  const content = document.getElementById("panelContent");

  const node = await fetchJson(API + "/node/" + nodeId);
  const flow = await fetchJson(API + "/node/" + nodeId + "/flow?limit=20");
  let channels = null;
  try { channels = await fetchJson(API + "/node/" + nodeId + "/channels"); } catch {}

  let html = '<div class="np-path">' + esc(node?.path || node?.name || nodeId) + '</div>';

  // Stats
  const signals = flow?.results || [];
  const sent = signals.filter(s => s.source === nodeId).length;
  const received = signals.length - sent;

  html += '<div class="np-stat"><span class="np-stat-label">Signals sent</span><span>' + sent + '</span></div>';
  html += '<div class="np-stat"><span class="np-stat-label">Signals received</span><span>' + received + '</span></div>';

  if (channels?.subscriptions?.length) {
    html += '<div class="np-stat"><span class="np-stat-label">Channels</span><span>'
      + channels.subscriptions.map(c => c.channelName).join(", ") + '</span></div>';
  }

  if (node?.metadata?.cascade?.enabled) {
    html += '<div class="np-stat"><span class="np-stat-label">Cascade</span><span>enabled</span></div>';
  }

  // Recent signals
  if (signals.length > 0) {
    html += '<div class="np-signal-list"><div class="np-signal-title">Recent Signals</div>';
    for (const sig of signals.slice(0, 15)) {
      const dir = sig.source === nodeId ? ">" : "<";
      const dirCls = sig.source === nodeId ? "sent" : "received";
      const ago = timeAgo(new Date(sig.timestamp || sig.createdAt));
      const desc = sig.extName || sig.status || "";
      html += '<div class="np-signal">'
        + '<span class="np-signal-dir">' + dir + '</span>'
        + '<span>' + esc(desc) + '</span>'
        + '<span class="np-signal-time">' + ago + '</span>'
        + '</div>';
    }
    html += '</div>';
  }

  content.innerHTML = html;
  panel.classList.add("open");
}

function closePanel() {
  document.getElementById("nodePanel").classList.remove("open");
  selectedNode = null;
}

// ── Network Layer ──

async function loadNetwork() {
  const section = document.getElementById("networkSection");
  const container = document.getElementById("networkLayer");

  let peers;
  try {
    peers = await fetchJson(API + "/canopy/admin/peers");
  } catch {}
  if (!peers?.length) {
    section.classList.add("nl-hidden");
    return;
  }

  section.classList.remove("nl-hidden");
  peerData = peers;

  let html = '<div class="nl-graph">';

  // Peers on the left
  const leftPeers = peers.slice(0, Math.ceil(peers.length / 2));
  const rightPeers = peers.slice(Math.ceil(peers.length / 2));

  for (const p of leftPeers) html += renderPeer(p);

  // Center: this land
  html += '<div class="nl-center"><div class="nl-center-dot"></div><div class="nl-center-label">This Land</div></div>';

  for (const p of rightPeers) html += renderPeer(p);

  html += '</div>';
  container.innerHTML = html;
}

function renderPeer(peer) {
  const status = peer.status || "unknown";
  let color = "var(--peer-dead)";
  let label = "inactive";
  if (status === "active" || status === "healthy") { color = "var(--peer-healthy)"; label = "healthy"; }
  else if (status === "degraded") { color = "var(--peer-degraded)"; label = "degraded"; }
  else if (status === "unreachable") { color = "var(--peer-dead)"; label = "unreachable"; }

  const name = peer.name || peer.landUrl || peer.peerId?.slice(0, 12) || "unknown";
  return '<div class="nl-peer">'
    + '<div class="nl-peer-dot" style="background:' + color + '"></div>'
    + '<div class="nl-peer-name">' + esc(name) + '</div>'
    + '<div class="nl-peer-status">' + label + '</div>'
    + '</div>';
}

// ── Breath Status ──
// Breath has no HTTP endpoint. Infer activity from flow data and tree count.

async function loadBreath() {
  const dot = document.getElementById("breathDot");
  const label = document.getElementById("breathLabel");
  if (!dot || !label) return;
  const treeCount = roots?.length || 0;

  if (treeCount === 0) {
    dot.className = "fd-breath-dot dormant";
    label.textContent = "no trees";
    return;
  }

  // Check recent signal activity as a proxy for breath
  const recentSignals = flowData.filter(s => Date.now() - s.timestamp < HOUR_MS).length;
  if (recentSignals > 0) {
    dot.classList.remove("dormant");
    // Faster pulse when more active
    const rate = recentSignals > 20 ? 0.5 : recentSignals > 5 ? 1 : 2;
    dot.style.animationDuration = rate + "s";
    label.textContent = treeCount + " tree" + (treeCount > 1 ? "s" : "") + ", " + recentSignals + " signals/hr";
  } else {
    dot.classList.add("dormant");
    label.textContent = treeCount + " tree" + (treeCount > 1 ? "s" : "") + ", quiet";
  }
}

// ── Helpers ──

function esc(s) {
  if (!s) return "";
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function timeAgo(date) {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 60) return sec + "s ago";
  if (sec < 3600) return Math.floor(sec / 60) + "m ago";
  if (sec < 86400) return Math.floor(sec / 3600) + "h ago";
  return Math.floor(sec / 86400) + "d ago";
}

// ── Event delegation for tree map clicks ──

document.getElementById("treeMap").addEventListener("click", function(e) {
  // Tree name click (expand/collapse)
  var treeName = e.target.closest(".tm-tree-name");
  if (treeName && treeName.dataset.rid) {
    toggleTreeLazy(treeName.dataset.rid);
    return;
  }
  // Node click (open panel)
  var nodeEl = e.target.closest(".tm-node");
  if (nodeEl && nodeEl.dataset.nodeid) {
    selectNode(nodeEl.dataset.nodeid, nodeEl.dataset.rootid);
  }
});

// ── Init and polling ──

async function init() {
  // One call: get root list
  await loadRoots();

  // Render tree cards immediately (collapsed, no fetches)
  renderTreeCards();

  // Load flow data and network in parallel (flow is independent of tree structure)
  await Promise.allSettled([loadPulseStrip(), loadNetwork()]);
  loadBreath().catch(() => {});

  // Always update breath label even if loadBreath fails
  const label = document.getElementById("breathLabel");
  if (label && label.textContent === "loading...") {
    label.textContent = roots.length + " tree" + (roots.length !== 1 ? "s" : "");
  }

  // Poll flow data every 10s (updates pulse strip + signal badges on cards)
  setInterval(async () => {
    await loadPulseStrip();
    loadBreath();
  }, POLL_INTERVAL);

  // Refresh root list every 60s (picks up new trees)
  setInterval(async () => {
    await loadRoots();
    renderTreeCards();
  }, 60000);
}

init();
`;
