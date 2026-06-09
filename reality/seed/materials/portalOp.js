// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// `do form-portal` — create a portal Matter in the actor's current
// space, pointing at a foreign IBPA address.
//
// A portal Matter is a normal Matter that carries `qualities.portal`:
//
//   qualities.portal = {
//     target:    "<reality>#<branch>/<position>"   // foreign IBPA
//     createdBy: "<beingId>"
//     createdAt: "<iso-timestamp>"
//     expiresAt: "<iso-timestamp>" | null
//   }
//
// What each VIEWER experiences through the portal is emergent from
// the foreign reality's stance auth for THEIR identity (per
// CROSS-WORLD.md and the "portal == window == full" doctrine in
// memory). The portal Matter doesn't pretend to know what each viewer
// can do; it just points. The foreign substrate decides per-call:
//
//   - foreign side grants SEE      → renders camera-through ("window")
//   - foreign side grants SEE+DO   → can reach in and act ("portal")
//   - foreign side grants SEE+DO+BE → can walk through (do:move with
//                                     position = portal target)
//   - foreign side grants nothing  → black window (matter visible
//                                     locally, contents not)
//
// The 3D / flat portal extensions render this by issuing live verbs at
// `qualities.portal.target` on behalf of the viewer — same canopy
// dispatch path as any other cross-world verb.

import { registerOperation } from "../ibp/operations.js";
import { IbpError, IBP_ERR } from "../ibp/protocol.js";
import { emitFact } from "../past/fact/facts.js";
import { detectTargetKind, targetIdOf } from "./_targetShape.js";
import { v4 as uuidv4 } from "uuid";

// Matches the IBPA shapes a portal can point at. A portal opens onto
// a different WORLD (different reality OR different branch); same
// reality+branch isn't a portal, it's just a reference. Accepted:
//
//   <reality>#<branch>/<position>   foreign reality + foreign branch
//   <reality>/<position>            foreign reality (implicit branch)
//   #<branch>/<position>            same reality, foreign branch
//
// "Reality" can be either a TLD-style domain (bing.com, tabors.site)
// or a single-word host (localhost, etc.) — both are legitimate
// substrate identities. Branch path follows the alternating-segment
// grammar (BRANCH_RE in address.js).
const IBPA_RE =
  /^(?:[a-zA-Z0-9.\-_]+(?:#[^/]+)?|#[^/]+)\/.+$/;

async function formPortalHandler({ target, params, summonCtx, identity }) {
  const { target: foreignAddress, name, expiresAt } = params || {};

  if (typeof foreignAddress !== "string" || !foreignAddress.length) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      "form-portal: `target` must be a foreign IBPA string (e.g. \"bing.com#0/library\")",
    );
  }
  if (!IBPA_RE.test(foreignAddress)) {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `form-portal: \`target\` doesn't look like a foreign IBPA: "${foreignAddress}". ` +
        `Expected "<reality-domain>[#<branch>]/<position>".`,
    );
  }

  // Resolve the containing space. Portal forms inside the space the
  // actor is acting on. Matter targets get the matter's containing
  // space; space targets are the space itself.
  const kind = detectTargetKind(target);
  let spaceId;
  if (kind === "space") {
    spaceId = String(targetIdOf(target));
  } else if (kind === "matter") {
    const { loadOrFold } = await import("./projections.js");
    const branch = summonCtx?.actorAct?.branch || "0";
    const matterSlot = await loadOrFold("matter", String(targetIdOf(target)), branch);
    spaceId = matterSlot?.state?.spaceId || null;
    if (!spaceId) {
      throw new IbpError(
        IBP_ERR.SPACE_NOT_FOUND,
        "form-portal: cannot determine containing space for the matter target",
      );
    }
  } else {
    throw new IbpError(
      IBP_ERR.INVALID_INPUT,
      `form-portal: target must be a space or matter (got ${kind})`,
    );
  }

  const actorBeingId = identity?.beingId
    ? String(identity.beingId)
    : null;
  if (!actorBeingId) {
    throw new IbpError(
      IBP_ERR.UNAUTHORIZED,
      "form-portal requires an identified actor",
    );
  }

  // Optional TTL — accept ISO string or null.
  let normalizedExpiresAt = null;
  if (expiresAt != null) {
    if (typeof expiresAt !== "string") {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        "form-portal: `expiresAt` must be an ISO 8601 string",
      );
    }
    const parsed = Date.parse(expiresAt);
    if (Number.isNaN(parsed)) {
      throw new IbpError(
        IBP_ERR.INVALID_INPUT,
        `form-portal: \`expiresAt\` is not a parseable date: "${expiresAt}"`,
      );
    }
    normalizedExpiresAt = new Date(parsed).toISOString();
  }

  const matterId = uuidv4();
  const branch = summonCtx?.targetBranch || summonCtx?.actorAct?.branch || "0";
  const createdAt = new Date().toISOString();

  // Portal qualities block. `target` is the foreign IBPA the portal
  // points at; viewers' experience is gated by foreign-side stance
  // auth at this target. createdBy + createdAt are forensic. expiresAt
  // is an optional TTL the wake scheduler can fire delete on.
  const portalQualities = {
    target:    foreignAddress,
    createdBy: actorBeingId,
    createdAt,
    expiresAt: normalizedExpiresAt,
  };

  // 1. Birth the matter with origin="cross-place" — its content lives
  //    on the foreign reality, not on local disk or the local IBP
  //    matter store.
  await emitFact(
    {
      verb: "do",
      action: "create-matter",
      beingId: actorBeingId,
      target: { kind: "matter", id: matterId },
      params: {
        spaceId,
        beingId: actorBeingId,
        origin: "cross-place",
        name: name || `portal → ${foreignAddress}`,
        parentMatterId: null,
      },
      actId: summonCtx?.actId || null,
      branch,
    },
    summonCtx,
  );

  // 2. Stamp the portal qualities namespace. Same moment, same
  //    deltaF, atomically sealed with the create-matter fact.
  await emitFact(
    {
      verb: "do",
      action: "set-matter",
      beingId: actorBeingId,
      target: { kind: "matter", id: matterId },
      params: {
        field: "qualities.portal",
        value: portalQualities,
        merge: false,
      },
      actId: summonCtx?.actId || null,
      branch,
    },
    summonCtx,
  );

  return {
    formed: true,
    matterId,
    spaceId,
    target: foreignAddress,
    expiresAt: normalizedExpiresAt,
    _factTarget: { kind: "matter", id: matterId },
  };
}

registerOperation("form-portal", {
  targets: ["space", "matter"],
  ownerExtension: "seed",
  factAction: "form-portal",
  args: {
    target: {
      type: "text",
      label: "Foreign IBPA (e.g. \"bing.com#0/library\")",
      required: true,
    },
    name: {
      type: "text",
      label: "Portal name (optional)",
      required: false,
    },
    expiresAt: {
      type: "text",
      label: "Expires at (ISO 8601, optional)",
      required: false,
    },
  },
  handler: formPortalHandler,
});
