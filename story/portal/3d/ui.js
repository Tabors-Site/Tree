// TreeOS Portal 3D — UI overlays.
//
// Login menu (opened when you gaze at the cherub), gaze labels above
// objects, and a small HUD line at the top of the screen.

import { setPortalStatus } from "../shared/portal-status.js";

const overlayRoot = () => document.getElementById("overlays");
const hudTop = () => document.getElementById("hud-top");
const hudBottom = () => document.getElementById("hud-bottom");

let labelEl = null;

// All status / HUD messages route through the shared toast at body
// level so they stay visible in both render modes (3D scene + text
// mode) and sit above every panel (hotbar, timeline, flat overlay).
// Errors render red; info renders dim gray. See
// portal/shared/portal-status.js for the classifier.
export function setHud(text) {
  setPortalStatus(text);
  // Keep writing the legacy #hud-bottom slot too so any consumer that
  // reads back via textContent (debug tools, tests) still works.
  const el = hudBottom();
  if (el) el.textContent = text || "";
}

export function setHudBottom(text) {
  setHud(text);
}

// The address bar moved to the shell (core/shell.js): the stance bar,
// nav buttons, and history enablement are chrome shared by every
// view, not 3D furniture. initAddressBar / updateAddressBar /
// setHistoryButtonsEnabled retired with the move.

export function showLabel(text, x, y) {
  if (!labelEl) {
    labelEl = document.createElement("div");
    labelEl.className = "label";
    document.body.appendChild(labelEl);
  }
  labelEl.textContent = text;
  labelEl.style.left = `${x}px`;
  labelEl.style.top  = `${y}px`;
  labelEl.style.display = "block";
}

export function hideLabel() {
  if (labelEl) labelEl.style.display = "none";
}

// Hardcoded auth panels (showAuthSignInPanel / showAuthActions) retired
// with the verbs-as-language UI cleanup. Cherub now exposes its four BE
// ops (birth / use / release / switch) through the descriptor's
// `actions[]` block, and the 3D portal renders them via the generic
// actionRenderer in src/actionRenderer.js. Everything previously
// hardcoded for cherub lives in that one path.

// Summon panel: shown when in proximity+gaze of a non-cherub being.
// Lets the user type a message and send a SUMMON. Typed state is
// preserved across re-opens (per being) so a brief look-away doesn't
// lose typing, and is cleared on submit or when the user navigates to
// a new position.
let _summonPanelEl = null;
let _summonState = new Map(); // being -> { text, busy, error }

export function showSummonPanel({ being: b, onSubmit }) {
  if (_summonPanelEl) return;
  document.exitPointerLock?.();
  const key = b.being;
  if (!_summonState.has(key)) _summonState.set(key, { text: "", busy: false, error: "" });
  const s = _summonState.get(key);

  const el = document.createElement("div");
  el.className = "summon-panel";
  el.style.cssText = `
    position: fixed; left: 50%; bottom: 80px;
    transform: translateX(-50%);
    background: rgba(10, 13, 12, 0.94);
    border: 1px solid #2c3a32; border-radius: 6px;
    padding: 12px 14px; min-width: 420px; max-width: 560px;
    pointer-events: auto; z-index: 12;
    font-family: ui-monospace, monospace; color: #c8d3cb;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
  `;
  el.innerHTML = `
    <div style="font-size: 11px; color: #6b7d72; margin-bottom: 6px;">
      ${escapeHtml(b.icon || "")} talking to ${escapeHtml(b.label || b.being)}
    </div>
    <form>
      <textarea name="message" rows="2" placeholder="say something..."
        style="width:100%; box-sizing:border-box; padding:6px 8px;
        background:#0a0d0c; color:#c8d3cb; border:1px solid #2c3a32;
        border-radius:3px; font-family:inherit; font-size:12px;
        resize:vertical;"></textarea>
      <div style="display:flex; gap:8px; align-items:center; margin-top:6px;">
        <button type="submit" class="btn-send" style="flex:1;
          padding:6px 10px; background:#1a3424; color:#c8d3cb;
          border:1px solid #2f6b48; border-radius:3px;
          font-family:inherit; font-size:12px; cursor:pointer;">
          send
        </button>
        <span class="hint" style="font-size:10px; color:#6b7d72;">
          enter to send, shift+enter for newline
        </span>
      </div>
      <div class="error" style="color:#d97a7a; font-size:11px;
        margin-top:6px; display:none;"></div>
    </form>
  `;
  document.body.appendChild(el);
  _summonPanelEl = el;

  const form = el.querySelector("form");
  const textarea = form.querySelector("textarea");
  const sendBtn = form.querySelector(".btn-send");
  const errBox = form.querySelector(".error");

  textarea.value = s.text;
  if (s.error) {
    errBox.style.display = "block";
    errBox.textContent = s.error;
  }
  setTimeout(() => textarea.focus(), 30);

  textarea.addEventListener("input", () => {
    s.text = textarea.value;
  });
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (s.busy) return;
    const text = textarea.value.trim();
    if (!text) return;
    s.busy = true;
    sendBtn.disabled = true;
    sendBtn.textContent = "sending...";
    errBox.style.display = "none";
    s.error = "";
    try {
      await onSubmit(text);
      // Success: clear text for the next message.
      s.text = "";
      textarea.value = "";
    } catch (err) {
      const msg = `${err.code || "error"}: ${err.message || "summon failed"}`;
      s.error = msg;
      errBox.style.display = "block";
      errBox.textContent = msg;
    } finally {
      s.busy = false;
      sendBtn.disabled = false;
      sendBtn.textContent = "send";
      textarea.focus();
    }
  });
}

export function hideSummonPanel() {
  _summonPanelEl?.remove();
  _summonPanelEl = null;
}

export function resetSummonState() {
  _summonState = new Map();
}

// Any modal panel currently open. Used to gate gameplay input (WASD/B/N)
// so the user can interact with panels without the camera moving.
// Cherub's action menu / form panels live in actionRenderer.js and are
// queried separately by callers that need the unified "any panel open"
// signal (main.js composes the two).
export function isAnyPanelOpen() {
  return !!_summonPanelEl;
}

// Bottom-right sky clock. Shows the place's local time (HH:MM in 24h),
// rendered when the scene is in default (sky) mode. Hidden in arrival.
let _skyClockEl = null;
function ensureSkyClock() {
  if (_skyClockEl) return _skyClockEl;
  _skyClockEl = document.createElement("div");
  _skyClockEl.style.cssText = `
    position: fixed; right: 14px; bottom: 14px; z-index: 8;
    padding: 5px 10px;
    background: rgba(10, 13, 12, 0.55);
    border: 1px solid rgba(200, 211, 203, 0.18);
    border-radius: 4px;
    color: #d8e0d8; font-family: ui-monospace, monospace;
    font-size: 13px; letter-spacing: 0.05em;
    pointer-events: none; user-select: none;
  `;
  document.body.appendChild(_skyClockEl);
  return _skyClockEl;
}

export function setSkyClock(text) {
  const el = ensureSkyClock();
  el.textContent = text;
  el.style.display = "block";
}

export function hideSkyClock() {
  if (_skyClockEl) _skyClockEl.style.display = "none";
}

// ────────────────────────────────────────────────────────────────────
// LLM Assigner panel
// ────────────────────────────────────────────────────────────────────
//
// Shown when the user activates the llm-assigner being. It is the
// place's LLM-configuration character — purely programmatic (no LLM
// cognition), so the interaction is a form, not a chat.
//
// Three scope tabs:
//
//   My Being   — add/list/delete connections on the caller's being,
//                pick which one is "main".
//   This Node  — bind one of the caller's connections to a slot on a
//                specific node. Only enabled when the user is on a
//                node (currentSpaceId provided).
//   Place       — set the place-level default. Server gates with
//                root-operator check; non-operators get FORBIDDEN.
//
// The shared "connections" fetch is reused across all three tabs.
// Form state (typed values) and the active tab are preserved across
// look-away/look-back via `_llmPanelState`.

let _llmAssignerPanelEl = null;
let _llmPanelState = {
  tab:      "being",          // "being" | "node" | "place"
  add:      { name: "", baseUrl: "", model: "", apiKey: "" },
  nodeSlot: "main",
  error:    "",
};

export function showLlmAssignerPanel({ client, place, currentSpaceId, onClose, onSpawnTutorial }) {
  if (_llmAssignerPanelEl) return;
  document.exitPointerLock?.();

  // Shared state for one open panel session.
  let connections = [];
  let mainConnId  = null;

  const el = document.createElement("div");
  el.className = "llm-assigner";
  el.style.cssText = `
    position: fixed; left: 50%; top: 50%;
    transform: translate(-50%, -50%);
    background: rgba(10, 13, 12, 0.94);
    border: 1px solid #2c3a32; border-radius: 6px;
    padding: 16px 20px; min-width: 420px; max-width: 520px;
    pointer-events: auto; z-index: 12;
    font-family: ui-monospace, monospace; color: #c8d3cb;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
    max-height: 86vh; overflow-y: auto;
  `;
  el.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center;
      margin-bottom: 10px;">
      <div style="font-size: 12px; color: #c8d3cb;">
        \u{1F9E0} LLM Assigner
        <span style="color:#6b7d72; font-weight: normal;"> @${escapeHtml(place)}</span>
      </div>
      <button class="llm-close" type="button" style="background:transparent;
        color:#6b7d72; border:none; font-size:18px; line-height:1;
        cursor:pointer; padding:0 4px;">×</button>
    </div>

    <div style="margin-bottom:10px; font-size:11px;">
      <button class="llm-spawn-tutorial" type="button"
        style="background:transparent; border:none; padding:0;
          color:#8fbf9f; cursor:pointer; font:inherit; text-align:left;">
        \u{25B6} Spawn the LLM setup video in the place
      </button>
    </div>

    <div class="llm-tabs" style="display:flex; gap:4px; margin-bottom:12px;
      border-bottom:1px solid #2c3a32;">
      <button class="llm-tab" data-tab="being" type="button">My Being</button>
      <button class="llm-tab" data-tab="node"  type="button" ${currentSpaceId ? "" : "disabled"}>This Node</button>
      <button class="llm-tab" data-tab="place"  type="button">Story Default</button>
    </div>

    <div class="llm-body" style="font-size:11px;"></div>
    <div class="llm-error" style="color:#d97a7a; font-size:11px;
      margin-top:8px; display:none;"></div>
  `;
  document.body.appendChild(el);
  _llmAssignerPanelEl = el;

  // Inline styles for tab buttons (simpler than CSS classes here).
  el.querySelectorAll(".llm-tab").forEach(b => {
    b.style.cssText = `
      background: transparent; color: #6b7d72; border: none;
      padding: 6px 12px; font-family: inherit; font-size: 11px;
      cursor: pointer; border-bottom: 2px solid transparent;
      margin-bottom: -1px;
    `;
    if (b.disabled) { b.style.opacity = "0.4"; b.style.cursor = "not-allowed"; }
  });

  const bodyEl  = el.querySelector(".llm-body");
  const errEl   = el.querySelector(".llm-error");
  const closeBtn= el.querySelector(".llm-close");
  const tabBtns = [...el.querySelectorAll(".llm-tab")];

  function showError(msg) {
    _llmPanelState.error = msg;
    errEl.style.display = "block";
    errEl.textContent   = msg;
  }
  function clearError() {
    _llmPanelState.error = "";
    errEl.style.display = "none";
  }

  function activateTab(tab) {
    if (tab === "node" && !currentSpaceId) return;
    _llmPanelState.tab = tab;
    tabBtns.forEach(b => {
      const active = b.dataset.tab === tab;
      b.style.color           = active ? "#c8d3cb" : "#6b7d72";
      b.style.borderBottom    = `2px solid ${active ? "#8fbf9f" : "transparent"}`;
    });
    renderActiveTab();
  }

  function renderActiveTab() {
    clearError();
    if (_llmPanelState.tab === "being") return renderBeingTab();
    if (_llmPanelState.tab === "node")  return renderNodeTab();
    if (_llmPanelState.tab === "place")  return renderPlaceTab();
  }

  // ── My Being tab ───────────────────────────────────────────────
  function renderBeingTab() {
    const listHtml = connections.length === 0
      ? `<div style="color:#6b7d72; padding:8px 0;">
           No connections yet. Add one below to give your being LLM access.
         </div>`
      : connections.map(c => {
          const isMain = String(c.connectionId) === String(mainConnId);
          return `
            <div style="display:flex; align-items:center; gap:6px;
              padding:6px 8px; border:1px solid #2c3a32; border-radius:3px;
              background:#0e1311; margin-bottom:4px;">
              <div style="flex:1; min-width:0;">
                <div style="color:#c8d3cb;">
                  ${escapeHtml(c.name || c.model)}
                  ${isMain ? `<span style="color:#8fbf9f; font-size:10px; margin-left:6px;">[main]</span>` : ""}
                </div>
                <div style="color:#6b7d72; font-size:10px;">
                  ${escapeHtml(c.model)} · ${escapeHtml(c.baseUrl)}
                </div>
              </div>
              ${isMain ? "" : `
                <button data-act="main" data-id="${escapeHtml(c.connectionId)}" type="button"
                  style="background:transparent; color:#8fbf9f; border:1px solid #2c3a32;
                  border-radius:3px; padding:3px 8px; font-family:inherit; font-size:10px;
                  cursor:pointer;">set main</button>
              `}
              <button data-act="del" data-id="${escapeHtml(c.connectionId)}" type="button"
                style="background:transparent; color:#6b7d72; border:1px solid #2c3a32;
                border-radius:3px; padding:3px 8px; font-family:inherit; font-size:10px;
                cursor:pointer;">delete</button>
            </div>
          `;
        }).join("");

    bodyEl.innerHTML = `
      <div style="margin-bottom: 12px;">${listHtml}</div>

      <div style="font-size:10px; color:#6b7d72; text-transform:uppercase;
        letter-spacing:.05em; margin-bottom:6px;">add new connection</div>
      <form class="llm-add-form">
        <input name="name" type="text" placeholder="name (optional, e.g. 'my-openai')"
          style="${INPUT}" /><div style="height:4px"></div>
        <input name="baseUrl" type="text" placeholder="baseUrl  (e.g. https://api.openai.com/v1)"
          style="${INPUT}" /><div style="height:4px"></div>
        <input name="model" type="text" placeholder="model  (e.g. gpt-4o)"
          style="${INPUT}" /><div style="height:4px"></div>
        <input name="apiKey" type="password" placeholder="apiKey (leave blank for local LLMs)"
          style="${INPUT}" /><div style="height:6px"></div>
        <button type="submit" class="btn-add" style="${BTN_PRIMARY}">
          add connection
        </button>
        <div style="margin-top:8px; font-size:10px; color:#6b7d72; line-height:1.4;">
          Private network URLs (e.g. <code style="color:#9ab0a3;">10.x</code>,
          <code style="color:#9ab0a3;">192.168.x</code>, <code style="color:#9ab0a3;">localhost</code>)
          are blocked by default. The root operator can opt in to specific hosts by setting
          <code style="color:#9ab0a3;">allowedLlmDomains</code> in place config.
        </div>
      </form>
    `;

    const form = bodyEl.querySelector(".llm-add-form");
    const nameI = form.querySelector("input[name=name]");
    const urlI  = form.querySelector("input[name=baseUrl]");
    const modI  = form.querySelector("input[name=model]");
    const keyI  = form.querySelector("input[name=apiKey]");
    const addBt = form.querySelector(".btn-add");

    nameI.value = _llmPanelState.add.name;
    urlI.value  = _llmPanelState.add.baseUrl;
    modI.value  = _llmPanelState.add.model;
    keyI.value  = _llmPanelState.add.apiKey;
    nameI.addEventListener("input", () => { _llmPanelState.add.name    = nameI.value; });
    urlI .addEventListener("input", () => { _llmPanelState.add.baseUrl = urlI.value; });
    modI .addEventListener("input", () => { _llmPanelState.add.model   = modI.value; });
    keyI .addEventListener("input", () => { _llmPanelState.add.apiKey  = keyI.value; });

    bodyEl.querySelectorAll("button[data-act=del]").forEach(b => {
      b.addEventListener("click", async () => {
        try {
          await client.do("/", "delete-llm", { connectionId: b.dataset.id });
          await refreshConnections(); renderActiveTab();
        } catch (err) { showError(fmtErr(err, "delete failed")); }
      });
    });
    bodyEl.querySelectorAll("button[data-act=main]").forEach(b => {
      b.addEventListener("click", async () => {
        try {
          await client.do("/", "assign-slot",
            { slot: "main", connectionId: b.dataset.id });
          await refreshConnections(); renderActiveTab();
        } catch (err) { showError(fmtErr(err, "set-main failed")); }
      });
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearError();
      const baseUrl = urlI.value.trim();
      const model   = modI.value.trim();
      const apiKey  = keyI.value || null;
      if (!baseUrl) return showError("baseUrl is required");
      if (!model)   return showError("model is required");
      // apiKey is optional — local LLMs (Ollama, llama.cpp) need none.
      addBt.disabled = true; addBt.textContent = "adding...";
      try {
        await client.do("/", "add-llm", {
          name: nameI.value.trim() || null, baseUrl, model, apiKey,
        });
        _llmPanelState.add = { name: "", baseUrl: "", model: "", apiKey: "" };
        await refreshConnections(); renderActiveTab();
      } catch (err) {
        showError(fmtErr(err, "add failed"));
      } finally {
        addBt.disabled = false; addBt.textContent = "add connection";
      }
    });
  }

  // ── This Node tab ──────────────────────────────────────────────
  function renderNodeTab() {
    if (!currentSpaceId) {
      bodyEl.innerHTML = `<div style="color:#6b7d72; padding:8px 0;">
        Navigate to a tree node first. The node tab assigns an LLM to a
        specific position you own.
      </div>`;
      return;
    }
    if (connections.length === 0) {
      bodyEl.innerHTML = `<div style="color:#6b7d72; padding:8px 0;">
        Add a connection on the <b style="color:#c8d3cb;">My Being</b> tab first,
        then come back here to bind it to this node.
      </div>`;
      return;
    }
    bodyEl.innerHTML = `
      <div style="color:#6b7d72; margin-bottom:8px;">
        Setting LLM slot on node
        <code style="color:#c8d3cb;">${escapeHtml(currentSpaceId)}</code>.
        Caller must own the tree.
      </div>
      <form class="llm-node-form">
        <label style="${LABEL}">slot</label>
        <input name="slot" type="text" value="${escapeHtml(_llmPanelState.nodeSlot)}"
          style="${INPUT}" /><div style="height:6px"></div>
        <label style="${LABEL}">connection</label>
        ${connDropdown("connectionId")}
        <div style="height:8px"></div>
        <div style="display:flex; gap:6px;">
          <button type="submit" data-act="apply" style="${BTN_PRIMARY}; flex:1;">apply</button>
          <button type="button" data-act="clear" style="${BTN_GHOST}; flex:1;">clear slot</button>
        </div>
      </form>
    `;
    const form = bodyEl.querySelector(".llm-node-form");
    const slotI = form.querySelector("input[name=slot]");
    const connI = form.querySelector("select[name=connectionId]");
    slotI.addEventListener("input", () => { _llmPanelState.nodeSlot = slotI.value; });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearError();
      try {
        await client.do("/", "set-space-llm", {
          spaceId:      currentSpaceId,
          slot:         slotI.value.trim() || "main",
          connectionId: connI.value || null,
        });
        showError("");  // clear
        renderActiveTab();
      } catch (err) { showError(fmtErr(err, "set-space-llm failed")); }
    });
    form.querySelector("button[data-act=clear]").addEventListener("click", async () => {
      clearError();
      try {
        await client.do("/", "set-space-llm", {
          spaceId: currentSpaceId, slot: slotI.value.trim() || "main", connectionId: null,
        });
      } catch (err) { showError(fmtErr(err, "clear failed")); }
    });
  }

  // ── Place Default tab ───────────────────────────────────────────
  function renderPlaceTab() {
    if (connections.length === 0) {
      bodyEl.innerHTML = `<div style="color:#6b7d72; padding:8px 0;">
        Add a connection on the <b style="color:#c8d3cb;">My Being</b> tab first,
        then come back here to set it as the place default.
      </div>`;
      return;
    }
    bodyEl.innerHTML = `
      <div style="color:#6b7d72; margin-bottom:8px;">
        Setting the story-level default LLM. Restricted to the root
        operator (the first registered human). Non-operators get
        <code style="color:#d97a7a;">FORBIDDEN</code>.
      </div>
      <form class="llm-place-form">
        <label style="${LABEL}">connection</label>
        ${connDropdown("connectionId")}
        <div style="height:8px"></div>
        <div style="display:flex; gap:6px;">
          <button type="submit" data-act="apply" style="${BTN_PRIMARY}; flex:1;">apply</button>
          <button type="button" data-act="clear" style="${BTN_GHOST}; flex:1;">clear default</button>
        </div>
      </form>
    `;
    const form = bodyEl.querySelector(".llm-place-form");
    const connI = form.querySelector("select[name=connectionId]");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearError();
      try {
        await client.do("/", "set-story-llm", {
          connectionId: connI.value || null,
        });
      } catch (err) { showError(fmtErr(err, "set-story-llm failed")); }
    });
    form.querySelector("button[data-act=clear]").addEventListener("click", async () => {
      clearError();
      try {
        await client.do("/", "set-story-llm", { connectionId: null });
      } catch (err) { showError(fmtErr(err, "clear failed")); }
    });
  }

  function connDropdown(fieldName) {
    return `<select name="${fieldName}" style="${INPUT}">
      ${connections.map(c => `
        <option value="${escapeHtml(c.connectionId)}">
          ${escapeHtml(c.name || c.model)} — ${escapeHtml(c.model)}
        </option>
      `).join("")}
    </select>`;
  }

  async function refreshConnections() {
    try {
      const data = await client.do("/", "llm-connections", {});
      connections = data?.connections || [];
      mainConnId  = data?.slots?.main || null;
    } catch (err) {
      showError(fmtErr(err, "list failed"));
    }
  }

  function fmtErr(err, fallback) {
    return `${err.code || "error"}: ${err.message || fallback}`;
  }

  tabBtns.forEach(b => {
    b.addEventListener("click", () => activateTab(b.dataset.tab));
  });
  closeBtn.addEventListener("click", () => {
    hideLlmAssignerPanel();
    if (typeof onClose === "function") onClose();
  });

  // Spawn link: fires the llm-assigner:start-tutorial DO. The op is
  // idempotent server-side (marker on qualities.tutorial.purpose), so
  // only one is ever active at a time. On success the panel closes
  // and the caller's onSpawnTutorial refetches the descriptor — the
  // new matter's video screen mounts in the 3D scene.
  const spawnLink = el.querySelector(".llm-spawn-tutorial");
  spawnLink.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const original = spawnLink.textContent;
    spawnLink.style.opacity = "0.5";
    spawnLink.textContent   = "spawning...";
    try {
      if (typeof onSpawnTutorial === "function") {
        await onSpawnTutorial();
      } else {
        await client.do("/", "llm-assigner:start-tutorial", {});
      }
      hideLlmAssignerPanel();
      if (typeof onClose === "function") onClose();
    } catch (err) {
      showError(fmtErr(err, "spawn failed"));
      spawnLink.style.opacity = "1";
      spawnLink.textContent   = original;
    }
  });

  // Initial mount. The intro YouTube tutorial used to live here as
  // a popup; it's now 3D placed matter (see scene.js video-screen
  // mesh). The panel is back to its CRUD-only role.
  (async () => {
    await refreshConnections();
    // Restore last-active tab; fall back to "being" if node was active
    // but we no longer have a current node.
    const startTab = (_llmPanelState.tab === "node" && !currentSpaceId) ? "being" : _llmPanelState.tab;
    activateTab(startTab);
    if (_llmPanelState.error) showError(_llmPanelState.error);
  })();
}

export function hideLlmAssignerPanel() {
  _llmAssignerPanelEl?.remove();
  _llmAssignerPanelEl = null;
}

// Reusable inline styles for the panel form controls.
const INPUT = `
  width:100%; box-sizing:border-box; padding:5px 8px;
  background:#0a0d0c; color:#c8d3cb; border:1px solid #2c3a32;
  border-radius:3px; font-family:ui-monospace, monospace; font-size:11px;
`;
const LABEL = `
  display:block; font-size:10px; color:#6b7d72;
  text-transform:uppercase; letter-spacing:.05em; margin-bottom:3px;
`;
const BTN_PRIMARY = `
  padding:7px 10px; background:#1a3424; color:#c8d3cb;
  border:1px solid #2f6b48; border-radius:3px;
  font-family:ui-monospace, monospace; font-size:12px; cursor:pointer;
`;
const BTN_GHOST = `
  padding:7px 10px; background:transparent; color:#6b7d72;
  border:1px solid #2c3a32; border-radius:3px;
  font-family:ui-monospace, monospace; font-size:12px; cursor:pointer;
`;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
