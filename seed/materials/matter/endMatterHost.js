// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// endMatterHost.js — the floor see-op for end-matter.word (matter/ops.js, the end-matter DO op).
//
// A being retires a matter. There is NO host out: bytes are content-addressed and possibly shared
// (dedup), so end-matter never touches the blob (casSweep + the explicit purge-content own blob
// lifecycle). The whole act is the do:end-matter fact the dispatcher lays; the matter reducer FOLDS
// its two consequences from that one verb (absent from its space, unheld), exactly as the old handler
// intended (23.md: one act, one fact). So the only thing that cannot be native Word is the AUTHORITY
// READ — load the matter row, then gate author-or-root-owner — and that is this one host see-op,
// `resolve-end-matter-spec`, reusing the SAME loadOrFold + resolveRootSpace + getSpaceOwner the handler
// called. It reimplements nothing and lays no fact; a host throw is the word's refusal.
//
// It returns { matterId } only: the verb carries no params (the reducer derives the tombstone from the
// verb itself), so the word promotes an empty fact targeted at the matter via idFrom:"matterId". The
// old handler's fire-and-forget afterMatter storage-accounting hook is NOT replayed here: storage is a
// projection of the matter Facts (the handler's own comment, "No incQuality"), so it folds from the
// do:end-matter fact like every other matter projection, not from an imperative side-channel. Mirrors
// set-matter's setMatterHost.js (resolve-set-matter-spec) and rename-matter's renameMatterHost.js.

import { IBP_ERR, IbpError } from "../../ibp/protocol.js";
import { resolveRootSpace } from "../space/spaces.js";
import { getSpaceOwner } from "../space/members.js";
import { loadTargetRow } from "../_targetShape.js";

export function endMatterHostEnv() {
  return {
    // resolve-end-matter-spec — the lone substrate read. Load the matter row, gate author-or-root-
    // owner (the SAME rule the handler enforced: the author always may; a non-author may only when
    // they own the matter's tree root; the heaven boundary, where resolveRootSpace throws, means "no
    // root owner" and the author rule alone decides). Returns { matterId } for the idFrom target. NO
    // fact laid; a throw is the refusal.
    "resolve-end-matter-spec": async ({ args: [target, caller, branch] }, ctx) => {
      const moment = ctx?.moment;
      const history = branch || moment?.actorAct?.history || "0";
      if (!caller) {
        throw new IbpError(IBP_ERR.UNAUTHORIZED, "end-matter: identity required");
      }
      // loadTargetRow returns the row FLATTENED ({ _id, position, ...state }) — beingId / spaceId
      // sit directly on it, not under a .state envelope.
      const row = await loadTargetRow(target, "matter", { moment });
      const matterId = String(row._id);

      const isAuthor = String(row.beingId || "") === String(caller);
      let isRootOwner = false;
      if (!isAuthor) {
        try {
          const rootSpace = await resolveRootSpace(row.spaceId);
          isRootOwner = String(getSpaceOwner(rootSpace) || "") === String(caller);
        } catch { /* heaven boundary or broken tree: the author rule decides */ }
      }
      if (!isAuthor && !isRootOwner) {
        throw new IbpError(
          IBP_ERR.FORBIDDEN,
          "Only the matter author or the tree owner can delete this matter",
        );
      }

      return { matterId, factParams: {} };
    },
  };
}
