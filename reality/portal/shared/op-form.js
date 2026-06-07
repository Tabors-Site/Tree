// op-form.js — generic schema-driven form for a DO operation.
//
// Reads an op's `args` field schema (the seed convention:
//   { <fieldName>: { type, label, required?, enum?, default?, placeholder?, description? } }
// where type ∈ text | password | number | select | multiline | bool | json)
// and renders a clean labeled form, PREFILLING each control from `values`
// when editing so the user sees what's already there. When an op declares
// no schema it falls back to a single JSON box, so every op stays callable.
//
// Decoupled from any client: the caller passes a `doOp(address, name, args)`
// function (e.g. the portal's flat.doOp) and an optional onResult callback.
// Styling rides on class names defined in the flat portal's style.css.

export function renderOpForm(
  container,
  { op, values = {}, address, doOp, onResult, submitLabel } = {},
) {
  if (!container) throw new Error("renderOpForm: container is required");
  if (!op || !op.name) throw new Error("renderOpForm: op with a name is required");
  container.innerHTML = "";

  const args = op.args && typeof op.args === "object" ? op.args : null;
  const fieldNames = args ? Object.keys(args) : [];

  const form = document.createElement("form");
  form.className = "op-form";

  const head = document.createElement("div");
  head.className = "op-form-head";
  const title = document.createElement("code");
  title.className = "op-form-name";
  title.textContent = op.name;
  title.title = `targets: ${(op.targets || []).join(", ") || "?"} • from ${op.ownerExtension || "seed"}`;
  head.appendChild(title);
  form.appendChild(head);

  // control registry: fieldName -> { input, descriptor }
  const controls = {};
  let jsonFallback = null;

  if (!args) {
    // No schema declared — single freeform JSON box.
    const wrap = document.createElement("div");
    wrap.className = "op-field";
    const lbl = document.createElement("label");
    lbl.textContent = "args (JSON)";
    const ta = document.createElement("textarea");
    ta.className = "op-input op-input-json";
    ta.rows = 4;
    ta.placeholder = "{ }";
    if (values && Object.keys(values).length) {
      ta.value = safeStringify(values);
    }
    wrap.appendChild(lbl);
    wrap.appendChild(ta);
    form.appendChild(wrap);
    jsonFallback = ta;
  } else if (fieldNames.length === 0) {
    // Empty schema {} — a confirm-only op (end-space, remove-owner, …).
    const note = document.createElement("p");
    note.className = "op-form-note dim";
    note.textContent = "No inputs — run this action?";
    form.appendChild(note);
  } else {
    for (const name of fieldNames) {
      const d = args[name] || {};
      const { wrap, input } = renderField(name, d, pick(values, name));
      controls[name] = { input, descriptor: d };
      form.appendChild(wrap);
    }
  }

  const actions = document.createElement("div");
  actions.className = "op-form-actions";
  const btn = document.createElement("button");
  btn.type = "submit";
  btn.className = "btn-sm btn-primary";
  btn.textContent = submitLabel || "run";
  actions.appendChild(btn);
  form.appendChild(actions);

  const result = document.createElement("div");
  result.className = "action-result hidden";
  form.appendChild(result);

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    let payload;
    try {
      payload = jsonFallback
        ? collectFreeform(jsonFallback)
        : collectSchema(args, controls);
    } catch (e) {
      showResult(result, e.message, "err");
      return;
    }
    showResult(result, "…", "pending");
    btn.disabled = true;
    try {
      const r = await doOp(address, op.name, payload);
      showResult(result, safeStringify(r), "ok");
      if (typeof onResult === "function") onResult(null, r, payload);
    } catch (err) {
      showResult(result, `${err?.code || "error"}: ${err?.message || String(err)}`, "err");
      if (typeof onResult === "function") onResult(err, null, payload);
    } finally {
      btn.disabled = false;
    }
  };

  container.appendChild(form);
  return form;
}

// ── field rendering ────────────────────────────────────────────────

function renderField(name, d, value) {
  const wrap = document.createElement("div");
  wrap.className = "op-field";

  const lbl = document.createElement("label");
  lbl.textContent = d.label || name;
  if (d.required) {
    const star = document.createElement("span");
    star.className = "op-required";
    star.textContent = " *";
    lbl.appendChild(star);
  }
  wrap.appendChild(lbl);

  const type = d.type || "text";
  let input;

  if (type === "select") {
    input = document.createElement("select");
    input.className = "op-input";
    for (const opt of Array.isArray(d.enum) ? d.enum : []) {
      const o = document.createElement("option");
      o.value = String(opt);
      o.textContent = opt === "" ? "(none)" : String(opt);
      input.appendChild(o);
    }
    const chosen = value != null ? value : d.default;
    if (chosen != null) input.value = String(chosen);
  } else if (type === "multiline") {
    input = document.createElement("textarea");
    input.className = "op-input";
    input.rows = 3;
    if (value != null) input.value = asText(value);
    else if (d.default != null) input.value = asText(d.default);
  } else if (type === "json") {
    input = document.createElement("textarea");
    input.className = "op-input op-input-json";
    input.rows = 3;
    if (value != null) input.value = safeStringify(value);
    else if (d.default != null) input.value = safeStringify(d.default);
  } else if (type === "bool") {
    input = document.createElement("input");
    input.type = "checkbox";
    input.className = "op-input op-input-bool";
    const on = value != null ? !!value : !!d.default;
    input.checked = on;
  } else {
    input = document.createElement("input");
    input.type = type === "password" ? "password" : type === "number" ? "number" : "text";
    input.className = "op-input";
    if (value != null) input.value = asText(value);
    else if (d.default != null) input.value = asText(d.default);
  }

  if (d.placeholder && input.tagName !== "SELECT" && type !== "bool") {
    input.placeholder = d.placeholder;
  }
  wrap.appendChild(input);

  if (d.description) {
    const hint = document.createElement("div");
    hint.className = "op-field-hint dim";
    hint.textContent = d.description;
    wrap.appendChild(hint);
  }

  return { wrap, input };
}

// ── value collection / coercion ────────────────────────────────────

function collectFreeform(textarea) {
  const raw = textarea.value.trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`args JSON parse error: ${e.message}`);
  }
}

function collectSchema(args, controls) {
  const out = {};
  for (const name of Object.keys(args)) {
    const d = args[name] || {};
    const ctl = controls[name];
    if (!ctl) continue;
    const type = d.type || "text";
    const el = ctl.input;

    if (type === "bool") {
      out[name] = !!el.checked;
      continue;
    }

    const raw = el.value != null ? String(el.value) : "";
    const trimmed = raw.trim();

    if (trimmed === "") {
      if (d.required) throw new Error(`${d.label || name} is required`);
      continue; // omit empty optional fields
    }

    if (type === "number") {
      const n = Number(trimmed);
      if (Number.isNaN(n)) throw new Error(`${d.label || name} must be a number`);
      out[name] = n;
    } else if (type === "json") {
      try {
        out[name] = JSON.parse(trimmed);
      } catch (e) {
        throw new Error(`${d.label || name}: invalid JSON (${e.message})`);
      }
    } else {
      // text / password / multiline / select — keep the raw string;
      // handlers parse line-lists and the like themselves.
      out[name] = raw;
    }
  }
  return out;
}

// ── small helpers ──────────────────────────────────────────────────

function pick(values, name) {
  if (!values || typeof values !== "object") return undefined;
  return values[name];
}

function asText(v) {
  return typeof v === "string" ? v : String(v);
}

function safeStringify(v) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function showResult(el, text, kind) {
  el.className = `action-result action-${kind}`;
  el.classList.remove("hidden");
  el.textContent = text;
}
