import "../styles/role-manager-panel.css";

// role-manager-panel.js — the operator's seat for authoring roles
// and roleFlow. Shared between text mode and the 3D scene; the
// two callers pass a small `ctx` adapter for accessing their
// portal-specific state and the WS client.
//
// Three sections:
//
//   1. Existing roles — every registered role at this story
//      (seed, extension, and operator-authored "live").
//
//   2. Create new role — calls DO set-role on @role-manager. The role
//      lands at <story>/./roles/<name> with origin: "live" and shows
//      up after the next boot's live-role loader.
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
//      Plus a terminal default. Save dispatches DO set-being on the
//      caller's own stance; the substrate's reducer projects
//      qualities.roleFlow and the next moment-assign honors it via
//      resolveActiveRole.
//
// Delegate-as-catalog: the panel reads its source lists from
// `beingEntry.catalogs`, which descriptor.js populates server-side
// for the role-manager being. No SEEs against heaven-gated mirrors;
// the asker (the user) never needs reigning to author roles.
//
// ctx shape:
//   story       string                                 — discovery.story
//   username      string | null                          — caller's being name
//   descriptor    object                                 — current SEE result (for fallback lookup)
//   see(address)  async (address) => descriptor          — used by loadFlowForSelf
//   doOp(addr, action, params) async                     — fires DO verb

// ── Condition vocabulary. Adding a path here is the only edit the UI
// needs when the roleFlow evaluator's vocabulary grows. See
// seed/present/roles/roleFlow.js for the matching set on the server.
const FIELDS = [
  // Who
  { path: "verb",                 label: "the verb",                  type: "select", options: ["do", "call", "be"] },
  { path: "action",               label: "the DO action name",        type: "text"   },
  { path: "operation",            label: "the BE op name",            type: "text"   },
  { path: "intent",               label: "the intent",                type: "text"   },
  { path: "connectedFrom",        label: "the asker's beingId",       type: "text"   },
  { path: "caller.role",          label: "the asker's role",          type: "role"   },
  { path: "caller.name",          label: "the asker's name",          type: "text"   },
  { path: "caller.cognition",     label: "the asker's cognition",     type: "select", options: ["llm", "human", "scripted"] },
  { path: "caller.isSelf",        label: "the asker is me",           type: "bool"   },
  { path: "caller.isAncestor",    label: "the asker is my ancestor",  type: "bool"   },
  { path: "caller.isDescendant",  label: "the asker is my descendant", type: "bool"  },

  // Where
  { path: "space.id",             label: "this space's id",            type: "text"   },
  { path: "space.name",           label: "this space's name",          type: "text"   },
  { path: "space.type",           label: "this space's type",          type: "text"   },
  { path: "space.heavenSpace",      label: "this space's heavenSpace tag", type: "text"   },
  { path: "coords.x",             label: "my X coord",                 type: "number" },
  { path: "coords.y",             label: "my Y coord",                 type: "number" },
  { path: "inHomeSpace",          label: "I am at home",               type: "bool"   },

  // Me
  { path: "me.cognition",         label: "my cognition",               type: "select", options: ["llm", "human", "scripted"] },
  { path: "me.role",              label: "my default role",            type: "role"   },
  { path: "me.previousRole",      label: "my previous moment's role",  type: "role"   },
  { path: "me.position",          label: "my current position",        type: "text"   },

  // Time
  { path: "time.hour",            label: "hour of day (0–23)",         type: "number" },
  { path: "time.dayOfWeek",       label: "day of week (0=Sun…6=Sat)",  type: "number" },
  { path: "time.sinceLastMoment", label: "seconds since last moment",  type: "number" },
];

const OPS = [
  { value: "eq",      label: "is"                },
  { value: "ne",      label: "is not"            },
  { value: "in",      label: "is one of"         },
  { value: "notIn",   label: "is not one of"     },
  { value: "gt",      label: ">"                 },
  { value: "gte",     label: "≥"                 },
  { value: "lt",      label: "<"                 },
  { value: "lte",     label: "≤"                 },
  { value: "present", label: "is present"        }, // value: true | false
];

// ──────────────────────────────────────────────────────────────
// Entry point
// ──────────────────────────────────────────────────────────────

export async function renderRoleManagerPanel(container, beingEntry, ctx) {
  container.innerHTML = "";

  const head = document.createElement("h3");
  head.className = "rm-pane-title";
  head.textContent = "Role Manager";
  container.appendChild(head);

  const sub = document.createElement("div");
  sub.className = "rm-sub";
  sub.textContent = "Author roles. Compose role flows for your being.";
  container.appendChild(sub);

  if (!ctx?.username) {
    const msg = document.createElement("div");
    msg.className = "rm-sub";
    msg.style.marginTop = "8px";
    msg.textContent = "Sign in to use the role manager.";
    container.appendChild(msg);
    return;
  }

  const rmEntry = findRoleManagerEntry(beingEntry, ctx);
  if (!rmEntry?.catalogs) {
    const msg = document.createElement("div");
    msg.className = "rm-sub";
    msg.style.marginTop = "8px";
    msg.textContent = "role-manager catalogs missing from descriptor. Reload the place and try again.";
    container.appendChild(msg);
    return;
  }
  const c = rmEntry.catalogs;

  const catalogs = {
    roles:      (c.roles      || []).map((r) => r.name).sort(),
    addresses:  (c.addresses  || []).map((a) => a.name),
    doActions:  (c.operations || []).map((o) => o.name).sort(),
    beOps:      (c.beOps      || []).map((o) => o.name).sort(),
  };

  container.appendChild(renderRolesSection(c.roles || []));
  container.appendChild(renderCreateRoleSection(catalogs, ctx, () => {
    renderRoleManagerPanel(container, beingEntry, ctx);
  }));
  container.appendChild(await renderFlowEditorSection(
    catalogs.roles.map((n) => ({ name: n })),
    ctx,
  ));
}

function findRoleManagerEntry(beingEntry, ctx) {
  if (beingEntry?.catalogs) return beingEntry;
  const desc = ctx?.descriptor;
  const pool = [].concat(desc?.beings || [], desc?.residents || []);
  return pool.find((e) => e.being === "role-manager") || null;
}

// ──────────────────────────────────────────────────────────────
// Section 1 — Roles list
// ──────────────────────────────────────────────────────────────

function renderRolesSection(allRoles) {
  const sec = document.createElement("section");
  sec.className = "rm-section";

  const h4 = document.createElement("h4");
  h4.textContent = `roles · ${allRoles.length}`;
  sec.appendChild(h4);

  if (allRoles.length === 0) {
    sec.appendChild(emptyHint("no roles registered"));
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

// ──────────────────────────────────────────────────────────────
// Section 2 — Create new role
// ──────────────────────────────────────────────────────────────

function renderCreateRoleSection(catalogs, ctx, onCreated) {
  const sec = document.createElement("section");
  sec.className = "rm-section";

  const h4 = document.createElement("h4");
  h4.textContent = "create new role";
  sec.appendChild(h4);

  const form = document.createElement("div");
  form.className = "rm-form";

  // Working state for the four chip-picker fields. Pickers mutate
  // these in place; submit reads the arrays at the end.
  //
  // canSummon is split into two pickers in the UI: ACTOR-side (what
  // this role can SEND — the legacy meaning) and RECEIVER-side (what
  // intents this role ACCEPTS when targeted). Submit combines them
  // into a single canSummon array with each entry tagged `as:"actor"`
  // or `as:"receiver"`. See seed/RolesAreAuth.md "canSummon: one
  // field, two surfaces" + FEDERATION.md "mate + vessel".
  const selected = {
    canSee: [],
    canDo: [],
    canSummonActor: [],
    canSummonReceiver: [],
    canBe: [],
  };

  const nameInput        = field("name (kebab-case)",       "text");
  const cognitionSelect  = selectField("required cognition", ["", "llm", "human", "scripted"]);

  const canSeePicker             = chipPicker({ label: "canSee — IBP addresses this role can read",                       source: catalogs.addresses, state: selected.canSee });
  const canDoPicker              = chipPicker({ label: "canDo — DO action names",                                          source: catalogs.doActions, state: selected.canDo  });
  const canSummonActorPicker     = chipPicker({ label: "canSummon (initiates) — beings this role can SEND summons to",     source: catalogs.roles,     state: selected.canSummonActor });
  const canSummonReceiverPicker  = chipPicker({ label: "canSummon (accepts) — intents this role ACCEPTS when targeted",   source: [],                 state: selected.canSummonReceiver });
  const canBePicker              = chipPicker({ label: "canBe — BE op names",                                              source: catalogs.beOps,     state: selected.canBe  });

  const promptInput      = field("system prompt", "multiline");

  form.appendChild(nameInput.wrap);
  form.appendChild(cognitionSelect.wrap);
  form.appendChild(canSeePicker.wrap);
  form.appendChild(canDoPicker.wrap);
  form.appendChild(canSummonActorPicker.wrap);
  form.appendChild(canSummonReceiverPicker.wrap);
  form.appendChild(canBePicker.wrap);
  form.appendChild(promptInput.wrap);

  const status = document.createElement("div");
  status.className = "rm-status rm-sub";
  form.appendChild(status);

  const submit = document.createElement("button");
  submit.className = "rm-btn rm-btn-primary";
  submit.textContent = "create role";
  submit.onclick = async () => {
    submit.disabled = true;
    status.textContent = "saving...";
    try {
      const bq = ctx.history && ctx.history !== "0" ? `#${ctx.history}` : "";
      const stance = `${ctx.story}${bq}/@role-manager`;
      // Combine the two canSummon pickers into one array with `as`
      // tags. Existing entries that come back stringified default
      // to as:"actor" semantics on the receiving side.
      const canSummonCombined = [
        ...selected.canSummonActor.map((entry) =>
          typeof entry === "object"
            ? { ...entry, as: "actor" }
            : { pattern: String(entry), as: "actor" },
        ),
        ...selected.canSummonReceiver.map((entry) =>
          typeof entry === "object"
            ? { ...entry, as: "receiver" }
            : { intent: String(entry), as: "receiver" },
        ),
      ];
      await ctx.doOp(stance, "set-role", {
        name:              nameInput.input.value.trim(),
        requiredCognition: cognitionSelect.input.value || "",
        canSee:            selected.canSee,
        canDo:             selected.canDo,
        canSummon:         canSummonCombined,
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
// One field per can*-slot. Each picker:
//   - shows the current selection as chips with × to remove
//   - has an input that filters a source catalog as you type
//   - shows matching suggestions in a dropdown; click to add
//   - accepts free-form entries on Enter (so extensions adding
//     names this client doesn't know yet still work)
//
// `state` is mutated in place so the surrounding form reads it
// at submit time.

function chipPicker({ label, source, state }) {
  const wrap = document.createElement("div");
  wrap.className = "rm-field";

  const lbl = document.createElement("label");
  lbl.textContent = label;
  wrap.appendChild(lbl);

  const box = document.createElement("div");
  box.className = "rm-chip-box";
  wrap.appendChild(box);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "rm-chip-input";
  input.placeholder = "type to search, Enter to add";

  const drop = document.createElement("div");
  drop.className = "rm-chip-drop rm-hidden";
  wrap.appendChild(drop);

  function renderChips() {
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
    const selectedSet = new Set(state);
    const matches = (source || [])
      .filter((s) => !selectedSet.has(s))
      .filter((s) => !q || s.toLowerCase().includes(q));
    drop.innerHTML = "";
    if (!matches.length || document.activeElement !== input) {
      drop.classList.add("rm-hidden");
      return;
    }
    drop.classList.remove("rm-hidden");
    for (const s of matches.slice(0, 12)) {
      const opt = document.createElement("div");
      opt.className = "rm-chip-drop-item";
      opt.textContent = s;
      opt.onmousedown = (ev) => {
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
    if (!v || state.includes(v)) return;
    state.push(v);
    input.value = "";
    renderChips();
    renderDrop();
    input.focus();
  }

  input.oninput = renderDrop;
  input.onfocus = renderDrop;
  input.onblur  = () => setTimeout(() => drop.classList.add("rm-hidden"), 120);
  input.onkeydown = (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      const q = input.value.trim();
      const exact = (source || []).find((s) => s.toLowerCase() === q.toLowerCase());
      addItem(exact || q);
    } else if (ev.key === "Backspace" && input.value === "" && state.length) {
      state.pop();
      renderChips();
      renderDrop();
    }
  };

  renderChips();
  return { wrap, state };
}

// ──────────────────────────────────────────────────────────────
// Section 3 — Author your roleFlow (mad-libs)
// ──────────────────────────────────────────────────────────────

async function renderFlowEditorSection(allRoles, ctx) {
  // Self editor. Loads the caller's own flow and saves back to
  // <story>/@<self>. The reusable renderer below handles arbitrary
  // targets; this is the role-manager panel's "edit your own flow"
  // entry point.
  const flow = await loadFlowForSelf(ctx);
  return renderFlowEditor(allRoles, ctx, {
    headerLabel:    "your role flow",
    initialFlow:    flow,
    targetStance:   `${ctx.story}${ctx.history && ctx.history !== "0" ? `#${ctx.history}` : ""}/@${ctx.username}`,
  });
}

/**
 * Reusable RoleFlow mad-libs editor. Exported via the shared module's
 * public surface (re-exported from a sibling wrapper) so the
 * being-flow panel can mount the same UI against any being's stance.
 *
 * @param {Array} allRoles                 role-name list for clause role pickers
 * @param {object} ctx                     panel ctx (story, username, doOp, …)
 * @param {object} target
 * @param {string} target.headerLabel      h4 label ("your role flow", "@food-coach's flow", …)
 * @param {Array}  target.initialFlow      current roleFlow on the target being (or empty)
 * @param {string} target.targetStance     where to save (`<story>/@<name>`)
 */
export function renderFlowEditor(allRoles, ctx, { headerLabel, initialFlow, targetStance }) {
  const sec = document.createElement("section");
  sec.className = "rm-section";

  const h4 = document.createElement("h4");
  h4.textContent = headerLabel || "role flow";
  sec.appendChild(h4);

  const hint = document.createElement("div");
  hint.className = "rm-sub";
  hint.textContent = "Primary clauses compete via first-match-wins; stacked clauses (modifiers) ALL apply when their conditions match. Permissions union; prompts concatenate.";
  sec.appendChild(hint);

  const draft = Array.isArray(initialFlow) ? deepCopy(initialFlow) : [];

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

  const actions = document.createElement("div");
  actions.className = "rm-flow-actions";

  const addClauseBtn = document.createElement("button");
  addClauseBtn.className = "rm-btn rm-btn-sm";
  addClauseBtn.textContent = "+ when…";
  addClauseBtn.onclick = () => {
    // Insert before the terminal default (the clause with no `when`).
    const insertAt = draft.findIndex((c) => !c.when);
    const newClause = { when: { [FIELDS[0].path]: "" }, role: allRoles[0]?.name || "" };
    if (insertAt >= 0) draft.splice(insertAt, 0, newClause);
    else               draft.push(newClause);
    rerender();
  };
  actions.appendChild(addClauseBtn);

  const status = document.createElement("span");
  status.className = "rm-status rm-sub";
  actions.appendChild(status);

  const saveBtn = document.createElement("button");
  saveBtn.className = "rm-btn rm-btn-primary";
  saveBtn.textContent = "save flow";
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    status.textContent = "saving...";
    try {
      if (!targetStance) throw new Error("no target stance");
      // set-being writes the whole array atomically (merge:false) so
      // removals propagate. Authorization is handled at the verb gate
      // — the panel surfaces FORBIDDEN as-is rather than pre-checking.
      await ctx.doOp(targetStance, "set-being", {
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
  row.className = `rm-clause ${clause.stack ? "rm-clause-stacked" : ""}`;

  // Header: stack toggle. Primary clauses compete via first-match-wins;
  // stacked clauses ALL apply when their `when` matches and union their
  // permissions / prompts onto the primary.
  const headerLine = document.createElement("div");
  headerLine.className = "rm-clause-header";
  const stackToggle = document.createElement("label");
  stackToggle.className = "rm-stack-toggle";
  const cb = document.createElement("input");
  cb.type = "checkbox";
  cb.checked = !!clause.stack;
  cb.onchange = () => {
    if (cb.checked) clause.stack = true;
    else delete clause.stack;
    onChange();
  };
  stackToggle.appendChild(cb);
  const tlabel = document.createElement("span");
  tlabel.textContent = "modifier (stacks onto primary)";
  stackToggle.appendChild(tlabel);
  headerLine.appendChild(stackToggle);
  row.appendChild(headerLine);

  if (Object.keys(clause.when || {}).length === 0) {
    // Defensive: add-clause always seeds one condition, but a hand-edited
    // JSON could land here. Insert a placeholder so the clause renders.
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

  const andBtn = document.createElement("button");
  andBtn.className = "rm-btn rm-btn-sm rm-and-btn";
  andBtn.textContent = "+ and";
  andBtn.onclick = () => {
    const usedPaths = new Set(Object.keys(clause.when));
    const available = FIELDS.find((f) => !usedPaths.has(f.path)) || FIELDS[0];
    clause.when[available.path] = "";
    onChange();
  };
  row.appendChild(andBtn);

  const thenLine = document.createElement("div");
  thenLine.className = "rm-then-line";
  const thenLabel = document.createElement("span");
  thenLabel.className = "rm-keyword";
  thenLabel.textContent = clause.stack ? "STACK role" : "THEN use role";
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
  roleSelect.onchange = () => { clause.role = roleSelect.value; };
  thenLine.appendChild(roleSelect);

  const removeClauseBtn = document.createElement("button");
  removeClauseBtn.className = "rm-btn rm-btn-sm rm-danger";
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

  // Field picker. A typeable input + datalist gives both the curated
  // catalog (the FIELDS doctrine list, surfaced as suggestions) AND
  // free-form path entry, so authors can reference `world.<ns>.<key>`
  // or any extension-published path that isn't in the catalog.
  const datalistId = `rm-fields-${randomId()}`;
  const fieldInput = document.createElement("input");
  fieldInput.type = "text";
  fieldInput.className = "rm-input rm-field-picker";
  fieldInput.setAttribute("list", datalistId);
  fieldInput.placeholder = "field path (e.g. world.harmony.tick)";
  fieldInput.value = path;
  const datalist = document.createElement("datalist");
  datalist.id = datalistId;
  for (const f of FIELDS) {
    const opt = document.createElement("option");
    opt.value = f.path;
    opt.label = f.label;
    datalist.appendChild(opt);
  }
  line.appendChild(fieldInput);
  line.appendChild(datalist);
  fieldInput.onchange = () => {
    const newKey = fieldInput.value.trim();
    if (!newKey || newKey === path) return;
    const old = clause.when[path];
    delete clause.when[path];
    clause.when[newKey] = old;
    onChange();
  };

  const fieldSpec = FIELDS.find((f) => f.path === path) || inferFieldSpec(path);
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
    clause.when[path] = packOperand(opSel.value, raw);
    onChange();
  };
  line.appendChild(opSel);

  const valInput = renderValueInput(fieldSpec, opSel.value, raw, allRoles, (next) => {
    clause.when[path] = packOperand(opSel.value, next);
  });
  line.appendChild(valInput);

  const rm = document.createElement("button");
  rm.className = "rm-btn rm-btn-sm rm-danger";
  rm.textContent = "×";
  rm.title = "remove this condition";
  rm.onclick = () => {
    delete clause.when[path];
    if (Object.keys(clause.when).length === 0) {
      clause.when[FIELDS[0].path] = "";
    }
    onChange();
  };
  line.appendChild(rm);

  return line;
}

function renderValueInput(fieldSpec, op, raw, allRoles, onUpdate) {
  // `present` always takes a boolean — overrides the field's natural type.
  if (op === "present") {
    const sel = document.createElement("select");
    sel.className = "rm-input rm-value";
    for (const v of ["true", "false"]) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    }
    sel.value = raw === false || raw === "false" ? "false" : "true";
    sel.onchange = () => onUpdate(sel.value === "true");
    return sel;
  }

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
      const i = draft.indexOf(defaultClause);
      if (i >= 0) draft.splice(i, 1);
      onChange();
    }
  };
  row.appendChild(sel);

  return row;
}

// ──────────────────────────────────────────────────────────────
// Data loaders
// ──────────────────────────────────────────────────────────────
//
// Catalogs ride on the role-manager being's descriptor entry. The
// only thing this section still loads is the caller's own roleFlow,
// which lives on her being at her home space.

async function loadFlowForSelf(ctx) {
  const { story, username, history, see } = ctx || {};
  if (!story || !username || typeof see !== "function") return [];
  try {
    const bq = history && history !== "0" ? `#${history}` : "";
    const desc = await see(`${story}${bq}/@${username}`);
    const myId = desc.identity?.beingId || null;
    const pool = [].concat(desc.beings || [], desc.residents || []);
    const mine = (myId && pool.find((b) => String(b.beingId) === String(myId)))
              || pool.find((b) => b.being === username || b.name === username);
    const rf = mine?.qualities?.roleFlow;
    return Array.isArray(rf) ? rf : [];
  } catch {
    return [];
  }
}

// ──────────────────────────────────────────────────────────────
// Operand pack / unpack
// ──────────────────────────────────────────────────────────────
//
// The substrate's evalWhen accepts either a bare value (equality
// shorthand) or an operator object `{ eq/ne/in/notIn/gt/gte/lt/lte: x }`.
// The UI keeps an explicit op + raw value in editor state and converts
// at the boundary.

function unpackOperand(stored) {
  if (stored === null || stored === undefined) return { op: "eq", raw: "" };
  if (typeof stored !== "object" || Array.isArray(stored)) {
    return { op: "eq", raw: stored };
  }
  for (const k of Object.keys(stored)) {
    if (OPS.find((o) => o.value === k)) return { op: k, raw: stored[k] };
  }
  return { op: "eq", raw: stored };
}

function packOperand(op, raw) {
  if (op === "eq") return raw;
  return { [op]: raw };
}

// ──────────────────────────────────────────────────────────────
// Small DOM helpers
// ──────────────────────────────────────────────────────────────

function emptyHint(msg) {
  const div = document.createElement("div");
  div.className = "rm-sub";
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

function deepCopy(o) {
  return JSON.parse(JSON.stringify(o));
}

// Render-stable random id for <datalist> uniqueness within a rerender.
let _idCounter = 0;
function randomId() {
  _idCounter += 1;
  return `rm-id-${_idCounter}`;
}

// For free-form paths the field-spec catalog doesn't know about
// (e.g. `world.harmony.tick.alive`), default to a text input. Authors
// using numeric world signals can still pick `gte`/`lte` and type a
// number; the operand coercion is lenient.
function inferFieldSpec(path) {
  return { path, label: path, type: "text" };
}

