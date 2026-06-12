// inbox-panel.js — your inbox (pending summons + responses).
//
// The inbox IS the summon queue. Each entry is a `pending` summon
// addressed to you. Responding is a normal SUMMON back at the
// summoner, carrying `inReplyTo: <correlation>` — the existing inbox
// fold closes the original row when the reply lands. No separate
// "respond" op; the substrate's summon machinery is what closes loops.
//
// Per seed/SUMMON.md, this panel is a DUMB RENDERER. It does not
// switch on intent. For each entry, the server-side `my-inbox` SEE op
// attaches an `entry.render` spec (built by the inbox renderer registry
// keyed by envelope intent). The panel renders the spec; the role —
// through its registered renderer — decided what the spec contains.
//
// Spec shape (see seed/present/intake/inboxRenderers.js for full doc):
//   {
//     shape:        "action-buttons" | "free-text",
//     body?:        { html?: string, text?: string },
//     buttons?:     [{ label, kind: "ok"|"warn"|"neutral",
//                      ops?: [{target, action, args}],
//                      reply?: {content},
//                      disabled?: string }],
//     placeholder?: string,
//     allowDismiss?: boolean,
//   }
//
// When `entry.render` is null (no renderer for the intent), the panel
// uses a default free-text reply + dismiss surface.

import { flat } from "./host.js";
import "../styles/inbox-panel.css";

export async function renderInboxPanel(body, action, opByName, { refreshView } = {}) {
  body.innerHTML = "";

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
  const block = document.createElement("div");
  block.className = "inbox-body";

  // Renderer-provided body override always wins.
  const bodySpec = entry.render?.body || null;
  if (bodySpec && typeof bodySpec.html === "string") {
    block.innerHTML = bodySpec.html;
    card.appendChild(block);
    return;
  }
  if (bodySpec && typeof bodySpec.text === "string") {
    block.textContent = bodySpec.text;
    card.appendChild(block);
    return;
  }

  // Default content rendering.
  const c = entry.content || {};
  if (typeof c === "string" && c.length) {
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
  const spec = entry.render;

  if (spec?.shape === "action-buttons" && Array.isArray(spec.buttons)) {
    for (const btnSpec of spec.buttons) {
      const btn = makeButtonFromSpec(btnSpec);
      if (!btnSpec.disabled) {
        btn.addEventListener("click", () =>
          executeButton(entry, btnSpec, { reality, refresh, btn }));
      }
      row.appendChild(btn);
    }
    card.appendChild(row);
    return;
  }

  // Default free-text surface (shape="free-text" or no spec at all).
  const placeholder = (spec && typeof spec.placeholder === "string")
    ? spec.placeholder
    : "type a reply…";
  const allowDismiss = !spec || spec.allowDismiss !== false;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "inbox-reply";
  input.placeholder = placeholder;
  row.appendChild(input);

  const send = makeButton("reply", "btn-ok");
  send.addEventListener("click", () => {
    const msg = input.value.trim();
    if (!msg) return;
    replyAndRefresh(entry, { message: msg }, { reality, refresh, btn: send });
  });
  row.appendChild(send);

  if (allowDismiss) {
    const dismiss = makeButton("dismiss", "btn-warn");
    dismiss.addEventListener("click", () =>
      replyAndRefresh(entry, { result: "dismissed" }, { reality, refresh, btn: dismiss }));
    row.appendChild(dismiss);
  }
  card.appendChild(row);
}

// ──────────────────────────────────────────────────────────────────
// Button execution
// ──────────────────────────────────────────────────────────────────

// Run a button spec end-to-end:
//   1. for each entry in ops: flat.doOp(target, action, args)
//   2. if reply: summon target=summoner with content + inReplyTo
//   3. refresh inbox view
async function executeButton(entry, btnSpec, { reality, refresh, btn }) {
  btn.disabled = true;
  const ops = Array.isArray(btnSpec.ops) ? btnSpec.ops : [];
  for (const op of ops) {
    if (!op || typeof op !== "object") continue;
    const { target, action, args } = op;
    if (!target || !action) continue;
    try {
      await flat.doOp(target, action, args || {});
    } catch (err) {
      btn.textContent = `${action} failed: ${err?.message || err}`.slice(0, 80);
      btn.disabled = false;
      return;
    }
  }
  if (btnSpec.reply) {
    await replyAndRefresh(entry, btnSpec.reply.content || {}, { reality, refresh, btn });
    return;
  }
  // No reply specified — just refresh.
  refresh();
}

// Send a reply summon back at the original summoner. The reply
// carries the response content + inReplyTo pointing at the inbox
// row's correlation. The closeInboxOnAnswer hook closes the row when
// the reply's Act seals.
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

function makeButtonFromSpec(btnSpec) {
  const kind = btnSpec.kind || "neutral";
  const cls = kind === "ok" ? "btn-ok" : kind === "warn" ? "btn-warn" : "btn-neutral";
  const b = makeButton(btnSpec.label || "?", cls);
  if (btnSpec.disabled) {
    b.disabled = true;
    b.title = btnSpec.disabled;
    b.classList.add("btn-disabled");
  }
  return b;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

