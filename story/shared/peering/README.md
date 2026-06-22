# peering — the discovery directory pack

A reality plants the peering pack to become **findable** on The Root
System and to find others. Without peering, the substrate's wire still
works (canopy verbs, GRAFTs, cross-reality SUMMONs) — you can be
reached if someone has your address, and you can reach anyone you
know. Peering only adds the directory layer.

## Status

**Scaffold.** The pack's manifest is in place so the doctrine has a
home and `plant.js` can offer it as a yes/no at first boot. Real
peer-record machinery is a separate substrate task. Today the pack
installs zero pieces; planting it is a no-op.

## What lands when peering is built

```
peering/
├── manifest.js               (this file's pack)
├── README.md
├── code/                     code piece
│   ├── manifest.js
│   ├── index.js              registers register-peer / forget-peer DO ops,
│   │                         SEE-ping liveness handler, peer-record verifier
│   └── handlers.js           peer-record signature checks; registry write
├── ables/peer-registrar/     the directory's writer
│   ├── manifest.js
│   └── able.js               scripted; handles register-peer SUMMON intent;
│                             stores directory in its own qualities
└── seeds/peer-directory/     the plantable directory space
    ├── manifest.js
    └── seed.json             plants peer-directory space + the registrar
```

## Doctrine

A peer record is a signed self-attestation:
`{ realityId, baseUrl, lastSeen }`, signed by the reality it
describes. Because `realityId` IS the reality's public key
([IDENTITY.md](../../philosophy/OS/IDENTITY.md)), the directory cannot
lie in any way that matters:

- Point at a wrong baseUrl → canopy handshake fails (the answerer
  can't sign as that key).
- Forge a record outright → the record's own signature fails.
- The only lie available is OMISSION (hiding a peer), and any other
  peer can tell the truth.

## Plant

When the substrate machinery lands, an operator plants the directory
with:

```
do <space> plant-template-by-name { name: "peering:peer-directory" }
```

This creates the peer-directory space and the peer-registrar being.
Other realities then SUMMON the registrar with intent
`register-peer` to attest their own record.

## Independence from store

Peering does NOT require the [store pack](../store/) and store does
NOT require peering. A reality can:

- Plant neither (private, reachable by address).
- Plant store only (private/internal catalog, reachable by address).
- Plant peering only (discoverable in directories; nothing published).
- Plant both (a full Roots node: discoverable + hosting a catalog).

See [philosophy/OS/PEERING.md](../../philosophy/OS/PEERING.md) for the
full doctrine.
