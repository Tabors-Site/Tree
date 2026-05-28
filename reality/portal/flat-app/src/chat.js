// chat.js — chat panel for a single summoned being.
//
// Opens when the user clicks "chat" next to a being row. Shows that
// being's inbox.recent as historical context, then live-appends:
//   - the user's outgoing SUMMONs
//   - the being's reply pushes (matched by inReplyTo correlation)
//   - sub-summons spawned downstream (rendered as nested items;
//     stoppable via a cancel SUMMON keyed on rootCorrelation)
//
// All wire traffic goes through main.js's flat.sendSummon helper, which
// drives PortalClient. Incoming pushes arrive in handleIncomingSummon
// (wired as the client's onSummon handler from main.js).

import { flat } from "./main.js";

const state = {
  open:    false,
  being:   null,             // being NAME (e.g. "alice")
  stance:  null,             // full stance address e.g. "<reality>/path@alice"
  messages: [],              // [{ id, who, content, kind, parent?, rootCorrelation?, ts }]
  byCorr:   new Map(),       // correlation → message id (for matching pushes)
  byMessage: new Map(),      // server messageId → our message entry
};

export function isChatOpen() { return state.open; }
export function getChatBeing() { return state.being; }

export function openChatFor(beingEntry, { refresh = false } = {}) {
  if (!beingEntry) return;
  const fl = flat.state;
  const reality = fl.discovery?.reality;
  if (!reality) return;

  const path = fl.descriptor?.address?.pathByNames || "/";
  const stance = `${reality}${path}@${beingEntry.being}`.replace(/\/+@/, "/@");

  // If we're already open on this being and just refreshing, only redraw
  // the inbox section (don't lose live messages).
  if (refresh && state.open && state.being === beingEntry.being) {
    redrawInbox(beingEntry);
    return;
  }

  state.open    = true;
  state.being   = beingEntry.being;
  state.stance  = stance;
  state.messages = [];
  state.byCorr.clear();
  state.byMessage.clear();

  const empty   = document.getElementById("empty-detail");
  const insp    = document.getElementById("inspector");
  const panel   = document.getElementById("chat-panel");
  empty.classList.add("hidden");
  insp.classList.add("hidden");
  panel.classList.remove("hidden");
  panel.innerHTML = "";

  // Header
  const header = document.createElement("div");
  header.className = "chat-header";

  const title = document.createElement("h3");
  title.className = "pane-title";
  title.textContent = `chat @${beingEntry.being}`;
  header.appendChild(title);

  const closeBtn = document.createElement("button");
  closeBtn.className = "btn-sm";
  closeBtn.textContent = "close";
  closeBtn.onclick = () => closeChat();
  header.appendChild(closeBtn);

  panel.appendChild(header);

  // Inbox (past summons with this being, from descriptor).
  const inboxSec = document.createElement("div");
  inboxSec.id = "chat-inbox";
  inboxSec.className = "chat-inbox";
  panel.appendChild(inboxSec);
  redrawInbox(beingEntry);

  // Live message log.
  const log = document.createElement("div");
  log.id = "chat-log";
  log.className = "chat-log";
  panel.appendChild(log);

  // Composer.
  const composer = document.createElement("form");
  composer.className = "chat-composer";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = `summon @${beingEntry.being}…`;
  input.autocomplete = "off";
  const send = document.createElement("button");
  send.type = "submit";
  send.className = "btn-primary";
  send.textContent = "send";
  composer.appendChild(input);
  composer.appendChild(send);
  composer.onsubmit = async (ev) => {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    await dispatchOutgoing(text);
  };
  panel.appendChild(composer);

  setTimeout(() => input.focus(), 10);
}

export function closeChat() {
  state.open = false;
  state.being = null;
  state.stance = null;
  state.messages = [];
  state.byCorr.clear();
  state.byMessage.clear();
  document.getElementById("chat-panel")?.classList.add("hidden");
  document.getElementById("inspector")?.classList.add("hidden");
  document.getElementById("empty-detail")?.classList.remove("hidden");
}

// PortalClient onSummon. The entry is whatever the server pushed via
// ibp:summon. We route it three ways:
//   1. inReplyTo matches an outgoing → it's a reply; append under that message.
//   2. from === @<being> we're chatting with → it's an unsolicited from-them; append.
//   3. parent thread matches one of our live root correlations → it's a
//      sub-summon spawned downstream; append as a nested item.
export function handleIncomingSummon(entry) {
  if (!state.open) return;
  const replyTo = entry?.inReplyTo;
  if (replyTo) {
    const ourId = state.byCorr.get(replyTo);
    if (ourId) {
      appendMessage({
        who: state.being,
        content: entry.content || "(no content)",
        kind: "reply",
        parent: ourId,
        ts: entry.sentAt || new Date().toISOString(),
      });
      return;
    }
  }
  // Sub-summon detection: server side already routed this to us because we're
  // listening on the being-room. If the rootCorrelation matches one we started,
  // it's a downstream spawn.
  const root = entry?.rootCorrelation;
  if (root) {
    const rootMessage = findByRootCorrelation(root);
    if (rootMessage) {
      appendMessage({
        who: entry.from || "(unknown)",
        content: entry.content || "",
        kind: "sub-summon",
        parent: rootMessage.id,
        rootCorrelation: root,
        ts: entry.sentAt || new Date().toISOString(),
      });
      return;
    }
  }
  // Unsolicited: just append as a from-them message.
  appendMessage({
    who: entry.from || state.being,
    content: entry.content || "",
    kind: "incoming",
    ts: entry.sentAt || new Date().toISOString(),
  });
}

// ────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────

async function dispatchOutgoing(text) {
  const id = appendMessage({
    who: flat.state.session?.username || "arrival",
    content: text,
    kind: "outgoing",
    ts: new Date().toISOString(),
  });
  try {
    const { correlation, reply } = await flat.sendSummon(state.stance, text);
    state.byCorr.set(correlation, id);
    // Store the correlation as the rootCorrelation for sub-summon matching.
    const entry = state.messages.find((m) => m.id === id);
    if (entry) entry.rootCorrelation = correlation;
    // Sync reply: server returned a content payload directly (sync respondMode).
    if (reply && reply.content) {
      appendMessage({
        who: state.being,
        content: reply.content,
        kind: "reply",
        parent: id,
        ts: new Date().toISOString(),
      });
    }
    // Otherwise: { status: "accepted" } means async; reply arrives via
    // handleIncomingSummon.
  } catch (err) {
    appendMessage({
      who: "system",
      content: `[${err.code || "error"}] ${err.message || "summon failed"}`,
      kind: "error",
      parent: id,
      ts: new Date().toISOString(),
    });
  }
}

let _idSeq = 0;
function appendMessage(msg) {
  const id = `m-${++_idSeq}`;
  const entry = { id, ...msg };
  state.messages.push(entry);
  if (msg.rootCorrelation) state.byMessage.set(msg.rootCorrelation, entry);
  redrawLog();
  return id;
}

function findByRootCorrelation(root) {
  for (const m of state.messages) {
    if (m.rootCorrelation === root) return m;
  }
  return null;
}

function redrawLog() {
  const log = document.getElementById("chat-log");
  if (!log) return;
  log.innerHTML = "";
  // Render messages as a flat list; nest replies/sub-summons by indenting
  // under their parent. Depth > 2 isn't styled specially; v2 work.
  for (const m of state.messages) {
    if (m.parent) continue; // rendered under parent below
    log.appendChild(renderMessage(m));
  }
  log.scrollTop = log.scrollHeight;
}

function renderMessage(m) {
  const wrap = document.createElement("div");
  wrap.className = `chat-msg chat-${m.kind}`;
  const who = document.createElement("div");
  who.className = "msg-who";
  who.textContent = m.who;
  const content = document.createElement("div");
  content.className = "msg-content";
  content.textContent = m.content;
  wrap.appendChild(who);
  wrap.appendChild(content);

  // Cancel button for outgoing root messages (this thread can be cut).
  if (m.kind === "outgoing" && m.rootCorrelation) {
    const cancel = document.createElement("button");
    cancel.className = "btn-sm btn-cancel";
    cancel.textContent = "stop";
    cancel.title = "sever this thread (rootCorrelation cut)";
    cancel.onclick = () => flat.cancelByRootCorrelation(m.rootCorrelation);
    wrap.appendChild(cancel);
  }

  // Children: replies + sub-summons.
  const kids = state.messages.filter((x) => x.parent === m.id);
  if (kids.length > 0) {
    const sub = document.createElement("div");
    sub.className = "chat-children";
    for (const k of kids) sub.appendChild(renderMessage(k));
    wrap.appendChild(sub);
  }
  return wrap;
}

function redrawInbox(beingEntry) {
  const inbox = document.getElementById("chat-inbox");
  if (!inbox) return;
  inbox.innerHTML = "";
  const recent = beingEntry?.inbox?.recent;
  if (!recent || recent.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dim";
    empty.textContent = "(no past summons in inbox)";
    inbox.appendChild(empty);
    return;
  }
  const h = document.createElement("h4");
  h.textContent = `inbox (${beingEntry.inbox.total ?? recent.length})`;
  inbox.appendChild(h);
  const ul = document.createElement("ul");
  ul.className = "inbox-list";
  for (const r of recent.slice(0, 10)) {
    const li = document.createElement("li");
    const from = document.createElement("span");
    from.className = "msg-who";
    from.textContent = r.from || "?";
    const content = document.createElement("span");
    content.className = "msg-content";
    content.textContent = " " + (r.content || "(no content)").slice(0, 80);
    li.appendChild(from);
    li.appendChild(content);
    ul.appendChild(li);
  }
  inbox.appendChild(ul);
}
