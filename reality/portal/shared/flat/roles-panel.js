// roles-panel.js — the Place > Roles tab.
//
// Per seed/RolesAreAuth.md, roles ARE the permission gate. This panel
// surfaces the full auth picture at the viewer's current position:
//
//   1. Where you are — position summary + ownership claim (private,
//      public-commons, or unowned). Surfaces the nearest-claim-wins rule.
//
//   2. Roles in effect HERE — walks the ancestor chain collecting
//      qualities.roles[*]; shows each role's host space, canX summary,
//      and reach. When the nearest claim is @public, the public-commons
//      floor is shown as the visitor's implicit role.
//
//   3. Your held roles — the viewer's qualities.rolesGranted, with the
//      role spec resolved from each grant's anchor. Marks which grants
//      currently reach this position. Includes lineage (mother/father).
//
//   4. Author a role here — set-role form pre-targeting this space as
//      the host. Owner-gated by the substrate.
//
//   5. Grant a role to a being — pick one of your held roles, name a
//      target being, dispatch grant-role. The substrate checks canDo:
//      grant-role:<name> on the caller's roles before admitting.
//
// Mutations compose existing seed ops (set-role, grant-role,
// revoke-role). The substrate gates every call; this panel doesn't
// pre-authorize, it just steers. Failures surface as FORBIDDEN inline.

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
  const positionSpaceId = desc.address?.spaceId
    || desc.position?.spaceId
    || desc.space?._id
    || null;

  const session = flat.state?.session || {};
  // Sign-in detection: prefer beingId, fall back to username. The wire
  // may bind anonymous sockets to @arrival's beingId; treat that as
  // "not signed in" for panel purposes.
  const viewerName = (session.username || session.name || "").trim();
  const isAnonymous = !viewerName || viewerName === "arrival";

  // ── 0. Where you are ──────────────────────────────────────────────
  await renderPositionAndOwnership(body, { desc, reality, positionSpaceId, path });

  // ── 1. Roles in effect here ──────────────────────────────────────
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
    inEffectBody.appendChild(emptyRow("(no roles hosted on this position or any ancestor)"));
  } else {
    for (const entry of rolesInEffect) renderRoleCard(inEffectBody, entry);
  }

  // ── 2. Your roles ────────────────────────────────────────────────
  const yoursHeader = isAnonymous
    ? "Your roles"
    : `Your roles (as @${viewerName})`;
  const yoursSection = section(body, yoursHeader);
  const yoursBody = document.createElement("div");
  yoursBody.className = "panel-body";
  yoursSection.appendChild(yoursBody);

  let yours = [];
  let lineage = null;
  if (isAnonymous) {
    yoursBody.appendChild(emptyRow("sign in to see your held roles."));
  } else {
    try {
      const collected = await collectYourGrantsAndLineage(viewerName, reality, positionSpaceId);
      yours = collected.grants;
      lineage = collected.lineage;
    } catch (err) {
      yoursBody.appendChild(errorRow(`failed to collect your grants: ${err?.message || err}`));
    }
    if (yours.length === 0) {
      yoursBody.appendChild(emptyRow("(you hold no granted roles)"));
    } else {
      for (const entry of yours) renderHeldRoleCard(yoursBody, entry, viewerName);
    }
    if (lineage && (lineage.mother || lineage.father)) {
      renderLineageRow(yoursBody, lineage);
    }
  }

  // ── 3. Author a role here ────────────────────────────────────────
  const authorSection = section(body, "Author a role here");
  const authorBody = document.createElement("div");
  authorBody.className = "panel-body";
  authorSection.appendChild(authorBody);
  authorBody.appendChild(dimRow(
    "Owner-gated. The substrate admits if you own this space OR hold a role with canDo:[\"set-role\"] reaching here.",
  ));
  renderAuthorRoleForm(authorBody, {
    positionAddress,
    onResult: (err) => { if (!err && typeof refreshView === "function") refreshView(); },
  });

  // ── 4. Grant a role to a being ───────────────────────────────────
  if (!isAnonymous && yours.length > 0) {
    const grantSection = section(body, "Grant a role to a being");
    const grantBody = document.createElement("div");
    grantBody.className = "panel-body";
    grantSection.appendChild(grantBody);
    grantBody.appendChild(dimRow(
      "Pick one of your roles, name a target being. The substrate admits if any of your held roles has canDo:[\"grant-role:<role>\"] (or grant-role:*) reaching the anchor.",
    ));
    renderGrantRoleForm(grantBody, {
      heldRoles: yours,
      reality,
      onResult: (err) => { if (!err && typeof refreshView === "function") refreshView(); },
    });
  }
}

// ── Section 0: Where you are + ownership claim ───────────────────────

async function renderPositionAndOwnership(body, { desc, reality, positionSpaceId, path }) {
  const sec = section(body, "Where you are");
  const sb = document.createElement("div");
  sb.className = "panel-body";
  sec.appendChild(sb);

  const hostName = desc.space?.name || desc.address?.spaceName || (path === "/" ? "reality root" : path);
  sb.appendChild(kvRow("position", path === "/" ? "/ (reality root)" : path));
  sb.appendChild(kvRow("space", hostName));
  if (positionSpaceId) {
    sb.appendChild(kvRow("spaceId", String(positionSpaceId).slice(0, 8) + "…"));
  }

  // Walk ancestors looking for the nearest non-empty members.owner.
  // This mirrors roleAuth's findNearestOwnedAncestor; we surface the
  // result so the operator sees who owns this position and whether
  // it's a public commons.
  const claim = await findNearestOwnedAncestor(desc, reality);
  if (!claim) {
    sb.appendChild(kvRow("ownership", "(unclaimed — no ancestor on this chain has members.owner set)"));
  } else if (claim.publicCommons) {
    sb.appendChild(kvRow("ownership", `public commons (anchor: ${claim.hostName})`));
    sb.appendChild(dimRow(
      "Public-commons floor applies: visitors get a baseline role permitting see + move + create-space + create-matter + summon @cherub.",
    ));
  } else if (claim.ownerNames.length > 0) {
    const label = claim.ownerNames.map((n) => `@${n}`).join(", ");
    const where = claim.spaceId === positionSpaceId ? "(this space)" : `(inherited from ${claim.hostName})`;
    sb.appendChild(kvRow("ownership", `${label} ${where}`));
    sb.appendChild(dimRow(
      "Owner can do anything in this subtree: install roles, grant, revoke, edit qualities, set-owner.",
    ));
  } else {
    sb.appendChild(kvRow("ownership", `(owner present but not resolvable; anchor: ${claim.hostName})`));
  }
}

// ── Data collection helpers ────────────────────────────────────────

async function findNearestOwnedAncestor(desc, reality) {
  const client = flat.state?.client;
  if (!client) return null;
  const path = desc.address?.pathByNames || "/";
  const segs = path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  // Walk from current up to root; first one with non-empty members.owner wins.
  for (let i = segs.length; i >= 0; i--) {
    const ancestorPath = "/" + segs.slice(0, i).join("/");
    let snap = null;
    try {
      snap = await client.see(`${reality}${ancestorPath === "/" ? "/" : ancestorPath}`);
    } catch { continue; }
    const owners = readOwners(snap);
    if (owners.length === 0) continue;
    const hostName = snap?.space?.name || snap?.address?.spaceName
                    || (ancestorPath === "/" ? "reality root" : ancestorPath);
    const spaceId = snap?.space?._id || snap?.address?.spaceId || null;
    // Resolve owner names. Names come back when the descriptor's
    // beings catalog enriches them; otherwise we'll show short ids.
    const ownerNames = [];
    let publicCommons = false;
    for (const ownerId of owners) {
      // The "public" being is the burn-target; detect by the
      // descriptor's beings list or a fallback known-name check.
      const beingsList = Array.isArray(snap.beings) ? snap.beings : [];
      const m = beingsList.find((b) => String(b?._id || b?.id) === String(ownerId));
      const name = m?.being || m?.name || null;
      if (name === "public") publicCommons = true;
      else if (name) ownerNames.push(name);
    }
    return { spaceId, hostName, ownerNames, publicCommons };
  }
  return null;
}

function readOwners(snap) {
  const members = snap?.space?.members || snap?.members || null;
  if (!members) return [];
  const raw = members.owner;
  if (!Array.isArray(raw)) return [];
  return raw.map(String);
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
  for (const [name, spec] of Object.entries(roles)) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, spec, hostSpaceName, viaInheritance });
  }
}

async function collectYourGrantsAndLineage(viewerName, reality, positionSpaceId) {
  const client = flat.state?.client;
  if (!client) return { grants: [], lineage: null };
  let beingDesc = null;
  try {
    beingDesc = await client.see(`${reality}/@${viewerName}`);
  } catch {
    return { grants: [], lineage: null };
  }
  // The descriptor surfaces the asker-stance being block as `being`
  // (and copies its qualities up under the same name). qualities live
  // either there or at top level depending on shape.
  const qualities =
    beingDesc?.being?.qualities ||
    beingDesc?.identity?.qualities ||
    beingDesc?.qualities || {};
  const granted = Array.isArray(qualities?.rolesGranted) ? qualities.rolesGranted : [];
  const lineage = qualities?.lineage || null;

  const out = [];
  for (const grant of granted) {
    const anchorSpaceId = grant.anchorSpaceId || null;
    if (!anchorSpaceId) continue;
    let anchorDesc = null;
    let spec = null;
    let host = null;
    // Walk anchor up looking for qualities.roles[name] — same shape as
    // the substrate's getRoleSpecForGrant. We just chase ancestors via SEE.
    let cursorSpaceId = anchorSpaceId;
    let safetyDepth = 0;
    while (cursorSpaceId && safetyDepth < 12) {
      safetyDepth++;
      try {
        anchorDesc = await client.see(`${reality}/${cursorSpaceId}`);
      } catch { break; }
      const roles = anchorDesc?.space?.qualities?.roles
                 || anchorDesc?.qualities?.roles || {};
      const found = roles?.[grant.role];
      if (found) {
        spec = found;
        host = {
          spaceId: anchorDesc?.space?._id || anchorDesc?.address?.spaceId || cursorSpaceId,
          name:    anchorDesc?.space?.name || anchorDesc?.address?.spaceName || "(unknown)",
        };
        break;
      }
      cursorSpaceId = anchorDesc?.space?.parent || anchorDesc?.address?.parent || null;
    }
    // Best-effort "reaches here" check — true if the host's spaceId
    // appears in the current position's ancestor chain. Skipped when
    // we lack info; substrate is the source of truth.
    let reachesHere = false;
    if (host && positionSpaceId) {
      reachesHere = await reachesByAncestorWalk(positionSpaceId, host.spaceId, reality);
      // If the spec carries an explicit `reach`, the substrate evaluates
      // it; we don't replicate the full bash-style grammar here.
    }
    out.push({
      grant,
      spec,
      host,
      reachesHere,
    });
  }
  return { grants: out, lineage };
}

async function reachesByAncestorWalk(targetSpaceId, hostSpaceId, reality) {
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

function renderRoleCard(parent, entry) {
  const card = document.createElement("div");
  card.className = "role-card";

  const head = document.createElement("div");
  head.className = "role-card-head";
  const nameEl = document.createElement("strong");
  nameEl.textContent = entry.name;
  head.appendChild(nameEl);
  const hostLabel = document.createElement("span");
  hostLabel.className = "role-card-host dim";
  hostLabel.textContent = entry.viaInheritance
    ? ` — inherited from ${entry.hostSpaceName}`
    : ` — hosted here (${entry.hostSpaceName})`;
  head.appendChild(hostLabel);
  card.appendChild(head);

  if (entry.spec?.description) {
    const d = document.createElement("div");
    d.className = "role-card-desc dim";
    d.textContent = entry.spec.description;
    card.appendChild(d);
  }

  const can = canSummary(entry.spec);
  if (can) {
    const c = document.createElement("div");
    c.className = "role-card-can";
    c.textContent = can;
    card.appendChild(c);
  }

  if (Array.isArray(entry.spec?.reach) && entry.spec.reach.length > 0) {
    const r = document.createElement("div");
    r.className = "role-card-reach dim";
    r.textContent = `reach: ${entry.spec.reach.join(", ")}`;
    card.appendChild(r);
  }

  parent.appendChild(card);
}

function renderHeldRoleCard(parent, entry, viewerName) {
  const card = document.createElement("div");
  card.className = "role-card";

  const head = document.createElement("div");
  head.className = "role-card-head";
  const nameEl = document.createElement("strong");
  nameEl.textContent = entry.grant.role;
  head.appendChild(nameEl);

  const statusEl = document.createElement("span");
  statusEl.className = entry.reachesHere ? "role-card-status active" : "role-card-status dim";
  statusEl.textContent = entry.reachesHere ? " ● reaches here" : " ○ inert here";
  head.appendChild(statusEl);
  card.appendChild(head);

  if (entry.spec?.description) {
    const d = document.createElement("div");
    d.className = "role-card-desc dim";
    d.textContent = entry.spec.description;
    card.appendChild(d);
  }

  const can = canSummary(entry.spec);
  if (can) {
    const c = document.createElement("div");
    c.className = "role-card-can";
    c.textContent = can;
    card.appendChild(c);
  }

  if (Array.isArray(entry.spec?.reach) && entry.spec.reach.length > 0) {
    const r = document.createElement("div");
    r.className = "role-card-reach dim";
    r.textContent = `role reach: ${entry.spec.reach.join(", ")}`;
    card.appendChild(r);
  }

  const meta = document.createElement("div");
  meta.className = "role-card-meta dim";
  const anchor = entry.grant.anchorSpaceId
    ? `anchor ${String(entry.grant.anchorSpaceId).slice(0, 8)}…`
    : entry.grant.anchorBeingId
      ? `anchor @${String(entry.grant.anchorBeingId).slice(0, 8)}…`
      : "no anchor";
  meta.textContent = [
    anchor,
    entry.grant.grantedBy ? `granted by ${entry.grant.grantedBy}` : null,
    entry.grant.grantedAt ? entry.grant.grantedAt.slice(0, 10) : null,
  ].filter(Boolean).join(" · ");
  card.appendChild(meta);

  // Revoke button — only when the viewer is the original grantor.
  if (viewerName && entry.grant.grantedBy === viewerName) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "revoke this grant";
    btn.className = "btn-warn";
    btn.style.marginTop = "6px";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await flat.doOp(
          `${flat.state?.discovery?.reality}/@${viewerName}`,
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
        btn.textContent = `revoke failed: ${err?.message || err}`;
        btn.disabled = false;
      }
    });
    card.appendChild(btn);
  }

  parent.appendChild(card);
}

function renderLineageRow(parent, lineage) {
  const card = document.createElement("div");
  card.className = "role-card";
  const head = document.createElement("div");
  head.className = "role-card-head";
  head.appendChild(document.createTextNode("Lineage"));
  card.appendChild(head);
  const body = document.createElement("div");
  body.className = "role-card-meta dim";
  const m = lineage.mother ? `mother: ${String(lineage.mother).slice(0, 8)}…` : null;
  const f = lineage.father ? `father: ${String(lineage.father).slice(0, 8)}…` : null;
  body.textContent = [m, f].filter(Boolean).join(" · ");
  card.appendChild(body);
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
  const canDoField = textInput("canDo", "canDo actions (comma-separated, e.g. set-matter,create-matter)");
  const canSeeField = textInput("canSee", "canSee SEE-op names (comma-separated, e.g. place,library)");
  const canSummonField = textInput("canSummon", "canSummon @being patterns (comma-separated, e.g. @coder,@reviewer)");
  const canBeField = textInput("canBe", "canBe operations (comma-separated, e.g. release)");
  const reachField = textInput("reach", "Reach patterns (optional; comma-separated, e.g. /docs/**,!/coders/legacy/**)");
  const descField = textInput("description", "Description (optional)");

  for (const f of [nameField, canDoField, canSeeField, canSummonField, canBeField, reachField, descField]) {
    form.appendChild(f.wrapper);
  }

  const submit = document.createElement("button");
  submit.type = "button";
  submit.textContent = "Install role at this space";
  submit.className = "btn-primary";
  const result = document.createElement("div");
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
      canDo:     splitList(canDoField.input.value).map((action) => ({ action })),
      canSee:    splitList(canSeeField.input.value),
      canSummon: splitList(canSummonField.input.value).map((pattern) => ({ pattern })),
      canBe:     splitList(canBeField.input.value).map((operation) => ({ operation })),
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

  parent.appendChild(form);
}

function renderGrantRoleForm(parent, { heldRoles, reality, onResult }) {
  const form = document.createElement("div");
  form.className = "grant-role-form";

  // Role select — populated from the viewer's held roles.
  const roleField = document.createElement("div");
  roleField.className = "op-field";
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

  const granteeField = textInput("grantee", "Grantee being name (e.g. alice)");
  const anchorField = textInput("anchor", "Anchor space id (defaults to current position)");
  form.appendChild(granteeField.wrapper);
  form.appendChild(anchorField.wrapper);

  const result = document.createElement("div");
  const submit = document.createElement("button");
  submit.type = "button";
  submit.textContent = "Grant role";
  submit.className = "btn-primary";
  submit.addEventListener("click", async () => {
    submit.disabled = true;
    result.textContent = "";
    const role = roleSelect.value;
    const grantee = granteeField.input.value.trim();
    if (!grantee) {
      result.className = "action-result action-err";
      result.textContent = "Grantee name is required.";
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
    try {
      await flat.doOp(`${reality}/@${grantee}`, "grant-role", {
        role,
        anchorSpaceId,
        anchorBeingId: null,
      });
      result.className = "action-result action-ok";
      result.textContent = `granted "${role}" to @${grantee} at ${String(anchorSpaceId).slice(0, 8)}…`;
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

function dimRow(text) {
  const d = document.createElement("div");
  d.className = "panel-note dim";
  d.style.marginTop = "4px";
  d.style.marginBottom = "8px";
  d.textContent = text;
  return d;
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
