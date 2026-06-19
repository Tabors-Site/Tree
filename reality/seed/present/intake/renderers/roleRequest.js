// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Inbox renderer for envelope intent "role-request".
//
// The acquisitionOps "ask-role" op sends a SUMMON to a space's
// owner when the role policy is asked:"queue". The owner sees the
// request in their inbox and approves or denies. Approve =
// dispatch grant-role on the asker, then reply summon with
// {result:"approved"}. Deny = reply summon with {result:"denied"}.
//
// The renderer is server-side: it resolves the asker's stance from
// content (using the projection if only the beingId was recorded)
// and bakes concrete arguments into the action-buttons spec. The
// inbox panel just renders the buttons and dispatches the ops/reply
// when the user clicks.
//
// Sovereignty notes:
//   - Approve dispatches grant-role on the OWNER'S authority (the
//     owner is the viewer and the actor of the ops the panel sends).
//     Auth gates the grant the same way it would for any do(grant-
//     role) call.
//   - Deny is just a reply summon; no side effect, no implicit ban.

import { loadOrFold } from "../../../materials/projections.js";

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {object} entry  inbox entry (carries the envelope content)
 * @param {object} ctx    { story, branch }
 */
export async function roleRequestRenderer(entry, ctx) {
  const c = entry.content || {};
  const role          = typeof c.role === "string" ? c.role : null;
  const anchorSpaceId = typeof c.anchorSpaceId === "string" ? c.anchorSpaceId : null;
  const askerBeingId  = typeof c.askerBeingId === "string" ? c.askerBeingId : null;
  const reason        = typeof c.reason === "string" ? c.reason : null;
  const story       = ctx?.story || "";
  const branch        = ctx?.branch  || "0";

  // Resolve asker stance: prefer the askerName recorded in content;
  // fall back to a projection read by beingId so we can address the
  // grant op even if the request didn't carry a name.
  let askerStance = null;
  let askerName   = typeof c.askerName === "string" ? c.askerName : null;
  if (askerName) {
    askerStance = `${story}/@${askerName}`;
  } else if (askerBeingId) {
    try {
      const slot = await loadOrFold("being", askerBeingId, branch);
      askerName = slot?.state?.name || null;
      if (askerName) askerStance = `${story}/@${askerName}`;
    } catch {
      askerStance = null;
    }
  }

  const body = {
    html:
      `wants <strong>${escapeHtml(role || "?")}</strong> ` +
      `at <span class="muted">${escapeHtml(String(anchorSpaceId || "?")).slice(0, 12)}…</span>` +
      (reason ? `<div class="dim">reason: ${escapeHtml(reason)}</div>` : ""),
  };

  // If we can't address the asker, surface the failure on the approve
  // button and leave deny enabled (the owner can still reject cleanly).
  const cantApprove = !askerStance || !role || !anchorSpaceId;
  const approveBtn = cantApprove
    ? {
        label:    "approve",
        kind:     "ok",
        disabled: !askerStance ? "asker not addressable" : "request missing role or anchor",
      }
    : {
        label: "approve",
        kind:  "ok",
        ops: [
          {
            target: askerStance,
            action: "grant-role",
            args:   { role, anchorSpaceId, anchorBeingId: null },
          },
        ],
        reply: { content: { result: "approved" } },
      };

  return {
    shape:   "action-buttons",
    body,
    buttons: [
      approveBtn,
      {
        label: "deny",
        kind:  "warn",
        reply: { content: { result: "denied" } },
      },
    ],
  };
}
