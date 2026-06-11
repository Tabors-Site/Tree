// inbox-panel.js — your inbox (pending summons + responses).
//
// The inbox IS the summon queue. Each entry is a `pending` summon
// addressed to you. Responding is a normal SUMMON back at the
// summoner, carrying `inReplyTo: <correlation>` — the existing inbox
// fold closes the original row when the reply lands. No separate
// "respond" op; the substrate's summon machinery is what closes loops.
//
// Per-intent UIs render different action surfaces. Each surface
// ultimately:
//   1. (optionally) dispatches a side-effect DO (e.g. grant-role)
//   2. summons the original sender back with the response content +
//      inReplyTo set to the inbox row's correlation
//
//   intent: "role-request"  → approve / deny
//                             approve does TWO acts: do(grant-role) +
//                             summon(reply, {result:"approved"})
//                             deny does ONE act: summon(reply, {result:"denied"})
//
//   intent: "yes-no"        → yes / no
//                             both do ONE act: summon(reply,
//                             {result:"yes"|"no"})
//
//   intent: "(anything else)" → free-text reply / dismiss

import { flat } from "./host.js";

export async function renderInboxPanel(body, action, opByName, { refreshView } = {}) {
  body.innerHTML = "";
  injectStyles();

  const session = flat.state?.session || {};
  const viewerName = (session.username || session.name || "").trim();
  const isAnonymous = !viewerName || viewerName === "arrival";

  const header = section(body, "Your inbox");
  if (isAnonymous) {
    header.appendChild(noteRow("Sign in to see your inbox."));
    return;
  }

  const reality = flat.state?.discovery?.reality || "";

  // After any response succeeds, refetch and repaint.
  const refresh = () => renderInboxPanel(body, action, opByName, { refreshView });

  let result;
  try {
    result = await flat.state.client.see("my-inbox");
  } catch (err) {
    header.appendChild(errorRow(`failed to load inbox: ${err?.message || err}`));
    return;
  }
  const pending = Array.isArray(result?.pending) ? result.pending : [];
  if (pending.length === 0) {
    header.appendChild(noteRow("(no pending summons)"));
    return;
  }

  const countRow = document.createElement("div");
  countRow.className = "rp-note dim";
  countRow.textContent = `${pending.length} pending`;
  header.appendChild(countRow);

  for (const entry of pending) {
    renderEntry(header, entry, { reality, refresh });
  }
}

function renderEntry(parent, entry, { reality, refresh }) {
  const card = document.createElement("div");
  card.className = "inbox-card";

  const head = document.createElement("div");
  head.className = "inbox-head";
  const intentLabel = entry.intent
    ? `<strong>${escapeHtml(entry.intent)}</strong>`
    : "<span class=\"dim\">generic summon</span>";
  const from = entry.summonerName ? `@${escapeHtml(entry.summonerName)}` :
    (entry.summoner ? `(${escapeHtml(String(entry.summoner).slice(0, 8))})` : "(unknown)");
  head.innerHTML = `${intentLabel} <span class="dim">from ${from}</span>`;
  card.appendChild(head);

  const meta = document.createElement("div");
  meta.className = "inbox-meta dim";
  const when = entry.sentAt ? new Date(entry.sentAt).toLocaleString() : "(no date)";
  meta.textContent = `${when} · priority: ${entry.priority || "?"} · branch: ${entry.branch || "?"}`;
  card.appendChild(meta);

  renderContentBody(card, entry);
  renderResponseSurface(card, entry, { reality, refresh });

  parent.appendChild(card);
}

function renderContentBody(card, entry) {
  const c = entry.content || {};
  const block = document.createElement("div");
  block.className = "inbox-body";

  if (entry.intent === "role-request") {
    block.innerHTML =
      `wants <strong>${escapeHtml(c.role || "?")}</strong> ` +
      `at <span class="muted">${escapeHtml(String(c.anchorSpaceId || "?")).slice(0, 12)}…</span>` +
      (c.reason ? `<div class="dim">reason: ${escapeHtml(c.reason)}</div>` : "");
  } else if (typeof c === "string" && c.length) {
    block.textContent = c;
  } else if (c && typeof c.message === "string") {
    block.textContent = c.message;
  } else if (c && typeof c === "object") {
    block.innerHTML = `<pre class="dim inbox-json">${escapeHtml(JSON.stringify(c, null, 2))}</pre>`;
  }
  card.appendChild(block);
}

function renderResponseSurface(card, entry, { reality, refresh }) {
  const row = document.createElement("div");
  row.className = "inbox-actions";

  if (entry.intent === "role-request") {
    const approve = makeButton("approve", "btn-ok");
    const deny    = makeButton("deny",    "btn-warn");
    approve.addEventListener("click", () =>
      handleRoleRequestApprove(entry, { reality, refresh, btn: approve }));
    deny.addEventListener("click", () =>
      replyAndRefresh(entry, { result: "denied", intent: "role-request" }, { reality, refresh, btn: deny }));
    row.appendChild(approve);
    row.appendChild(deny);
    card.appendChild(row);
    return;
  }

  if (entry.intent === "yes-no") {
    const yes = makeButton("yes", "btn-ok");
    const no  = makeButton("no",  "btn-warn");
    yes.addEventListener("click", () =>
      replyAndRefresh(entry, { result: "yes", intent: "yes-no" }, { reality, refresh, btn: yes }));
    no.addEventListener("click", () =>
      replyAndRefresh(entry, { result: "no",  intent: "yes-no" }, { reality, refresh, btn: no }));
    row.appendChild(yes);
    row.appendChild(no);
    card.appendChild(row);
    return;
  }

  // Generic free-text reply.
  const input = document.createElement("input");
  input.type = "text";
  input.className = "inbox-reply";
  input.placeholder = "type a reply…";
  row.appendChild(input);
  const send = makeButton("reply", "btn-ok");
  send.addEventListener("click", () => {
    const msg = input.value.trim();
    if (!msg) return;
    replyAndRefresh(entry, { message: msg }, { reality, refresh, btn: send });
  });
  const dismiss = makeButton("dismiss", "btn-warn");
  dismiss.addEventListener("click", () =>
    replyAndRefresh(entry, { result: "dismissed" }, { reality, refresh, btn: dismiss }));
  row.appendChild(send);
  row.appendChild(dismiss);
  card.appendChild(row);
}

// ──────────────────────────────────────────────────────────────────
// Response orchestration
// ──────────────────────────────────────────────────────────────────

// Approve a role-request: TWO acts — grant-role on the asker, then a
// reply summon that closes the original inbox row. The grant lands on
// the asker's reel; the reply lands as a summon back at them.
async function handleRoleRequestApprove(entry, { reality, refresh, btn }) {
  btn.disabled = true;
  const c = entry.content || {};
  if (!c.role || !c.anchorSpaceId || !c.askerBeingId) {
    btn.textContent = "missing role/anchor/asker fields";
    return;
  }
  // Step 1: grant the role on the asker's reel. Resolve their stance:
  // prefer the askerName recorded in the request; fall back to the
  // public directory if we only have an id (mirrors the summoner
  // resolution path).
  let askerStance = null;
  if (c.askerName) {
    askerStance = `${reality}/@${c.askerName}`;
  } else if (c.askerBeingId) {
    try {
      const dir = await flat.state.client.see(`${reality}/.beings/${c.askerBeingId}`);
      const name = dir?.directoryEntry?.name || dir?.name || dir?.being?.name;
      if (name) askerStance = `${reality}/@${name}`;
    } catch (err) {
      console.warn("[inbox-panel] asker directory SEE failed:", err?.message || err);
    }
  }
  if (!askerStance) {
    btn.textContent = "asker not addressable";
    btn.disabled = false;
    return;
  }
  try {
    await flat.doOp(askerStance, "grant-role", {
      role:          c.role,
      anchorSpaceId: c.anchorSpaceId,
      anchorBeingId: null,
    });
  } catch (err) {
    btn.textContent = `grant failed: ${err?.message || err}`.slice(0, 80);
    btn.disabled = false;
    return;
  }
  // Step 2: reply summon — closes the inbox row via inReplyTo + the
  // fold handler.
  await replyAndRefresh(entry, { result: "approved", intent: "role-request" }, { reality, refresh, btn });
}

// Send a reply summon back at the original summoner. The reply
// carries the user's response content + inReplyTo pointing at the
// inbox row's correlation. The inboxProjectionFold's reply-sweep
// closes the row.
async function replyAndRefresh(entry, content, { reality, refresh, btn }) {
  if (btn) btn.disabled = true;
  const target = await resolveSummonerStance(entry, reality);
  if (!target) {
    if (btn) {
      btn.textContent = "no addressable summoner";
      btn.disabled = false;
    }
    return;
  }
  try {
    await flat.state.client.summon(target, {
      content,
      inReplyTo: entry.correlation,
    });
    refresh();
  } catch (err) {
    if (btn) {
      btn.textContent = `reply failed: ${err?.message || err}`.slice(0, 80);
      btn.disabled = false;
    }
  }
}

// Resolve a stance to address the summoner at, in priority order:
//   1. summonerName from the inbox row (server-side resolution)
//   2. public directory SEE on `<reality>/.beings/<id>` (no auth needed)
//   3. null (un-resolvable; caller surfaces a failure)
//
// The public directory path is the substrate's federation-foundation
// id→name lookup; it works even when the local projection slot hasn't
// folded yet (the bug pattern that motivated this fallback). See
// seed/ibp/verbs/see.js#publicDirectoryTargetFromPath.
async function resolveSummonerStance(entry, reality) {
  if (entry.summonerName) {
    return `${reality}/@${entry.summonerName}`;
  }
  if (!entry.summoner) return null;
  try {
    const dir = await flat.state.client.see(`${reality}/.beings/${entry.summoner}`);
    const name = dir?.directoryEntry?.name || dir?.name || dir?.being?.name;
    if (name) return `${reality}/@${name}`;
  } catch (err) {
    console.warn("[inbox-panel] summoner directory SEE failed:", err?.message || err);
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────
// Render primitives
// ──────────────────────────────────────────────────────────────────

function section(parent, title) {
  const sec = document.createElement("section");
  sec.className = "rp-section";
  const h = document.createElement("h3");
  h.className = "rp-title";
  h.textContent = title;
  sec.appendChild(h);
  parent.appendChild(sec);
  return sec;
}

function noteRow(text) {
  const d = document.createElement("div");
  d.className = "rp-note dim";
  d.textContent = text;
  return d;
}

function errorRow(text) {
  const d = document.createElement("div");
  d.className = "rp-note action-err";
  d.textContent = text;
  return d;
}

function makeButton(label, cls) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `${cls} btn-compact`;
  b.textContent = label;
  return b;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function injectStyles() {
  if (document.getElementById("inbox-panel-styles")) return;
  const s = document.createElement("style");
  s.id = "inbox-panel-styles";
  s.textContent = `
    .inbox-card { border-left: 3px solid #2a4a8c; padding: 6px 10px; margin: 6px 0; background: #1118; border-radius: 2px; }
    .inbox-head { font-size: 13px; }
    .inbox-meta { font-size: 11px; margin-top: 2px; }
    .inbox-body { font-size: 12px; margin: 6px 0; line-height: 1.4; }
    .inbox-body pre.inbox-json { max-height: 200px; overflow: auto; padding: 4px; background: #0a0a0a; border: 1px solid #222; font-size: 11px; }
    .inbox-actions { display: flex; gap: 6px; align-items: center; margin-top: 6px; flex-wrap: wrap; }
    .inbox-reply { flex: 1; min-width: 120px; background: #0c0c0c; color: #ccc; border: 1px solid #333; padding: 3px 6px; font-size: 12px; }
    .btn-ok   { background: #2a6e3a; color: #fff; border: 0; cursor: pointer; }
    .btn-warn { background: #6e2a2a; color: #fff; border: 0; cursor: pointer; }
  `;
  document.head.appendChild(s);
}
