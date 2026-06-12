// roles-panel.js — the Place > Roles tab.
//
// Per seed/RolesAreAuth.md, roles ARE the permission gate. This panel
// surfaces the full auth picture at the viewer's current position in
// a layered shape — what they CAN DO first (the practical question),
// then what they HOLD, then what's hosted here, then the authoring
// surface. Sections collapse by default below the practical view so
// the page doesn't open as a wall of text.

import { flat } from "./host.js";
import "../styles/roles-panel.css";

export async function renderRolesPanel(body, action, opByName, { refreshView } = {}) {
  body.innerHTML = "";
  const desc = action.values?.descriptor || flat.state?.descriptor || {};

  const reality = flat.state?.discovery?.reality
    || desc.address?.reality
    || desc.address?.place
    || "";
  const path = desc.address?.pathByNames || "/";
  const positionAddress = `${reality}${path === "/" ? "/" : path}`;
  const positionSpaceId = desc.address?.spaceId
    || desc.position?.spaceId
    || desc.space?._id
    || null;

  const session = flat.state?.session || {};
  const viewerName = (session.username || session.name || "").trim();
  const isAnonymous = !viewerName || viewerName === "arrival";

  // ── 1. Where you are + ownership ────────────────────────────────
  await renderWhereYouAre(body, { desc, reality, positionSpaceId, path });

  // Collect data we'll need across sections.
  let hostedHere   = [];
  let claim        = null;
  let viewerData   = { grants: [], lineage: null };
  try { hostedHere = await collectRolesInEffect(desc, reality); } catch { /* surface in section */ }
  try { claim = await findNearestOwnedAncestor(desc, reality); } catch { /* */ }
  if (!isAnonymous) {
    try { viewerData = await collectYourGrantsAndLineage(viewerName, reality, positionSpaceId); } catch { /* */ }
  }

  // Annotate each grant with: spec, host, whether it reaches here.
  const annotated = await annotateGrants(viewerData.grants, hostedHere, positionSpaceId, reality);
  const activeGrants = annotated.filter((g) => g.reachesHere);

  // Compute effective canX once — drives the "What you can do here"
  // section AND the canX pickers in the author form.
  const effective = computeEffective(activeGrants, claim, viewerName);

  // ── 2. What you can do here (THE answer) ────────────────────────
  renderEffective(body, { effective, claim, viewerName, isAnonymous });

  // ── 3. Your grants ──────────────────────────────────────────────
  renderYourGrants(body, { annotated, viewerName, isAnonymous, lineage: viewerData.lineage, reality });

  // ── 4. Roles hosted here (collapsed) ────────────────────────────
  renderHostedHere(body, { hostedHere });

  // ── 5. Author a role here (collapsed) ───────────────────────────
  renderAuthorForm(body, {
    positionAddress,
    effective,
    hostedHere,
    onResult: (err) => { if (!err && typeof refreshView === "function") refreshView(); },
  });

  // ── 6. Grant a role (only when you have grants reaching here) ──
  if (activeGrants.length > 0) {
    renderGrantForm(body, {
      heldRoles: activeGrants,
      reality,
      onResult: (err) => { if (!err && typeof refreshView === "function") refreshView(); },
    });
  }
}

// Compute effective canX from active grants. Returns {see, do, summon,
// be} as Maps of token → Set<source-role-names>. Owner gets a sentinel
// `ownerAll = true` so the author form can offer everything when the
// caller owns the host space.
function computeEffective(activeGrants, claim, viewerName) {
  const out = {
    see:    new Map(),
    do:     new Map(),
    summon: new Map(),
    be:     new Map(),
    ownerAll: false,
  };
  if (claim && claim.ownerNames.some((n) => n === viewerName)) {
    out.ownerAll = true;
  }
  for (const g of activeGrants) {
    addCan(out.see,    g.spec?.canSee,    "name",      g.grant.role);
    addCan(out.do,     g.spec?.canDo,     "action",    g.grant.role);
    addCan(out.summon, g.spec?.canSummon, "pattern",   g.grant.role);
    addCan(out.be,     g.spec?.canBe,     "operation", g.grant.role);
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────
// Section 1 — Where you are
// ──────────────────────────────────────────────────────────────────

async function renderWhereYouAre(parent, { desc, reality, positionSpaceId, path }) {
  const sec = section(parent, "Where you are");
  const hostName = desc.space?.name || desc.address?.spaceName
                  || (path === "/" ? "reality root" : path);
  sec.appendChild(kvRow("position", path === "/" ? "/ (reality root)" : path));
  sec.appendChild(kvRow("space", hostName));
  if (positionSpaceId) sec.appendChild(kvRow("spaceId", shortId(positionSpaceId)));

  const claim = await findNearestOwnedAncestor(desc, reality);
  if (!claim) {
    sec.appendChild(kvRow("ownership", "(unclaimed)"));
  } else if (claim.publicCommons) {
    sec.appendChild(kvRow("ownership", `public commons (anchor: ${claim.hostName})`));
  } else if (claim.ownerNames.length > 0) {
    const label = claim.ownerNames.map((n) => `@${n}`).join(", ");
    const where = claim.spaceId === positionSpaceId ? "this space" : `inherited from ${claim.hostName}`;
    sec.appendChild(kvRow("ownership", `${label} (${where})`));
  }
}

// ──────────────────────────────────────────────────────────────────
// Section 2 — What you can do here (aggregated effective canX)
// ──────────────────────────────────────────────────────────────────

function renderEffective(parent, { effective, claim, viewerName, isAnonymous }) {
  const sec = section(parent, isAnonymous ? "What you can do here" : `What @${viewerName} can do here`);

  if (isAnonymous) {
    sec.appendChild(noteRow("Sign in to see your effective permissions."));
    return;
  }

  if (effective.ownerAll) {
    const ownRow = document.createElement("div");
    ownRow.className = "perm-owner";
    ownRow.textContent = `● Owner of ${claim.hostName} — you can do anything in this subtree.`;
    sec.appendChild(ownRow);
    return;
  }

  const totalSize = effective.see.size + effective.do.size + effective.summon.size + effective.be.size;
  if (totalSize === 0) {
    sec.appendChild(noteRow("No granted role reaches this position."));
    return;
  }

  const verbs = [
    { label: "SEE",    map: effective.see,    empty: "(no SEE ops)" },
    { label: "DO",     map: effective.do,     empty: "(no DO actions)" },
    { label: "SUMMON", map: effective.summon, empty: "(no SUMMON targets)" },
    { label: "BE",     map: effective.be,     empty: "(no BE ops)" },
  ];

  for (const v of verbs) {
    const row = document.createElement("div");
    row.className = "perm-row";
    const tag = document.createElement("span");
    tag.className = "perm-verb";
    tag.textContent = v.label;
    row.appendChild(tag);
    const body = document.createElement("span");
    body.className = "perm-body";
    if (v.map.size === 0) {
      body.classList.add("dim");
      body.textContent = v.empty;
    } else {
      const sorted = Array.from(v.map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      for (let i = 0; i < sorted.length; i++) {
        const [token, sources] = sorted[i];
        const badge = document.createElement("span");
        badge.className = "perm-token";
        badge.textContent = token;
        badge.title = `via ${Array.from(sources).join(", ")}`;
        body.appendChild(badge);
        if (i < sorted.length - 1) body.appendChild(document.createTextNode(" · "));
      }
    }
    row.appendChild(body);
    sec.appendChild(row);
  }
}

function addCan(map, list, key, roleName) {
  if (!Array.isArray(list)) return;
  for (const entry of list) {
    let token = null;
    if (typeof entry === "string") token = entry;
    else if (entry && typeof entry === "object") {
      token = entry[key] || entry.name || entry.action || entry.operation || entry.pattern || null;
      // Compound shape: action + namespace (e.g. set-being:coord)
      if (token && entry.namespace) token = `${token}:${entry.namespace}`;
      if (token && entry.intent) token = `${token}:${entry.intent}`;
    }
    if (!token) continue;
    if (!map.has(token)) map.set(token, new Set());
    map.get(token).add(roleName);
  }
}

// ──────────────────────────────────────────────────────────────────
// Section 3 — Your grants
// ──────────────────────────────────────────────────────────────────

function renderYourGrants(parent, { annotated, viewerName, isAnonymous, lineage, reality }) {
  const sec = section(parent, isAnonymous ? "Your grants" : `Your grants (as @${viewerName})`);
  if (isAnonymous) {
    sec.appendChild(noteRow("Sign in to see your held roles."));
    return;
  }
  if (annotated.length === 0) {
    sec.appendChild(noteRow("(you hold no granted roles)"));
  } else {
    for (const g of annotated) {
      sec.appendChild(grantCard(g, viewerName, reality));
    }
  }
  if (lineage && (lineage.mother || lineage.father)) {
    const m = lineage.mother ? shortId(lineage.mother) : null;
    const f = lineage.father ? shortId(lineage.father) : null;
    sec.appendChild(kvRow("lineage", [m && `mother: ${m}`, f && `father: ${f}`].filter(Boolean).join(" · ")));
  }
}

function grantCard(entry, viewerName, reality) {
  const card = document.createElement("div");
  card.className = "grant-card";

  const head = document.createElement("div");
  head.className = "grant-head";
  const name = document.createElement("strong");
  name.textContent = entry.grant.role;
  head.appendChild(name);
  const status = document.createElement("span");
  status.className = entry.reachesHere ? "grant-status active" : "grant-status dim";
  status.textContent = entry.reachesHere ? " ● reaches here" : " ○ inert here";
  head.appendChild(status);
  card.appendChild(head);

  const meta = document.createElement("div");
  meta.className = "grant-meta dim";
  const hostLabel = entry.host?.name ? `host: ${entry.host.name}` : `anchor: ${shortId(entry.grant.anchorSpaceId)}`;
  meta.textContent = [
    hostLabel,
    entry.grant.grantedBy ? `granted by ${shortenGrantor(entry.grant.grantedBy)}` : null,
    entry.grant.grantedAt ? entry.grant.grantedAt.slice(0, 10) : null,
  ].filter(Boolean).join(" · ");
  card.appendChild(meta);

  // Revoke if the viewer is the grantor.
  if (viewerName && entry.grant.grantedBy && entry.grant.grantedBy.toLowerCase() === viewerName.toLowerCase()) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-warn btn-compact";
    btn.textContent = "revoke";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await flat.doOp(
          `${reality}/@${viewerName}`,
          "revoke-role",
          {
            role:          entry.grant.role,
            anchorSpaceId: entry.grant.anchorSpaceId || null,
            anchorBeingId: entry.grant.anchorBeingId || null,
            grantedBy:     viewerName,
          },
        );
        btn.textContent = "revoked";
      } catch (err) {
        btn.textContent = `failed: ${err?.message || err}`.slice(0, 60);
        btn.disabled = false;
      }
    });
    card.appendChild(btn);
  }

  return card;
}

// ──────────────────────────────────────────────────────────────────
// Section 4 — Roles hosted here (collapsed)
// ──────────────────────────────────────────────────────────────────

function renderHostedHere(parent, { hostedHere }) {
  const sec = collapsibleSection(parent, `Roles hosted here & inherited (${hostedHere.length})`);
  if (hostedHere.length === 0) {
    sec.body.appendChild(noteRow("(no roles hosted on this position or any ancestor)"));
    return;
  }

  // Filter input
  const filter = document.createElement("input");
  filter.type = "text";
  filter.placeholder = "filter by name…";
  filter.className = "role-filter";
  sec.body.appendChild(filter);

  const list = document.createElement("div");
  list.className = "hosted-list";
  sec.body.appendChild(list);

  const cards = hostedHere.map((e) => hostedRoleCard(e));
  for (const c of cards) list.appendChild(c);

  filter.addEventListener("input", () => {
    const q = filter.value.trim().toLowerCase();
    for (let i = 0; i < hostedHere.length; i++) {
      const e = hostedHere[i];
      const match = !q || e.name.toLowerCase().includes(q);
      cards[i].style.display = match ? "" : "none";
    }
  });
}

function hostedRoleCard(entry) {
  const card = document.createElement("div");
  card.className = "hosted-card";

  const head = document.createElement("div");
  head.className = "hosted-head";
  const name = document.createElement("strong");
  name.textContent = entry.name;
  head.appendChild(name);
  const where = document.createElement("span");
  where.className = "hosted-where dim";
  where.textContent = entry.viaInheritance
    ? ` · inherited from ${entry.hostSpaceName}`
    : ` · hosted here`;
  head.appendChild(where);
  card.appendChild(head);

  if (entry.spec?.description) {
    const d = document.createElement("div");
    d.className = "hosted-desc dim";
    d.textContent = entry.spec.description;
    card.appendChild(d);
  }

  const can = canSummary(entry.spec);
  if (can) {
    const c = document.createElement("div");
    c.className = "hosted-can";
    c.textContent = can;
    card.appendChild(c);
  }

  if (Array.isArray(entry.spec?.reach) && entry.spec.reach.length > 0) {
    const r = document.createElement("div");
    r.className = "hosted-reach dim";
    r.textContent = `reach: ${entry.spec.reach.join(", ")}`;
    card.appendChild(r);
  }
  return card;
}

// ──────────────────────────────────────────────────────────────────
// Section 5 — Author a role here (collapsed)
// ──────────────────────────────────────────────────────────────────

function renderAuthorForm(parent, { positionAddress, effective, hostedHere, onResult }) {
  const sec = collapsibleSection(parent, "Author / edit a role here");
  sec.body.appendChild(noteRow(
    "Pickers below show ONLY canX you currently hold (so you can't author a role with abilities you can't grant). " +
    "Owner of this space? You can pick from any of your held tokens regardless of source role."
  ));
  const form = document.createElement("div");
  form.className = "compact-form";

  // Name input (also doubles as edit selector: same name overwrites).
  const nameField = textInput("name", "Role name (kebab-case)");
  form.appendChild(nameField.wrapper);

  // Edit-existing: pick a hosted role to load its spec into the form.
  // Same path as authoring — set-role overwrites by name.
  if (hostedHere && hostedHere.length > 0) {
    const editField = document.createElement("div");
    editField.className = "field-row";
    const lbl = document.createElement("label");
    lbl.textContent = "Load existing role to edit (optional)";
    const select = document.createElement("select");
    select.className = "op-input";
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "— start fresh —";
    select.appendChild(blank);
    for (const e of hostedHere) {
      const opt = document.createElement("option");
      opt.value = e.name;
      opt.textContent = `${e.name} (${e.viaInheritance ? "inherited" : "here"})`;
      select.appendChild(opt);
    }
    editField.appendChild(lbl);
    editField.appendChild(select);
    form.appendChild(editField);

    select.addEventListener("change", () => {
      const chosen = hostedHere.find((e) => e.name === select.value);
      if (!chosen) return;
      nameField.input.value = chosen.name;
      // Populate pickers + reach + description from the chosen spec.
      loadSpecIntoPickers(chosen.spec, pickers, reachField, descField);
    });
  }

  // Pickers (multi-select checkbox grid) for each verb, populated
  // from the effective canX. Hidden when the bucket is empty.
  const pickers = {
    see:    pickerGroup("canSee — pick from your held SEE ops",     effective.see,    "name"),
    do:     pickerGroup("canDo — pick from your held DO actions",   effective.do,     "action"),
    summon: pickerGroup("canSummon — pick from your held targets",  effective.summon, "pattern"),
    be:     pickerGroup("canBe — pick from your held BE ops",       effective.be,     "operation"),
  };
  for (const k of Object.keys(pickers)) form.appendChild(pickers[k].wrapper);

  // Reach + description stay as free-text.
  const reachField = textInput("reach", "Reach (optional, comma-separated; e.g. /docs/**,!/legacy/**)");
  const descField  = textInput("description", "Description (optional)");
  form.appendChild(reachField.wrapper);
  form.appendChild(descField.wrapper);

  const result = document.createElement("div");
  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "btn-primary";
  submit.textContent = "Install / replace role at this space";
  submit.addEventListener("click", async () => {
    submit.disabled = true;
    result.textContent = "";
    const name = nameField.input.value.trim();
    if (!name) {
      result.className = "action-result action-err";
      result.textContent = "Role name is required.";
      submit.disabled = false;
      return;
    }
    const spec = {
      name,
      canSee:    pickers.see.collect().map((token) => token),                     // canSee is string[]
      canDo:     pickers.do.collect().map((token) => ({ action:    token })),
      canSummon: pickers.summon.collect().map((token) => ({ pattern: token })),
      canBe:     pickers.be.collect().map((token) => ({ operation: token })),
    };
    const reach = splitList(reachField.input.value);
    if (reach.length > 0) spec.reach = reach;
    const description = descField.input.value.trim();
    if (description) spec.description = description;
    try {
      await flat.doOp(positionAddress, "set-role", { name, spec });
      result.className = "action-result action-ok";
      result.textContent = `installed "${name}" at this space`;
      onResult?.(null);
    } catch (err) {
      result.className = "action-result action-err";
      result.textContent = err?.message || String(err);
      submit.disabled = false;
      onResult?.(err);
    }
  });
  form.appendChild(submit);
  form.appendChild(result);
  sec.body.appendChild(form);
}

// Render a multi-select picker as a labeled box of checkboxes, one per
// token in the given source map (effective canX bucket). Returns
// { wrapper, collect }: collect() returns the picked tokens in order.
function pickerGroup(label, sourceMap, _tokenKey) {
  const wrapper = document.createElement("div");
  wrapper.className = "field-row picker-group";
  const lbl = document.createElement("label");
  lbl.textContent = label;
  wrapper.appendChild(lbl);
  const box = document.createElement("div");
  box.className = "picker-box";
  wrapper.appendChild(box);

  const tokens = Array.from(sourceMap.keys()).sort();
  if (tokens.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dim picker-empty";
    empty.textContent = "(no available tokens to grant from this verb)";
    box.appendChild(empty);
  }
  const checks = new Map(); // token → input element
  for (const token of tokens) {
    const id = `pick-${label.replace(/[^a-z]/gi, "")}-${token.replace(/[^a-z0-9]/gi, "")}`;
    const row = document.createElement("label");
    row.className = "picker-item";
    row.htmlFor = id;
    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.id = id;
    chk.value = token;
    row.appendChild(chk);
    const span = document.createElement("span");
    span.textContent = ` ${token}`;
    const sources = sourceMap.get(token);
    if (sources && sources.size > 0) {
      span.title = `via ${Array.from(sources).join(", ")}`;
    }
    row.appendChild(span);
    box.appendChild(row);
    checks.set(token, chk);
  }

  function collect() {
    const out = [];
    for (const [token, chk] of checks.entries()) {
      if (chk.checked) out.push(token);
    }
    return out;
  }
  function setSelection(selectedSet) {
    for (const [token, chk] of checks.entries()) {
      chk.checked = selectedSet.has(token);
    }
  }
  return { wrapper, collect, setSelection };
}

function loadSpecIntoPickers(spec, pickers, reachField, descField) {
  const tokensOf = (list, key) => {
    if (!Array.isArray(list)) return new Set();
    return new Set(list.map((e) => typeof e === "string" ? e : (e?.[key] || e?.name || null)).filter(Boolean));
  };
  pickers.see.setSelection(tokensOf(spec?.canSee, "name"));
  pickers.do.setSelection(tokensOf(spec?.canDo, "action"));
  pickers.summon.setSelection(tokensOf(spec?.canSummon, "pattern"));
  pickers.be.setSelection(tokensOf(spec?.canBe, "operation"));
  reachField.input.value = Array.isArray(spec?.reach) ? spec.reach.join(", ") : "";
  descField.input.value = typeof spec?.description === "string" ? spec.description : "";
}

// ──────────────────────────────────────────────────────────────────
// Section 6 — Grant a role to a being
// ──────────────────────────────────────────────────────────────────

function renderGrantForm(parent, { heldRoles, reality, onResult }) {
  const sec = collapsibleSection(parent, "Grant a role to a being");
  sec.body.appendChild(noteRow(
    "The substrate admits if any of your held roles has canDo:[\"grant-role:<role>\"] (or grant-role:*) reaching the anchor."
  ));
  const form = document.createElement("div");
  form.className = "compact-form";

  const roleField = document.createElement("div");
  roleField.className = "field-row";
  const roleLabel = document.createElement("label");
  roleLabel.textContent = "Role to grant";
  const roleSelect = document.createElement("select");
  roleSelect.className = "op-input";
  for (const entry of heldRoles) {
    const opt = document.createElement("option");
    opt.value = entry.grant.role;
    opt.textContent = entry.grant.role;
    roleSelect.appendChild(opt);
  }
  roleField.appendChild(roleLabel);
  roleField.appendChild(roleSelect);
  form.appendChild(roleField);

  const granteeField = textInput("grantee", "Grantee (name, beingId, or full IBPA — e.g. alice, <uuid>, bing.com/@tabor)");
  const anchorField  = textInput("anchor", "Anchor space id (defaults to current position)");
  form.appendChild(granteeField.wrapper);
  form.appendChild(anchorField.wrapper);

  const result = document.createElement("div");
  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "btn-primary";
  submit.textContent = "Grant role";
  submit.addEventListener("click", async () => {
    submit.disabled = true;
    result.textContent = "";
    const role = roleSelect.value;
    const raw = granteeField.input.value.trim();
    if (!raw) {
      result.className = "action-result action-err";
      result.textContent = "Grantee is required.";
      submit.disabled = false;
      return;
    }
    let anchorSpaceId = anchorField.input.value.trim() || null;
    if (!anchorSpaceId) {
      anchorSpaceId =
        flat.state?.descriptor?.address?.spaceId ||
        flat.state?.descriptor?.position?.spaceId || null;
    }
    if (!anchorSpaceId) {
      result.className = "action-result action-err";
      result.textContent = "Could not resolve an anchor space.";
      submit.disabled = false;
      return;
    }
    const target = resolveGranteeTarget(raw, reality);
    try {
      await flat.doOp(target, "grant-role", {
        role,
        anchorSpaceId,
        anchorBeingId: null,
      });
      result.className = "action-result action-ok";
      result.textContent = `granted "${role}" to ${target}`;
      onResult?.(null);
    } catch (err) {
      result.className = "action-result action-err";
      result.textContent = err?.message || String(err);
      submit.disabled = false;
      onResult?.(err);
    }
  });
  form.appendChild(submit);
  form.appendChild(result);
  sec.body.appendChild(form);
}

// ──────────────────────────────────────────────────────────────────
// Data collection
// ──────────────────────────────────────────────────────────────────

async function findNearestOwnedAncestor(desc, reality) {
  const client = flat.state?.client;
  if (!client) return null;
  const path = desc.address?.pathByNames || "/";
  const segs = path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  for (let i = segs.length; i >= 0; i--) {
    const ancestorPath = "/" + segs.slice(0, i).join("/");
    let snap = null;
    try {
      snap = await client.see(`${reality}${ancestorPath === "/" ? "/" : ancestorPath}`);
    } catch { continue; }
    const owner = readOwner(snap);
    if (!owner) continue;
    const hostName = snap?.space?.name || snap?.address?.spaceName
                    || (ancestorPath === "/" ? "reality root" : ancestorPath);
    const spaceId = snap?.space?._id || snap?.address?.spaceId || null;
    // Resolve owner name (public => commons indicator).
    const beingsList = Array.isArray(snap.beings) ? snap.beings : [];
    const m = beingsList.find((b) => String(b?._id || b?.id) === String(owner));
    const name = m?.being || m?.name || null;
    const publicCommons = name === "public";
    const ownerNames = publicCommons ? [] : (name ? [name] : []);
    return { spaceId, hostName, ownerNames, publicCommons };
  }
  return null;
}

function readOwner(snap) {
  return snap?.space?.owner || snap?.owner || null;
}

async function collectRolesInEffect(desc, reality) {
  const client = flat.state?.client;
  if (!client) return [];

  const seen = new Set();
  const out = [];
  const path = desc.address?.pathByNames || "/";
  await harvestRolesAt(client, reality, path, seen, out, false);

  const segs = path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    const ancestorPath = "/" + segs.slice(0, i).join("/");
    await harvestRolesAt(client, reality, ancestorPath || "/", seen, out, true);
  }
  return out;
}

async function harvestRolesAt(client, reality, path, seen, out, viaInheritance) {
  let snap = null;
  try {
    snap = await client.see(`${reality}${path === "/" ? "/" : path}`);
  } catch { return; }
  const roles = snap?.space?.qualities?.roles || snap?.qualities?.roles || null;
  if (!roles || typeof roles !== "object") return;
  const hostSpaceName = snap?.space?.name || snap?.address?.spaceName
                       || (path === "/" ? "reality root" : path);
  const hostSpaceId = snap?.space?._id || snap?.address?.spaceId || null;
  for (const [name, spec] of Object.entries(roles)) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, spec, hostSpaceName, hostSpaceId, viaInheritance });
  }
}

async function collectYourGrantsAndLineage(viewerName, reality, positionSpaceId) {
  const client = flat.state?.client;
  if (!client) return { grants: [], lineage: null };
  // The @stance SEE resolves to the position the being stands at; the
  // returned beings[] includes the viewer's own entry, whose qualities
  // carry rolesGranted + lineage. The identity block doesn't carry
  // qualities, so this is the correct path.
  let beingDesc = null;
  try {
    beingDesc = await client.see(`${reality}/@${viewerName}`);
  } catch {
    return { grants: [], lineage: null };
  }
  const beings = Array.isArray(beingDesc?.beings) ? beingDesc.beings : [];
  const me = beings.find((b) => String(b?.being).toLowerCase() === viewerName.toLowerCase()
                              || String(b?.name).toLowerCase() === viewerName.toLowerCase());
  const qualities = me?.qualities || {};
  const granted = Array.isArray(qualities?.rolesGranted) ? qualities.rolesGranted : [];
  const lineage = qualities?.lineage || null;
  void positionSpaceId;
  return { grants: granted, lineage };
}

async function annotateGrants(grants, hostedHere, positionSpaceId, reality) {
  // hostedHere already collected from current → root. Use it to find specs
  // for grants whose anchor is somewhere on this chain. For grants
  // anchored elsewhere we fall back to a per-grant SEE walk.
  const byName = new Map();
  for (const h of hostedHere) {
    if (!byName.has(h.name)) byName.set(h.name, h);
  }
  const out = [];
  for (const grant of grants) {
    let host  = null;
    let spec  = null;
    const cached = byName.get(grant.role);
    if (cached) {
      spec = cached.spec;
      host = { spaceId: cached.hostSpaceId, name: cached.hostSpaceName };
    } else if (grant.anchorSpaceId) {
      const walked = await walkForRoleSpec(grant.anchorSpaceId, grant.role, reality);
      spec = walked.spec;
      host = walked.host;
    }
    const reachesHere = !!(spec && host && (await spaceReachable(positionSpaceId, host.spaceId, spec, reality)));
    out.push({ grant, spec, host, reachesHere });
  }
  return out;
}

async function walkForRoleSpec(anchorSpaceId, roleName, reality) {
  const client = flat.state?.client;
  if (!client) return { spec: null, host: null };
  let cursor = anchorSpaceId;
  let safety = 0;
  while (cursor && safety < 12) {
    safety++;
    let snap = null;
    try { snap = await client.see(`${reality}/${cursor}`); } catch { return { spec: null, host: null }; }
    const roles = snap?.space?.qualities?.roles || snap?.qualities?.roles || {};
    const found = roles?.[roleName];
    if (found) {
      return {
        spec: found,
        host: {
          spaceId: snap?.space?._id || snap?.address?.spaceId || cursor,
          name:    snap?.space?.name || snap?.address?.spaceName || "(unknown)",
        },
      };
    }
    cursor = snap?.space?.parent || snap?.address?.parent || null;
  }
  return { spec: null, host: null };
}

async function spaceReachable(targetSpaceId, hostSpaceId, _spec, reality) {
  // Best-effort: covered when target === host or target is in host's
  // descendant chain. Doesn't replicate the full `reach` path-grammar;
  // the substrate is the source of truth for real auth decisions.
  if (!targetSpaceId || !hostSpaceId) return false;
  if (String(targetSpaceId) === String(hostSpaceId)) return true;
  const client = flat.state?.client;
  if (!client) return false;
  let cursor = targetSpaceId;
  let safety = 0;
  while (cursor && safety < 12) {
    safety++;
    if (String(cursor) === String(hostSpaceId)) return true;
    let snap = null;
    try { snap = await client.see(`${reality}/${cursor}`); } catch { return false; }
    cursor = snap?.space?.parent || snap?.address?.parent || null;
  }
  return false;
}

// ──────────────────────────────────────────────────────────────────
// Render primitives
// ──────────────────────────────────────────────────────────────────

function section(parent, title) {
  const sec = document.createElement("section");
  sec.className = "rp-section";
  const h = document.createElement("h3");
  h.className = "rp-title";
  h.textContent = title;
  sec.appendChild(h);
  parent.appendChild(sec);
  return sec;
}

function collapsibleSection(parent, title) {
  const sec = document.createElement("section");
  sec.className = "rp-section rp-collapsible";
  const head = document.createElement("h3");
  head.className = "rp-title rp-clickable";
  head.textContent = `▸ ${title}`;
  sec.appendChild(head);
  const body = document.createElement("div");
  body.className = "rp-body";
  body.style.display = "none";
  sec.appendChild(body);
  let open = false;
  head.addEventListener("click", () => {
    open = !open;
    head.textContent = (open ? "▾ " : "▸ ") + title;
    body.style.display = open ? "" : "none";
  });
  parent.appendChild(sec);
  return { sec, body };
}

function kvRow(k, v) {
  const d = document.createElement("div");
  d.className = "kv-row";
  const ke = document.createElement("span");
  ke.className = "kv-key dim";
  ke.textContent = `${k}: `;
  const ve = document.createElement("span");
  ve.textContent = v;
  d.appendChild(ke);
  d.appendChild(ve);
  return d;
}

function noteRow(text) {
  const d = document.createElement("div");
  d.className = "rp-note dim";
  d.textContent = text;
  return d;
}

function textInput(name, label) {
  const wrapper = document.createElement("div");
  wrapper.className = "field-row";
  const l = document.createElement("label");
  l.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.name = name;
  input.className = "op-input";
  wrapper.appendChild(l);
  wrapper.appendChild(input);
  return { wrapper, input };
}

function splitList(raw) {
  if (typeof raw !== "string") return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// Resolve a grantee input into an IBP target address.
//   "alice"                → "<reality>/@alice"           (local @-stance)
//   "<uuid>"               → "<reality>/@<uuid>"          (id treated as name; resolver looks up by id too)
//   "@alice"               → "<reality>/@alice"           (already prefixed)
//   "bing.com/@tabor"      → "bing.com/@tabor"            (full IBPA, pass through)
//   "bing.com#4/@tabor"    → "bing.com#4/@tabor"          (federation form, pass through)
// Heuristic: if the string contains "/" or starts with the reality's
// domain, treat it as a full address. Otherwise prefix with the local
// reality's @-stance shape.
function resolveGranteeTarget(raw, reality) {
  const s = raw.trim();
  if (s.includes("/")) return s;          // full address shape
  const cleaned = s.startsWith("@") ? s.slice(1) : s;
  return `${reality}/@${cleaned}`;
}

function shortId(id) {
  if (!id) return "";
  const s = String(id);
  return s.length > 12 ? `${s.slice(0, 8)}…` : s;
}

function shortenGrantor(g) {
  if (g === "i-am") return "I-Am";
  if (g === "auto-on-entry") return "auto-on-entry";
  return shortId(g);
}

function canSummary(spec) {
  if (!spec) return null;
  const parts = [];
  const list = (arr, label, key) => {
    if (!Array.isArray(arr) || arr.length === 0) return;
    const names = arr.map((e) => typeof e === "string" ? e : (e?.[key] || e?.name || "")).filter(Boolean);
    if (names.length === 0) return;
    parts.push(`${label}: ${names.join(", ")}`);
  };
  list(spec.canSee, "see", "name");
  list(spec.canDo, "do", "action");
  list(spec.canSummon, "summon", "pattern");
  list(spec.canBe, "be", "operation");
  return parts.length > 0 ? parts.join(" · ") : null;
}

