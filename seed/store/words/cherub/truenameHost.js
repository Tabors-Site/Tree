// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// truenameHost.js — the floor see-ops for truename.word (be:truename).
//
// The four irreducible reads the control strand reaches through `see`: resolve a
// pubkey-or-real-name token to a canonical nameId, resolve the target being from
// the address handle, assert the Name EXISTS on main, and assert it is NOT
// banished. Each reimplements NOTHING — it wires the SAME primitives the be.js
// truename branch already called (resolveNameId, findByName, loadProjection,
// isNameBanished). Name reads pin to "0" (identity is above the history timeline);
// the BEING resolve comes from the ACT (actorAct.history) — a being's fact chain is
// per-history, so the target resolves on the branch the act is on, no silent "0".
// Mirrors portalHost.js / matterHost.js (the host-env pattern).

export function truenameHostEnv() {
  return {
    "resolve-name-id": async ({ args: [token] }) => {
      const { resolveNameId } = await import("../../../materials/name/registry.js");
      return (await resolveNameId(token)) || null;
    },
    "resolve-target-being": async ({ args: [beingName] }, ctx) => {
      const { findByName } = await import("../../../materials/projections.js");
      const slot = await findByName("being", beingName, ctx?.moment?.actorAct?.history);
      return slot ? String(slot.id) : null;
    },
    "name-exists": async ({ args: [nameId] }) => {
      const { loadProjection } = await import("../../../materials/projections.js");
      const slot = await loadProjection("name", String(nameId), "0"); // names live on main
      return !!slot?.state;
    },
    "name-banished": async ({ args: [nameId] }) => {
      const { isNameBanished } = await import("../../../materials/name/closure.js");
      return await isNameBanished(nameId);
    },
  };
}
