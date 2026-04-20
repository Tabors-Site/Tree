/**
 * Rooms visualization pages.
 *
 * Three views under /rooms:
 *   /rooms            list of rooms with participants + status
 *   /rooms/:id        transcript viewer for one room
 *   /rooms/map        graph view — trees as nodes, rooms as hyperedges
 *
 * Each page is server-rendered via html-rendering's `page` layout.
 * Data is read from core.js (listRooms, readRoomTranscript) plus Node
 * lookups for tree/node names.
 */

import { page } from "../../html-rendering/html/layout.js";
import { buildLink } from "../../html-rendering/htmlHelpers.js";
import { listRooms, readRoomTranscript } from "../core.js";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function timeAgo(iso) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  return d + "d ago";
}

// ─────────────────────────────────────────────────────────────────────────
// LIST: /rooms
// ─────────────────────────────────────────────────────────────────────────

export async function renderRoomsList({ req } = {}) {
  const rooms = await listRooms();
  const roomLink = (id) => req ? esc(buildLink(req, `/rooms/${id}`)) : `/rooms/${esc(id)}`;
  const mapLink = req ? esc(buildLink(req, `/rooms/map`)) : `/rooms/map`;
  if (!rooms || rooms.length === 0) {
    return page({
      title: "Rooms · TreeOS",
      body: `
        <div class="wrap">
          <h1>Rooms</h1>
          <p class="empty">No rooms yet. Use <code>room-create</code> to start one.</p>
          <p><a href="${mapLink}">Map view</a></p>
        </div>`,
      css: PAGE_CSS,
    });
  }

  const cards = rooms.map((r) => {
    const agents = r.participants.agents;
    const users = r.participants.users;
    const observers = r.participants.observers;
    const statusClass = r.status === "closed" ? "status-closed"
      : r.status === "paused" ? "status-paused"
      : "status-open";
    const subs = (r.subscriptions || []).map((s) => {
      const label = esc(s.label || s.subId.slice(0, 8));
      const badge = s.type === "agent" ? "🤖"
        : s.type === "user" ? "👤"
        : s.type === "observer" ? "👁"
        : "•";
      const hint = s.type === "agent" && s.modeHint ? ` <em>${esc(s.modeHint)}</em>` : "";
      return `<li>${badge} ${label}${hint}</li>`;
    }).join("");
    return `
      <div class="room-card">
        <div class="room-head">
          <h2><a href="${roomLink(r.id)}">${esc(r.name)}</a></h2>
          <span class="status-pill ${statusClass}">${esc(r.status)}</span>
        </div>
        <div class="room-meta">
          <span>${r.postCount}/${r.maxMessages} posts</span>
          <span>last ${esc(timeAgo(r.lastPostAt))}</span>
          <span>${agents} agent${agents === 1 ? "" : "s"} · ${users} user${users === 1 ? "" : "s"} · ${observers} observer${observers === 1 ? "" : "s"}</span>
        </div>
        <ul class="participants">${subs}</ul>
        <div class="actions">
          <a href="${roomLink(r.id)}">open transcript →</a>
        </div>
      </div>`;
  }).join("");

  return page({
    title: "Rooms · TreeOS",
    body: `
      <div class="wrap">
        <div class="header-row">
          <h1>Rooms</h1>
          <div class="nav-links"><a href="${mapLink}">Map view</a></div>
        </div>
        <div class="room-grid">${cards}</div>
      </div>`,
    css: PAGE_CSS,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// TRANSCRIPT: /rooms/:id
// ─────────────────────────────────────────────────────────────────────────

export async function renderRoomTranscript({ roomId, nodeModel, req }) {
  const rooms = await listRooms();
  const room = rooms.find((r) => r.id === roomId);
  if (!room) {
    return page({
      title: "Room not found",
      body: `<div class="wrap"><h1>Room not found</h1><p><a href="/rooms">← back to list</a></p></div>`,
      css: PAGE_CSS,
    });
  }
  const transcript = await readRoomTranscript({ roomNodeId: roomId, limit: 200 });

  // Resolve tree names for agent participants so hyperlinks show friendly text.
  const treeNames = new Map();
  if (nodeModel) {
    const agentRoots = [...new Set(
      (room.subscriptions || [])
        .map((s) => s.agentRootId)
        .filter(Boolean),
    )];
    if (agentRoots.length > 0) {
      try {
        const docs = await nodeModel.find({ _id: { $in: agentRoots } }).select("_id name").lean();
        for (const d of docs) treeNames.set(String(d._id), d.name);
      } catch {}
    }
  }
  const subInfo = new Map();
  for (const s of room.subscriptions || []) {
    subInfo.set(s.subId, {
      label: s.label || s.subId.slice(0, 8),
      type: s.type,
      rootId: s.agentRootId || null,
      nodeId: s.agentNodeId || null,
      rootName: s.agentRootId ? (treeNames.get(s.agentRootId) || s.agentRootId.slice(0, 8)) : null,
    });
  }

  // Color-code by author: consistent color per authorLabel.
  const colorFor = (() => {
    const cache = new Map();
    const palette = ["#4ecca3", "#667eea", "#ff9a3c", "#e06c75", "#c678dd", "#56b6c2", "#f7d560"];
    let i = 0;
    return (key) => {
      if (!key) return "#888";
      if (!cache.has(key)) { cache.set(key, palette[i++ % palette.length]); }
      return cache.get(key);
    };
  })();

  const messages = transcript.map((t) => {
    const label = t.authorLabel || (t.wasAi ? "agent" : "user");
    const color = colorFor(label);
    const info = t.authorSubId ? subInfo.get(t.authorSubId) : null;
    let authorHtml;
    if (info && info.rootId) {
      // Agent post — author label links to the agent's AI-chats page at
      // its specific node (that's where you see the actual LLM conversation
      // the agent had). Tree chip links to the tree root. buildLink
      // propagates auth context (?html, ?token) from the current request.
      const rootHref = req
        ? esc(buildLink(req, `/api/v1/root/${info.rootId}/chats`))
        : `/api/v1/root/${esc(info.rootId)}/chats?html=1`;
      const nodeHref = info.nodeId
        ? (req
            ? esc(buildLink(req, `/api/v1/node/${info.nodeId}/chats`))
            : `/api/v1/node/${esc(info.nodeId)}/chats?html=1`)
        : rootHref;
      authorHtml = `<a class="author-link" style="color:${color}" href="${nodeHref}" title="View ${esc(label)}'s LLM chats at this node">${esc(label)}</a> <span class="tree-chip">@<a href="${rootHref}">${esc(info.rootName)}</a></span>`;
      var roleHtml = `<a class="role" href="${nodeHref}">sub:${esc(t.authorSubId.slice(0, 8))}</a>`;
    } else {
      authorHtml = `<span class="author" style="color:${color}">${esc(label)}</span>`;
      var roleHtml = `<span class="role">${t.authorSubId ? "sub:" + esc(t.authorSubId.slice(0, 8)) : "user post"}</span>`;
    }
    return `
      <div class="msg">
        <div class="msg-head">
          ${authorHtml}
          ${roleHtml}
          <span class="ts">${esc(timeAgo(t.at))}</span>
        </div>
        <div class="msg-body">${esc(t.content).replace(/\n/g, "<br>")}</div>
      </div>`;
  }).join("");

  const subs = (room.subscriptions || []).map((s) => {
    const label = esc(s.label || s.subId.slice(0, 8));
    const badge = s.type === "agent" ? "🤖" : s.type === "user" ? "👤" : "👁";
    const hint = s.type === "agent" && s.modeHint ? ` <em>${esc(s.modeHint)}</em>` : "";
    const info = subInfo.get(s.subId);
    let labelHtml = label;
    if (info && info.rootId) {
      const chatsHref = req
        ? esc(buildLink(req, `/api/v1/root/${info.rootId}/chats`))
        : `/api/v1/root/${esc(info.rootId)}/chats?html=1`;
      labelHtml = `<a href="${chatsHref}" style="color:inherit">${label}</a> <small>@${esc(info.rootName || "")}</small>`;
    }
    const removeBtn = `<button class="leave-btn" data-sub="${esc(s.subId)}" title="Remove participant">×</button>`;
    return `<li>${badge} ${labelHtml}${hint} ${removeBtn}</li>`;
  }).join("");

  const statusClass = room.status === "closed" ? "status-closed"
    : room.status === "paused" ? "status-paused"
    : "status-open";

  const postFormHtml = room.status === "closed" ? "" : `
      <form id="post-form" class="post-form">
        <textarea name="content" placeholder="Post a message into this room. Emit [[ROOM-DONE]] to close it." rows="3" required></textarea>
        <div class="form-row">
          <button type="submit" class="primary">Post</button>
          <button type="button" class="close-btn" id="close-room">Close room</button>
          <span class="form-hint">Message fans out to all agent participants via cascade.</span>
        </div>
      </form>`;

  const js = `
    (function(){
      const roomId = ${JSON.stringify(roomId)};
      const form = document.getElementById('post-form');
      const closeBtn = document.getElementById('close-room');
      async function post(path, body) {
        const res = await fetch(path, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
        return res.json().catch(() => ({}));
      }
      if (form) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const content = form.content.value.trim();
          if (!content) return;
          form.querySelector('button[type=submit]').disabled = true;
          await post('/api/v1/rooms/' + encodeURIComponent(roomId) + '/post', { content });
          form.content.value = '';
          setTimeout(() => location.reload(), 500);
        });
      }
      if (closeBtn) {
        closeBtn.addEventListener('click', async () => {
          if (!confirm('Close this room? No more posts will be accepted.')) return;
          await post('/api/v1/rooms/' + encodeURIComponent(roomId) + '/close');
          location.reload();
        });
      }
      // Participant remove
      document.querySelectorAll('.leave-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const subId = btn.getAttribute('data-sub');
          if (!confirm('Remove this participant?')) return;
          const res = await fetch('/api/v1/rooms/' + encodeURIComponent(roomId) + '/participants/' + encodeURIComponent(subId), {
            method: 'DELETE', credentials: 'include',
          });
          if (res.ok) location.reload();
          else alert('Remove failed: ' + res.status);
        });
      });
    })();
  `;

  return page({
    title: `${room.name} · Rooms`,
    body: `
      <div class="wrap">
        <div class="header-row">
          <h1>${esc(room.name)}</h1>
          <span class="status-pill ${statusClass}">${esc(room.status)}</span>
          <div class="nav-links">
            <a href="${req ? esc(buildLink(req, `/rooms`)) : `/rooms`}">← rooms</a>
            <a href="${req ? esc(buildLink(req, `/rooms/map`)) : `/rooms/map`}">map</a>
          </div>
        </div>
        <div class="room-meta">
          ${room.postCount}/${room.maxMessages} posts · last ${esc(timeAgo(room.lastPostAt))}
        </div>
        <div class="two-col">
          <div>
            <div class="transcript">${messages || '<p class="empty">No posts yet.</p>'}</div>
            ${postFormHtml}
          </div>
          <aside class="sidebar">
            <h3>Participants</h3>
            <ul class="participants">${subs}</ul>
          </aside>
        </div>
      </div>`,
    css: PAGE_CSS + TRANSCRIPT_CSS,
    js,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// MAP: /rooms/map
// Trees as nodes, rooms as hyperedges (one central dot per room, spokes
// to each participant tree).
// ─────────────────────────────────────────────────────────────────────────

export async function renderRoomsMap({ nodeModel, req } = {}) {
  const rooms = await listRooms();

  // Collect distinct trees (rootIds) referenced by any agent participant.
  const treeIds = new Set();
  for (const r of rooms) {
    for (const s of r.subscriptions || []) {
      if (s.agentRootId) treeIds.add(s.agentRootId);
    }
  }

  // Resolve tree names if we have the Node model. If not, show ids.
  const treeNames = new Map();
  if (nodeModel && treeIds.size > 0) {
    try {
      const treeNodes = await nodeModel.find({ _id: { $in: [...treeIds] } }).select("_id name").lean();
      for (const t of treeNodes) treeNames.set(String(t._id), t.name);
    } catch {
      // Fall back to showing ids.
    }
  }

  if (rooms.length === 0) {
    const listLink = req ? esc(buildLink(req, "/rooms")) : "/rooms";
    return page({
      title: "Rooms Map · TreeOS",
      body: `
        <div class="wrap">
          <h1>Rooms Map</h1>
          <p class="empty">No rooms yet.</p>
          <p><a href="${listLink}">← back to list</a></p>
        </div>`,
      css: PAGE_CSS,
    });
  }

  // Compute a simple circular layout: place trees around a ring, place
  // room centers near their participants (or in the middle if multi-tree).
  const W = 1000;
  const H = 640;
  const cx = W / 2;
  const cy = H / 2;
  const R = 240;

  const trees = [...treeIds];
  const treePos = new Map();
  trees.forEach((id, i) => {
    const a = (i / Math.max(1, trees.length)) * 2 * Math.PI - Math.PI / 2;
    treePos.set(id, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  });

  const roomPos = new Map();
  rooms.forEach((r) => {
    const touched = (r.subscriptions || []).map((s) => s.agentRootId).filter(Boolean);
    if (touched.length === 0) {
      roomPos.set(r.id, { x: cx, y: cy });
    } else {
      let sx = 0, sy = 0, n = 0;
      for (const t of touched) {
        const p = treePos.get(t);
        if (p) { sx += p.x; sy += p.y; n++; }
      }
      roomPos.set(r.id, n > 0 ? { x: sx / n, y: sy / n } : { x: cx, y: cy });
    }
  });

  // SVG: edges first (so nodes draw on top), then room hubs, then tree nodes.
  const edges = [];
  for (const r of rooms) {
    const rp = roomPos.get(r.id);
    for (const s of r.subscriptions || []) {
      if (!s.agentRootId) continue;
      const tp = treePos.get(s.agentRootId);
      if (!tp) continue;
      const stroke = r.status === "closed" ? "#555" : r.status === "paused" ? "#a67" : "#4ecca3";
      edges.push(`<line x1="${rp.x.toFixed(1)}" y1="${rp.y.toFixed(1)}" x2="${tp.x.toFixed(1)}" y2="${tp.y.toFixed(1)}" stroke="${stroke}" stroke-width="1.5" opacity="0.55" />`);
    }
  }

  const roomLink = (id) => req ? esc(buildLink(req, `/rooms/${id}`)) : `/rooms/${esc(id)}`;
  const treeLink = (id) => req
    ? esc(buildLink(req, `/api/v1/root/${id}/chats`))
    : `/api/v1/root/${esc(id)}/chats?html=1`;

  const roomHubs = rooms.map((r) => {
    const p = roomPos.get(r.id);
    const fill = r.status === "closed" ? "#444" : r.status === "paused" ? "#b97" : "#4ecca3";
    return `
      <g>
        <a href="${roomLink(r.id)}">
          <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="10" fill="${fill}" stroke="#fff" stroke-width="1.5" />
          <text x="${p.x.toFixed(1)}" y="${(p.y - 16).toFixed(1)}" text-anchor="middle" fill="#fff" font-size="11" font-family="sans-serif">${esc(r.name)}</text>
          <text x="${p.x.toFixed(1)}" y="${(p.y + 24).toFixed(1)}" text-anchor="middle" fill="#aaa" font-size="9" font-family="sans-serif">${r.postCount} posts</text>
        </a>
      </g>`;
  }).join("");

  const treeNodes = trees.map((id) => {
    const p = treePos.get(id);
    const name = treeNames.get(id) || id.slice(0, 8);
    return `
      <g>
        <a href="${treeLink(id)}" title="View AI chats for ${esc(name)}">
          <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="16" fill="#16213e" stroke="#667eea" stroke-width="2" style="cursor:pointer" />
          <text x="${p.x.toFixed(1)}" y="${(p.y + 5).toFixed(1)}" text-anchor="middle" fill="#fff" font-size="11" font-family="sans-serif" font-weight="bold" style="pointer-events:none">${esc(name)}</text>
        </a>
      </g>`;
  }).join("");

  const listLink = req ? esc(buildLink(req, "/rooms")) : "/rooms";
  return page({
    title: "Rooms Map · TreeOS",
    body: `
      <div class="wrap">
        <div class="header-row">
          <h1>Rooms Map</h1>
          <div class="nav-links"><a href="${listLink}">← list view</a></div>
        </div>
        <div class="map-box">
          <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" style="background:#0f1220;border-radius:10px">
            ${edges.join("\n")}
            ${roomHubs}
            ${treeNodes}
          </svg>
        </div>
        <p class="empty">Circles: rooms · rounded nodes: trees · green edges: open · grey: closed</p>
      </div>`,
    css: PAGE_CSS + MAP_CSS,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────────────────────────────────

const PAGE_CSS = `
  .wrap { max-width: 1100px; margin: 0 auto; padding: 24px 16px; color: #eee; }
  .header-row { display: flex; align-items: center; gap: 16px; }
  .header-row h1 { margin: 0; flex: 1; }
  .nav-links { display: flex; gap: 12px; font-size: 0.95rem; }
  .nav-links a { color: #4ecca3; text-decoration: none; }
  .nav-links a:hover { text-decoration: underline; }
  .empty { color: #888; font-style: italic; }
  code { background: #222; padding: 1px 5px; border-radius: 3px; }
  .status-pill { padding: 2px 10px; border-radius: 999px; font-size: 0.8rem; font-weight: 600; }
  .status-open { background: #4ecca3; color: #003; }
  .status-paused { background: #ff9a3c; color: #331; }
  .status-closed { background: #666; color: #fff; }
  .room-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 16px; margin-top: 18px; }
  .room-card { background: #1a1a2e; border-radius: 10px; padding: 16px; border: 1px solid #2a2a4a; }
  .room-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
  .room-head h2 { margin: 0; font-size: 1.1rem; }
  .room-head h2 a { color: #fff; text-decoration: none; }
  .room-head h2 a:hover { color: #4ecca3; }
  .room-meta { font-size: 0.85rem; color: #aaa; display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
  .participants { list-style: none; margin: 0; padding: 0; font-size: 0.9rem; }
  .participants li { padding: 3px 0; color: #ddd; }
  .participants em { color: #667eea; font-style: normal; font-size: 0.8rem; }
  .actions { margin-top: 10px; font-size: 0.9rem; }
  .actions a { color: #4ecca3; text-decoration: none; }
`;

const TRANSCRIPT_CSS = `
  .two-col { display: grid; grid-template-columns: 1fr 260px; gap: 20px; margin-top: 18px; }
  @media (max-width: 780px) { .two-col { grid-template-columns: 1fr; } }
  .transcript { background: #1a1a2e; border-radius: 10px; padding: 16px; min-height: 400px; }
  .msg { border-left: 3px solid #2a2a4a; padding: 8px 12px; margin-bottom: 12px; background: #121220; border-radius: 4px; }
  .msg-head { font-size: 0.8rem; color: #888; margin-bottom: 4px; display: flex; gap: 10px; align-items: center; }
  .msg-head .author, .msg-head .author-link { font-weight: 600; text-decoration: none; }
  .msg-head .author-link:hover { text-decoration: underline; }
  .msg-head .tree-chip { color: #888; font-size: 0.78rem; }
  .msg-head .tree-chip a { color: #aaa; text-decoration: none; }
  .msg-head .tree-chip a:hover { color: #fff; text-decoration: underline; }
  .msg-head .role { color: #667eea; text-decoration: none; }
  .msg-head a.role:hover { text-decoration: underline; }
  .msg-head .ts { margin-left: auto; }
  .msg-body { font-size: 0.95rem; line-height: 1.5; color: #ddd; white-space: pre-wrap; word-wrap: break-word; }
  .sidebar { background: #1a1a2e; border-radius: 10px; padding: 14px; }
  .sidebar h3 { margin: 0 0 10px; font-size: 0.95rem; }
  .leave-btn { float: right; background: transparent; border: none; color: #888; cursor: pointer; font-size: 1.1rem; padding: 0 4px; }
  .leave-btn:hover { color: #e06c75; }
  .post-form { margin-top: 16px; background: #1a1a2e; border-radius: 10px; padding: 14px; }
  .post-form textarea { width: 100%; background: #0f1220; color: #eee; border: 1px solid #2a2a4a; border-radius: 6px; padding: 10px; font-family: inherit; font-size: 0.95rem; resize: vertical; box-sizing: border-box; }
  .post-form .form-row { display: flex; gap: 10px; align-items: center; margin-top: 10px; }
  .post-form button { padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; font-weight: 600; }
  .post-form button.primary { background: #4ecca3; color: #003; }
  .post-form button.primary:hover { background: #6bddb8; }
  .post-form button.primary:disabled { background: #555; cursor: not-allowed; }
  .post-form button.close-btn { background: transparent; color: #888; border: 1px solid #444; }
  .post-form button.close-btn:hover { color: #e06c75; border-color: #e06c75; }
  .post-form .form-hint { color: #888; font-size: 0.82rem; margin-left: auto; }
`;

const MAP_CSS = `
  .map-box { margin-top: 18px; border-radius: 10px; overflow: hidden; }
`;
