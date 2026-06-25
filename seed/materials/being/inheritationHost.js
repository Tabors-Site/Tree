// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// inheritationHost.js — the floor see-op for grant-inheritation.word / revoke-inheritation.word
// (being/inheritationOps.js, the two inheritation DO ops).
//
// The CONTROL strand (the `name`-required gate + the return) is the .word; the genuine substrate
// READS + the authority gate this op needs — resolve the acting Name (ctx.identity.nameId, or I
// for the seed paths), the grantable-Name check (declared + not banished, grant only), and the
// authority-over-position check (hasAuthorityOver) — are ONE host see-op, `resolve-inheritation`.
// It REUSES the SAME primitives the JS handler called (loadProjection / isNameBanished /
// hasAuthorityOver); it reimplements nothing. The .word reaches it through `see`; the dispatcher
// lays the one do:grant-inheritation / do:revoke-inheritation fact from the returned factParams.
// Mirrors setBeingHost's resolve-set-being-spec.
//
// THE BLOCK it returns is { position, factParams, grantedBy|revokedBy } where factParams is the
// EXACT fact shape the dispatcher stamped from ctx.params before this conversion — { name } (the
// granted Name; inheritation.js reads points by target.id=position and the Name from params.name).
// position is the fact TARGET (the position being's reel); the .word promotes it via idFrom:
// "position". grantedBy / revokedBy ride in the RESULT (the answer to the caller), matching the old
// handler's return; they are NOT in factParams (the grantor is the fact's own signer/actor).
//
// The host throws the SAME IbpErrors the handler threw — a host throw becomes the .word's refusal.
// It is a READ: it validates, resolves, and RETURNS; it lays no fact and mutates nothing.

import { IBP_ERR, IbpError } from "../../ibp/protocol.js";
import { I } from "./seedBeings.js";
import { hasAuthorityOver } from "./identity/inheritation.js";

// The acting Name (the granter/revoker). DO acts carry identity.nameId post-split; the I seed
// paths carry the I being/name instead. Mirrors actingNameOf in inheritationOps.js.
function actingNameOf(identity) {
  if (identity?.nameId) return String(identity.nameId);
  if (identity?.name === I || identity?.beingId === I) return String(I);
  return null;
}

const historyOf = (ctx) => ctx?.moment?.actorAct?.history || ctx?.history || "0";

export function inheritationHostEnv() {
  return {
    // resolve-inheritation(name, position, mode) — the genuine substrate read + authority gate.
    // mode "grant" runs the grantable-Name check (declared + not banished); both modes run the
    // authority-over-position check. Returns { position, factParams:{name}, grantedBy|revokedBy }.
    // The .word's `If no name` gate runs FIRST, so name is a present string here. NO fact laid.
    "resolve-inheritation": async ({ args: [name, position, mode] }, ctx) => {
      const opName = mode === "revoke" ? "revoke-inheritation" : "grant-inheritation";
      const actingName = actingNameOf(ctx?.identity || ctx?.moment?.identity);
      if (!actingName) {
        throw new IbpError(
          IBP_ERR.UNAUTHORIZED,
          `${opName} requires an identified acting Name`,
        );
      }
      const grantedName =
        typeof name === "string" && name.trim() ? name.trim() : null;
      if (!grantedName) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `${opName} requires params.name (the Name${mode === "revoke" ? " whose point to remove" : " to grant authority to"})`,
        );
      }
      const pos = String(position || "");
      if (!pos) {
        throw new IbpError(
          IBP_ERR.INVALID_INPUT,
          `${opName} requires a being-tree position (target.kind='being')`,
        );
      }
      const history = historyOf(ctx);

      // grant only: the granted Name must be a declared, non-banished Name on this story
      // (mirrors birth.js's explicit-trueName validation — you can't hand a point to a typo or
      // a banished Name). revoke removes a point regardless (a never-granted point is a no-op).
      if (mode !== "revoke") {
        const { loadProjection } = await import("../projections.js");
        const nameSlot = await loadProjection("name", grantedName, history);
        if (!nameSlot?.state) {
          throw new IbpError(
            IBP_ERR.INVALID_INPUT,
            `grant-inheritation: "${grantedName.slice(0, 12)}…" is not a declared Name on this story.`,
          );
        }
        const { isNameBanished } = await import("../name/closure.js");
        if (await isNameBanished(grantedName)) {
          throw new IbpError(
            IBP_ERR.FORBIDDEN,
            `grant-inheritation: "${grantedName.slice(0, 12)}…" is banished.`,
          );
        }
      }

      // Authority to grant/revoke at a position is authority OVER that position. authorize.js
      // gates these the same way (inheritation coverage as a do-on-being fallback); this is the
      // defense-in-depth re-check for direct-call paths. I (universal authority) always passes.
      const ok = await hasAuthorityOver(actingName, pos, history);
      if (!ok) {
        throw new IbpError(
          IBP_ERR.FORBIDDEN,
          `${opName}: acting Name has no authority over this being-tree position`,
          { actingName: actingName.slice(0, 12), position: pos.slice(0, 8) },
        );
      }

      const block = { position: pos, factParams: { name: grantedName } };
      block[mode === "revoke" ? "revokedBy" : "grantedBy"] = actingName;
      return block;
    },
  };
}
