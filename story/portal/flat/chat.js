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

import { flat } from "./host.js";

const state = {
  open:    false,
  being:   null,             // being NAME (e.g. "alice")
  stance:  null,             // full stance address e.g. "<story>/path@alice"
  messages: [],              // [{ id, who, content, kind, parent?, rootCorrelation?, ts }]
  byCorr:   new Map(),       // correlation → message id (for matching pushes)
  byMessage: new Map(),      // server messageId → our message entry
};

export function isChatOpen() { return state.open; }
export function getChatBeing() { return state.being; }

export function openChatFor(beingEntry, { refresh = false } = {}) {
  if (!beingEntry) return;
  const fl = flat.state;
  const story = fl.discovery?.story;
  if (!story) return;

  const path = fl.descriptor?.address?.pathByNames || "/";
  // Carry the active branch qualifier through; otherwise a chat opened
  // on #1 silently addresses the same name on main and the cross-branch
  // gate rejects (or worse, hits a different being with the same name).
  const branch = fl.descriptor?.address?.branch || "0";
  const bq = branch === "0" ? "" : `#${branch}`;
  const stance = `${story}${bq}${path}@${beingEntry.being}`.replace(/\/+@/, "/@");

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

  // ── LLM indicator ─────────────────────────────────────────────
  // Shows the LLM that WILL be used to respond, with provenance
  // (which step of the 7-step chain it came from). Click to expand
  // and see the full chain. The preview is fetched once when chat
  // opens — re-fetched only when the user explicitly clicks refresh.
  const llmBar = document.createElement("div");
  llmBar.className = "chat-llm-bar";
  llmBar.textContent = "LLM: (loading…)";
  llmBar.style.cursor = "pointer";
  llmBar.title = "click to see full chain";
  panel.appendChild(llmBar);

  let chainCache = null;
  let expanded = false;
  function renderBarSummary() {
    llmBar.innerHTML = "";
    const chain = (chainCache && Array.isArray(chainCache.chain)) ? chainCache.chain : [];
    const chosen = chainCache?.chosen || null;
    if (chosen) {
      const label = document.createElement("span");
      label.textContent = "LLM: ";
      label.className = "muted";
      const model = document.createElement("strong");
      model.textContent = chosen.model || chosen.name || chosen.connectionId.slice(0, 12);
      const via = document.createElement("span");
      via.className = "muted";
      via.textContent = ` ← step ${chosen.step} · ${chosen.source}`;
      llmBar.appendChild(label);
      llmBar.appendChild(model);
      llmBar.appendChild(via);
    } else if (chain.length === 0 && chainCache?.reason) {
      llmBar.textContent = `LLM: (none — ${chainCache.reason})`;
    } else {
      llmBar.textContent = "LLM: (no candidate resolved)";
    }
    const more = document.createElement("span");
    more.className = "muted";
    more.style.marginLeft = "0.5em";
    more.textContent = expanded ? " ▾" : " ▸";
    llmBar.appendChild(more);
  }
  function renderBarExpanded() {
    renderBarSummary();
    const chain = (chainCache && Array.isArray(chainCache.chain)) ? chainCache.chain : [];
    if (chain.length === 0) return;
    const ul = document.createElement("ul");
    ul.className = "llm-chain";
    for (const entry of chain) {
      const li = document.createElement("li");
      li.className = "llm-chain-entry";
      const isChosen = chainCache?.chosen && entry.connectionId === chainCache.chosen.connectionId
        && entry.step === chainCache.chosen.step && entry.source === chainCache.chosen.source;
      const marker = document.createElement("span");
      marker.className = "llm-chain-marker";
      marker.textContent = isChosen ? "✓" : " ";
      const step = document.createElement("span");
      step.className = "llm-chain-step";
      step.textContent = `step ${entry.step}`;
      const src = document.createElement("span");
      src.className = "llm-chain-source";
      src.textContent = entry.source;
      const model = document.createElement("span");
      model.className = "llm-chain-model";
      model.textContent = entry.model || entry.name || entry.connectionId.slice(0, 8);
      if (isChosen) li.style.fontWeight = "bold";
      li.appendChild(marker);
      li.appendChild(step);
      li.appendChild(src);
      li.appendChild(model);
      ul.appendChild(li);
    }
    llmBar.appendChild(ul);
    if (chainCache?.reason) {
      const rDiv = document.createElement("div");
      rDiv.className = "sub muted";
      rDiv.textContent = `reason: ${chainCache.reason}`;
      llmBar.appendChild(rDiv);
    }
  }
  llmBar.onclick = () => {
    expanded = !expanded;
    if (expanded) renderBarExpanded();
    else renderBarSummary();
  };

  // Kick the preview fetch. The receiver is this being; the actor is
  // the signed-in user. SEE op — no Fact stamped, no chain pollution.
  // `client.see("llm-chain", { args })` dispatches through the unified
  // SEE ops registry; the wire returns the handler's value verbatim.
  const role = beingEntry.defaultRole || "main";
  Promise.resolve(fl.client.see("llm-chain", {
    args: {
      receiverBeingId: beingEntry.beingId || null,
      receiverBeingName: beingEntry.beingId ? null : beingEntry.being,
      receiverSpaceId: fl.descriptor?.position?.spaceId || null,
      actorBeingName: fl.session?.username || null,
      role,
    },
  })).then((res) => {
    chainCache = (res && res.result) || res || { chain: [], reason: null, chosen: null };
    if (expanded) renderBarExpanded();
    else renderBarSummary();
  }).catch((err) => {
    llmBar.textContent = `LLM: (preview failed — ${err?.message || err})`;
  });

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
