// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// Inbox renderer for envelope intent "able-request".
//
// The acquisitionOps "ask-able" op sends a SUMMON to a space's
// owner when the able policy is asked:"queue". The owner sees the
// request in their inbox and approves or denies. Approve =
// dispatch grant-able on the asker, then reply summon with
// {result:"approved"}. Deny = reply summon with {result:"denied"}.
//
// The renderer is server-side: it resolves the asker's stance from
// content (using the projection if only the beingId was recorded)
// and bakes concrete arguments into the action-buttons spec. The
// inbox panel just renders the buttons and dispatches the ops/reply
// when the user clicks.
//
// Sovereignty notes:
//   - Approve dispatches grant-able on the OWNER'S authority (the
//     owner is the viewer and the actor of the ops the panel sends).
//     Auth gates the grant the same way it would for any do(grant-
//     able) call.
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
 * @param {object} ctx    { story, history }
 */
export async function ableRequestRenderer(entry, ctx) {
  const c = entry.content || {};
  const able          = typeof c.able === "string" ? c.able : null;
  const anchorSpaceId = typeof c.anchorSpaceId === "string" ? c.anchorSpaceId : null;
  const askerBeingId  = typeof c.askerBeingId === "string" ? c.askerBeingId : null;
  const reason        = typeof c.reason === "string" ? c.reason : null;
  const story       = ctx?.story || "";
  const history       = ctx?.history  || "0";

  // Resolve asker stance: prefer the askerName recorded in content;
  // fall back to a projection read by beingId so we can address the
  // grant op even if the request didn't carry a name.
  let askerStance = null;
  let askerName   = typeof c.askerName === "string" ? c.askerName : null;
  if (askerName) {
    askerStance = `${story}/@${askerName}`;
  } else if (askerBeingId) {
    try {
      const slot = await loadOrFold("being", askerBeingId, history);
      askerName = slot?.state?.name || null;
      if (askerName) askerStance = `${story}/@${askerName}`;
    } catch {
      askerStance = null;
    }
  }

  const body = {
    html:
      `wants <strong>${escapeHtml(able || "?")}</strong> ` +
      `at <span class="muted">${escapeHtml(String(anchorSpaceId || "?")).slice(0, 12)}…</span>` +
      (reason ? `<div class="dim">reason: ${escapeHtml(reason)}</div>` : ""),
  };

  // If we can't address the asker, surface the failure on the approve
  // button and leave deny enabled (the owner can still reject cleanly).
  const cantApprove = !askerStance || !able || !anchorSpaceId;
  const approveBtn = cantApprove
    ? {
        label:    "approve",
        kind:     "ok",
        disabled: !askerStance ? "asker not addressable" : "request missing able or anchor",
      }
    : {
        label: "approve",
        kind:  "ok",
        ops: [
          {
            target: askerStance,
            action: "grant-able",
            args:   { able, anchorSpaceId, anchorBeingId: null },
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
