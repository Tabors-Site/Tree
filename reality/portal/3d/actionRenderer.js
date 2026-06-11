// actionRenderer.js . the generic action-menu + arg-schema form renderer.
//
// Every being whose descriptor carries `actions[]` is rendered through
// this one path . click the being, see a menu of its actions, pick
// one, fill the schema-driven form, submit. The portal stays
// substrate-blind: it doesn't know what cherub is or what claim does;
// it just reads the descriptor's actions and renders them.
//
// Shape of an action entry from the server:
//
//   {
//     verb:        "be" | "do" | "summon",
//     action:      "<op-name>",
//     label:       "Register" | "Log in" | ...,
//     description: "...",
//     args:        { <field>: { type, label, required, default, minLength } },
//     bootstrap:   boolean   // server-side hint; portal ignores
//   }
//
// Supported field types: text, password, number, select (with enum),
// checkbox, multiline.

let _menuEl = null;
let _formEl = null;
let _stylesInjected = false;

function ensureStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const style = document.createElement("style");
  style.id = "action-renderer-style";
  style.textContent = `
    .act-panel {
      position: fixed; left: 50%; bottom: 80px;
      transform: translateX(-50%);
      min-width: 320px; max-width: 420px;
      background: rgba(10,13,12,0.94);
      color: #c8d3cb;
      border: 1px solid #2c3a32;
      border-radius: 6px;
      box-shadow: 0 8px 28px rgba(0,0,0,0.55);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      padding: 12px;
      z-index: 9;
    }
    .act-header {
      display: flex; align-items: baseline; justify-content: space-between;
      gap: 12px;
      padding-bottom: 8px; margin-bottom: 8px;
      border-bottom: 1px solid #1a2620;
    }
    .act-title {
      color: #c8d3cb; font-weight: 600;
    }
    .act-subtitle {
      color: #6b7d72; font-size: 10px;
    }
    .act-close {
      background: transparent; color: #6b7d72; border: none; cursor: pointer;
      font-family: inherit; font-size: 14px; padding: 0 4px;
    }
    .act-close:hover { color: #c8d3cb; }
    .act-menu { display: flex; flex-direction: column; gap: 6px; }
    .act-menu-item {
      display: block; width: 100%; text-align: left;
      padding: 8px 10px;
      background: #0f1814; color: #c8d3cb;
      border: 1px solid #2c3a32; border-radius: 4px;
      cursor: pointer;
      font-family: inherit; font-size: 12px;
    }
    .act-menu-item:hover { background: #15241c; border-color: #2f6b48; }
    .act-menu-item-label { font-weight: 600; color: #c8d3cb; }
    .act-menu-item-desc {
      display: block; margin-top: 3px;
      color: #6b7d72; font-size: 10px; line-height: 1.4;
    }
    .act-empty { color: #6b7d72; font-style: italic; padding: 8px 0; }
    .act-form { display: flex; flex-direction: column; gap: 10px; }
    .act-form-desc {
      color: #8fbf9f; font-size: 11px; line-height: 1.5;
      margin-bottom: 2px;
    }
    .act-field { display: block; }
    .act-label {
      display: block; font-size: 10px; color: #6b7d72;
      text-transform: uppercase; letter-spacing: 0.05em;
      margin-bottom: 3px;
    }
    .act-input {
      width: 100%; box-sizing: border-box;
      padding: 5px 8px;
      background: #0a0d0c; color: #c8d3cb;
      border: 1px solid #2c3a32; border-radius: 3px;
      font-family: inherit; font-size: 11px;
    }
    .act-input:focus { outline: none; border-color: #2f6b48; }
    .act-multiline { min-height: 60px; resize: vertical; }
    .act-actions { display: flex; gap: 6px; padding-top: 4px; }
    .act-btn-primary {
      flex: 1; padding: 7px 10px;
      background: #1a3424; color: #c8d3cb;
      border: 1px solid #2f6b48; border-radius: 3px;
      font-family: inherit; font-size: 12px; cursor: pointer;
    }
    .act-btn-primary:hover { background: #1f3e2b; }
    .act-btn-primary:disabled { opacity: 0.55; cursor: default; }
    .act-btn-ghost {
      flex: 1; padding: 7px 10px;
      background: transparent; color: #6b7d72;
      border: 1px solid #2c3a32; border-radius: 3px;
      font-family: inherit; font-size: 12px; cursor: pointer;
    }
    .act-btn-ghost:hover { color: #c8d3cb; }
    .act-error {
      color: #d97a7a; font-size: 11px; line-height: 1.4;
      padding: 6px 8px;
      background: rgba(217,122,122,0.07);
      border: 1px solid rgba(217,122,122,0.25);
      border-radius: 3px;
    }
  `;
  document.head.appendChild(style);
}

function panelEl() {
  const el = document.createElement("div");
  el.className = "act-panel";
  return el;
}

function headerEl(title, subtitle, onClose) {
  const head = document.createElement("div");
  head.className = "act-header";
  const left = document.createElement("div");
  const t = document.createElement("div");
  t.className = "act-title";
  t.textContent = title;
  left.appendChild(t);
  if (subtitle) {
    const sub = document.createElement("div");
    sub.className = "act-subtitle";
    sub.textContent = subtitle;
    left.appendChild(sub);
  }
  head.appendChild(left);
  if (onClose) {
    const close = document.createElement("button");
    close.className = "act-close";
    close.type = "button";
    close.textContent = "×";
    close.title = "close";
    close.onclick = onClose;
    head.appendChild(close);
  }
  return head;
}

function clearPanels() {
  if (_menuEl) { _menuEl.remove(); _menuEl = null; }
  if (_formEl) { _formEl.remove(); _formEl = null; }
}

/**
 * Show a menu of a being's actions. `being` is a descriptor entry with
 * `being` (name) and `actions[]`. Click an action → onActionPicked(action).
 */
export function showActionMenu(being, { onActionPicked, onClose } = {}) {
  ensureStyles();
  clearPanels();

  const el = panelEl();
  const title = `@${being.being || being.name || "?"}`;
  const subtitle = being.actions?.length
    ? `${being.actions.length} action${being.actions.length === 1 ? "" : "s"}`
    : "no actions";
  el.appendChild(headerEl(title, subtitle, () => {
    clearPanels();
    if (onClose) onClose();
  }));

  const menu = document.createElement("div");
  menu.className = "act-menu";

  if (!Array.isArray(being.actions) || being.actions.length === 0) {
    const empty = document.createElement("div");
    empty.className = "act-empty";
    empty.textContent = "this being exposes no actions";
    menu.appendChild(empty);
  } else {
    for (const action of being.actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "act-menu-item";
      const lbl = document.createElement("div");
      lbl.className = "act-menu-item-label";
      lbl.textContent = action.label || action.action;
      btn.appendChild(lbl);
      if (action.description) {
        const desc = document.createElement("div");
        desc.className = "act-menu-item-desc";
        desc.textContent = action.description;
        btn.appendChild(desc);
      }
      btn.onclick = () => {
        if (onActionPicked) onActionPicked(action);
      };
      menu.appendChild(btn);
    }
  }

  el.appendChild(menu);
  document.body.appendChild(el);
  _menuEl = el;
}

/**
 * Show a form for one action. Builds inputs from `action.args` schema;
 * submit collects values → onSubmit(values). onCancel restores the
 * caller's state (typically: show the menu again).
 */
export function showActionForm(action, { onSubmit, onCancel, busy = false, error = null } = {}) {
  ensureStyles();
  clearPanels();

  const el = panelEl();
  el.appendChild(headerEl(
    action.label || action.action,
    `verb: ${(action.verb || "?").toUpperCase()}`,
    () => {
      clearPanels();
      if (onCancel) onCancel();
    },
  ));

  const form = document.createElement("form");
  form.className = "act-form";

  if (action.description) {
    const desc = document.createElement("div");
    desc.className = "act-form-desc";
    desc.textContent = action.description;
    form.appendChild(desc);
  }

  const inputs = new Map();
  const args = action.args || {};
  const fieldNames = Object.keys(args);
  for (const name of fieldNames) {
    const schema = args[name] || {};
    const wrap = document.createElement("div");
    wrap.className = "act-field";
    const lbl = document.createElement("label");
    lbl.className = "act-label";
    lbl.textContent = schema.label || name;
    if (schema.required) lbl.textContent += " *";
    wrap.appendChild(lbl);

    let input;
    switch (schema.type) {
      case "multiline":
        input = document.createElement("textarea");
        input.className = "act-input act-multiline";
        break;
      case "select":
        input = document.createElement("select");
        input.className = "act-input";
        if (Array.isArray(schema.enum)) {
          for (const v of schema.enum) {
            const opt = document.createElement("option");
            opt.value = v;
            opt.textContent = v;
            input.appendChild(opt);
          }
        }
        break;
      case "checkbox":
        input = document.createElement("input");
        input.type = "checkbox";
        input.className = "act-input";
        input.style.width = "auto";
        break;
      case "number":
        input = document.createElement("input");
        input.type = "number";
        input.className = "act-input";
        break;
      case "password":
        input = document.createElement("input");
        input.type = "password";
        input.className = "act-input";
        break;
      case "text":
      default:
        input = document.createElement("input");
        input.type = "text";
        input.className = "act-input";
        break;
    }
    input.name = name;
    if (schema.default !== undefined) {
      if (schema.type === "checkbox") input.checked = !!schema.default;
      else input.value = String(schema.default);
    }
    if (schema.required) input.required = true;
    if (busy) input.disabled = true;
    inputs.set(name, { input, schema });
    wrap.appendChild(input);
    form.appendChild(wrap);
  }

  if (error) {
    const errEl = document.createElement("div");
    errEl.className = "act-error";
    errEl.textContent = typeof error === "string" ? error : (error?.message || "error");
    form.appendChild(errEl);
  }

  const actions = document.createElement("div");
  actions.className = "act-actions";

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "act-btn-primary";
  submit.textContent = busy ? "…" : (action.label || action.action);
  submit.disabled = busy;
  actions.appendChild(submit);

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "act-btn-ghost";
  cancel.textContent = "back";
  cancel.onclick = (e) => {
    e.preventDefault();
    if (onCancel) onCancel();
  };
  actions.appendChild(cancel);

  form.appendChild(actions);

  form.onsubmit = (e) => {
    e.preventDefault();
    if (busy || !onSubmit) return;
    const values = {};
    for (const [name, { input, schema }] of inputs) {
      if (schema.type === "checkbox") values[name] = !!input.checked;
      else if (schema.type === "number") {
        const n = Number(input.value);
        values[name] = Number.isFinite(n) ? n : undefined;
      } else {
        values[name] = input.value;
      }
    }
    onSubmit(values);
  };

  el.appendChild(form);
  document.body.appendChild(el);
  _formEl = el;

  // Focus first field for keyboard flow.
  const first = form.querySelector("input, select, textarea");
  if (first) first.focus();
}

/**
 * Force-close any open action panel (menu or form). Used when the
 * user navigates away from the being's proximity.
 */
export function hideActionPanel() {
  clearPanels();
}

export function isActionPanelOpen() {
  return !!(_menuEl || _formEl);
}
