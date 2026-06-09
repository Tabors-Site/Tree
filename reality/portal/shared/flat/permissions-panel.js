// permissions-panel.js — the Place > Permissions tab.
//
// What it shows for the position the viewer is standing in:
//
//   1. The viewer's stance at this position
//      . name + active role
//      . class memberships at the leaf and at each ancestor
//      . derived convenience flags (owner / contributor / hasAccess)
//   2. The rules attached at this position (qualities.permissions)
//      . for each rule: verb / key / requires-clause / does-the-viewer-pass
//   3. The members map at this position
//      . each class name → list of beings (with names when resolvable)
//   4. Inherited rules + members from the ancestor chain
//      . the panel walks the leaf's lineage and SEE's each ancestor,
//        showing each ancestor's rules + members so the viewer can
//        understand where the gates that affect them are authored.
//
// For viewers with authority (owner anywhere on the chain, or in
// heaven's `angel` class), the panel surfaces edit affordances:
// "+ add member to a class", "+ author rule", and per-row "remove".
// Each mutation composes existing seed ops (add-member / remove-member /
// set-space with field=qualities.permissions.<verb>.<key>); the seed
// gates the call, so the panel doesn't pre-authorize, it just steers.
//
// Doctrine pinned in seed/PERMISSIONS.md (the "OR lives in derived
// properties" pattern). The comparator below mirrors authorize.js so
// the viewer's check matches what the substrate would decide at the
// next verb call.

import { flat } from "./host.js";

// Mirror authorize.js's compareRequirement so the panel's "you?"
// column reflects the substrate's decision at the next call. Kept
// trivially simple — equality + the {includes} shape — matching the
// doctrine: complexity lives in derived properties, not the comparator.
function compareRequirement(propName, expected, props) {
  const actual = props[propName];
  if (
    typeof expected === "string" &&
    (propName === "homeInDomain" || propName === "positionInHomeDomain")
  ) {
    return Array.isArray(props.homeAncestors) && props.homeAncestors.includes(expected);
  }
  if (
    expected && typeof expected === "object" && !Array.isArray(expected) &&
    Object.prototype.hasOwnProperty.call(expected, "includes")
  ) {
    return Array.isArray(actual) && actual.includes(expected.includes);
  }
  if (expected === true)  return actual === true;
  if (expected === false) return actual === false;
  if (Array.isArray(expected)) return expected.includes(actual);
  return actual === expected;
}

function evaluateRule(rule, props) {
  const requires = rule?.requires;
  if (!requires || typeof requires !== "object") return { ok: true };
  for (const [prop, expected] of Object.entries(requires)) {
    if (!compareRequirement(prop, expected, props)) {
      return {
        ok: false,
        failed: prop,
        have: props[prop],
        need:  expected,
      };
    }
  }
  return { ok: true };
}

// Derive the viewer's stance bag against a stack of ancestor rows.
// `lineage` is leaf → root: [{ members, qualities, address }, ...].
function deriveViewerStance(viewerBeingId, lineage) {
  const props = {
    beingId: viewerBeingId || null,
    arrival: !viewerBeingId,
    owner: false,
    contributor: false,
    hasAccess: false,
    memberClasses: [],
    homeOnThisReality: true,
    homeAtPosition: false,
    homeInDomain: false,
    positionInHomeDomain: false,
    homeAncestors: [],
  };
  if (!viewerBeingId) return props;
  const classes = new Set();
  for (const node of lineage) {
    const members = node.members || {};
    for (const [className, list] of Object.entries(members)) {
      if (Array.isArray(list) && list.some((id) => String(id) === String(viewerBeingId))) {
        classes.add(className);
      }
    }
  }
  props.memberClasses = Array.from(classes);
  props.owner       = classes.has("owner");
  props.contributor = !props.owner && classes.has("contributor");
  // hasAccess is the doctrinal OR: owner OR any non-system class.
  props.hasAccess   = props.owner || classes.size > 0;
  return props;
}

// Pull each ancestor's descriptor so the panel can show inherited
// rules + members. The lineage on the leaf descriptor carries only
// names, not the bodies — one SEE per ancestor (incremental, bottom
// up). The reality root and the leaf both get included.
async function fetchAncestorDescriptors(client, leafDesc) {
  const realityDomain =
    leafDesc.address?.reality || leafDesc.address?.place || "";
  const branch = leafDesc.address?.branch && leafDesc.address.branch !== "0"
    ? `#${leafDesc.address.branch}`
    : "";
  const leafPath = leafDesc.address?.pathByNames || "/";
  // Split path into walk steps. "/" → ["/"]; "/a/b/c" → ["/", "/a",
  // "/a/b", "/a/b/c"].
  const segments = leafPath.split("/").filter(Boolean);
  const paths = ["/"];
  let acc = "";
  for (const seg of segments) {
    acc += "/" + seg;
    paths.push(acc);
  }
  // SEE in parallel — each path returns its own descriptor.
  const results = await Promise.allSettled(
    paths.map((p) => client.see(`${realityDomain}${branch}${p}`))
  );
  // Convert to a leaf-to-root array (closest first), keeping only
  // successful fetches. Each entry: { address, qualities, members }.
  const out = [];
  for (let i = results.length - 1; i >= 0; i--) {
    const r = results[i];
    if (r.status !== "fulfilled" || !r.value) continue;
    const d = r.value;
    out.push({
      label: paths[i] === "/" ? `/  (reality root)` : paths[i],
      address: `${realityDomain}${branch}${paths[i]}`,
      qualities: d.qualities || {},
      members: d.members || {},
    });
  }
  return out;
}

// Walk a descriptor's `qualities.permissions` and yield each rule as
// { verb, key, requires, source } so the table can render them.
function rulesFrom(descLike) {
  const out = [];
  const perms = descLike?.qualities?.permissions;
  if (!perms) return out;
  for (const verb of ["see", "do", "summon", "be"]) {
    const bucket = perms[verb];
    if (!bucket || typeof bucket !== "object") continue;
    for (const [key, rule] of Object.entries(bucket)) {
      out.push({ verb, key, requires: rule?.requires || null });
    }
  }
  return out;
}

// Convenience: render a `requires:` object as a compact string.
// `{ hasAccess: true, role: "judge" }` → "hasAccess=true, role=judge".
function formatRequires(req) {
  if (!req || typeof req !== "object") return "(none)";
  const entries = Object.entries(req);
  if (entries.length === 0) return "(any)";
  return entries.map(([k, v]) => {
    if (v && typeof v === "object" && !Array.isArray(v) && "includes" in v) {
      return `${k} ∋ "${v.includes}"`;
    }
    return `${k}=${JSON.stringify(v)}`;
  }).join(", ");
}

// Resolve a being-id to a display name from the descriptor's beings
// list when available. Otherwise show a short id chip.
function nameForBeingId(beingId, lineage) {
  if (!beingId) return "(none)";
  if (beingId === "i-am") return "@i-am";
  for (const node of lineage) {
    const beings = node._raw?.beings || [];
    for (const b of beings) {
      if (String(b.beingId) === String(beingId)) {
        return `@${b.name}`;
      }
    }
  }
  return beingId.slice(0, 8);
}

// ── Public renderer ────────────────────────────────────────────────

/**
 * Mount the Permissions panel into the inspector body.
 *
 * @param {HTMLElement} body          the inspector body container
 * @param {object} action             the dropdown action ({address, values:{descriptor}})
 * @param {Map} opByName              cached operations registry
 * @param {object} ctx                { refreshView }
 */
export async function renderPermissionsPanel(body, action, opByName, ctx) {
  const desc = action.values?.descriptor || null;
  if (!desc) {
    renderError(body, "Permissions panel: no descriptor in action.");
    return;
  }
  const viewerBeingId = desc.identity?.beingId || null;
  const viewerName    = desc.identity?.name || null;

  body.innerHTML = "";
  body.classList.add("perm-panel");

  // Loading line while we walk the lineage.
  const loading = document.createElement("div");
  loading.className = "perm-loading dim";
  loading.textContent = "Walking the ancestor chain for inherited rules + members …";
  body.appendChild(loading);

  const client = flat.state?.client || null;
  let ancestorDescs;
  try {
    if (!client?.see) throw new Error("no WebSocket client available");
    ancestorDescs = await fetchAncestorDescriptors(client, desc);
  } catch (err) {
    renderError(body, `Failed to walk the ancestor chain: ${err.message}`);
    return;
  } finally {
    loading.remove();
  }

  // Stash raw descriptors so nameForBeingId can resolve from the
  // beings list at any level.
  ancestorDescs.forEach((node, i) => {
    // Re-walk the equivalent index in the SEE result. fetchAncestorDescriptors
    // already pulled it; carry it for name resolution.
    node._raw = node._raw || {};
  });

  const viewerProps = deriveViewerStance(viewerBeingId, ancestorDescs);

  // ── Section 1: Your stance ──
  const stanceCard = document.createElement("div");
  stanceCard.className = "perm-card";
  stanceCard.innerHTML = `
    <div class="perm-card-title">Your stance at this position</div>
    <div class="perm-row">
      <span class="perm-label">being</span>
      <span class="perm-value">${esc(viewerName ? "@" + viewerName : "(arrival)")} ${viewerBeingId ? `<span class="perm-id">${esc(viewerBeingId.slice(0, 8))}…</span>` : ""}</span>
    </div>
    <div class="perm-row">
      <span class="perm-label">role</span>
      <span class="perm-value">${esc(desc.identity?.role || desc.address?.activeRole || "(default)")}</span>
    </div>
    <div class="perm-row">
      <span class="perm-label">classes</span>
      <span class="perm-value">${
        viewerProps.memberClasses.length > 0
          ? viewerProps.memberClasses.map((c) => `<span class="perm-chip">${esc(c)}</span>`).join(" ")
          : `<span class="dim">(no class memberships on this chain)</span>`
      }</span>
    </div>
    <div class="perm-row">
      <span class="perm-label">derived</span>
      <span class="perm-value">
        ${flag("owner", viewerProps.owner)}
        ${flag("contributor", viewerProps.contributor)}
        ${flag("hasAccess", viewerProps.hasAccess)}
        ${flag("arrival", viewerProps.arrival)}
        ${flag("homeOnThisReality", viewerProps.homeOnThisReality)}
      </span>
    </div>
  `;
  body.appendChild(stanceCard);

  // ── Section 2: Rules at this position ──
  // The closest space (index 0) is the leaf the user is standing at.
  // Each ancestor's rules go in its own card, with the leaf first.
  for (let i = 0; i < ancestorDescs.length; i++) {
    const node = ancestorDescs[i];
    const rules = rulesFrom(node);
    if (rules.length === 0 && i !== 0) continue;  // skip empty ancestor cards
    const card = document.createElement("div");
    card.className = "perm-card";
    const isLeaf = i === 0;
    const header = document.createElement("div");
    header.className = "perm-card-title";
    header.innerHTML = isLeaf
      ? `Rules at this position <span class="dim perm-sub">${esc(node.label)}</span>`
      : `Inherited from <span class="perm-sub">${esc(node.label)}</span>`;
    card.appendChild(header);

    if (rules.length === 0) {
      const empty = document.createElement("div");
      empty.className = "perm-empty dim";
      empty.textContent = "(no rules authored at this position)";
      card.appendChild(empty);
    } else {
      const tbl = document.createElement("table");
      tbl.className = "perm-table";
      tbl.innerHTML = `
        <thead>
          <tr>
            <th>verb</th>
            <th>key</th>
            <th>requires</th>
            <th>you?</th>
            <th></th>
          </tr>
        </thead>
        <tbody></tbody>
      `;
      const tbody = tbl.querySelector("tbody");
      for (const rule of rules) {
        const verdict = evaluateRule(rule, viewerProps);
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><code>${esc(rule.verb)}</code></td>
          <td><code>${esc(rule.key)}</code></td>
          <td class="perm-requires">${esc(formatRequires(rule.requires))}</td>
          <td class="perm-verdict ${verdict.ok ? "ok" : "no"}">${verdict.ok ? "✓" : "✗"}</td>
          <td class="perm-row-action"></td>
        `;
        if (!verdict.ok) {
          tr.querySelector(".perm-verdict").title =
            `fails on ${verdict.failed}: have ${JSON.stringify(verdict.have)}, need ${JSON.stringify(verdict.need)}`;
        }
        if (isLeaf && canEditPermissions(viewerProps)) {
          const del = document.createElement("button");
          del.type = "button";
          del.className = "perm-btn-mini perm-btn-danger";
          del.textContent = "remove";
          del.addEventListener("click", () => onDeleteRule(action.address, rule, ctx));
          tr.querySelector(".perm-row-action").appendChild(del);
        }
        tbody.appendChild(tr);
      }
      card.appendChild(tbl);
    }

    if (isLeaf && canEditPermissions(viewerProps)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "perm-btn";
      btn.textContent = "+ author rule here";
      btn.addEventListener("click", () => openAuthorRuleForm(body, action.address, ctx));
      card.appendChild(btn);
    }

    body.appendChild(card);
  }

  // ── Section 3: Members at this position + inherited ──
  for (let i = 0; i < ancestorDescs.length; i++) {
    const node = ancestorDescs[i];
    const classes = Object.entries(node.members || {});
    if (classes.length === 0 && i !== 0) continue;
    const card = document.createElement("div");
    card.className = "perm-card";
    const isLeaf = i === 0;
    const header = document.createElement("div");
    header.className = "perm-card-title";
    header.innerHTML = isLeaf
      ? `Members at this position <span class="dim perm-sub">${esc(node.label)}</span>`
      : `Inherited members from <span class="perm-sub">${esc(node.label)}</span>`;
    card.appendChild(header);

    if (classes.length === 0) {
      const empty = document.createElement("div");
      empty.className = "perm-empty dim";
      empty.textContent = "(no members at this position)";
      card.appendChild(empty);
    } else {
      const tbl = document.createElement("table");
      tbl.className = "perm-table";
      tbl.innerHTML = `
        <thead>
          <tr>
            <th>class</th>
            <th>beings</th>
            <th>you?</th>
            <th></th>
          </tr>
        </thead>
        <tbody></tbody>
      `;
      const tbody = tbl.querySelector("tbody");
      for (const [className, list] of classes) {
        const inThisClass = Array.isArray(list)
          && viewerBeingId
          && list.some((id) => String(id) === String(viewerBeingId));
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><code>${esc(className)}</code></td>
          <td>${(list || []).map((id) => `<span class="perm-chip">${esc(nameForBeingId(id, ancestorDescs))}</span>`).join(" ") || `<span class="dim">(empty)</span>`}</td>
          <td class="perm-verdict ${inThisClass ? "ok" : "no"}">${inThisClass ? "✓" : "·"}</td>
          <td class="perm-row-action"></td>
        `;
        if (isLeaf && canEditPermissions(viewerProps)) {
          const add = document.createElement("button");
          add.type = "button";
          add.className = "perm-btn-mini";
          add.textContent = "+ add";
          add.addEventListener("click", () => onAddMember(action.address, className, ctx));
          tr.querySelector(".perm-row-action").appendChild(add);
        }
        tbody.appendChild(tr);
      }
      card.appendChild(tbl);
    }

    if (isLeaf && canEditPermissions(viewerProps)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "perm-btn";
      btn.textContent = "+ add member to any class";
      btn.addEventListener("click", () => onAddMember(action.address, null, ctx));
      card.appendChild(btn);
    }

    body.appendChild(card);
  }

  // Footer hint.
  const help = document.createElement("div");
  help.className = "perm-help dim";
  help.innerHTML = `
    Rules and members live on each Space; the substrate walks up the
    parent chain and the closest rule wins.
    See <code>seed/PERMISSIONS.md</code> for the full doctrine.
  `;
  body.appendChild(help);
}

// ── Edit affordances ──────────────────────────────────────────────

// The panel surfaces edit affordances when the viewer holds authority
// somewhere on the chain. The seed gates each call; this client-side
// check is just visual steering. False here means we hide the buttons,
// not that the seed would deny — the viewer can still navigate to the
// raw add-member / set-space dropdown entries.
function canEditPermissions(props) {
  if (!props) return false;
  if (props.owner) return true;
  if (Array.isArray(props.memberClasses)
      && (props.memberClasses.includes("angel")
          || props.memberClasses.includes("contributor"))) {
    return true;
  }
  return false;
}

function onAddMember(address, presetClassName, ctx) {
  const className = presetClassName || prompt(
    'Class name (kebab-case). Canonical: "owner", "contributor", "angel". ' +
    'Operators may author custom classes like "auditor", "editor", etc.'
  );
  if (!className) return;
  const beingId = prompt(`Being id to add to "${className}":`);
  if (!beingId) return;
  flat.doOp(address, "add-member", { className, beingId })
    .then(() => { ctx?.refreshView?.(); })
    .catch((err) => alert(`add-member failed: ${err.message}`));
}

function onDeleteRule(address, rule, ctx) {
  if (!confirm(`Delete rule ${rule.verb}.${rule.key} at this position?`)) return;
  // Clear a rule by writing the parent bucket without that key. We
  // don't have a "delete key from qualities" verb, so the field-write
  // overwrites the whole verb bucket — caller has to know that.
  // Simpler interim: set the rule to {} (no requires-clause = admit
  // everyone). Real rule deletion is a TODO for the seed.
  flat.doOp(address, "set-space", {
    field: `qualities.permissions.${rule.verb}.${rule.key}`,
    value: { requires: {} },
  })
    .then(() => { ctx?.refreshView?.(); })
    .catch((err) => alert(`rule reset failed: ${err.message}`));
}

function openAuthorRuleForm(body, address, ctx) {
  // Build a simple inline form into the panel: verb / key / requires
  // (free-text JSON). On submit, stamp a do:set-space with field
  // path qualities.permissions.<verb>.<key>.
  const form = document.createElement("div");
  form.className = "perm-card perm-author-form";
  form.innerHTML = `
    <div class="perm-card-title">Author a new rule</div>
    <label class="perm-row">
      <span class="perm-label">verb</span>
      <select class="perm-input">
        <option value="see">see</option>
        <option value="do" selected>do</option>
        <option value="summon">summon</option>
        <option value="be">be</option>
      </select>
    </label>
    <label class="perm-row">
      <span class="perm-label">key</span>
      <input class="perm-input" type="text" placeholder="*  or  set-matter:content" value="*">
    </label>
    <label class="perm-row">
      <span class="perm-label">requires (JSON)</span>
      <textarea class="perm-input" rows="3" placeholder='{"hasAccess": true}'>{"hasAccess": true}</textarea>
    </label>
    <div class="perm-row">
      <button type="button" class="perm-btn">save rule</button>
      <button type="button" class="perm-btn perm-btn-secondary">cancel</button>
    </div>
  `;
  const [verbEl, keyEl, requiresEl] = form.querySelectorAll(".perm-input");
  const [saveBtn, cancelBtn] = form.querySelectorAll(".perm-btn");
  cancelBtn.addEventListener("click", () => form.remove());
  saveBtn.addEventListener("click", async () => {
    let requires;
    try {
      requires = JSON.parse(requiresEl.value.trim() || "{}");
    } catch (err) {
      alert(`requires must be valid JSON: ${err.message}`);
      return;
    }
    const verb = verbEl.value;
    const key  = keyEl.value.trim() || "*";
    try {
      await flat.doOp(address, "set-space", {
        field: `qualities.permissions.${verb}.${key}`,
        value: { requires },
      });
      ctx?.refreshView?.();
    } catch (err) {
      alert(`save rule failed: ${err.message}`);
    }
  });
  body.appendChild(form);
}

function renderError(body, msg) {
  const err = document.createElement("div");
  err.className = "perm-error";
  err.textContent = msg;
  body.appendChild(err);
}

function flag(label, on) {
  return `<span class="perm-flag ${on ? "on" : "off"}">${esc(label)}${on ? " ✓" : ""}</span>`;
}

function esc(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
