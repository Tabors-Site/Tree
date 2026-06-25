// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// renameMatterHost.js — the floor see-op for rename-matter.word (the rename-matter DO op).
//
// The CONTROL strand (the `name`-required gate + the return) is the .word; the world READ this op
// needs — load the matter row, require its spaceId, and run the per-(spaceId, parentMatterId) folder
// uniqueness check — is one host see-op (`resolve-rename-spec`). It REUSES the SAME primitives the JS
// handler called (loadTargetRow + listMatterNamesInFolder); it reimplements nothing. The .word reaches
// it through `see`, the dispatcher lays the one do:rename-matter fact from the returned {matterId,name}.
// Mirrors create-matter's matterHost.js (resolveBirthSpec).

import { IbpError, IBP_ERR } from "../../ibp/protocol.js";
import { loadTargetRow } from "../_targetShape.js";

export function renameMatterHostEnv() {
  return {
    // Resolve the rename: load the target matter, require a spaceId, and (unless allowReplace) reject a
    // name already used by a SIBLING in the same folder (case-insensitive; the matter's own current name
    // is excluded so renaming to itself is a no-op, not a collision). Throws the SAME IbpErrors the JS
    // handler threw — a host throw becomes the .word's refusal. Returns the resolved {matterId, name};
    // the name itself is validated non-empty by the .word's `If no name` gate before this runs.
    "resolve-rename-spec": async ({ args: [target, name, allowReplace, branch] }, ctx) => {
      const moment = ctx?.moment;
      const row = await loadTargetRow(target, "matter", { moment });
      const matterId = String(row._id);
      const history = branch || moment?.actorAct?.history || "0";
      const spaceId = row.spaceId ? String(row.spaceId) : null;
      const parentMatterId = row.parentMatterId ? String(row.parentMatterId) : null;
      if (!spaceId) {
        throw new IbpError(IBP_ERR.INVALID_INPUT, "rename-matter: matter has no spaceId");
      }
      if (allowReplace !== true) {
        const { listMatterNamesInFolder } = await import("../projections.js");
        const existing = await listMatterNamesInFolder(history, spaceId, parentMatterId);
        const taken = new Set(existing.map((n) => String(n).toLowerCase()));
        if (typeof row.name === "string") taken.delete(row.name.toLowerCase());
        if (taken.has(String(name).toLowerCase())) {
          throw new IbpError(
            IBP_ERR.INVALID_INPUT,
            `rename-matter: name "${name}" already in use in this folder`,
            { reason: "name-in-use" },
          );
        }
      }
      return { matterId, name: String(name) };
    },
  };
}
