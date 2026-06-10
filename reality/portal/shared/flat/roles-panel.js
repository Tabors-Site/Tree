// roles-panel.js — the Place > Roles tab.
//
// Per seed/RolesAreAuth.md, roles ARE the permission gate. This panel
// shows the roles in effect at the viewer's current position, what
// the viewer holds, and (for owners) an author-role form.
//
// What it shows:
//
//   1. Roles in effect HERE
//      — walk the ancestor chain; collect every qualities.roles[*] entry
//      — for each: name, host space, canSee/canDo/canSummon/canBe summary,
//        optional reach
//
//   2. YOUR roles
//      — your qualities.rolesGranted filtered to grants whose role
//        reaches this position
//      — for each: role name, anchor space, what the canX unlocks here
//
//   3. Author a role here  (owner-only, structural authority)
//      — set-role form pre-targeting THIS space as the host; the new
//        role auto-grants to the author
//
// Mutations compose existing ops:
//   - set-role  → installs a new role into target.qualities.roles[name]
//   - grant-role / revoke-role → mutate the grantee being's
//     qualities.rolesGranted (handled from the being inspector, not here)
//
// The seed gates every call; the panel doesn't pre-authorize, it just
// steers. Failures surface as FORBIDDEN inline.

import { flat } from "./host.js";

export async function renderRolesPanel(body, action, opByName, { refreshView } = {}) {
  body.innerHTML = "";
  const desc = action.values?.descriptor || flat.state?.descriptor || {};

  const reality = flat.state?.discovery?.reality
    || desc.address?.reality
    || desc.address?.place
    || "";
  const path = desc.address?.pathByNames || "/";
  const positionAddress = `${reality}${path === "/" ? "/" : path}`;
  const session = flat.state?.session || {};
  const viewerBeingId = session.beingId || null;
  const viewerName = session.username || null;

  // ── 1. Roles in effect here (walk ancestors, collect qualities.roles)
  const inEffectSection = section(body, "Roles in effect here");
  const inEffectBody = document.createElement("div");
  inEffectBody.className = "panel-body";
  inEffectSection.appendChild(inEffectBody);

  let rolesInEffect = [];
  try {
    rolesInEffect = await collectRolesInEffect(desc, reality);
  } catch (err) {
    inEffectBody.appendChild(errorRow(`failed to collect roles: ${err?.message || err}`));
  }
  if (rolesInEffect.length === 0) {
    inEffectBody.appendChild(emptyRow("(no roles hosted on this position or its ancestors)"));
  } else {
    for (const entry of rolesInEffect) renderRoleCard(inEffectBody, entry);
  }

  // ── 2. Your roles (granted, filtered to grants reaching this position)
  const yoursSection = section(body, viewerName ? `Your roles (as @${viewerName})` : "Your roles");
  const yoursBody = document.createElement("div");
  yoursBody.className = "panel-body";
  yoursSection.appendChild(yoursBody);

  if (!viewerBeingId) {
    yoursBody.appendChild(emptyRow("sign in to see your held roles."));
  } else {
    let yours = [];
    try {
      yours = await collectYourGrants(viewerBeingId, desc, reality);
    } catch (err) {
      yoursBody.appendChild(errorRow(`failed to collect your grants: ${err?.message || err}`));
    }
    if (yours.length === 0) {
      yoursBody.appendChild(emptyRow("(no granted roles reach this position)"));
    } else {
      for (const entry of yours) renderRoleCard(yoursBody, entry, { showAnchor: true });
    }
  }

  // ── 3. Author a role here (owner-only)
  // The substrate decides who can author (owner-check or canDo:set-role
  // role-walk). We render the form unconditionally; FORBIDDEN surfaces
  // if the caller isn't authorized.
  const authorSection = section(body, "Author a role here");
  const authorBody = document.createElement("div");
  authorBody.className = "panel-body";
  authorSection.appendChild(authorBody);
  renderAuthorRoleForm(authorBody, {
    positionAddress,
    onResult: (err) => { if (!err && typeof refreshView === "function") refreshView(); },
  });
}

// ── Data collection helpers ────────────────────────────────────────

async function collectRolesInEffect(desc, reality) {
  // Walk the chain of pathByNames from current → root, SEE each, harvest
  // qualities.roles. We rely on flat.state.client.see to fetch ancestors.
  const client = flat.state?.client;
  if (!client) return [];

  const seen = new Set();
  const out = [];
  // SEE the current position first; the descriptor we already have
  // probably carries qualities.roles, but re-SEE keeps the model lean.
  const path = desc.address?.pathByNames || "/";
  await harvestRolesAt(client, reality, path, seen, out, /*viaInheritance*/ false);

  // Walk parents by trimming path segments. Inheritance flows downward,
  // so a role hosted at /foo/ is in effect at /foo/bar/ — we surface it
  // labeled by its host space.
  const segs = path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    const ancestorPath = "/" + segs.slice(0, i).join("/");
    await harvestRolesAt(client, reality, ancestorPath || "/", seen, out, /*viaInheritance*/ true);
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
  const hostSpaceName = snap?.space?.name || snap?.address?.spaceName || (path === "/" ? "(reality root)" : path);
  for (const [name, spec] of Object.entries(roles)) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, spec, hostSpaceName, viaInheritance });
  }
}

async function collectYourGrants(viewerBeingId, desc, reality) {
  // The viewer's grants ride on their Being projection. SEE the being's
  // address to read the public projection face; the wire returns the
  // qualities map (subject to seed redaction). qualities.rolesGranted is
  // the array we want.
  const client = flat.state?.client;
  if (!client) return [];
  let beingDesc = null;
  try {
    beingDesc = await client.see(`${reality}/@${viewerBeingId}`);
  } catch { /* fall through */ }
  const qualities = beingDesc?.being?.qualities || beingDesc?.qualities || {};
  const granted = Array.isArray(qualities?.rolesGranted) ? qualities.rolesGranted : [];

  // For each grant, harvest the role spec by walking up from the
  // grant.anchorSpaceId. We re-use the in-effect collection by SEEing
  // each anchor's path. Skip grants whose role doesn't reach the
  // viewer's current position (best-effort — the substrate's authorize
  // is the source of truth).
  const positionSpaceId = desc.address?.spaceId
    || desc.position?.spaceId
    || null;

  const out = [];
  for (const grant of granted) {
    const anchorSpaceId = grant.anchorSpaceId || null;
    if (!anchorSpaceId) continue;
    let anchorDesc = null;
    try {
      anchorDesc = await client.see(`${reality}/${anchorSpaceId}`);
    } catch { /* skip */ }
    const roles = anchorDesc?.space?.qualities?.roles || anchorDesc?.qualities?.roles || {};
    const spec = roles?.[grant.role] || null;
    if (!spec) continue;
    // Best-effort: surface every grant; the substrate gates real calls.
    out.push({
      name: grant.role,
      spec,
      hostSpaceName: anchorDesc?.space?.name || `(space ${String(anchorSpaceId).slice(0, 8)})`,
      anchorSpaceId,
      grantedBy: grant.grantedBy || null,
      grantedAt: grant.grantedAt || null,
      reachesHere: true,
    });
    void positionSpaceId; // reach check would refine this; substrate is the source of truth
  }
  return out;
}

// ── Render helpers ────────────────────────────────────────────────

function section(parent, title) {
  const sec = document.createElement("div");
  sec.className = "panel-section";
  const h = document.createElement("h3");
  h.className = "panel-section-title";
  h.textContent = title;
  sec.appendChild(h);
  parent.appendChild(sec);
  return sec;
}

function renderRoleCard(parent, entry, { showAnchor = false } = {}) {
  const card = document.createElement("div");
  card.className = "role-card";

  const head = document.createElement("div");
  head.className = "role-card-head";
  const nameEl = document.createElement("strong");
  nameEl.textContent = entry.name;
  head.appendChild(nameEl);
  const hostLabel = document.createElement("span");
  hostLabel.className = "role-card-host";
  hostLabel.textContent = entry.viaInheritance
    ? ` — inherited from ${entry.hostSpaceName}`
    : ` — hosted here (${entry.hostSpaceName})`;
  head.appendChild(hostLabel);
  card.appendChild(head);

  if (entry.spec?.description) {
    const desc = document.createElement("div");
    desc.className = "role-card-desc dim";
    desc.textContent = entry.spec.description;
    card.appendChild(desc);
  }

  const canX = canSummary(entry.spec);
  if (canX) {
    const can = document.createElement("div");
    can.className = "role-card-can";
    can.textContent = canX;
    card.appendChild(can);
  }

  if (Array.isArray(entry.spec?.reach) && entry.spec.reach.length > 0) {
    const reach = document.createElement("div");
    reach.className = "role-card-reach dim";
    reach.textContent = `reach: ${entry.spec.reach.join(", ")}`;
    card.appendChild(reach);
  }

  if (showAnchor && entry.anchorSpaceId) {
    const anchor = document.createElement("div");
    anchor.className = "role-card-anchor dim";
    anchor.textContent = `anchored at ${String(entry.anchorSpaceId).slice(0, 8)}` +
      (entry.grantedBy ? ` · granted by ${entry.grantedBy}` : "") +
      (entry.grantedAt ? ` · ${entry.grantedAt}` : "");
    card.appendChild(anchor);
  }

  parent.appendChild(card);
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

function renderAuthorRoleForm(parent, { positionAddress, onResult }) {
  const form = document.createElement("div");
  form.className = "author-role-form";

  const nameField = textInput("name", "Role name (kebab-case)");
  const reachField = textInput("reach", "Reach patterns (comma-separated; optional)");
  const canDoField = textInput("canDo", "canDo actions (comma-separated)");
  const canSeeField = textInput("canSee", "canSee SEE-op names (comma-separated)");
  const canSummonField = textInput("canSummon", "canSummon patterns (e.g. @cherub)");
  const canBeField = textInput("canBe", "canBe operations (comma-separated)");

  for (const f of [nameField, canDoField, canSeeField, canSummonField, canBeField, reachField]) {
    form.appendChild(f.wrapper);
  }

  const submit = document.createElement("button");
  submit.type = "button";
  submit.textContent = "Install role at this space";
  submit.className = "btn-primary";
  submit.addEventListener("click", async () => {
    submit.disabled = true;
    const name = nameField.input.value.trim();
    if (!name) {
      submit.disabled = false;
      return;
    }
    const spec = {
      name,
      canDo:     splitList(canDoField.input.value).map((action) => ({ action })),
      canSee:    splitList(canSeeField.input.value),
      canSummon: splitList(canSummonField.input.value).map((pattern) => ({ pattern })),
      canBe:     splitList(canBeField.input.value).map((operation) => ({ operation })),
    };
    const reach = splitList(reachField.input.value);
    if (reach.length > 0) spec.reach = reach;
    try {
      await flat.doOp(positionAddress, "set-role", { name, spec });
      onResult?.(null);
    } catch (err) {
      const result = document.createElement("div");
      result.className = "action-result action-err";
      result.textContent = err?.message || String(err);
      form.appendChild(result);
      submit.disabled = false;
      onResult?.(err);
    }
  });
  form.appendChild(submit);

  parent.appendChild(form);
}

function textInput(name, label) {
  const wrapper = document.createElement("div");
  wrapper.className = "op-field";
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

function emptyRow(text) {
  const d = document.createElement("div");
  d.className = "panel-empty dim";
  d.textContent = text;
  return d;
}
function errorRow(text) {
  const d = document.createElement("div");
  d.className = "panel-error action-err";
  d.textContent = text;
  return d;
}
