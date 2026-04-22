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
      modeHint: s.modeHint || null,
    });
  }

  // Consistent color per author label. Palette matches the map page so the
  // same agent lands on the same color across every view.
  const AUTHOR_PALETTE = [
    "#7dd3fc", "#fca5a5", "#a7f3d0", "#fde68a", "#c4b5fd",
    "#fdba74", "#f9a8d4", "#86efac", "#93c5fd", "#fcd34d",
  ];
  const colorCache = new Map();
  let colorIdx = 0;
  const colorFor = (key) => {
    if (!key) return "#94a3b8";
    if (!colorCache.has(key)) colorCache.set(key, AUTHOR_PALETTE[colorIdx++ % AUTHOR_PALETTE.length]);
    return colorCache.get(key);
  };
  const initialsOf = (s) => {
    if (!s) return "?";
    const parts = String(s).trim().split(/\s+|-|_/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  };

  const messages = transcript.map((t) => {
    const label = t.authorLabel || (t.wasAi ? "agent" : "user");
    const color = colorFor(label);
    const info = t.authorSubId ? subInfo.get(t.authorSubId) : null;
    const roleGlyph = t.wasAi ? "🤖" : (info?.type === "observer" ? "👁" : "👤");
    const roleClass = t.wasAi ? "msg-agent" : (info?.type === "observer" ? "msg-observer" : "msg-user");

    let nodeHref = null, rootHref = null;
    if (info?.rootId) {
      rootHref = req
        ? esc(buildLink(req, `/api/v1/root/${info.rootId}/chats`))
        : `/api/v1/root/${esc(info.rootId)}/chats?html=1`;
      nodeHref = info.nodeId
        ? (req
            ? esc(buildLink(req, `/api/v1/node/${info.nodeId}/chats`))
            : `/api/v1/node/${esc(info.nodeId)}/chats?html=1`)
        : rootHref;
    }

    const nameHtml = nodeHref
      ? `<a class="msg-name" style="color:${color}" href="${nodeHref}" title="View agent LLM chats">${esc(label)}</a>`
      : `<span class="msg-name" style="color:${color}">${esc(label)}</span>`;

    const treeChipHtml = info?.rootId
      ? `<a class="msg-tree" href="${rootHref}" title="Open tree">@${esc(info.rootName)}</a>`
      : "";

    const modeHintHtml = info?.modeHint
      ? `<span class="msg-mode">${esc(info.modeHint)}</span>`
      : "";

    return `
      <article class="msg ${roleClass}">
        <div class="msg-avatar" style="background:${color}22;color:${color};border-color:${color}66" aria-hidden="true">
          <span class="msg-avatar-glyph">${roleGlyph}</span>
          <span class="msg-avatar-init">${initialsOf(label)}</span>
        </div>
        <div class="msg-main">
          <div class="msg-head">
            ${nameHtml}
            ${treeChipHtml}
            ${modeHintHtml}
            <span class="msg-ts" title="${esc(t.at || "")}">${esc(timeAgo(t.at))}</span>
          </div>
          <div class="msg-body">${esc(t.content).replace(/\n/g, "<br>")}</div>
        </div>
      </article>`;
  }).join("");

  const subs = (room.subscriptions || []).map((s) => {
    const label = s.label || s.subId.slice(0, 8);
    const color = colorFor(label);
    const info = subInfo.get(s.subId) || {};
    const glyph = s.type === "agent" ? "🤖" : s.type === "user" ? "👤" : "👁";
    const typeLabel = s.type === "agent" ? "Agent" : s.type === "user" ? "User" : "Observer";

    const nameHref = info.rootId
      ? (req
          ? esc(buildLink(req, `/api/v1/root/${info.rootId}/chats`))
          : `/api/v1/root/${esc(info.rootId)}/chats?html=1`)
      : null;
    const nameHtml = nameHref
      ? `<a class="p-name" href="${nameHref}">${esc(label)}</a>`
      : `<span class="p-name">${esc(label)}</span>`;

    const treeLine = info.rootName
      ? `<div class="p-sub">@${esc(info.rootName)}${info.modeHint ? ` · <em>${esc(info.modeHint)}</em>` : ""}</div>`
      : (info.modeHint ? `<div class="p-sub"><em>${esc(info.modeHint)}</em></div>` : "");

    return `
      <li class="p-card" style="--p-color:${color}">
        <div class="p-avatar" aria-hidden="true" style="background:${color}22;border-color:${color}66;color:${color}">${glyph}</div>
        <div class="p-meta">
          ${nameHtml}
          <div class="p-type">${typeLabel}</div>
          ${treeLine}
        </div>
        <button class="p-remove" data-sub="${esc(s.subId)}" title="Remove participant">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </li>`;
  }).join("");

  const statusClass = room.status === "closed" ? "status-closed"
    : room.status === "paused" ? "status-paused"
    : "status-open";

  const pct = room.maxMessages > 0 ? Math.min(100, Math.round((room.postCount / room.maxMessages) * 100)) : 0;
  const progressColor = room.status === "closed" ? "#64748b" : room.status === "paused" ? "#fbbf24" : "#4ade80";

  const postFormHtml = room.status === "closed" ? `
      <div class="closed-banner">This room is closed. No new posts will be accepted.</div>` : `
      <form id="post-form" class="post-form">
        <textarea id="post-input" name="content" placeholder="Post a message. Emit [[ROOM-DONE]] to close the room." rows="1" required></textarea>
        <div class="form-row">
          <span class="form-hint">Enter posts · Shift+Enter for newline · fans out via cascade</span>
          <div class="form-actions">
            <button type="button" class="btn-ghost" id="close-room">Close room</button>
            <button type="submit" class="btn-primary">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
              Post
            </button>
          </div>
        </div>
      </form>`;

  const js = `
    (function(){
      const roomId = ${JSON.stringify(roomId)};
      const form = document.getElementById('post-form');
      const closeBtn = document.getElementById('close-room');
      const input = document.getElementById('post-input');

      // Auto-grow textarea.
      if (input) {
        const grow = () => {
          input.style.height = 'auto';
          input.style.height = Math.min(input.scrollHeight, 200) + 'px';
        };
        input.addEventListener('input', grow);
        // Enter submits, Shift+Enter inserts newline.
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            form?.requestSubmit();
          }
        });
      }

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
          const submitBtn = form.querySelector('button[type=submit]');
          submitBtn.disabled = true;
          submitBtn.classList.add('is-loading');
          await post('/api/v1/rooms/' + encodeURIComponent(roomId) + '/post', { content });
          form.content.value = '';
          if (input) input.style.height = 'auto';
          setTimeout(() => location.reload(), 400);
        });
      }
      if (closeBtn) {
        closeBtn.addEventListener('click', async () => {
          if (!confirm('Close this room? No more posts will be accepted.')) return;
          await post('/api/v1/rooms/' + encodeURIComponent(roomId) + '/close');
          location.reload();
        });
      }
      // Participant remove — small confirm + delete.
      document.querySelectorAll('.p-remove').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const subId = btn.getAttribute('data-sub');
          if (!confirm('Remove this participant?')) return;
          btn.disabled = true;
          const res = await fetch('/api/v1/rooms/' + encodeURIComponent(roomId) + '/participants/' + encodeURIComponent(subId), {
            method: 'DELETE', credentials: 'include',
          });
          if (res.ok) location.reload();
          else { btn.disabled = false; alert('Remove failed: ' + res.status); }
        });
      });

      // Scroll transcript to bottom on load so newest is visible.
      const transcript = document.querySelector('.transcript');
      if (transcript) transcript.scrollTop = transcript.scrollHeight;
    })();
  `;

  const listLink = req ? esc(buildLink(req, `/rooms`)) : `/rooms`;
  const mapLink = req ? esc(buildLink(req, `/rooms/map`)) : `/rooms/map`;

  return page({
    title: `${room.name} · Rooms`,
    body: `
      <div class="wrap">
        <div class="room-header">
          <div class="room-header-top">
            <div class="room-title">
              <h1>${esc(room.name)}</h1>
              <span class="status-pill ${statusClass}">${esc(room.status)}</span>
            </div>
            <div class="nav-links">
              <a href="${listLink}">← rooms</a>
              <a href="${mapLink}">map</a>
            </div>
          </div>
          <div class="room-progress">
            <div class="room-progress-bar"><div class="room-progress-fill" style="width:${pct}%;background:${progressColor}"></div></div>
            <div class="room-progress-stats">
              <span><strong>${room.postCount}</strong>/${room.maxMessages} posts</span>
              <span>·</span>
              <span>${room.participants.agents} 🤖 · ${room.participants.users} 👤 · ${room.participants.observers} 👁</span>
              <span>·</span>
              <span>last ${esc(timeAgo(room.lastPostAt))}</span>
            </div>
          </div>
        </div>
        <div class="two-col">
          <div class="transcript-col">
            <div class="transcript">${messages || '<p class="empty">No posts yet. Be the first to post.</p>'}</div>
            ${postFormHtml}
          </div>
          <aside class="sidebar">
            <h3>Participants <span class="sidebar-count">${(room.subscriptions || []).length}</span></h3>
            <ul class="participants-grid">${subs || '<li class="empty">No participants.</li>'}</ul>
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

  // Distinct trees referenced by any agent participant.
  const treeIds = new Set();
  for (const r of rooms) {
    for (const s of r.subscriptions || []) {
      if (s.agentRootId) treeIds.add(s.agentRootId);
    }
  }

  const treeNames = new Map();
  if (nodeModel && treeIds.size > 0) {
    try {
      const treeNodes = await nodeModel.find({ _id: { $in: [...treeIds] } }).select("_id name").lean();
      for (const t of treeNodes) treeNames.set(String(t._id), t.name);
    } catch {}
  }

  const listLink = req ? esc(buildLink(req, "/rooms")) : "/rooms";

  if (rooms.length === 0) {
    return page({
      title: "Rooms Map · TreeOS",
      body: `
        <div class="wrap">
          <h1>Rooms Map</h1>
          <p class="empty">No rooms yet. Create one and participants will appear here.</p>
          <p><a href="${listLink}">← back to list</a></p>
        </div>`,
      css: PAGE_CSS,
    });
  }

  // Counts for header strip.
  const counts = { open: 0, paused: 0, closed: 0 };
  let agentSubs = 0, userSubs = 0, observerSubs = 0;
  for (const r of rooms) {
    if (counts[r.status] != null) counts[r.status]++;
    agentSubs += r.participants?.agents || 0;
    userSubs += r.participants?.users || 0;
    observerSubs += r.participants?.observers || 0;
  }

  // Tree-consistent palette: every tree gets the same accent color across
  // the page regardless of how many rooms it participates in.
  const TREE_PALETTE = [
    "#7dd3fc", "#fca5a5", "#a7f3d0", "#fde68a", "#c4b5fd",
    "#fdba74", "#f9a8d4", "#86efac", "#93c5fd", "#fcd34d",
  ];
  const trees = [...treeIds];
  const treeColor = new Map();
  trees.forEach((id, i) => treeColor.set(id, TREE_PALETTE[i % TREE_PALETTE.length]));

  // How many rooms each tree participates in.
  const treeRoomCount = new Map();
  for (const r of rooms) {
    const seen = new Set();
    for (const s of r.subscriptions || []) {
      if (!s.agentRootId || seen.has(s.agentRootId)) continue;
      seen.add(s.agentRootId);
      treeRoomCount.set(s.agentRootId, (treeRoomCount.get(s.agentRootId) || 0) + 1);
    }
  }

  // Layout: trees around outer ring, rooms at centroid of their participants
  // with an offset push to avoid rooms sharing the same centroid stacking.
  const W = 1200, H = 720;
  const cx = W / 2, cy = H / 2;
  const R = Math.min(W, H) * 0.36;
  const TREE_W = 150, TREE_H = 44;

  const treePos = new Map();
  trees.forEach((id, i) => {
    const a = (i / Math.max(1, trees.length)) * 2 * Math.PI - Math.PI / 2;
    treePos.set(id, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a), angle: a });
  });

  const roomPos = new Map();
  const centroidBuckets = new Map();
  rooms.forEach((r) => {
    const touched = (r.subscriptions || []).map((s) => s.agentRootId).filter(Boolean);
    let x = cx, y = cy;
    if (touched.length > 0) {
      let sx = 0, sy = 0, n = 0;
      for (const t of touched) {
        const p = treePos.get(t);
        if (p) { sx += p.x; sy += p.y; n++; }
      }
      if (n > 0) { x = sx / n; y = sy / n; }
    }
    // Bucket by rounded centroid so we can space coincident rooms.
    const bKey = `${Math.round(x / 40)}_${Math.round(y / 40)}`;
    const bucket = centroidBuckets.get(bKey) || [];
    bucket.push(r.id);
    centroidBuckets.set(bKey, bucket);
    const spreadIdx = bucket.length - 1;
    const spread = spreadIdx * 42;
    const spreadAngle = spreadIdx > 0 ? (spreadIdx * 2.4) : 0;
    roomPos.set(r.id, {
      x: x + spread * Math.cos(spreadAngle),
      y: y + spread * Math.sin(spreadAngle),
    });
  });

  const roomLink = (id) => req ? esc(buildLink(req, `/rooms/${id}`)) : `/rooms/${esc(id)}`;
  const treeLink = (id) => req
    ? esc(buildLink(req, `/api/v1/root/${id}/chats`))
    : `/api/v1/root/${esc(id)}/chats?html=1`;

  const STATUS_COLOR = { open: "#4ade80", paused: "#fbbf24", closed: "#64748b" };
  const nowMs = Date.now();
  const isLive = (r) => r.status === "open" && r.lastPostAt && (nowMs - new Date(r.lastPostAt).getTime() < 60_000);

  // Edges: one line per (room, participating tree). Width scales with how
  // many distinct participants from that tree are in the room.
  const edges = [];
  for (const r of rooms) {
    const rp = roomPos.get(r.id);
    const subsByTree = new Map();
    for (const s of r.subscriptions || []) {
      if (!s.agentRootId) continue;
      const arr = subsByTree.get(s.agentRootId) || [];
      arr.push(s);
      subsByTree.set(s.agentRootId, arr);
    }
    for (const [treeId, subs] of subsByTree) {
      const tp = treePos.get(treeId);
      if (!tp) continue;
      // Slight curve so parallel lines don't stack on top of each other.
      const dx = tp.x - rp.x, dy = tp.y - rp.y;
      const mx = (tp.x + rp.x) / 2 - dy * 0.05;
      const my = (tp.y + rp.y) / 2 + dx * 0.05;
      const stroke = STATUS_COLOR[r.status] || "#64748b";
      const width = Math.min(4, 1.2 + subs.length * 0.6);
      const opacity = r.status === "closed" ? 0.2 : 0.55;
      const anyObserver = subs.every((s) => s.type === "observer");
      const dash = anyObserver ? 'stroke-dasharray="4 4"' : '';
      const liveClass = isLive(r) ? "edge-live" : "";
      edges.push(`<path class="${liveClass}" d="M ${rp.x.toFixed(1)} ${rp.y.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${tp.x.toFixed(1)} ${tp.y.toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="${width}" opacity="${opacity}" ${dash} />`);
    }
  }

  // Tree cards.
  const treeCards = trees.map((id) => {
    const p = treePos.get(id);
    const name = treeNames.get(id) || id.slice(0, 8);
    const color = treeColor.get(id);
    const rooms_ = treeRoomCount.get(id) || 0;
    const rx = p.x - TREE_W / 2;
    const ry = p.y - TREE_H / 2;
    return `
      <g class="tree-card">
        <a href="${treeLink(id)}">
          <title>${esc(name)} — in ${rooms_} room${rooms_ === 1 ? "" : "s"}</title>
          <rect x="${rx.toFixed(1)}" y="${ry.toFixed(1)}" width="${TREE_W}" height="${TREE_H}" rx="10" fill="#0f172a" stroke="${color}" stroke-width="2.5" />
          <text x="${p.x.toFixed(1)}" y="${(p.y - 4).toFixed(1)}" text-anchor="middle" fill="#ffffff" font-size="14" font-weight="700" filter="url(#map-label-shadow)" style="pointer-events:none">${esc(name)}</text>
          <text x="${p.x.toFixed(1)}" y="${(p.y + 15).toFixed(1)}" text-anchor="middle" fill="${color}" font-size="11" font-weight="600" filter="url(#map-label-shadow)" style="pointer-events:none">in ${rooms_} room${rooms_ === 1 ? "" : "s"}</text>
        </a>
      </g>`;
  }).join("");

  // Room hubs with donut progress ring.
  const roomHubs = rooms.map((r) => {
    const p = roomPos.get(r.id);
    const color = STATUS_COLOR[r.status] || "#64748b";
    const pct = r.maxMessages > 0 ? Math.min(1, r.postCount / r.maxMessages) : 0;
    const ringR = 22;
    const circumference = 2 * Math.PI * ringR;
    const filled = (circumference * pct).toFixed(1);
    const empty = (circumference - circumference * pct).toFixed(1);
    const live = isLive(r);
    const liveCls = live ? "room-live" : "";
    const agents = r.participants?.agents || 0;
    const users = r.participants?.users || 0;
    const obs = r.participants?.observers || 0;
    const tip = `${r.name}\n${r.status} · ${r.postCount}/${r.maxMessages} posts\n${agents} agents · ${users} users · ${obs} observers\nlast: ${timeAgo(r.lastPostAt)}`;
    return `
      <g class="room-hub ${liveCls}">
        <a href="${roomLink(r.id)}">
          <title>${esc(tip)}</title>
          <text x="${p.x.toFixed(1)}" y="${(p.y - 34).toFixed(1)}" text-anchor="middle" fill="#f1f5f9" font-size="12" font-weight="600" style="pointer-events:none">${esc(r.name)}</text>
          <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${ringR}" fill="none" stroke="#1e293b" stroke-width="5" />
          <circle class="progress-ring" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${ringR}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"
            stroke-dasharray="${filled} ${empty}" transform="rotate(-90 ${p.x.toFixed(1)} ${p.y.toFixed(1)})" />
          <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${ringR - 7}" fill="${color}" opacity="0.15" />
          <text x="${p.x.toFixed(1)}" y="${(p.y + 1).toFixed(1)}" text-anchor="middle" fill="#f1f5f9" font-size="11" font-weight="700" style="pointer-events:none">${r.postCount}</text>
          <text x="${p.x.toFixed(1)}" y="${(p.y + 13).toFixed(1)}" text-anchor="middle" fill="#94a3b8" font-size="8" style="pointer-events:none">/${r.maxMessages}</text>
          <text x="${p.x.toFixed(1)}" y="${(p.y + 38).toFixed(1)}" text-anchor="middle" fill="#94a3b8" font-size="10" style="pointer-events:none">${agents ? "🤖" + agents : ""}${users ? " 👤" + users : ""}${obs ? " 👁" + obs : ""}</text>
        </a>
      </g>`;
  }).join("");

  const summary = `
    <div class="map-summary">
      <span class="stat-chip stat-open"><span class="dot"></span>${counts.open} open</span>
      <span class="stat-chip stat-paused"><span class="dot"></span>${counts.paused} paused</span>
      <span class="stat-chip stat-closed"><span class="dot"></span>${counts.closed} closed</span>
      <span class="stat-sep"></span>
      <span class="stat-chip stat-plain">${trees.length} tree${trees.length === 1 ? "" : "s"}</span>
      <span class="stat-chip stat-plain">🤖 ${agentSubs}</span>
      <span class="stat-chip stat-plain">👤 ${userSubs}</span>
      <span class="stat-chip stat-plain">👁 ${observerSubs}</span>
    </div>`;

  const legend = `
    <div class="map-legend">
      <div class="legend-title">Legend</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#4ade80"></span>open</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#fbbf24"></span>paused</div>
      <div class="legend-row"><span class="legend-swatch" style="background:#64748b"></span>closed</div>
      <div class="legend-row"><span class="legend-ring"></span>ring fills with posts</div>
      <div class="legend-row"><span class="legend-dash"></span>observer-only edge</div>
      <div class="legend-row"><span class="legend-pulse"></span>posted within 60s</div>
    </div>`;

  return page({
    title: "Rooms Map · TreeOS",
    body: `
      <div class="wrap">
        <div class="header-row">
          <h1>Rooms Map</h1>
          <div class="nav-links"><a href="${listLink}">← list view</a></div>
        </div>
        ${summary}
        <div class="map-box">
          <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet" aria-label="Rooms and participating trees">
            <defs>
              <radialGradient id="map-bg" cx="50%" cy="50%" r="65%">
                <stop offset="0%" stop-color="#111827" />
                <stop offset="100%" stop-color="#030712" />
              </radialGradient>
              <filter id="map-label-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="0" stdDeviation="1.2" flood-color="#020617" flood-opacity="0.95"/>
              </filter>
            </defs>
            <rect width="${W}" height="${H}" fill="url(#map-bg)" />
            <g class="edges">${edges.join("\n")}</g>
            <g class="trees">${treeCards}</g>
            <g class="rooms">${roomHubs}</g>
          </svg>
          ${legend}
        </div>
      </div>`,
    css: PAGE_CSS + MAP_CSS,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────────────────────────────────

const PAGE_CSS = `
  .wrap { max-width: 1280px; margin: 0 auto; padding: 24px 20px 40px; color: #e5e7eb; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .header-row { display: flex; align-items: center; gap: 16px; margin-bottom: 6px; }
  .header-row h1 { margin: 0; flex: 1; font-size: 1.5rem; letter-spacing: -0.02em; }
  .nav-links { display: flex; gap: 14px; font-size: 0.9rem; }
  .nav-links a { color: #5eead4; text-decoration: none; border-bottom: 1px solid transparent; transition: border-color 120ms; }
  .nav-links a:hover { border-color: #5eead4; }
  .empty { color: #64748b; font-style: italic; }
  code { background: #0f172a; padding: 1px 6px; border-radius: 4px; font-size: 0.88em; color: #cbd5e1; }

  .status-pill { padding: 3px 10px; border-radius: 999px; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
  .status-open { background: rgba(74,222,128,0.18); color: #4ade80; border: 1px solid rgba(74,222,128,0.4); }
  .status-paused { background: rgba(251,191,36,0.15); color: #fbbf24; border: 1px solid rgba(251,191,36,0.4); }
  .status-closed { background: rgba(100,116,139,0.2); color: #94a3b8; border: 1px solid rgba(100,116,139,0.4); }

  .room-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 14px; margin-top: 20px; }
  .room-card { background: linear-gradient(180deg, #1a2234 0%, #131a2a 100%); border-radius: 12px; padding: 18px; border: 1px solid rgba(148,163,184,0.1); transition: transform 120ms, border-color 120ms; }
  .room-card:hover { transform: translateY(-2px); border-color: rgba(94,234,212,0.4); }
  .room-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; }
  .room-head h2 { margin: 0; font-size: 1.05rem; font-weight: 600; letter-spacing: -0.01em; }
  .room-head h2 a { color: #f1f5f9; text-decoration: none; }
  .room-head h2 a:hover { color: #5eead4; }
  .room-meta { font-size: 0.82rem; color: #94a3b8; display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
  .participants { list-style: none; margin: 0; padding: 0; font-size: 0.88rem; }
  .participants li { padding: 4px 0; color: #cbd5e1; }
  .participants em { color: #a5b4fc; font-style: normal; font-size: 0.78rem; margin-left: 2px; }
  .actions { margin-top: 12px; font-size: 0.88rem; }
  .actions a { color: #5eead4; text-decoration: none; }
  .actions a:hover { text-decoration: underline; }
`;

const TRANSCRIPT_CSS = `
  /* ── Header ─────────────────────────────────────────────────────── */
  .room-header { margin-top: 6px; margin-bottom: 18px; padding: 18px 20px; background: linear-gradient(180deg, #1a2234 0%, #131a2a 100%); border: 1px solid rgba(148,163,184,0.12); border-radius: 14px; }
  .room-header-top { display: flex; align-items: center; gap: 16px; margin-bottom: 14px; flex-wrap: wrap; }
  .room-title { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
  .room-title h1 { margin: 0; font-size: 1.4rem; letter-spacing: -0.02em; font-weight: 600; color: #f1f5f9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .room-progress { display: flex; flex-direction: column; gap: 8px; }
  .room-progress-bar { height: 4px; background: rgba(148,163,184,0.15); border-radius: 999px; overflow: hidden; }
  .room-progress-fill { height: 100%; border-radius: 999px; transition: width 300ms ease; }
  .room-progress-stats { display: flex; flex-wrap: wrap; gap: 10px; font-size: 0.78rem; color: #94a3b8; align-items: center; }
  .room-progress-stats strong { color: #f1f5f9; font-weight: 600; }

  /* ── Two-column layout ──────────────────────────────────────────── */
  .two-col { display: grid; grid-template-columns: 1fr 280px; gap: 20px; }
  @media (max-width: 860px) { .two-col { grid-template-columns: 1fr; } }
  .transcript-col { display: flex; flex-direction: column; gap: 14px; min-width: 0; }

  /* ── Transcript ─────────────────────────────────────────────────── */
  .transcript { background: #131a2a; border: 1px solid rgba(148,163,184,0.1); border-radius: 14px; padding: 18px; min-height: 420px; max-height: 62vh; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; scrollbar-width: thin; scrollbar-color: rgba(148,163,184,0.3) transparent; }
  .transcript::-webkit-scrollbar { width: 8px; }
  .transcript::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.25); border-radius: 4px; }
  .transcript .empty { color: #64748b; font-style: italic; text-align: center; padding: 40px 0; }

  .msg { display: flex; gap: 12px; padding: 2px 0; animation: msgIn 220ms ease-out both; }
  @keyframes msgIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  .msg-avatar { flex-shrink: 0; width: 36px; height: 36px; border-radius: 50%; border: 1.5px solid; display: flex; align-items: center; justify-content: center; font-size: 1rem; font-weight: 600; position: relative; }
  .msg-avatar-glyph { font-size: 0.95rem; }
  .msg-avatar-init { display: none; font-size: 0.72rem; letter-spacing: 0.02em; }
  .msg-user .msg-avatar-glyph, .msg-observer .msg-avatar-glyph { display: none; }
  .msg-user .msg-avatar-init, .msg-observer .msg-avatar-init { display: inline; }
  .msg-main { flex: 1; min-width: 0; }
  .msg-head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; margin-bottom: 4px; font-size: 0.78rem; }
  .msg-name { font-weight: 600; font-size: 0.92rem; text-decoration: none; }
  a.msg-name:hover { text-decoration: underline; }
  .msg-tree { color: #94a3b8; text-decoration: none; font-size: 0.78rem; padding: 1px 8px; border-radius: 999px; background: rgba(148,163,184,0.08); border: 1px solid rgba(148,163,184,0.15); }
  .msg-tree:hover { color: #f1f5f9; background: rgba(148,163,184,0.15); }
  .msg-mode { color: #a5b4fc; font-size: 0.72rem; font-style: italic; }
  .msg-ts { margin-left: auto; color: #64748b; font-size: 0.75rem; }
  .msg-body { font-size: 0.94rem; line-height: 1.55; color: #e2e8f0; white-space: pre-wrap; word-wrap: break-word; padding: 10px 14px; background: rgba(30,41,59,0.5); border-radius: 10px; border: 1px solid rgba(148,163,184,0.08); }
  .msg-observer .msg-body { opacity: 0.7; font-style: italic; }
  .msg-agent .msg-body { background: rgba(15,23,42,0.7); }

  /* ── Post form ──────────────────────────────────────────────────── */
  .post-form { background: #131a2a; border: 1px solid rgba(148,163,184,0.12); border-radius: 14px; padding: 12px 14px; }
  .post-form textarea { width: 100%; background: transparent; color: #f1f5f9; border: none; outline: none; padding: 8px 2px; font-family: inherit; font-size: 0.95rem; line-height: 1.5; resize: none; box-sizing: border-box; min-height: 40px; max-height: 200px; }
  .post-form textarea::placeholder { color: #64748b; }
  .post-form .form-row { display: flex; gap: 10px; align-items: center; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(148,163,184,0.08); }
  .post-form .form-hint { color: #64748b; font-size: 0.74rem; flex: 1; min-width: 0; }
  .post-form .form-actions { display: flex; gap: 8px; align-items: center; }
  .post-form button { padding: 7px 14px; border-radius: 8px; border: 1px solid transparent; cursor: pointer; font-weight: 600; font-size: 0.86rem; display: inline-flex; align-items: center; gap: 6px; transition: background 120ms, color 120ms, border-color 120ms, transform 80ms; }
  .post-form .btn-primary { background: #10b981; color: #052e1f; border-color: #10b981; }
  .post-form .btn-primary:hover { background: #34d399; border-color: #34d399; }
  .post-form .btn-primary:active { transform: translateY(1px); }
  .post-form .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
  .post-form .btn-primary.is-loading svg { animation: spin 700ms linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .post-form .btn-ghost { background: transparent; color: #94a3b8; border-color: rgba(148,163,184,0.25); }
  .post-form .btn-ghost:hover { color: #fca5a5; border-color: rgba(239,68,68,0.5); }

  .closed-banner { padding: 16px; background: rgba(100,116,139,0.1); border: 1px dashed rgba(148,163,184,0.25); border-radius: 12px; color: #94a3b8; text-align: center; font-size: 0.9rem; }

  /* ── Sidebar participants ───────────────────────────────────────── */
  .sidebar { background: #131a2a; border: 1px solid rgba(148,163,184,0.12); border-radius: 14px; padding: 16px; align-self: start; position: sticky; top: 16px; }
  .sidebar h3 { margin: 0 0 12px; font-size: 0.78rem; font-weight: 600; color: #cbd5e1; letter-spacing: 0.08em; text-transform: uppercase; display: flex; align-items: center; gap: 8px; }
  .sidebar-count { background: rgba(148,163,184,0.15); color: #cbd5e1; padding: 1px 8px; border-radius: 999px; font-size: 0.7rem; letter-spacing: normal; text-transform: none; }
  .participants-grid { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .p-card { display: flex; gap: 10px; align-items: center; padding: 8px; border-radius: 10px; border: 1px solid transparent; transition: background 120ms, border-color 120ms; }
  .p-card:hover { background: rgba(30,41,59,0.5); border-color: rgba(148,163,184,0.12); }
  .p-avatar { flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; border: 1.5px solid; display: flex; align-items: center; justify-content: center; font-size: 0.82rem; }
  .p-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .p-name { font-size: 0.86rem; color: #f1f5f9; text-decoration: none; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  a.p-name:hover { color: var(--p-color); text-decoration: underline; }
  .p-type { font-size: 0.7rem; color: var(--p-color); letter-spacing: 0.04em; }
  .p-sub { font-size: 0.72rem; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .p-sub em { font-style: normal; color: #a5b4fc; }
  .p-remove { flex-shrink: 0; background: transparent; border: none; padding: 6px; border-radius: 6px; color: #64748b; cursor: pointer; opacity: 0; transition: opacity 120ms, color 120ms, background 120ms; display: flex; align-items: center; justify-content: center; }
  .p-card:hover .p-remove { opacity: 1; }
  .p-remove:hover { color: #fca5a5; background: rgba(239,68,68,0.1); }
  .p-remove:disabled { opacity: 0.4; cursor: not-allowed; }
`;

const MAP_CSS = `
  .map-summary { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 10px 2px 14px; font-size: 0.82rem; }
  .stat-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; font-weight: 500; border: 1px solid rgba(148,163,184,0.15); background: rgba(30,41,59,0.5); color: #cbd5e1; }
  .stat-chip .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .stat-chip.stat-open { border-color: rgba(74,222,128,0.35); color: #4ade80; }
  .stat-chip.stat-open .dot { background: #4ade80; }
  .stat-chip.stat-paused { border-color: rgba(251,191,36,0.35); color: #fbbf24; }
  .stat-chip.stat-paused .dot { background: #fbbf24; }
  .stat-chip.stat-closed { border-color: rgba(100,116,139,0.4); color: #94a3b8; }
  .stat-chip.stat-closed .dot { background: #94a3b8; }
  .stat-chip.stat-plain { color: #cbd5e1; }
  .stat-sep { width: 1px; height: 20px; background: rgba(148,163,184,0.2); margin: 0 4px; }

  .map-box { position: relative; margin-top: 6px; border-radius: 14px; overflow: hidden; border: 1px solid rgba(148,163,184,0.12); box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
  .map-box svg { display: block; width: 100%; height: auto; }

  .map-legend { position: absolute; top: 14px; right: 14px; background: rgba(15,23,42,0.85); backdrop-filter: blur(6px); border: 1px solid rgba(148,163,184,0.2); border-radius: 10px; padding: 10px 12px; font-size: 0.75rem; color: #cbd5e1; min-width: 160px; }
  .map-legend .legend-title { font-weight: 600; color: #f1f5f9; margin-bottom: 6px; font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; }
  .map-legend .legend-row { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
  .legend-swatch { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
  .legend-ring { width: 14px; height: 14px; border-radius: 50%; border: 3px solid #5eead4; border-right-color: transparent; border-bottom-color: transparent; display: inline-block; transform: rotate(-45deg); }
  .legend-dash { width: 18px; height: 2px; background-image: linear-gradient(to right, #94a3b8 50%, transparent 50%); background-size: 6px 2px; display: inline-block; }
  .legend-pulse { width: 10px; height: 10px; border-radius: 50%; background: #4ade80; display: inline-block; box-shadow: 0 0 0 4px rgba(74,222,128,0.2); animation: legendPulse 1.4s ease-in-out infinite; }

  .tree-card rect { transition: filter 160ms; }
  .tree-card:hover rect { filter: brightness(1.25); }
  .tree-card a { cursor: pointer; }
  .tree-card text { paint-order: stroke; stroke: rgba(2,6,23,0.85); stroke-width: 3px; stroke-linejoin: round; }

  .room-hub a { cursor: pointer; }
  .room-hub .progress-ring { transition: stroke-width 160ms; }
  .room-hub:hover .progress-ring { stroke-width: 7; }
  .room-hub:hover text { filter: brightness(1.2); }

  .room-hub.room-live .progress-ring { animation: ringPulse 1.6s ease-in-out infinite; }
  .edge-live { animation: edgeFlow 2.4s linear infinite; stroke-dasharray: 6 8; }

  @keyframes ringPulse {
    0%, 100% { filter: drop-shadow(0 0 0 rgba(74,222,128,0)); }
    50% { filter: drop-shadow(0 0 6px rgba(74,222,128,0.8)); }
  }
  @keyframes edgeFlow {
    to { stroke-dashoffset: -28; }
  }
  @keyframes legendPulse {
    0%, 100% { box-shadow: 0 0 0 4px rgba(74,222,128,0.2); }
    50% { box-shadow: 0 0 0 7px rgba(74,222,128,0); }
  }

  @media (max-width: 720px) {
    .map-legend { position: static; margin-top: 10px; width: auto; }
  }
`;
