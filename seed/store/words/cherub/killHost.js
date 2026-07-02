// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// killHost.js — the floor see-op for kill.word (be:kill).
//
// One irreducible read the control strand reaches through `see`: resolve the target
// being from the address handle. Reimplements nothing — wires the same findByName the
// be.js kill branch already called. The branch comes from the ACT: actorAct.history is
// the history the kill fact lands on, so the target resolves on that SAME reel (a being's
// fact chain is per-history; the kill must hit the branch the act is on). No silent "0" —
// resolving on main when the act carries no branch would kill the wrong chain; a missing
// act history is a threading bug, the same law resolveHistoryForFact holds for the fact.
// The kill authority is the VERB's authorize() able-walk (be.js), not a floor read here.
// Mirrors truenameHost.js / portalHost.js.

export function killHostEnv() {
  return {
    "resolve-target-being": async ({ args: [beingName] }, ctx) => {
      const { findByName } = await import("../../../materials/projections.js");
      const slot = await findByName("being", beingName, ctx?.moment?.actorAct?.history);
      return slot ? String(slot.id) : null;
    },
  };
}
