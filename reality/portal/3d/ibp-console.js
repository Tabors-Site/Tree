// IBP console — a raw verb panel inside the 3D portal.
//
// Press backtick (`) to toggle. Pick a verb, fill the address + payload,
// hit Send. The exact envelope going over the wire is shown above the
// response so you can see what you just did and what came back.
//
// Reuses the same PortalClient the scene uses — calls go over the same
// socket. Useful during early-protocol development when ops are
// registered faster than UI is built for them.

const VERBS = ["see", "do", "summon", "be"];

const BE_OPS = ["birth", "connect", "release"];

export function mountIbpConsole({ root, client, getPlace }) {
  if (!root) throw new Error("mountIbpConsole: { root } required (DOM container)");
  if (!client) throw new Error("mountIbpConsole: { client } required (PortalClient)");

  injectStyles();
  const panel = buildPanel();
  root.appendChild(panel);

  const els = {
    panel,
    verb:     panel.querySelector("[data-el=verb]"),
    address:  panel.querySelector("[data-el=address]"),
    payload:  panel.querySelector("[data-el=payload]"),
    payloadHint: panel.querySelector("[data-el=payload-hint]"),
    send:     panel.querySelector("[data-el=send]"),
    envelope: panel.querySelector("[data-el=envelope]"),
    ack:      panel.querySelector("[data-el=ack]"),
    ackStatus:panel.querySelector("[data-el=ack-status]"),
    history:  panel.querySelector("[data-el=history]"),
    close:    panel.querySelector("[data-el=close]"),
  };

  const history = [];

  function refreshPayloadShape() {
    const verb = els.verb.value;
    els.payload.value = defaultPayloadFor(verb);
    els.payloadHint.textContent = payloadHintFor(verb);
    els.address.placeholder = addressPlaceholderFor(verb, getPlace?.() || "<place>");
  }

  els.verb.addEventListener("change", refreshPayloadShape);
  refreshPayloadShape();

  els.send.addEventListener("click", async () => {
    const verb    = els.verb.value;
    const address = els.address.value.trim();
    let payload;
    try {
      payload = els.payload.value.trim() ? JSON.parse(els.payload.value) : {};
    } catch (err) {
      renderError(els, { message: `Invalid JSON payload: ${err.message}` });
      return;
    }

    const envelope = { id: nextId(), verb, address, payload };
    els.envelope.textContent = JSON.stringify(envelope, null, 2);
    els.ack.textContent = "(waiting…)";
    els.ackStatus.textContent = "";
    els.ackStatus.className = "ibpc-ack-status";
    els.send.disabled = true;
    const t0 = performance.now();

    try {
      const data = await runVerb(client, verb, address, payload);
      const ms = Math.round(performance.now() - t0);
      const ack = { id: envelope.id, status: "ok", data };
      els.ack.textContent = JSON.stringify(ack, null, 2);
      els.ackStatus.textContent = `200 OK · ${ms}ms`;
      els.ackStatus.classList.add("ok");
      pushHistory(history, els.history, { verb, address, ok: true, ms });
    } catch (err) {
      const ms = Math.round(performance.now() - t0);
      const ack = {
        id:     envelope.id,
        status: "error",
        error:  { code: err.code || "ERROR", message: err.message, detail: err.detail },
      };
      els.ack.textContent = JSON.stringify(ack, null, 2);
      els.ackStatus.textContent = `${err.code || "ERROR"} · ${ms}ms`;
      els.ackStatus.classList.add("err");
      pushHistory(history, els.history, { verb, address, ok: false, ms, code: err.code });
    } finally {
      els.send.disabled = false;
    }
  });

  els.close.addEventListener("click", () => toggle(false));

  function toggle(forceOpen) {
    const open = typeof forceOpen === "boolean" ? forceOpen : panel.classList.contains("ibpc-hidden");
    panel.classList.toggle("ibpc-hidden", !open);
    if (open) setTimeout(() => els.address.focus(), 0);
  }

  // Backtick toggles. Ignored when typing in another input.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "`") return;
    const t = e.target;
    const inField = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    if (inField && !panel.contains(t)) return;
    e.preventDefault();
    toggle();
  });

  toggle(false);

  return { toggle, panel };
}

// ────────────────────────────────────────────────────────────────────

let _idCounter = 0;
function nextId() { return `c-${++_idCounter}`; }

function runVerb(client, verb, address, payload) {
  switch (verb) {
    case "see":    return client.see(address, payload);
    case "do":     return client.do(address, payload.action, payload.args || {});
    case "summon": {
      const { message, ...threading } = payload;
      return client.summon(address, message, threading);
    }
    case "be": {
      const { op, ...credentials } = payload;
      return client.be(op, address, credentials);
    }
    default:
      throw new Error(`Unknown verb: ${verb}`);
  }
}

function defaultPayloadFor(verb) {
  switch (verb) {
    case "see":    return JSON.stringify({ live: false }, null, 2);
    case "do":     return JSON.stringify({ action: "", args: {} }, null, 2);
    case "summon": return JSON.stringify({ message: { content: "" } }, null, 2);
    case "be":     return JSON.stringify({ op: "connect", name: "", password: "" }, null, 2);
    default:       return "{}";
  }
}

function payloadHintFor(verb) {
  switch (verb) {
    case "see":    return "options for SEE: { live }";
    case "do":     return "DO: { action: \"create-child\" | \"set-meta\" | …, args: { … } }";
    case "summon": return "SUMMON: { message: { content, … }, from?, inReplyTo?, correlation? }";
    case "be":     return `BE: { op: "${BE_OPS.join(" | ")}", name?, password?, … }`;
    default:       return "";
  }
}

function addressPlaceholderFor(verb, place) {
  switch (verb) {
    case "see":    return `${place}/.discovery`;
    case "do":     return `${place}/<spaceId>`;
    case "summon": return `${place}/<spaceId>@<being>`;
    case "be":     return `${place}/@cherub`;
    default:       return place;
  }
}

function pushHistory(history, listEl, entry) {
  history.unshift(entry);
  if (history.length > 50) history.length = 50;
  const li = document.createElement("li");
  li.className = `ibpc-history-item ${entry.ok ? "ok" : "err"}`;
  li.textContent = `${entry.ok ? "✓" : "✗"} ${entry.verb.padEnd(7)} ${entry.address} · ${entry.ms}ms${entry.code ? ` · ${entry.code}` : ""}`;
  listEl.prepend(li);
}

function renderError(els, err) {
  els.ack.textContent = JSON.stringify({ status: "error", error: err }, null, 2);
  els.ackStatus.textContent = "client error";
  els.ackStatus.classList.add("err");
}

function buildPanel() {
  const panel = document.createElement("div");
  panel.id = "ibp-console";
  panel.className = "ibpc-panel ibpc-hidden";
  panel.innerHTML = `
    <div class="ibpc-header">
      <span class="ibpc-title">IBP console</span>
      <span class="ibpc-hint">( \`  to toggle )</span>
      <button data-el="close" class="ibpc-close" title="Close">×</button>
    </div>

    <div class="ibpc-row">
      <select data-el="verb">
        ${VERBS.map(v => `<option value="${v}">${v.toUpperCase()}</option>`).join("")}
      </select>
      <input data-el="address" type="text" placeholder="address" spellcheck="false" />
      <button data-el="send" class="ibpc-send">Send</button>
    </div>

    <label class="ibpc-label">payload</label>
    <textarea data-el="payload" spellcheck="false"></textarea>
    <div class="ibpc-hint-row" data-el="payload-hint"></div>

    <div class="ibpc-split">
      <div class="ibpc-pane">
        <div class="ibpc-pane-header">envelope (sent)</div>
        <pre data-el="envelope" class="ibpc-pre"></pre>
      </div>
      <div class="ibpc-pane">
        <div class="ibpc-pane-header">
          <span>ack (received)</span>
          <span data-el="ack-status" class="ibpc-ack-status"></span>
        </div>
        <pre data-el="ack" class="ibpc-pre"></pre>
      </div>
    </div>

    <div class="ibpc-history-header">history</div>
    <ul data-el="history" class="ibpc-history"></ul>
  `;
  return panel;
}

function injectStyles() {
  if (document.getElementById("ibpc-styles")) return;
  const style = document.createElement("style");
  style.id = "ibpc-styles";
  style.textContent = `
    .ibpc-panel {
      position: fixed; right: 14px; top: 60px; bottom: 14px; width: 480px; z-index: 30;
      display: flex; flex-direction: column; gap: 8px;
      background: rgba(10, 13, 12, 0.95);
      border: 1px solid #2c3a32; border-radius: 6px;
      padding: 12px 14px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.6);
      color: #c8d3cb;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Mono", monospace;
      font-size: 11px;
    }
    .ibpc-hidden { display: none; }
    .ibpc-header { display: flex; align-items: center; gap: 8px; }
    .ibpc-title { font-size: 12px; font-weight: 500; color: #c8d3cb; }
    .ibpc-hint  { font-size: 10px; color: #6b7d72; flex: 1; }
    .ibpc-close {
      background: transparent; color: #6b7d72; border: none;
      font-size: 18px; line-height: 1; cursor: pointer; padding: 0 4px;
    }
    .ibpc-close:hover { color: #c8d3cb; }

    .ibpc-row { display: flex; gap: 6px; }
    .ibpc-row select, .ibpc-row input {
      background: #0a0d0c; color: #c8d3cb;
      border: 1px solid #2c3a32; border-radius: 3px;
      padding: 6px 8px; font-family: inherit; font-size: 11px;
    }
    .ibpc-row select { width: 90px; text-transform: uppercase; }
    .ibpc-row input  { flex: 1; min-width: 0; }
    .ibpc-row select:focus, .ibpc-row input:focus { outline: none; border-color: #8fbf9f; }
    .ibpc-send {
      background: #1a3424; color: #c8d3cb; border: 1px solid #2f6b48;
      border-radius: 3px; padding: 6px 14px; font-family: inherit;
      font-size: 11px; cursor: pointer;
    }
    .ibpc-send:hover    { background: #234a32; }
    .ibpc-send:disabled { opacity: 0.4; cursor: not-allowed; }

    .ibpc-label {
      font-size: 10px; color: #6b7d72; text-transform: uppercase;
      letter-spacing: 0.05em; margin-top: 4px;
    }
    .ibpc-panel textarea {
      background: #0a0d0c; color: #c8d3cb;
      border: 1px solid #2c3a32; border-radius: 3px;
      padding: 6px 8px; font-family: inherit; font-size: 11px;
      min-height: 88px; resize: vertical;
    }
    .ibpc-panel textarea:focus { outline: none; border-color: #8fbf9f; }
    .ibpc-hint-row { font-size: 10px; color: #6b7d72; }

    .ibpc-split { display: flex; gap: 8px; flex: 1; min-height: 0; }
    .ibpc-pane {
      flex: 1; min-width: 0; display: flex; flex-direction: column;
      border: 1px solid #2c3a32; border-radius: 3px; overflow: hidden;
      background: #0a0d0c;
    }
    .ibpc-pane-header {
      display: flex; justify-content: space-between; gap: 8px;
      padding: 4px 8px; font-size: 10px;
      color: #6b7d72; text-transform: uppercase; letter-spacing: 0.05em;
      background: #131a17; border-bottom: 1px solid #2c3a32;
    }
    .ibpc-ack-status { text-transform: none; letter-spacing: 0; }
    .ibpc-ack-status.ok  { color: #8fbf9f; }
    .ibpc-ack-status.err { color: #d97a7a; }
    .ibpc-pre {
      flex: 1; overflow: auto; padding: 6px 8px;
      margin: 0; font-family: inherit; font-size: 10px; color: #c8d3cb;
      white-space: pre-wrap; word-break: break-all;
    }

    .ibpc-history-header {
      font-size: 10px; color: #6b7d72; text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .ibpc-history {
      list-style: none; padding: 0; margin: 0;
      max-height: 120px; overflow-y: auto;
      border: 1px solid #2c3a32; border-radius: 3px; background: #0a0d0c;
    }
    .ibpc-history-item {
      padding: 3px 8px; font-size: 10px;
      border-bottom: 1px solid #131a17; white-space: pre;
    }
    .ibpc-history-item.ok  { color: #9ab0a3; }
    .ibpc-history-item.err { color: #d97a7a; }
    .ibpc-history-item:last-child { border-bottom: none; }
  `;
  document.head.appendChild(style);
}
