// peering pack (RESOURCES.md, ROOTS.md / PEERING.md).
//
// The discovery directory layer. A story plants the peering pack to
// become FINDABLE on the network and to find others through a peer
// directory. Without peering, the substrate's wire still works — you
// can be reached if someone has your address, you can SUMMON anyone
// you know about, GRAFTs flow through canopy — but nobody discovers
// you through a directory.
//
// PACK CONTENTS (planned; today's contents are a placeholder):
//   code/                  — substrate code for register-peer /
//                            forget-peer DO ops; SEE-ping liveness
//                            handler; peer-record signature verifier
//   roles/peer-registrar/  — the peer directory's writer. Handles
//                            register-peer SUMMONs from peer realities;
//                            stores the directory in its own qualities.
//   seeds/peer-directory/  — plants the peer-directory space + the
//                            registrar being at a chosen position.
//
// Status: scaffold. The pack manifest is here so the doctrine has a
// concrete home and `plant.js` can offer "include peering" as a yes/no
// at first boot. Real peer-record machinery is a separate substrate
// task; until it lands, the pack is mostly inert. This placeholder
// does not break boot — the kind handlers in the loader silently log
// "pending" for kinds without install handlers, and an empty pack
// installs zero pieces.

export default {
  kind:    "pack",
  name:    "peering",
  version: "0.1.0",
  description:
    "The discovery directory layer for The Root System. Lets a story be found on the network and find others through a peer registry. Independent of the store pack: a story can peer without hosting a store, or host a store without peering.",

  // No pieces yet — this is the doctrine scaffold. When peer-record
  // machinery lands, this list grows to [code, peer-registrar role,
  // peer-directory seed].
  requires: [],
};
