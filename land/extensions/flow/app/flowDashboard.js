/**
 * Flow Dashboard — the land's nervous system at a glance.
 *
 * One screen: a live SVG map of which trees are exchanging signals, a
 * filterable live feed with every signal linking out to chat / tree /
 * signal-detail pages, and breakdown chips for status / extension / tree.
 * Polls /api/v1/flow every 10s.
 */

import express from "express";
import authenticateLite from "../../html-rendering/authenticateLite.js";
import { page } from "../../html-rendering/html/layout.js";

const router = express.Router();

router.get("/dashboard/flow", authenticateLite, async (req, res) => {
  if (!req.userId) return res.redirect("/login");
  const injectedJs = `const USER_ID = ${JSON.stringify(req.userId)};\n` + JS;
  res.send(page({
    title: "Flow · TreeOS",
    bare: true,
    css: CSS,
    body: BODY,
    js: injectedJs,
  }));
});

export default router;

// ── CSS ───────────────────────────────────────────────────────────────

const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: #030712;
  color: #e5e7eb;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
}

:root {
  --success: #4ade80;
  --pending: #fbbf24;
  --failed:  #f87171;
  --queued:  #60a5fa;
  --awaiting:#a78bfa;
  --rejected:#fb7185;
  --partial: #fcd34d;
  --card-bg: linear-gradient(180deg, #1a2234 0%, #131a2a 100%);
  --card-border: rgba(148,163,184,0.12);
  --text-dim: #64748b;
  --text-mid: #94a3b8;
  --text-bright: #f1f5f9;
  --accent: #5eead4;
}

.fd-wrap { max-width: 1400px; margin: 0 auto; padding: 20px 20px 40px; display: flex; flex-direction: column; gap: 18px; }

/* ── Header ── */
.fd-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
.fd-title { font-size: 1.5rem; font-weight: 600; color: var(--text-bright); letter-spacing: -0.02em; }
.fd-sub { font-size: 0.85rem; color: var(--text-mid); margin-top: 4px; }
.fd-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.fd-winbtn { padding: 6px 12px; background: transparent; border: 1px solid var(--card-border); color: var(--text-mid); border-radius: 999px; font-size: 0.78rem; font-weight: 600; cursor: pointer; transition: all 120ms; }
.fd-winbtn:hover { color: var(--text-bright); border-color: var(--accent); }
.fd-winbtn.fd-active { background: rgba(94,234,212,0.1); color: var(--accent); border-color: var(--accent); }
.fd-backlink { padding: 6px 14px; color: var(--text-mid); text-decoration: none; font-size: 0.82rem; border: 1px solid var(--card-border); border-radius: 8px; }
.fd-backlink:hover { color: var(--text-bright); border-color: var(--accent); }

/* ── Stat chips ── */
.fd-stats { display: flex; gap: 10px; flex-wrap: wrap; font-size: 0.82rem; }
.fd-chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 999px; color: var(--text-mid); }
.fd-chip strong { color: var(--text-bright); font-weight: 600; }
.fd-chip .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.fd-chip-live { color: var(--success); border-color: rgba(74,222,128,0.4); }
.fd-chip-live .dot { background: var(--success); box-shadow: 0 0 0 3px rgba(74,222,128,0.2); animation: livePulse 1.4s ease-in-out infinite; }
.fd-chip-live.idle { color: var(--text-mid); border-color: var(--card-border); }
.fd-chip-live.idle .dot { background: var(--text-dim); box-shadow: none; animation: none; }
@keyframes livePulse { 0%,100% { box-shadow: 0 0 0 3px rgba(74,222,128,0.2); } 50% { box-shadow: 0 0 0 6px rgba(74,222,128,0); } }

/* ── Grid ── */
.fd-grid { display: grid; grid-template-columns: 1fr 320px; gap: 18px; }
@media (max-width: 900px) { .fd-grid { grid-template-columns: 1fr; } }

.fd-card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 14px; padding: 18px; }
.fd-card-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; }
.fd-card-title { font-size: 0.72rem; font-weight: 700; color: var(--text-mid); letter-spacing: 0.08em; text-transform: uppercase; }
.fd-card-count { font-size: 0.7rem; color: var(--text-dim); letter-spacing: normal; text-transform: none; }

/* ── Map ── */
.fd-map-box { position: relative; border-radius: 12px; overflow: hidden; background: radial-gradient(ellipse at center, #0f172a 0%, #020617 100%); border: 1px solid rgba(148,163,184,0.08); }
.fd-map-box svg { display: block; width: 100%; height: auto; }
.fd-map-empty { padding: 60px 20px; text-align: center; color: var(--text-dim); font-style: italic; }
.fd-tree-card rect { transition: filter 160ms; cursor: pointer; }
.fd-tree-card:hover rect { filter: brightness(1.25); }
.fd-tree-card text { paint-order: stroke; stroke: rgba(3,7,18,0.85); stroke-width: 3px; stroke-linejoin: round; }
.fd-edge { transition: stroke-width 160ms, opacity 160ms; cursor: pointer; }
.fd-edge:hover { opacity: 1 !important; stroke-width: 6 !important; }
.fd-edge.fd-active-pair { opacity: 1 !important; stroke-width: 6 !important; filter: drop-shadow(0 0 4px currentColor); }
.fd-edge-live { animation: edgeFlow 2.4s linear infinite; stroke-dasharray: 6 8; }
@keyframes edgeFlow { to { stroke-dashoffset: -28; } }
.fd-self-loop { stroke-dasharray: 3 5; opacity: 0.5; }

.fd-clear-pair { display: none; margin-left: 8px; padding: 3px 10px; font-size: 0.72rem; background: rgba(239,68,68,0.12); color: #fca5a5; border: 1px solid rgba(239,68,68,0.3); border-radius: 999px; cursor: pointer; }
.fd-clear-pair.show { display: inline-block; }
.fd-clear-pair:hover { background: rgba(239,68,68,0.2); color: #fee2e2; }

.fd-legend { position: absolute; top: 12px; right: 12px; background: rgba(15,23,42,0.85); backdrop-filter: blur(6px); border: 1px solid rgba(148,163,184,0.2); border-radius: 10px; padding: 10px 12px; font-size: 0.72rem; color: #cbd5e1; }
.fd-legend-title { font-weight: 600; color: var(--text-bright); font-size: 0.68rem; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px; }
.fd-legend-row { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
.fd-legend-sw { width: 12px; height: 2.5px; border-radius: 2px; }

/* ── Breakdowns ── */
.fd-breakdowns { display: flex; flex-direction: column; gap: 14px; }
.fd-bar { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 0.8rem; }
.fd-bar-swatch { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.fd-bar-label { color: var(--text-mid); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fd-bar-label a { color: var(--text-mid); text-decoration: none; border-bottom: 1px dotted transparent; }
.fd-bar-label a:hover { color: var(--text-bright); border-bottom-color: var(--accent); }
.fd-bar-count { color: var(--text-bright); font-weight: 600; font-variant-numeric: tabular-nums; }
.fd-bar-bar { height: 4px; background: rgba(148,163,184,0.1); border-radius: 2px; overflow: hidden; margin-top: 3px; }
.fd-bar-fill { height: 100%; border-radius: 2px; transition: width 300ms; }
.fd-status-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 6px; }
.fd-status-cell { padding: 10px; border-radius: 8px; background: rgba(30,41,59,0.5); border: 1px solid rgba(148,163,184,0.08); text-align: center; }
.fd-status-cell .v { font-size: 1.1rem; font-weight: 600; color: var(--text-bright); font-variant-numeric: tabular-nums; }
.fd-status-cell .l { font-size: 0.7rem; color: var(--text-mid); letter-spacing: 0.04em; text-transform: uppercase; margin-top: 2px; }

/* ── Feed ── */
.fd-feed { max-height: 540px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; scrollbar-width: thin; scrollbar-color: rgba(148,163,184,0.3) transparent; }
.fd-feed::-webkit-scrollbar { width: 8px; }
.fd-feed::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.25); border-radius: 4px; }

.fd-sig { display: grid; grid-template-columns: auto 1fr auto auto; gap: 12px; align-items: center; padding: 10px 12px; border-radius: 10px; border: 1px solid transparent; transition: background 120ms, border-color 120ms; }
.fd-sig:hover { background: rgba(30,41,59,0.5); border-color: rgba(148,163,184,0.1); }
.fd-sig-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.fd-sig-body { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.fd-sig-flow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 0.85rem; }
.fd-sig-flow a { color: var(--text-bright); text-decoration: none; border-bottom: 1px dotted rgba(148,163,184,0.4); }
.fd-sig-flow a:hover { color: var(--accent); border-bottom-color: var(--accent); }
.fd-sig-arrow { color: var(--text-dim); font-weight: bold; font-size: 0.72rem; }
.fd-sig-meta { display: flex; gap: 8px; font-size: 0.72rem; color: var(--text-dim); flex-wrap: wrap; }
.fd-sig-meta a { color: var(--text-dim); text-decoration: none; }
.fd-sig-meta a:hover { color: var(--accent); }
.fd-sig-meta .ext { color: var(--accent); }
.fd-sig-status { padding: 2px 8px; border-radius: 999px; font-size: 0.68rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.fd-sig-time { font-size: 0.72rem; color: var(--text-dim); font-variant-numeric: tabular-nums; white-space: nowrap; }

/* ── Filter bar ── */
.fd-filter { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.fd-fchip { padding: 4px 10px; background: transparent; border: 1px solid var(--card-border); color: var(--text-mid); border-radius: 999px; font-size: 0.72rem; font-weight: 600; cursor: pointer; transition: all 120ms; }
.fd-fchip:hover { color: var(--text-bright); }
.fd-fchip.active { background: rgba(94,234,212,0.1); color: var(--accent); border-color: var(--accent); }

/* ── Loader ── */
.fd-empty { padding: 40px 20px; text-align: center; color: var(--text-dim); font-style: italic; }
.fd-skeleton { padding: 10px 12px; border-radius: 10px; background: rgba(30,41,59,0.3); animation: skel 1.5s ease-in-out infinite; }
@keyframes skel { 0%,100% { opacity: 0.5; } 50% { opacity: 0.8; } }
`;

// ── Body ──────────────────────────────────────────────────────────────

const BODY = `
<div class="fd-wrap">
  <div class="fd-head">
    <div>
      <div class="fd-title">Flow Dashboard</div>
      <div class="fd-sub">Signal activity across your land</div>
    </div>
    <div class="fd-actions">
      <button class="fd-winbtn" data-win="3600000">1h</button>
      <button class="fd-winbtn fd-active" data-win="86400000">24h</button>
      <button class="fd-winbtn" data-win="604800000">7d</button>
      <button class="fd-winbtn" data-win="0">all</button>
      <a href="/dashboard" class="fd-backlink">← Home</a>
    </div>
  </div>

  <div class="fd-stats" id="fdStats"></div>

  <div class="fd-grid">
    <div>
      <div class="fd-card">
        <div class="fd-card-head">
          <div class="fd-card-title">Flow Map</div>
          <div class="fd-card-count" id="fdMapCount"></div>
        </div>
        <div class="fd-map-box" id="fdMapBox">
          <div class="fd-map-empty">Loading…</div>
        </div>
      </div>

      <div class="fd-card" style="margin-top:18px">
        <div class="fd-card-head">
          <div class="fd-card-title">Live Feed</div>
          <div class="fd-card-count" id="fdFeedCount"></div>
        </div>
        <div class="fd-filter" id="fdFilter"></div>
        <div class="fd-feed" id="fdFeed"><div class="fd-empty">Loading…</div></div>
      </div>
    </div>

    <div class="fd-breakdowns">
      <div class="fd-card">
        <div class="fd-card-head"><div class="fd-card-title">By Status</div></div>
        <div class="fd-status-grid" id="fdByStatus"></div>
      </div>
      <div class="fd-card">
        <div class="fd-card-head"><div class="fd-card-title">By Extension</div></div>
        <div id="fdByExt"></div>
      </div>
      <div class="fd-card">
        <div class="fd-card-head"><div class="fd-card-title">By Tree</div></div>
        <div id="fdByTree"></div>
      </div>
      <div class="fd-card">
        <div class="fd-card-head"><div class="fd-card-title">Storage</div></div>
        <div id="fdStats2"></div>
      </div>
      <div class="fd-card" id="fdPeerCard" style="display:none">
        <div class="fd-card-head"><div class="fd-card-title">Peers</div></div>
        <div id="fdPeers"></div>
      </div>
    </div>
  </div>
</div>
`;

// ── JS ────────────────────────────────────────────────────────────────

const JS = `
const API = "/api/v1";
const POLL = 10000;

// Auth token from query string is preserved across links so iframe/inApp
// sessions don't lose the share-token context.
const AUTH_QS = (function(){
  const q = new URLSearchParams(window.location.search);
  const tok = q.get("token");
  return tok ? ("&token=" + encodeURIComponent(tok)) : "";
})();

const STATUS_COLORS = {
  succeeded: "#4ade80",
  failed:    "#f87171",
  rejected:  "#fb7185",
  queued:    "#60a5fa",
  awaiting:  "#a78bfa",
  partial:   "#fcd34d",
  unknown:   "#64748b",
};
const STATUS_ORDER = ["succeeded","failed","rejected","queued","awaiting","partial"];

// Palette aligns with rooms map so the same tree wears the same color everywhere.
const TREE_PALETTE = ["#7dd3fc","#fca5a5","#a7f3d0","#fde68a","#c4b5fd","#fdba74","#f9a8d4","#86efac","#93c5fd","#fcd34d"];

let state = {
  roots: [],           // [{ id, name }]
  rootById: {},        // id -> root obj
  nodeToRoot: {},      // nodeId -> rootId (populated as we learn from signals)
  treeColor: {},       // rootId -> color
  signals: [],         // all cascade hops in window, sorted newest first
  windowMs: 86400000,  // 24h default
  statusFilter: null,
  pairFilter: null,    // { src, tgt } — when clicked, feed shows only that pair
  peers: [],
  stats: null,
};

// ── fetch helpers ──

async function fetchJson(url) {
  try {
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) return null;
    const j = await r.json();
    return j.data != null ? j.data : j;
  } catch { return null; }
}
function idOf(v) { if (!v) return ""; if (typeof v === "string") return v; if (v._id) return String(v._id); return String(v); }
function esc(s) { if (s == null) return ""; const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
function timeAgo(d) {
  const sec = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (sec < 60) return sec + "s";
  if (sec < 3600) return Math.floor(sec/60) + "m";
  if (sec < 86400) return Math.floor(sec/3600) + "h";
  return Math.floor(sec/86400) + "d";
}
function link(href, text, cls) {
  return '<a href="' + href + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(text) + '</a>';
}
function withAuth(path) {
  // The dashboard itself runs authenticated via cookie, but links to
  // authenticated HTML pages need the ?token=...&html pair in many setups.
  const sep = path.includes("?") ? "&" : "?";
  return path + sep + "html" + AUTH_QS;
}

// ── data load ──

async function loadAll() {
  // Roots for this user
  const userData = await fetchJson(API + "/user/" + USER_ID);
  state.roots = (userData?.roots || []).map(r => ({ id: idOf(r), name: r.name || idOf(r).slice(0,8) }));
  state.rootById = {};
  state.treeColor = {};
  state.roots.forEach((r, i) => {
    state.rootById[r.id] = r;
    state.treeColor[r.id] = TREE_PALETTE[i % TREE_PALETTE.length];
  });

  // Pre-populate nodeToRoot: every root node maps to itself.
  for (const r of state.roots) state.nodeToRoot[r.id] = r.id;

  // Global flow — last 500 signals.
  const flow = await fetchJson(API + "/flow?limit=500");
  const resultMap = flow?.results || {};
  const hops = [];
  for (const [signalId, signalResults] of Object.entries(resultMap)) {
    if (!Array.isArray(signalResults)) continue;
    for (const r of signalResults) {
      const ts = new Date(r.timestamp || r.createdAt || Date.now()).getTime();
      hops.push({
        signalId,
        timestamp: ts,
        status: r.status || "unknown",
        source: r.source ? String(r.source) : null,
        target: r.nodeId ? String(r.nodeId) : null,
        extName: r.extName || r.extension || null,
        depth: r.depth != null ? r.depth : null,
        summary: r.summary || r.reason || null,
      });
    }
  }
  hops.sort((a, b) => b.timestamp - a.timestamp);
  state.signals = hops;

  // Resolve unknown nodeIds to their root via /node/:id lookup, cached.
  await resolveUnknownRoots(hops);

  // Storage stats + peers in parallel (best-effort; may 403 for non-admin).
  const [stats, peers] = await Promise.all([
    fetchJson(API + "/flow/stats").catch(() => null),
    fetchJson(API + "/canopy/admin/peers").catch(() => null),
  ]);
  state.stats = stats;
  state.peers = Array.isArray(peers) ? peers : [];
}

async function resolveUnknownRoots(hops) {
  const seen = new Set();
  const pending = [];
  for (const h of hops) {
    for (const nid of [h.source, h.target]) {
      if (!nid || seen.has(nid) || state.nodeToRoot[nid] != null) continue;
      seen.add(nid);
      pending.push(nid);
      if (pending.length >= 40) break;  // cap per tick
    }
    if (pending.length >= 40) break;
  }
  if (pending.length === 0) return;
  await Promise.all(pending.map(async (nid) => {
    const wrapped = await fetchJson(API + "/node/" + nid);
    const n = wrapped?.node || wrapped;
    if (!n) { state.nodeToRoot[nid] = null; return; }
    // rootOwner is a userId (not a root nodeId), so don't use it. Walk via
    // the node's parent chain isn't cheap from here — instead, /node/:id
    // returns a "path" through the tree if the route supports it. As a
    // fallback treat any node whose id matches a known root as its own
    // root, and otherwise mark unknown.
    if (state.rootById[nid]) state.nodeToRoot[nid] = nid;
    else if (n.rootId) state.nodeToRoot[nid] = String(n.rootId);
    else state.nodeToRoot[nid] = null;
  }));
}

// ── windowing ──

function inWindow(sig) {
  if (!state.windowMs) return true;
  return Date.now() - sig.timestamp <= state.windowMs;
}
function filteredSignals() {
  let out = state.signals.filter(inWindow);
  if (state.statusFilter) out = out.filter(s => s.status === state.statusFilter);
  if (state.pairFilter) {
    const { src, tgt } = state.pairFilter;
    out = out.filter((s) => {
      const sr = rootOfNode(s.source) || "_unknown";
      const tr = s.target ? rootOfNode(s.target) || "_unknown" : sr;
      return sr === src && tr === tgt;
    });
  }
  return out;
}

// ── header stats ──

function renderStats() {
  const sigs = state.signals.filter(inWindow);
  const total = sigs.length;
  const byStatus = {};
  for (const s of sigs) byStatus[s.status] = (byStatus[s.status] || 0) + 1;
  const succ = byStatus.succeeded || 0;
  const successPct = total > 0 ? Math.round((succ / total) * 100) : 0;
  const lastMinute = sigs.filter(s => Date.now() - s.timestamp < 60000).length;
  const livePulse = lastMinute > 0;

  const chips = [
    '<span class="fd-chip fd-chip-live ' + (livePulse ? '' : 'idle') + '"><span class="dot"></span>' +
      (livePulse ? lastMinute + '/min' : 'idle') + '</span>',
    '<span class="fd-chip"><strong>' + total + '</strong> signals</span>',
    '<span class="fd-chip"><strong>' + successPct + '%</strong> success</span>',
    '<span class="fd-chip"><strong>' + state.roots.length + '</strong> tree' + (state.roots.length === 1 ? '' : 's') + '</span>',
  ];
  document.getElementById("fdStats").innerHTML = chips.join("");
}

// ── flow map ──

function rootOfNode(nodeId) { return state.nodeToRoot[nodeId] || null; }
function labelForRoot(rid) { return state.rootById[rid]?.name || (rid ? rid.slice(0, 8) : "unknown"); }

function renderMap() {
  const box = document.getElementById("fdMapBox");
  const countEl = document.getElementById("fdMapCount");
  const sigs = filteredSignals();

  // Build tree nodes + pairwise flow counts (aggregated by source tree → target tree).
  const treeHits = new Map();   // rootId -> { sent, received, last }
  const pairFlow = new Map();   // "src|tgt" -> { src, tgt, count, lastStatus, lastTs }

  for (const s of sigs) {
    const srcRoot = rootOfNode(s.source) || "_unknown";
    const tgtRoot = s.target ? rootOfNode(s.target) || "_unknown" : srcRoot;
    const srcEntry = treeHits.get(srcRoot) || { sent: 0, received: 0, last: 0 };
    srcEntry.sent++; srcEntry.last = Math.max(srcEntry.last, s.timestamp);
    treeHits.set(srcRoot, srcEntry);
    if (tgtRoot !== srcRoot || !s.target) {
      const tgtEntry = treeHits.get(tgtRoot) || { sent: 0, received: 0, last: 0 };
      tgtEntry.received++; tgtEntry.last = Math.max(tgtEntry.last, s.timestamp);
      treeHits.set(tgtRoot, tgtEntry);
    }
    const key = srcRoot + "|" + tgtRoot;
    const pair = pairFlow.get(key) || { src: srcRoot, tgt: tgtRoot, count: 0, lastStatus: s.status, lastTs: 0 };
    pair.count++;
    if (s.timestamp > pair.lastTs) { pair.lastTs = s.timestamp; pair.lastStatus = s.status; }
    pairFlow.set(key, pair);
  }

  countEl.textContent = treeHits.size + " tree" + (treeHits.size === 1 ? "" : "s") + " · " + pairFlow.size + " flow" + (pairFlow.size === 1 ? "" : "s");

  if (treeHits.size === 0) {
    box.innerHTML = '<div class="fd-map-empty">No signals in this window. Write a note on a cascade-enabled node to see signals land here.</div>';
    return;
  }

  // Layout: trees in a ring.
  const W = 1000, H = 540;
  const cx = W/2, cy = H/2;
  const trees = [...treeHits.keys()];
  const R = Math.min(W, H) * (trees.length === 1 ? 0 : 0.34);
  const treePos = new Map();
  trees.forEach((rid, i) => {
    const a = (i / trees.length) * 2 * Math.PI - Math.PI / 2;
    treePos.set(rid, { x: trees.length === 1 ? cx : cx + R * Math.cos(a), y: trees.length === 1 ? cy : cy + R * Math.sin(a) });
  });

  const TREE_W = 160, TREE_H = 52;

  // Max count for stroke scaling.
  const maxCount = Math.max(...[...pairFlow.values()].map(p => p.count), 1);
  const now = Date.now();

  // Edges (draw first so tree cards paint on top). Every edge is clickable
  // and carries data-src/data-tgt so the feed can filter to that pair.
  const edges = [];
  for (const pair of pairFlow.values()) {
    const sp = treePos.get(pair.src), tp = treePos.get(pair.tgt);
    if (!sp || !tp) continue;
    const stroke = STATUS_COLORS[pair.lastStatus] || STATUS_COLORS.unknown;
    const width = 1.5 + (pair.count / maxCount) * 5;
    const isLive = now - pair.lastTs < 60000;
    const liveCls = isLive ? " fd-edge-live" : "";
    const isActive = state.pairFilter && state.pairFilter.src === pair.src && state.pairFilter.tgt === pair.tgt;
    const activeCls = isActive ? " fd-active-pair" : "";
    const title = labelForRoot(pair.src) + " → " + labelForRoot(pair.tgt) + " · " + pair.count + " signal" + (pair.count === 1 ? "" : "s") + " · last " + timeAgo(pair.lastTs) + " · click to filter feed";
    const dataAttrs = ' data-src="' + esc(pair.src) + '" data-tgt="' + esc(pair.tgt) + '"';
    if (pair.src === pair.tgt) {
      // Self loop: a ~3/4 circle to the right of the card.
      const r = 22;
      const anchorX = sp.x + TREE_W / 2;
      const endX = sp.x + TREE_W / 2;
      edges.push('<path class="fd-edge fd-self-loop' + liveCls + activeCls + '"' + dataAttrs + ' d="M ' + anchorX.toFixed(1) + ' ' + (sp.y - 10).toFixed(1) + ' a ' + r + ' ' + r + ' 0 1 1 0 ' + (20) + '" fill="none" stroke="' + stroke + '" stroke-width="' + width.toFixed(1) + '" opacity="0.6"><title>' + esc(title) + '</title></path>');
    } else {
      // Curve between two cards.
      const dx = tp.x - sp.x, dy = tp.y - sp.y;
      const mx = (sp.x + tp.x) / 2 - dy * 0.12;
      const my = (sp.y + tp.y) / 2 + dx * 0.12;
      edges.push('<path class="fd-edge' + liveCls + activeCls + '"' + dataAttrs + ' d="M ' + sp.x.toFixed(1) + ' ' + sp.y.toFixed(1) + ' Q ' + mx.toFixed(1) + ' ' + my.toFixed(1) + ' ' + tp.x.toFixed(1) + ' ' + tp.y.toFixed(1) + '" fill="none" stroke="' + stroke + '" stroke-width="' + width.toFixed(1) + '" opacity="0.6"><title>' + esc(title) + '</title></path>');
    }
  }

  // Tree cards — darker fill + thicker stroke + brighter text with outline so
  // labels pop against both the card and the background glow behind it.
  const treeCards = trees.map(rid => {
    const p = treePos.get(rid);
    const hit = treeHits.get(rid);
    const color = state.treeColor[rid] || "#94a3b8";
    const name = labelForRoot(rid);
    const rx = p.x - TREE_W/2;
    const ry = p.y - TREE_H/2;
    const link = rid === "_unknown" ? null : withAuth("/api/v1/root/" + rid);
    const wrapperOpen = link ? '<a href="' + link + '">' : '<g>';
    const wrapperClose = link ? '</a>' : '</g>';
    return (
      '<g class="fd-tree-card">' + wrapperOpen +
        '<title>' + esc(name) + ' · ' + hit.sent + ' sent · ' + hit.received + ' received</title>' +
        '<rect x="' + rx.toFixed(1) + '" y="' + ry.toFixed(1) + '" width="' + TREE_W + '" height="' + TREE_H + '" rx="10" fill="#0f172a" stroke="' + color + '" stroke-width="2.5" />' +
        '<text x="' + p.x.toFixed(1) + '" y="' + (p.y - 4).toFixed(1) + '" text-anchor="middle" fill="#ffffff" font-size="14" font-weight="700" filter="url(#labelShadow)" style="pointer-events:none">' + esc(name) + '</text>' +
        '<text x="' + p.x.toFixed(1) + '" y="' + (p.y + 15).toFixed(1) + '" text-anchor="middle" fill="' + color + '" font-size="11" font-weight="600" filter="url(#labelShadow)" style="pointer-events:none">↑' + hit.sent + ' ↓' + hit.received + '</text>' +
      wrapperClose + '</g>'
    );
  }).join("");

  box.innerHTML =
    '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" preserveAspectRatio="xMidYMid meet">' +
      '<defs>' +
        '<filter id="labelShadow" x="-20%" y="-20%" width="140%" height="140%">' +
          '<feDropShadow dx="0" dy="0" stdDeviation="1.2" flood-color="#020617" flood-opacity="0.95"/>' +
        '</filter>' +
      '</defs>' +
      '<rect width="' + W + '" height="' + H + '" fill="#030712" />' +
      '<g class="edges">' + edges.join("") + '</g>' +
      '<g class="trees">' + treeCards + '</g>' +
    '</svg>' +
    '<div class="fd-legend">' +
      '<div class="fd-legend-title">Edge = latest status</div>' +
      '<div class="fd-legend-row"><span class="fd-legend-sw" style="background:#4ade80"></span>succeeded</div>' +
      '<div class="fd-legend-row"><span class="fd-legend-sw" style="background:#f87171"></span>failed</div>' +
      '<div class="fd-legend-row"><span class="fd-legend-sw" style="background:#60a5fa"></span>queued</div>' +
      '<div class="fd-legend-row"><span class="fd-legend-sw" style="background:#a78bfa"></span>awaiting</div>' +
      '<div class="fd-legend-row"><span class="fd-legend-sw" style="background:#fcd34d"></span>partial</div>' +
      '<div class="fd-legend-row" style="margin-top:4px;color:#94a3b8">thickness = volume</div>' +
    '</div>';
}

// ── feed ──

function renderFilter() {
  const counts = {};
  for (const s of state.signals.filter(inWindow)) counts[s.status] = (counts[s.status] || 0) + 1;
  const total = Object.values(counts).reduce((a,b)=>a+b, 0);
  const chips = ['<button class="fd-fchip' + (state.statusFilter == null ? " active" : "") + '" data-status="">All ' + total + '</button>'];
  for (const st of STATUS_ORDER) {
    const n = counts[st] || 0;
    if (n === 0) continue;
    const active = state.statusFilter === st ? " active" : "";
    chips.push('<button class="fd-fchip' + active + '" data-status="' + st + '" style="border-color:' + STATUS_COLORS[st] + '66;color:' + STATUS_COLORS[st] + '">' + st + ' ' + n + '</button>');
  }
  // Pair filter chip (from edge click). Visible only while set.
  if (state.pairFilter) {
    const srcName = labelForRoot(state.pairFilter.src);
    const tgtName = labelForRoot(state.pairFilter.tgt);
    chips.push('<button class="fd-clear-pair show" id="fdClearPair">✕ ' + esc(srcName) + ' → ' + esc(tgtName) + '</button>');
  }
  document.getElementById("fdFilter").innerHTML = chips.join("");
}

function renderFeed() {
  const feed = document.getElementById("fdFeed");
  const countEl = document.getElementById("fdFeedCount");
  const sigs = filteredSignals().slice(0, 80);
  countEl.textContent = sigs.length + " shown";

  if (sigs.length === 0) {
    feed.innerHTML = '<div class="fd-empty">No signals match this filter.</div>';
    return;
  }

  const rows = sigs.map(s => {
    const color = STATUS_COLORS[s.status] || STATUS_COLORS.unknown;
    const srcRoot = rootOfNode(s.source);
    const tgtRoot = s.target ? rootOfNode(s.target) : null;
    const srcName = srcRoot ? labelForRoot(srcRoot) : (s.source ? s.source.slice(0,8) : "—");
    const tgtName = s.target ? (tgtRoot ? labelForRoot(tgtRoot) : s.target.slice(0,8)) : null;

    const srcLink = s.source ? withAuth("/api/v1/node/" + s.source + "/chats") : null;
    const tgtLink = s.target ? withAuth("/api/v1/node/" + s.target + "/chats") : null;
    const signalDetailLink = withAuth("/api/v1/flow/signal/" + s.signalId);

    const srcHtml = srcLink ? link(srcLink, srcName) : esc(srcName);
    const arrow = tgtName ? '<span class="fd-sig-arrow">→</span>' : '';
    const tgtHtml = tgtName ? (tgtLink ? link(tgtLink, tgtName) : esc(tgtName)) : '';

    const extHtml = s.extName ? '<span class="ext">' + esc(s.extName) + '</span>' : '';
    const depthHtml = s.depth != null ? 'hop ' + s.depth : '';
    const sigLinkHtml = link(signalDetailLink, s.signalId.slice(0,8), 'signal-id');
    const summaryHtml = s.summary ? esc(String(s.summary).slice(0, 80)) : '';

    return (
      '<div class="fd-sig">' +
        '<span class="fd-sig-dot" style="background:' + color + '"></span>' +
        '<div class="fd-sig-body">' +
          '<div class="fd-sig-flow">' + srcHtml + arrow + tgtHtml + '</div>' +
          '<div class="fd-sig-meta">' +
            sigLinkHtml +
            (extHtml ? ' · ' + extHtml : '') +
            (depthHtml ? ' · ' + depthHtml : '') +
            (summaryHtml ? ' · ' + summaryHtml : '') +
          '</div>' +
        '</div>' +
        '<span class="fd-sig-status" style="background:' + color + '22;color:' + color + '">' + esc(s.status) + '</span>' +
        '<span class="fd-sig-time">' + timeAgo(s.timestamp) + ' ago</span>' +
      '</div>'
    );
  });

  feed.innerHTML = rows.join("");
}

// ── breakdowns ──

function renderBreakdowns() {
  const sigs = state.signals.filter(inWindow);

  // By status
  const byStatus = {};
  for (const s of sigs) byStatus[s.status] = (byStatus[s.status] || 0) + 1;
  const statusHtml = STATUS_ORDER
    .filter(st => byStatus[st])
    .map(st => (
      '<div class="fd-status-cell" style="border-color:' + STATUS_COLORS[st] + '33">' +
        '<div class="v" style="color:' + STATUS_COLORS[st] + '">' + byStatus[st] + '</div>' +
        '<div class="l">' + st + '</div>' +
      '</div>'
    )).join("") || '<div class="fd-empty" style="grid-column:span 2">No data</div>';
  document.getElementById("fdByStatus").innerHTML = statusHtml;

  // By extension
  const byExt = {};
  for (const s of sigs) { const k = s.extName || "kernel"; byExt[k] = (byExt[k] || 0) + 1; }
  const extTotal = Object.values(byExt).reduce((a,b)=>a+b, 0) || 1;
  const extRows = Object.entries(byExt).sort((a,b)=>b[1]-a[1]).slice(0, 8).map(([k,n]) => {
    const pct = Math.round((n / extTotal) * 100);
    return (
      '<div class="fd-bar">' +
        '<span class="fd-bar-swatch" style="background:#5eead4"></span>' +
        '<span class="fd-bar-label">' + esc(k) + '</span>' +
        '<span class="fd-bar-count">' + n + '</span>' +
      '</div>' +
      '<div class="fd-bar-bar"><div class="fd-bar-fill" style="background:#5eead4;width:' + pct + '%"></div></div>'
    );
  });
  document.getElementById("fdByExt").innerHTML = extRows.length ? extRows.join("") : '<div class="fd-empty">No data</div>';

  // By tree
  const byTree = {};
  for (const s of sigs) {
    const rid = rootOfNode(s.source) || "_unknown";
    byTree[rid] = (byTree[rid] || 0) + 1;
  }
  const treeTotal = Object.values(byTree).reduce((a,b)=>a+b, 0) || 1;
  const treeRows = Object.entries(byTree).sort((a,b)=>b[1]-a[1]).slice(0, 8).map(([rid,n]) => {
    const pct = Math.round((n / treeTotal) * 100);
    const name = labelForRoot(rid);
    const color = state.treeColor[rid] || "#94a3b8";
    const labelHtml = rid === "_unknown" ? esc(name) : link(withAuth("/api/v1/root/" + rid), name);
    return (
      '<div class="fd-bar">' +
        '<span class="fd-bar-swatch" style="background:' + color + '"></span>' +
        '<span class="fd-bar-label">' + labelHtml + '</span>' +
        '<span class="fd-bar-count">' + n + '</span>' +
      '</div>' +
      '<div class="fd-bar-bar"><div class="fd-bar-fill" style="background:' + color + ';width:' + pct + '%"></div></div>'
    );
  });
  document.getElementById("fdByTree").innerHTML = treeRows.length ? treeRows.join("") : '<div class="fd-empty">No data</div>';

  // Storage stats
  if (state.stats) {
    const s = state.stats;
    const htmlParts = [];
    htmlParts.push('<div class="fd-bar"><span class="fd-bar-label">Partitions</span><span class="fd-bar-count">' + (s.partitionCount || 0) + '</span></div>');
    htmlParts.push('<div class="fd-bar"><span class="fd-bar-label">Today</span><span class="fd-bar-count">' + (s.todaySignals || 0) + ' / ' + (s.todayCap || 0) + '</span></div>');
    htmlParts.push('<div class="fd-bar"><span class="fd-bar-label">Retention</span><span class="fd-bar-count">' + (s.resultTTLDays || 0) + ' days</span></div>');
    if (s.oldestPartition) htmlParts.push('<div class="fd-bar"><span class="fd-bar-label">Oldest partition</span><span class="fd-bar-count">' + esc(s.oldestPartition) + '</span></div>');
    document.getElementById("fdStats2").innerHTML = htmlParts.join("");
  } else {
    document.getElementById("fdStats2").innerHTML = '<div class="fd-empty">No data</div>';
  }

  // Peers
  if (state.peers?.length) {
    document.getElementById("fdPeerCard").style.display = "";
    const peerRows = state.peers.slice(0, 10).map(p => {
      const st = p.status || "unknown";
      const color = st === "active" || st === "healthy" ? "#4ade80" : st === "degraded" ? "#fbbf24" : "#64748b";
      const name = p.name || p.landUrl || idOf(p).slice(0,12);
      return (
        '<div class="fd-bar">' +
          '<span class="fd-bar-swatch" style="background:' + color + '"></span>' +
          '<span class="fd-bar-label">' + esc(name) + '</span>' +
          '<span class="fd-bar-count" style="color:' + color + ';font-size:0.72rem">' + esc(st) + '</span>' +
        '</div>'
      );
    });
    document.getElementById("fdPeers").innerHTML = peerRows.join("");
  }
}

// ── render + events ──

function renderAll() {
  renderStats();
  renderMap();
  renderFilter();
  renderFeed();
  renderBreakdowns();
}

document.addEventListener("click", (e) => {
  const winBtn = e.target.closest(".fd-winbtn");
  if (winBtn) {
    document.querySelectorAll(".fd-winbtn").forEach(b => b.classList.remove("fd-active"));
    winBtn.classList.add("fd-active");
    state.windowMs = parseInt(winBtn.dataset.win, 10) || 0;
    renderAll();
    return;
  }
  // Edge click: filter feed to this pair, scroll into view, re-render map
  // so the clicked edge highlights with a glow.
  const edge = e.target.closest(".fd-edge");
  if (edge) {
    e.preventDefault();
    const src = edge.dataset.src, tgt = edge.dataset.tgt;
    if (src && tgt) {
      if (state.pairFilter && state.pairFilter.src === src && state.pairFilter.tgt === tgt) {
        state.pairFilter = null;
      } else {
        state.pairFilter = { src, tgt };
      }
      renderMap();
      renderFilter();
      renderFeed();
      document.getElementById("fdFeed")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    return;
  }
  // Clear pair filter chip
  if (e.target.closest("#fdClearPair")) {
    state.pairFilter = null;
    renderMap();
    renderFilter();
    renderFeed();
    return;
  }
  const fchip = e.target.closest(".fd-fchip");
  if (fchip) {
    state.statusFilter = fchip.dataset.status || null;
    renderFilter();
    renderFeed();
  }
});

async function tick() {
  try { await loadAll(); renderAll(); } catch (err) { console.error("[flow] tick failed", err); }
}

tick();
setInterval(tick, POLL);
`;
