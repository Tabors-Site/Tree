import "../styles/action-renderer.css";

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
        const v = input.value;
        // An OPTIONAL field left blank is OMITTED, not sent as "". The server reads
        // absent as "no value" (an optional password → keypair-only); a literal ""
        // trips length/required checks. Required fields always send their value.
        values[name] = (!schema.required && v === "") ? undefined : v;
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
