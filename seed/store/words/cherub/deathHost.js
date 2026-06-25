// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// deathHost.js — the floor see-op for death.word (be:death).
//
// One irreducible read the control strand reaches through `see`: resolve the target
// being from the address handle. Reimplements nothing — wires the same findByName the
// be.js death branch already called, on the operating history (the death fact lands on
// the resolved being's reel). The kill authority is the VERB's authorize() able-walk
// (be.js), not a floor read here. Mirrors truenameHost.js / portalHost.js.

export function deathHostEnv() {
  return {
    "resolve-target-being": async ({ args: [beingName] }, ctx) => {
      const { findByName } = await import("../../../materials/projections.js");
      const slot = await findByName("being", beingName, ctx?.moment?.actorAct?.history || "0");
      return slot ? String(slot.id) : null;
    },
  };
}
