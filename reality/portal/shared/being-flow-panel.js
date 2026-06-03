// being-flow-panel.js — per-being roleFlow editor.
//
// Spec, Step 5 of role-manager.md: "Being panel: shows a being's
// roleFlow as an editable list of clauses." This module mounts that
// editor against any being a portal hands it. The mad-libs UI and the
// save path are shared with the role-manager panel's own
// "edit your own flow" surface (renderFlowEditor in
// role-manager-panel.js); this file is the thin frame that:
//
//   - shows the target being's identity header (name, cognition,
//     defaultRole, beingId tail)
//   - sources the role-name catalog from the role-manager being's
//     descriptor entry (`descriptor.beings[role-manager].catalogs.roles`)
//     so the role pickers populate without a separate SEE
//   - hands the editor a target stance pointing at the chosen being
//
// Authorization is enforced by the verb gate at save time. Operators
// without set-being permission on the target see FORBIDDEN inline;
// the panel doesn't gate read-only beings client-side beyond that.

import { renderFlowEditor } from "./role-manager-panel.js";

export function renderBeingFlowPanel(container, beingEntry, ctx) {
  container.innerHTML = "";

  if (!beingEntry?.being) {
    appendHint(container, "no being selected");
    return;
  }
  if (!ctx?.username) {
    appendHint(container, "Sign in to edit role flows.");
    return;
  }

  // ── Header ───────────────────────────────────────────────────
  const head = document.createElement("h3");
  head.className = "rm-pane-title";
  head.textContent = `@${beingEntry.being} — Role Flow`;
  container.appendChild(head);

  const sub = document.createElement("div");
  sub.className = "rm-sub";
  const subBits = [];
  if (beingEntry.cognition) subBits.push(`cognition: ${beingEntry.cognition}`);
  if (beingEntry.defaultRole) subBits.push(`default role: ${beingEntry.defaultRole}`);
  if (beingEntry.beingId)     subBits.push(`id: ${String(beingEntry.beingId).slice(0, 8)}`);
  sub.textContent = subBits.join("  ·  ") || " ";
  container.appendChild(sub);

  // ── Catalog source ──────────────────────────────────────────
  // Role names ride on the role-manager being's descriptor entry
  // (descriptor.js#buildRoleManagerCatalogs). Any authenticated being
  // who can SEE the place can read them; no heaven SEE.
  const desc = ctx.descriptor;
  const pool = [].concat(desc?.beings || [], desc?.residents || []);
  const rmEntry = pool.find((e) => e.being === "role-manager");
  const allRoles = (rmEntry?.catalogs?.roles || []).map((r) => ({ name: r.name }));

  // ── Current flow on the target ──────────────────────────────
  // The flow lives at qualities.roleFlow on the being row; the
  // descriptor's enrichBeings folds qualities into each entry.
  const initialFlow = Array.isArray(beingEntry?.qualities?.roleFlow)
    ? beingEntry.qualities.roleFlow
    : [];

  // ── Editor ─────────────────────────────────────────────────
  const bq = ctx.branch && ctx.branch !== "0" ? `#${ctx.branch}` : "";
  const targetStance = `${ctx.reality}${bq}/@${beingEntry.being}`;
  container.appendChild(renderFlowEditor(allRoles, ctx, {
    headerLabel:  `clauses (${initialFlow.length})`,
    initialFlow,
    targetStance,
  }));
}

function appendHint(container, msg) {
  const div = document.createElement("div");
  div.className = "rm-sub";
  div.style.marginTop = "8px";
  div.textContent = msg;
  container.appendChild(div);
}
