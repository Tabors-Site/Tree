// TreeOS Portal 3D — UI overlays.
//
// Login menu (opened when you gaze at the auth-being), gaze labels above
// objects, and a small HUD line at the top of the screen.

const overlayRoot = () => document.getElementById("overlays");
const hudTop = () => document.getElementById("hud-top");
const hudBottom = () => document.getElementById("hud-bottom");

let labelEl = null;

export function setHud(text) {
  // Use the bottom HUD as the status line; the top is occupied by the
  // address bar now.
  const el = hudBottom();
  if (el) el.textContent = text;
}

export function setHudBottom(text) {
  const el = hudBottom();
  if (el) el.textContent = text;
}

// ── Address bar ────────────────────────────────────────────────────

let _addressApi = null;

export function initAddressBar({ onNavigate, onIdentityClick, onBack, onForward }) {
  const chip = document.getElementById("identity-chip");
  const input = document.getElementById("address-input");
  const navBack = document.getElementById("nav-back");
  const navForward = document.getElementById("nav-forward");
  const navLand = document.getElementById("nav-land");
  const navHome = document.getElementById("nav-home");
  const navRoot = document.getElementById("nav-root");

  chip.addEventListener("click", () => onIdentityClick?.());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") onNavigate(input.value.trim());
  });
  input.addEventListener("focus", () => document.exitPointerLock?.());

  navBack.addEventListener("click",    () => onBack?.());
  navForward.addEventListener("click", () => onForward?.());
  navLand.addEventListener("click", () => onNavigate("/"));
  navHome.addEventListener("click", () => onNavigate("/~"));
  navRoot.addEventListener("click", () => {
    if (_addressApi.treeRootPath) onNavigate(_addressApi.treeRootPath);
  });

  _addressApi = {
    chip, input, navBack, navForward, navLand, navHome, navRoot,
    treeRootPath: null,
  };
  return _addressApi;
}

export function setHistoryButtonsEnabled({ back, forward }) {
  if (!_addressApi) return;
  _addressApi.navBack.disabled = !back;
  _addressApi.navForward.disabled = !forward;
}

export function updateAddressBar({ username, landDomain, pathByNames, chain, isAuthenticated }) {
  if (!_addressApi) return;
  const nameEl = document.getElementById("chip-name");
  const landEl = document.getElementById("chip-land");
  if (nameEl) nameEl.textContent = isAuthenticated ? (username || "you") : "arrival";
  if (landEl) landEl.textContent = `@${landDomain || "<land>"}`;
  const land = landDomain || "";
  const path = pathByNames || "/";
  _addressApi.input.value = land ? `${land}${path === "/" ? "/" : path}` : path;

  // Tree root computation: walk the chain past the optional ~user segment.
  let rootPath = null;
  if (Array.isArray(chain) && chain.length) {
    const first = chain[0]?.name || "";
    const idx = first.startsWith("~") ? 1 : 0;
    if (chain.length > idx) {
      const segs = chain.slice(0, idx + 1).map((c) => c.name);
      rootPath = "/" + segs.join("/");
    }
  }
  _addressApi.treeRootPath = rootPath;
  _addressApi.navRoot.disabled = !rootPath;
  _addressApi.navHome.disabled = !isAuthenticated;
}

let _chipExpanded = false;
export function toggleIdentityChip(fullForm) {
  _chipExpanded = !_chipExpanded;
  const nameEl = document.getElementById("chip-name");
  const landEl = document.getElementById("chip-land");
  if (_chipExpanded) {
    if (nameEl) nameEl.textContent = fullForm;
    if (landEl) landEl.textContent = "";
  } else {
    // Caller should call updateAddressBar to restore default.
  }
  return _chipExpanded;
}

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

// Contextual sign-in panel shown when gazing at the auth-being while
// unestablished. Behaves like the logout panel: appears on gaze, hides
// on look-away. The panel persists ONLY while the gaze stays on the
// auth-being; if the gaze leaves, the panel removes itself, but state
// (typed values) is preserved across re-gazes so the user doesn't have
// to restart on a brief glance-away.
let _signInPanelEl = null;
let _signInState = { mode: "claim", username: "", password: "", error: "" };

export function showAuthSignInPanel({ land, onSubmit }) {
  if (_signInPanelEl) return;
  document.exitPointerLock?.();

  const el = document.createElement("div");
  el.className = "auth-signin";
  el.style.cssText = `
    position: fixed; left: 50%; top: 50%;
    transform: translate(-50%, calc(-50% - 60px));
    background: rgba(10, 13, 12, 0.94);
    border: 1px solid #2c3a32; border-radius: 6px;
    padding: 16px 20px; min-width: 280px;
    pointer-events: auto; z-index: 12;
    font-family: ui-monospace, monospace; color: #c8d3cb;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
  `;
  el.innerHTML = `
    <div style="font-size: 11px; color: #6b7d72; margin-bottom: 10px;">
      arrival at ${escapeHtml(land)}
    </div>
    <form>
      <div style="margin-bottom: 8px;">
        <label style="display:block; font-size:10px; color:#6b7d72;
          text-transform:uppercase; letter-spacing:.05em; margin-bottom:3px;">
          username
        </label>
        <input name="username" type="text" autocomplete="username"
          style="width:100%; box-sizing:border-box; padding:5px 8px;
          background:#0a0d0c; color:#c8d3cb; border:1px solid #2c3a32;
          border-radius:3px; font-family:inherit; font-size:12px;" />
      </div>
      <div style="margin-bottom: 10px;">
        <label style="display:block; font-size:10px; color:#6b7d72;
          text-transform:uppercase; letter-spacing:.05em; margin-bottom:3px;">
          password
        </label>
        <input name="password" type="password" autocomplete="current-password"
          style="width:100%; box-sizing:border-box; padding:5px 8px;
          background:#0a0d0c; color:#c8d3cb; border:1px solid #2c3a32;
          border-radius:3px; font-family:inherit; font-size:12px;" />
      </div>
      <button type="submit" class="btn-submit" style="width:100%;
        padding:7px 10px; background:#1a3424; color:#c8d3cb;
        border:1px solid #2f6b48; border-radius:3px;
        font-family:inherit; font-size:12px; cursor:pointer;">
        claim
      </button>
      <button type="button" class="btn-toggle" style="width:100%;
        padding:5px 0; margin-top:4px; background:none; border:none;
        color:#6b7d72; font-family:inherit; font-size:11px; cursor:pointer;">
        or register a new being
      </button>
      <div class="error" style="color:#d97a7a; font-size:11px;
        margin-top:6px; display:none;"></div>
    </form>
  `;
  document.body.appendChild(el);
  _signInPanelEl = el;

  const form = el.querySelector("form");
  const usernameInput = form.querySelector("input[name=username]");
  const passwordInput = form.querySelector("input[name=password]");
  const submitBtn = form.querySelector(".btn-submit");
  const toggleBtn = form.querySelector(".btn-toggle");
  const errBox = form.querySelector(".error");

  // Restore preserved state.
  usernameInput.value = _signInState.username;
  passwordInput.value = _signInState.password;
  submitBtn.textContent = _signInState.mode;
  toggleBtn.textContent = _signInState.mode === "claim"
    ? "or register a new being"
    : "or claim an existing being";
  if (_signInState.error) {
    errBox.style.display = "block";
    errBox.textContent = _signInState.error;
  }
  setTimeout(() => usernameInput.focus(), 30);

  // Persist typed values so look-away/look-back doesn't lose them.
  usernameInput.addEventListener("input", () => { _signInState.username = usernameInput.value; });
  passwordInput.addEventListener("input", () => { _signInState.password = passwordInput.value; });

  toggleBtn.addEventListener("click", () => {
    _signInState.mode = _signInState.mode === "claim" ? "register" : "claim";
    submitBtn.textContent = _signInState.mode;
    toggleBtn.textContent = _signInState.mode === "claim"
      ? "or register a new being"
      : "or claim an existing being";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.style.display = "none";
    _signInState.error = "";
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) return;
    try {
      await onSubmit(_signInState.mode, username, password);
      // Success: clear state so a future arrival starts fresh.
      _signInState = { mode: "claim", username: "", password: "", error: "" };
      hideAuthSignInPanel();
    } catch (err) {
      const msg = `${err.code || "error"}: ${err.message || "sign-in failed"}`;
      _signInState.error = msg;
      errBox.style.display = "block";
      errBox.textContent = msg;
    }
  });
}

export function hideAuthSignInPanel() {
  _signInPanelEl?.remove();
  _signInPanelEl = null;
}

// Small action panel shown when gazing at the auth-being while signed in.
// Persists while the gaze stays on the auth-being; closes when the user
// looks away or the action completes.
let _authActionsEl = null;
export function showAuthActions({ username, onLogout }) {
  if (_authActionsEl) return;
  document.exitPointerLock?.();
  const el = document.createElement("div");
  el.className = "auth-actions";
  el.style.cssText = `
    position: fixed; left: 50%; top: 50%;
    transform: translate(-50%, calc(-50% - 80px));
    background: rgba(10, 13, 12, 0.92);
    border: 1px solid #2c3a32; border-radius: 6px;
    padding: 14px 18px; min-width: 220px;
    pointer-events: auto; z-index: 12;
    font-family: ui-monospace, monospace; color: #c8d3cb;
  `;
  el.innerHTML = `
    <div style="font-size: 11px; color: #6b7d72; margin-bottom: 10px;">
      signed in as ${escapeHtml(username || "you")}
    </div>
    <button class="btn-logout" style="width:100%; padding:6px 10px;
      background:#2a1414; color:#d97a7a;
      border:1px solid #5a2a2a; border-radius:3px;
      font-family:inherit; font-size:12px; cursor:pointer;">
      logout
    </button>
  `;
  el.querySelector(".btn-logout").addEventListener("click", async () => {
    try { await onLogout(); } finally { hideAuthActions(); }
  });
  document.body.appendChild(el);
  _authActionsEl = el;
}

export function hideAuthActions() {
  _authActionsEl?.remove();
  _authActionsEl = null;
}

// Any modal panel currently open. Used to gate gameplay input (WASD/B/N)
// so the user can interact with panels without the camera moving.
export function isAnyPanelOpen() {
  return !!(_signInPanelEl || _authActionsEl);
}

// Bottom-right sky clock. Shows the land's local time (HH:MM in 24h),
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
