// identity.js — claim / register UI.
//
// Renders a small overlay with two tabs: claim (existing name + password)
// and register (new name + password). Wires up to BE via main.js#signIn.
// Overlay is shown by main.js when the descriptor's identity is missing,
// or by the identity chip on click.

import { flat } from "./host.js";

let _overlayMounted = false;

export function showAuthOverlay(reality) {
  const root = document.getElementById("auth-overlay");
  if (!root) return;
  root.classList.remove("hidden");
  root.innerHTML = ""; // re-render each time

  const card = document.createElement("div");
  card.className = "auth-card";

  const h = document.createElement("h2");
  h.textContent = "claim an identity";
  card.appendChild(h);

  const sub = document.createElement("div");
  sub.className = "sub";
  sub.textContent = `on ${reality}`;
  card.appendChild(sub);

  // Tabs.
  const tabs = document.createElement("div");
  tabs.className = "tabs";
  const claimTab    = tabBtn("claim",    true);
  const registerTab = tabBtn("register", false);
  tabs.appendChild(claimTab);
  tabs.appendChild(registerTab);
  card.appendChild(tabs);

  // Form fields.
  const nameField = field("name", "input");
  const passField = field("password", "input", "password");
  card.appendChild(nameField.wrap);
  card.appendChild(passField.wrap);

  // Register-only: import an existing identity. The exported key (the
  // PEM, or the 24-word paper phrase) births the being WITH that
  // identity — recovery, or moving yourself onto a reality you
  // control. Leave empty for a fresh keypair.
  const importWrap = document.createElement("div");
  importWrap.className = "field hidden";
  const importLabel = document.createElement("label");
  importLabel.textContent = "import key (optional)";
  const importInput = document.createElement("textarea");
  importInput.placeholder = "24-word recovery phrase, or the exported key PEM — empty mints a fresh identity";
  importInput.rows = 2;
  importInput.style.width = "100%";
  importInput.style.boxSizing = "border-box";
  importWrap.appendChild(importLabel);
  importWrap.appendChild(importInput);
  card.appendChild(importWrap);

  const submit = document.createElement("button");
  submit.className = "btn-primary btn-block";
  submit.textContent = "claim";
  card.appendChild(submit);

  const err = document.createElement("div");
  err.className = "auth-err hidden";
  card.appendChild(err);

  const cherub = document.createElement("button");
  cherub.className = "btn-link";
  cherub.textContent = "claim as @cherub (no password)";
  cherub.title = "ad-hoc test identity";
  card.appendChild(cherub);

  // BE op names: "connect" (binds to existing) or "birth" (mints new).
  // The UI labels stay user-friendly . decoupled from the underlying op.
  let mode = "connect";
  claimTab.onclick = () => {
    mode = "connect";
    setActive(claimTab, registerTab);
    submit.textContent = "connect";
    importWrap.classList.add("hidden");
  };
  registerTab.onclick = () => {
    mode = "birth";
    setActive(registerTab, claimTab);
    submit.textContent = "register";
    importWrap.classList.remove("hidden");
  };

  submit.onclick = async () => {
    err.classList.add("hidden");
    const name = nameField.input.value.trim();
    const pass = passField.input.value;
    if (!name) { showErr(err, "name required"); return; }
    try {
      submit.disabled = true;
      submit.textContent = mode === "connect" ? "connecting..." : "registering...";
      const importKey = mode === "birth" ? importInput.value.trim() : "";
      await flat.signIn(mode, name, pass, importKey ? { importKey } : {});
    } catch (e) {
      showErr(err, `${e.code || "error"}: ${e.message || "sign-in failed"}`);
      submit.disabled = false;
      submit.textContent = mode === "connect" ? "connect" : "register";
    }
  };

  cherub.onclick = async () => {
    err.classList.add("hidden");
    try {
      cherub.disabled = true;
      await flat.signIn("connect", "cherub", "");
    } catch (e) {
      showErr(err, `${e.code || "error"}: ${e.message || "cherub connect failed"}`);
      cherub.disabled = false;
    }
  };

  root.appendChild(card);
  _overlayMounted = true;

  // Close on background click.
  root.onclick = (ev) => { if (ev.target === root) hideAuthOverlay(); };
  // Focus the name field.
  setTimeout(() => nameField.input.focus(), 10);
}

export function hideAuthOverlay() {
  const root = document.getElementById("auth-overlay");
  if (!root) return;
  root.classList.add("hidden");
  root.innerHTML = "";
  _overlayMounted = false;
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

function tabBtn(label, active) {
  const b = document.createElement("button");
  b.className = "tab" + (active ? " active" : "");
  b.textContent = label;
  return b;
}

function setActive(on, off) {
  on.classList.add("active");
  off.classList.remove("active");
}

function field(label, kind, type = "text") {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const l = document.createElement("label");
  l.textContent = label;
  const input = document.createElement(kind);
  input.type = type;
  wrap.appendChild(l);
  wrap.appendChild(input);
  return { wrap, input };
}

function showErr(el, msg) {
  el.textContent = msg;
  el.classList.remove("hidden");
}
