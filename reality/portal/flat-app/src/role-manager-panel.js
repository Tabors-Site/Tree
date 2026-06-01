// role-manager-panel.js — the operator's seat for authoring roles
// and roleFlow.
//
// Three sections:
//
//   1. Existing roles — list of every registered role at this reality
//      (seed, extension, and operator-authored "live"). Read-only for
//      now; a future iteration can let operators edit live entries.
//
//   2. Create new role — form that calls DO set-role on @role-manager.
//      The role lands at <reality>/./roles/<name> with origin: "live"
//      and shows up after the next boot's live-role loader.
//
//   3. Author your roleFlow — mad-libs editor for your own being's
//      qualities.roleFlow. Conditions are dropdowns + value inputs;
//      the JSON shape is hidden behind sentence templates:
//
//        WHEN [field] [op] [value]
//        AND  [field] [op] [value]
//        ...
//        THEN use role [role]
//
//      Plus a terminal default ("otherwise, use role [role]"). Save
//      dispatches DO set-being on your own stance with the assembled
//      array; the substrate's reducer projects qualities.roleFlow and
//      the next moment-assign honors it via resolveActiveRole.
//
// All three sections render INSIDE the inspector pane when the user
// inspects @role-manager.

import { flat } from "./main.js";

// ── Condition vocabulary. ─────────────────────────────────────────
// Each field declares its label and how its value should be rendered:
//   { label, type, options?, defaultOp?, defaultValue? }
// type = "select" | "text" | "number" | "bool"
// options = string[] when type === "select"
// defaultOp = which operator to default to for this field
//
// Adding a field here is the only place the UI needs to grow when the
// roleFlow evaluator's vocabulary grows. See
// seed/present/roles/roleFlow.js for the matching set on the server.
const FIELDS = [
  { path: "verb",           label: "the verb",            type: "select", options: ["see", "do", "summon", "be"] },
  { path: "action",         label: "the DO action name",  type: "text"   },
  { path: "operation",      label: "the BE op name",      type: "text"   },
  { path: "intent",         label: "the intent",          type: "text"   },
  { path: "connectedFrom",  label: "the asker's beingId", type: "text"   },
  { path: "caller.role",    label: "the asker's role",    type: "role"   },
  { path: "caller.name",    label: "the asker's name",    type: "text"   },
  { path: "space.id",       label: "this space's id",     type: "text"   },
  { path: "space.name",     label: "this space's name",   type: "text"   },
  { path: "space.type",     label: "this space's type",   type: "text"   },
  { path: "coords.x",       label: "my X coord",          type: "number" },
  { path: "coords.y",       label: "my Y coord",          type: "number" },
  { path: "inHomeSpace",    label: "I am at home",        type: "bool"   },
  { path: "me.cognition",   label: "my cognition",        type: "select", options: ["llm", "human", "scripted"] },
  { path: "me.role",        label: "my default role",     type: "role"   },
  { path: "me.position",    label: "my current position", type: "text"   },
];

const OPS = [
  { value: "eq",    label: "is"           },
  { value: "ne",    label: "is not"       },
  { value: "in",    label: "is one of"    },
  { value: "notIn", label: "is not one of"},
  { value: "gt",    label: ">"            },
  { value: "gte",   label: "≥"            },
  { value: "lt",    label: "<"            },
  { value: "lte",   label: "≤"            },
];

// ────────────────────────────────────────────────────────────────
// Entry point
// ────────────────────────────────────────────────────────────────

export async function renderRoleManagerPanel(insp, _b) {
  insp.innerHTML = "";

  const head = document.createElement("h3");
  head.className = "pane-title";
  head.textContent = "Role Manager";
  insp.appendChild(head);

  const sub = document.createElement("div");
  sub.className = "sub";
  sub.textContent = "Author roles. Compose role flows for your being.";
  insp.appendChild(sub);

  // The panel's surfaces (.tools, .roles, .operations) all live under
  // heaven, which gates SEE by `reigning`. Arrival fails that walk and
  // gets FORBIDDEN. Bail loud rather than silently render an empty
  // panel — the operator wants to know why.
  if (!flat.state.session?.username) {
    const msg = document.createElement("div");
    msg.className = "sub";
    msg.style.marginTop = "8px";
    msg.textContent = "Sign in to use the role manager. The catalogs it reads live under heaven and aren't visible to arrival.";
    insp.appendChild(msg);
    return;
  }

  // Load every catalog the panel needs in parallel. Each fetch
  // degrades to an empty list on failure so one missing surface
  // doesn't break the whole panel. FORBIDDEN responses surface in
  // the per-section status; the panel renders even when partial.
  const [allRoles, allTools, allBeOps] = await Promise.all([
    fetchAllRoles(),
    fetchAllTools(),
    Promise.resolve(KNOWN_BE_OPS),
  ]);
  // DO operations are already loaded into flat.state.operations on
  // boot; surface just the names for the picker.
  const allDoActions = (flat.state.operations || [])
    .map((op) => op.name)
    .filter(Boolean)
    .sort();

  const catalogs = {
    roles:      allRoles.map((r) => r.name).sort(),
    tools:      allTools.sort(),
    doActions:  allDoActions,
    beOps:      allBeOps,
  };

  insp.appendChild(await renderRolesSection(allRoles));
  insp.appendChild(renderCreateRoleSection(catalogs, async () => {
    // Re-render the whole panel after a successful create so every
    // catalog refreshes and the new role appears in role dropdowns.
    renderRoleManagerPanel(insp, _b);
  }));
  insp.appendChild(await renderFlowEditorSection(catalogs.roles.map((n) => ({ name: n }))));
}

// Canonical BE ops the cherub/birther static table exposes. The
// substrate freezes this set in seed/ibp/beOps.js — surfacing it
// over the wire would be overkill; keeping the list inline here keeps
// the picker honest. Bump alongside that file if it ever grows.
const KNOWN_BE_OPS = ["birth", "connect", "release"];

// ────────────────────────────────────────────────────────────────
// Section 1 — Roles list
// ────────────────────────────────────────────────────────────────

async function renderRolesSection(allRoles) {
  const sec = document.createElement("section");
  sec.className = "panel-section rm-section";

  const h4 = document.createElement("h4");
  h4.textContent = `roles · ${allRoles.length}`;
  sec.appendChild(h4);

  if (allRoles.length === 0) {
    const reason = allRoles._fetchReason;
    if (reason === "FORBIDDEN") {
      sec.appendChild(emptyHint(
        "denied: this being can't read /./roles. " +
        "The roles space lives under heaven (only reigning beings see it). " +
        "Sign in as the root operator (or another reigning being) to manage roles.",
      ));
    } else if (reason) {
      sec.appendChild(emptyHint(`load failed: ${reason}`));
    } else {
      sec.appendChild(emptyHint("no roles registered"));
    }
    return sec;
  }

  const list = document.createElement("ul");
  list.className = "rm-roles-list";
  for (const r of allRoles) {
    const li = document.createElement("li");
    li.className = "rm-roles-row";

    const name = document.createElement("span");
    name.className = "rm-role-name";
    name.textContent = r.name;
    li.appendChild(name);

    const meta = document.createElement("span");
    meta.className = "rm-role-meta";
    const bits = [];
    if (r.origin) bits.push(r.origin);
    if (r.requiredCognition) bits.push(`needs ${r.requiredCognition}`);
    if (Array.isArray(r.permissions) && r.permissions.length) bits.push(r.permissions.join("/"));
    meta.textContent = bits.join(" · ");
    li.appendChild(meta);

    list.appendChild(li);
  }
  sec.appendChild(list);
  return sec;
}

// ────────────────────────────────────────────────────────────────
// Section 2 — Create new role
// ────────────────────────────────────────────────────────────────

function renderCreateRoleSection(catalogs, onCreated) {
  const sec = document.createElement("section");
  sec.className = "panel-section rm-section";

  const h4 = document.createElement("h4");
  h4.textContent = "create new role";
  sec.appendChild(h4);

  const form = document.createElement("div");
  form.className = "rm-form";

  // Working state for the four chip-picker fields. We hold the selected
  // list here and the picker mutates it in place; submit reads the
  // arrays directly. Free-form entries (typed but not in the source
  // catalog) are allowed because extensions can introduce names this
  // panel doesn't know about yet.
  const selected = {
    canSee:    [],
    canDo:     [],
    canSummon: [],
    canBe:     [],
  };

  const nameInput        = field("name (kebab-case)",         "text");
  const cognitionSelect  = selectField("required cognition",   ["", "llm", "human", "scripted"]);

  const canSeePicker     = chipPicker({
    label:  "canSee — tools this role can call",
    source: catalogs.tools,
    state:  selected.canSee,
  });
  const canDoPicker      = chipPicker({
    label:  "canDo — DO actions",
    source: catalogs.doActions,
    state:  selected.canDo,
  });
  const canSummonPicker  = chipPicker({
    label:  "canSummon — role shorthands",
    source: catalogs.roles,
    state:  selected.canSummon,
  });
  const canBePicker      = chipPicker({
    label:  "canBe — BE ops",
    source: catalogs.beOps,
    state:  selected.canBe,
  });

  const promptInput      = field("system prompt",              "multiline");

  form.appendChild(nameInput.wrap);
  form.appendChild(cognitionSelect.wrap);
  form.appendChild(canSeePicker.wrap);
  form.appendChild(canDoPicker.wrap);
  form.appendChild(canSummonPicker.wrap);
  form.appendChild(canBePicker.wrap);
  form.appendChild(promptInput.wrap);

  const status = document.createElement("div");
  status.className = "rm-status sub";
  form.appendChild(status);

  const submit = document.createElement("button");
  submit.className = "btn-primary";
  submit.textContent = "create role";
  submit.onclick = async () => {
    submit.disabled = true;
    status.textContent = "saving...";
    try {
      const reality = flat.state.discovery?.reality;
      const stance = `${reality}/@role-manager`;
      // set-role's parseLines accepts arrays directly (seed/present/roles/
      // role-manager/ops.js), so we hand the chip arrays through as-is.
      await flat.doOp(stance, "set-role", {
        name:              nameInput.input.value.trim(),
        requiredCognition: cognitionSelect.input.value || "",
        canSee:            selected.canSee,
        canDo:             selected.canDo,
        canSummon:         selected.canSummon,
        canBe:             selected.canBe,
        prompt:            promptInput.input.value,
      });
      status.textContent = `created — restart to register in memory.`;
      if (typeof onCreated === "function") onCreated();
    } catch (err) {
      status.textContent = `create failed: ${err?.message || err}`;
    } finally {
      submit.disabled = false;
    }
  };
  form.appendChild(submit);

  sec.appendChild(form);
  return sec;
}

// ──────────────────────────────────────────────────────────────
// Chip picker — searchable, addable, x-able
// ──────────────────────────────────────────────────────────────
//
// One field per `canSee/canDo/canSummon/canBe` slot. Each picker:
//
//   - shows the current selection as chips with × to remove
//   - has an input that filters a source catalog as you type
//   - shows matching suggestions in a dropdown; click to add
//   - accepts free-form entries on Enter (so extensions adding new
//     names not yet known to this client still work)
//
// `state` is mutated in place so the surrounding form just reads it
// at submit time.
function chipPicker({ label, source, state }) {
  const wrap = document.createElement("div");
  wrap.className = "rm-field";

  const lbl = document.createElement("label");
  lbl.textContent = label;
  wrap.appendChild(lbl);

  // The container holds chips + input together on one wrap-friendly row.
  const box = document.createElement("div");
  box.className = "rm-chip-box";
  wrap.appendChild(box);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "rm-chip-input";
  input.placeholder = "type to search, Enter to add";

  // Dropdown of suggestions sits below the input.
  const drop = document.createElement("div");
  drop.className = "rm-chip-drop hidden";
  wrap.appendChild(drop);

  function renderChips() {
    // Wipe everything in box except the input. We hold a stable input
    // reference so it doesn't lose focus when chips rerender.
    box.innerHTML = "";
    for (const item of state) {
      const chip = document.createElement("span");
      chip.className = "rm-chip";

      const txt = document.createElement("span");
      txt.textContent = item;
      chip.appendChild(txt);

      const x = document.createElement("button");
      x.type = "button";
      x.className = "rm-chip-x";
      x.textContent = "×";
      x.title = "remove";
      x.onclick = () => {
        const i = state.indexOf(item);
        if (i >= 0) state.splice(i, 1);
        renderChips();
      };
      chip.appendChild(x);
      box.appendChild(chip);
    }
    box.appendChild(input);
  }

  function renderDrop() {
    const q = input.value.trim().toLowerCase();
    // Filter suggestions: prefix match first, then substring, then
    // drop anything already selected.
    const selectedSet = new Set(state);
    const matches = (source || [])
      .filter((s) => !selectedSet.has(s))
      .filter((s) => !q || s.toLowerCase().includes(q));
    drop.innerHTML = "";
    if (!matches.length || !document.activeElement || document.activeElement !== input) {
      drop.classList.add("hidden");
      return;
    }
    drop.classList.remove("hidden");
    for (const s of matches.slice(0, 12)) {
      const opt = document.createElement("div");
      opt.className = "rm-chip-drop-item";
      opt.textContent = s;
      opt.onmousedown = (ev) => {
        // mousedown beats input's blur so the click registers before
        // the dropdown collapses.
        ev.preventDefault();
        addItem(s);
      };
      drop.appendChild(opt);
    }
    if (q && !(source || []).some((s) => s.toLowerCase() === q)) {
      const note = document.createElement("div");
      note.className = "rm-chip-drop-hint";
      note.textContent = `press Enter to add "${input.value.trim()}"`;
      drop.appendChild(note);
    }
  }

  function addItem(name) {
    const v = String(name || "").trim();
    if (!v) return;
    if (state.includes(v)) return;
    state.push(v);
    input.value = "";
    renderChips();
    renderDrop();
    input.focus();
  }

  input.oninput = renderDrop;
  input.onfocus = renderDrop;
  input.onblur  = () => {
    // Defer so a mousedown on a suggestion still resolves.
    setTimeout(() => drop.classList.add("hidden"), 120);
  };
  input.onkeydown = (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      // Enter prefers an exact catalog match if one exists, falls
      // through to whatever the user typed.
      const q = input.value.trim();
      const exact = (source || []).find((s) => s.toLowerCase() === q.toLowerCase());
      addItem(exact || q);
    } else if (ev.key === "Backspace" && input.value === "" && state.length) {
      // Backspace on empty input drops the last chip.
      state.pop();
      renderChips();
      renderDrop();
    }
  };

  renderChips();
  return { wrap, state };
}

// ────────────────────────────────────────────────────────────────
// Section 3 — Author your roleFlow (mad-libs)
// ────────────────────────────────────────────────────────────────

async function renderFlowEditorSection(allRoles) {
  const sec = document.createElement("section");
  sec.className = "panel-section rm-section";

  const h4 = document.createElement("h4");
  h4.textContent = "your role flow";
  sec.appendChild(h4);

  const hint = document.createElement("div");
  hint.className = "sub";
  hint.textContent = "First clause whose conditions all match wins. Last clause runs when nothing else matches.";
  sec.appendChild(hint);

  // Load current flow from the user's own being. SEE on the user's
  // stance returns desc.beings[] containing the user with their
  // qualities. roleFlow lives at qualities.roleFlow on the being.
  const flow = await loadFlowForSelf();
  // Working copy — edits stay in memory until "save".
  const draft = Array.isArray(flow) ? deepCopy(flow) : [];

  const list = document.createElement("ol");
  list.className = "rm-clauses";
  sec.appendChild(list);

  function rerender() {
    list.innerHTML = "";
    draft.forEach((clause, idx) => {
      list.appendChild(renderClause(clause, idx, draft, allRoles, () => rerender()));
    });
    list.appendChild(renderDefaultRow(draft, allRoles, () => rerender()));
  }
  rerender();

  // ── Add clause + save row
  const actions = document.createElement("div");
  actions.className = "rm-flow-actions";

  const addClauseBtn = document.createElement("button");
  addClauseBtn.className = "btn-sm";
  addClauseBtn.textContent = "+ when…";
  addClauseBtn.onclick = () => {
    // Add a new clause BEFORE the terminal default. The default is the
    // last clause with no `when`; everything else goes above it.
    const insertAt = draft.findIndex((c) => !c.when);
    const newClause = { when: { [FIELDS[0].path]: "" }, role: allRoles[0]?.name || "" };
    if (insertAt >= 0) draft.splice(insertAt, 0, newClause);
    else               draft.push(newClause);
    rerender();
  };
  actions.appendChild(addClauseBtn);

  const status = document.createElement("span");
  status.className = "rm-status sub";
  actions.appendChild(status);

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn-primary";
  saveBtn.textContent = "save flow";
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    status.textContent = "saving...";
    try {
      const reality = flat.state.discovery?.reality;
      const me = flat.state.session?.username;
      if (!me) throw new Error("not signed in");
      // The flow lives on the being's qualities. set-being writes the
      // whole roleFlow array atomically (merge:false) so removals
      // propagate.
      await flat.doOp(`${reality}/@${me}`, "set-being", {
        field: "qualities.roleFlow",
        value: draft,
        merge: false,
      });
      status.textContent = `saved — applies on next moment-assign.`;
    } catch (err) {
      status.textContent = `save failed: ${err?.message || err}`;
    } finally {
      saveBtn.disabled = false;
    }
  };
  actions.appendChild(saveBtn);

  sec.appendChild(actions);
  return sec;
}

// ── Clause row ─────────────────────────────────────────────────

function renderClause(clause, idx, draft, allRoles, onChange) {
  const row = document.createElement("li");
  row.className = "rm-clause";

  // "WHEN" / "AND" prefix for each condition.
  const conditions = Object.keys(clause.when || {});
  if (conditions.length === 0) {
    // Shouldn't happen — add-clause always adds at least one — but
    // defend against manual JSON edits.
    clause.when = { [FIELDS[0].path]: "" };
  }

  Object.keys(clause.when).forEach((path, condIdx) => {
    row.appendChild(renderConditionLine({
      clause,
      path,
      value: clause.when[path],
      prefix: condIdx === 0 ? "WHEN" : "AND",
      allRoles,
      onChange,
    }));
  });

  // "+ AND" button at the bottom of conditions.
  const andBtn = document.createElement("button");
  andBtn.className = "btn-sm rm-and-btn";
  andBtn.textContent = "+ and";
  andBtn.onclick = () => {
    // Pick the first field not already used (or default to first).
    const usedPaths = new Set(Object.keys(clause.when));
    const available = FIELDS.find((f) => !usedPaths.has(f.path)) || FIELDS[0];
    clause.when[available.path] = "";
    onChange();
  };
  row.appendChild(andBtn);

  // THEN ROLE line.
  const thenLine = document.createElement("div");
  thenLine.className = "rm-then-line";
  const thenLabel = document.createElement("span");
  thenLabel.className = "rm-keyword";
  thenLabel.textContent = "THEN use role";
  thenLine.appendChild(thenLabel);

  const roleSelect = document.createElement("select");
  roleSelect.className = "rm-input";
  for (const r of allRoles) {
    const opt = document.createElement("option");
    opt.value = r.name;
    opt.textContent = r.name;
    roleSelect.appendChild(opt);
  }
  roleSelect.value = clause.role || "";
  roleSelect.onchange = () => {
    clause.role = roleSelect.value;
  };
  thenLine.appendChild(roleSelect);

  const removeClauseBtn = document.createElement("button");
  removeClauseBtn.className = "btn-sm rm-danger";
  removeClauseBtn.textContent = "remove clause";
  removeClauseBtn.onclick = () => {
    draft.splice(idx, 1);
    onChange();
  };
  thenLine.appendChild(removeClauseBtn);

  row.appendChild(thenLine);
  return row;
}

function renderConditionLine({ clause, path, value, prefix, allRoles, onChange }) {
  const line = document.createElement("div");
  line.className = "rm-condition";

  const kw = document.createElement("span");
  kw.className = "rm-keyword";
  kw.textContent = prefix;
  line.appendChild(kw);

  // Field selector — picks which path in ctx to test.
  const fieldSel = document.createElement("select");
  fieldSel.className = "rm-input";
  for (const f of FIELDS) {
    const opt = document.createElement("option");
    opt.value = f.path;
    opt.textContent = f.label;
    fieldSel.appendChild(opt);
  }
  fieldSel.value = path;
  fieldSel.onchange = () => {
    // Rename the key in clause.when. Preserve operator + value when
    // possible; reset value otherwise.
    const oldKey = path;
    const newKey = fieldSel.value;
    if (oldKey === newKey) return;
    const old = clause.when[oldKey];
    delete clause.when[oldKey];
    clause.when[newKey] = old;
    onChange();
  };
  line.appendChild(fieldSel);

  // Operator + value pair. Stored shape can be a bare value
  // (equality shortcut) or { eq/ne/in/notIn/gt/gte/lt/lte: x }.
  // Display: split into op + value.
  const fieldSpec = FIELDS.find((f) => f.path === path) || FIELDS[0];
  const { op, raw } = unpackOperand(value);

  const opSel = document.createElement("select");
  opSel.className = "rm-input rm-op";
  for (const o of OPS) {
    const opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    opSel.appendChild(opt);
  }
  opSel.value = op;
  opSel.onchange = () => {
    clause.when[path] = packOperand(opSel.value, raw, fieldSpec);
    onChange();
  };
  line.appendChild(opSel);

  // Value input — typed per field. For "is one of" / "is not one of",
  // input is a comma-separated list.
  const valInput = renderValueInput(fieldSpec, opSel.value, raw, allRoles, (next) => {
    clause.when[path] = packOperand(opSel.value, next, fieldSpec);
  });
  line.appendChild(valInput);

  // Remove condition button.
  const rm = document.createElement("button");
  rm.className = "btn-sm rm-danger";
  rm.textContent = "×";
  rm.title = "remove this condition";
  rm.onclick = () => {
    delete clause.when[path];
    // Don't leave an empty when{}: callers expect at least one condition
    // per clause, otherwise the clause becomes a default. Insert a
    // placeholder field if the user removed the last condition.
    if (Object.keys(clause.when).length === 0) {
      clause.when[FIELDS[0].path] = "";
    }
    onChange();
  };
  line.appendChild(rm);

  return line;
}

function renderValueInput(fieldSpec, op, raw, allRoles, onUpdate) {
  // For list operators we render a free-text input the user types
  // a comma-separated list into.
  const isList = (op === "in" || op === "notIn");
  if (isList) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "rm-input rm-value";
    input.placeholder = "comma-separated";
    input.value = Array.isArray(raw) ? raw.join(", ") : String(raw || "");
    input.oninput = () => {
      const parts = input.value.split(",").map((s) => s.trim()).filter(Boolean);
      onUpdate(parts);
    };
    return input;
  }

  switch (fieldSpec.type) {
    case "select": {
      const sel = document.createElement("select");
      sel.className = "rm-input rm-value";
      for (const v of fieldSpec.options || []) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        sel.appendChild(opt);
      }
      sel.value = raw ?? "";
      sel.onchange = () => onUpdate(sel.value);
      return sel;
    }
    case "role": {
      const sel = document.createElement("select");
      sel.className = "rm-input rm-value";
      for (const r of allRoles) {
        const opt = document.createElement("option");
        opt.value = r.name;
        opt.textContent = r.name;
        sel.appendChild(opt);
      }
      sel.value = raw ?? "";
      sel.onchange = () => onUpdate(sel.value);
      return sel;
    }
    case "bool": {
      const sel = document.createElement("select");
      sel.className = "rm-input rm-value";
      for (const v of ["true", "false"]) {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v;
        sel.appendChild(opt);
      }
      sel.value = raw === true || raw === "true" ? "true" : "false";
      sel.onchange = () => onUpdate(sel.value === "true");
      return sel;
    }
    case "number": {
      const inp = document.createElement("input");
      inp.type = "number";
      inp.className = "rm-input rm-value";
      inp.value = raw ?? "";
      inp.oninput = () => onUpdate(inp.value === "" ? "" : Number(inp.value));
      return inp;
    }
    case "text":
    default: {
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "rm-input rm-value";
      inp.value = raw ?? "";
      inp.oninput = () => onUpdate(inp.value);
      return inp;
    }
  }
}

// ── Default (terminal) row ─────────────────────────────────────

function renderDefaultRow(draft, allRoles, onChange) {
  // The terminal default is a clause with no `when` and just `role`.
  let defaultClause = draft.find((c) => !c.when || Object.keys(c.when).length === 0);
  if (!defaultClause) {
    defaultClause = { role: "" };
    draft.push(defaultClause);
  }

  const row = document.createElement("li");
  row.className = "rm-default";

  const label = document.createElement("span");
  label.className = "rm-keyword";
  label.textContent = "OTHERWISE use role";
  row.appendChild(label);

  const sel = document.createElement("select");
  sel.className = "rm-input";
  // First option is empty so the user can clear the default.
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "(unset — fall back to defaultRole)";
  sel.appendChild(blank);
  for (const r of allRoles) {
    const opt = document.createElement("option");
    opt.value = r.name;
    opt.textContent = r.name;
    sel.appendChild(opt);
  }
  sel.value = defaultClause.role || "";
  sel.onchange = () => {
    defaultClause.role = sel.value;
    if (!sel.value) {
      // Empty default → remove the clause so the substrate falls back
      // to Being.defaultRole.
      const i = draft.indexOf(defaultClause);
      if (i >= 0) draft.splice(i, 1);
      onChange();
    }
  };
  row.appendChild(sel);

  return row;
}

// ────────────────────────────────────────────────────────────────
// Data loaders
// ────────────────────────────────────────────────────────────────

// Catalog fetches share one error shape so the panel can render
// "denied / failed / empty" distinctly. heaven-scoped reads
// (`.roles`, `.tools`) return FORBIDDEN for any caller that isn't
// reigning; we want that to surface rather than silently empty.
async function fetchCatalog(seedSpace, project) {
  const reality = flat.state.discovery?.reality;
  if (!reality) return { ok: false, reason: "no-reality", items: [] };
  try {
    const desc = await flat.state.client.see(`${reality}/./${seedSpace}`);
    const children = Array.isArray(desc.children) ? desc.children : [];
    return { ok: true, items: children.map(project).filter(Boolean) };
  } catch (err) {
    const code = err?.code || "ERR";
    return { ok: false, reason: code, items: [], message: err?.message || String(err) };
  }
}

async function fetchAllRoles() {
  // Roles are mirrored under <reality>/./roles/<name> with
  // qualities.role containing the spec. syncRolesToSubstrate writes
  // every registered role (seed, extension, live) at boot, so this
  // SEE is the canonical "give me every role" surface.
  const res = await fetchCatalog("roles", (c) => {
    const r = c.qualities?.role || {};
    return {
      name:              c.name,
      origin:            r.origin || null,
      requiredCognition: r.requiredCognition || null,
      permissions:       Array.isArray(r.permissions) ? r.permissions : [],
    };
  });
  // Stash the reason on the array so the rendering section can show
  // a denied/failed badge inline. Arrays propagate cleanly through the
  // existing renderers; the extra prop is invisible to consumers that
  // don't look for it.
  res.items._fetchReason = res.ok ? null : res.reason;
  return res.items;
}

async function fetchAllTools() {
  // Tools are mirrored under <reality>/./tools/<name> by
  // syncToolsToSubstrate at boot. Each child is one tool; the name
  // alone is what canSee wants.
  const res = await fetchCatalog("tools", (c) => c.name);
  res.items._fetchReason = res.ok ? null : res.reason;
  return res.items;
}

async function loadFlowForSelf() {
  const reality = flat.state.discovery?.reality;
  const me      = flat.state.session?.username;
  if (!reality || !me) return [];
  try {
    // SEE @self resolves to the user's home space. The user shows up
    // in desc.beings if physically present, otherwise in desc.residents
    // (their home registration). Either entry carries qualities (the
    // descriptor's enrichBeings folds the being row).
    const desc = await flat.state.client.see(`${reality}/@${me}`);
    const myId = desc.identity?.beingId || null;
    const pool = [].concat(desc.beings || [], desc.residents || []);
    const mine = (myId && pool.find((b) => String(b.beingId) === String(myId)))
              || pool.find((b) => b.being === me || b.name === me);
    const rf = mine?.qualities?.roleFlow;
    return Array.isArray(rf) ? rf : [];
  } catch {
    return [];
  }
}

// ────────────────────────────────────────────────────────────────
// Pack / unpack operand shape
// ────────────────────────────────────────────────────────────────

// The substrate's evalWhen accepts either a bare value (equality shorthand)
// or an operator object `{ eq/ne/in/notIn/gt/gte/lt/lte: x }`. The UI
// keeps an explicit op + raw value in editor state and converts at the
// boundary.

function unpackOperand(stored) {
  if (stored === null || stored === undefined) return { op: "eq", raw: "" };
  if (typeof stored !== "object" || Array.isArray(stored)) {
    return { op: "eq", raw: stored };
  }
  const keys = Object.keys(stored);
  for (const k of keys) {
    if (OPS.find((o) => o.value === k)) {
      return { op: k, raw: stored[k] };
    }
  }
  // Object value with no recognized op key — treat as bare equality.
  return { op: "eq", raw: stored };
}

function packOperand(op, raw, _fieldSpec) {
  if (op === "eq") return raw;
  return { [op]: raw };
}

// ────────────────────────────────────────────────────────────────
// Small DOM helpers
// ────────────────────────────────────────────────────────────────

function emptyHint(msg) {
  const div = document.createElement("div");
  div.className = "sub";
  div.textContent = msg;
  return div;
}

function field(labelText, kind) {
  const wrap = document.createElement("div");
  wrap.className = "rm-field";
  const lbl = document.createElement("label");
  lbl.textContent = labelText;
  wrap.appendChild(lbl);
  let input;
  if (kind === "multiline") {
    input = document.createElement("textarea");
    input.rows = 3;
  } else {
    input = document.createElement("input");
    input.type = kind;
  }
  input.className = "rm-input";
  wrap.appendChild(input);
  return { wrap, input };
}

function selectField(labelText, options) {
  const wrap = document.createElement("div");
  wrap.className = "rm-field";
  const lbl = document.createElement("label");
  lbl.textContent = labelText;
  wrap.appendChild(lbl);
  const input = document.createElement("select");
  input.className = "rm-input";
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o;
    opt.textContent = o || "(none)";
    input.appendChild(opt);
  }
  wrap.appendChild(input);
  return { wrap, input };
}

function setStatusInPanel(insp, msg) {
  const status = insp.querySelector(".rm-status");
  if (status) status.textContent = msg;
}

function deepCopy(o) {
  return JSON.parse(JSON.stringify(o));
}
