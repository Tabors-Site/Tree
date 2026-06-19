# PEERING: the discovery directory

> _"Knowing one peer is knowing the network."_

Peering is the directory layer of The Root System. A reality plants
the peering pack to become FINDABLE on the network and to find
others. Without peering, the substrate's wire still works — you can
be reached if someone has your address, you can SUMMON anyone you
know about, GRAFTs flow through canopy — peering only adds the
discoverability layer on top.

Read alongside [ROOTS.md](ROOTS.md) (the umbrella) and
[STORE.md](STORE.md) (the publishable catalog layer; orthogonal to
peering).

## Status

The peering pack lives at
[reality/resources/peering/](../../resources/peering/). It's a
**scaffold** today: the manifest is in place so the doctrine has a
home and `plant.js` can offer it as a yes/no at first boot, but the
peer-record machinery isn't built. Real implementation is a
substrate task whose design follows this doctrine.

## Peer records

A peer record is small and self-signed:

```
peer record = {
  realityId,    // the public key of the reality
  baseUrl,      // where to reach it
  lastSeen,     // when it last refreshed
}
   signed by the reality it describes
```

Because a `realityId` IS that reality's public key
([IDENTITY.md](IDENTITY.md), Cross reality), the directory cannot
lie in any way that matters.

- Point you at a wrong baseUrl, and the canopy handshake fails
  immediately. Whoever answers there cannot sign as that key.
- Forge a record outright, and the record's own signature fails.
- The only lie available is OMISSION, hiding a peer, and any other
  peering node can tell the truth.

Realities register themselves with the peering nodes they choose,
refresh their own records, and check each other's liveness with an
ordinary SEE ping. First contact needs no key ceremony: knowing the
peer record is knowing the key.

Two honesty notes. A peer record is an ATTESTATION, not an
endorsement: it says "I exist, here," signed by the one who exists,
and storing it vouches for nothing. And because registering costs
only a signature, the directory will accumulate dead and junk
records; peering nodes prune what stops answering (housekeeping, not
curation), and discovery filters on freshness (`lastSeen`). Spam can
clutter a directory; it cannot counterfeit one.

## Planting peering on an existing reality

Every reality already has the substrate federation half: peering,
the canopy wire, the cross-reality verbs. The peering pack adds the
DIRECTORY half: serve a registry, refresh records, prune dead ones.
Any existing reality can switch the role on and become a peering
node. Serving is opt-in (a directory is a public service with
storage and bandwidth costs); querying is universal (every reality
is a peering CLIENT, able to ask any peering node and register
itself with the ones it chooses).

[plant.js](../../plant.js) offers the peering pack during initial
setup. If yes, when the pack ships its full implementation,
`.first-boot-actions.json` will queue `peering:peer-directory` and
[begin.js](../../begin.js) plants it at the reality root on first
boot.

### The first hello

A fresh reality knows nobody. Every decentralized network solves
this the same way: ship a few well-known addresses as defaults. The
default is a door you may knock on first, not an authority.

SEE any one peering node's directory space and you receive every
record it holds: realities, and other peering nodes, each record
self-signed by the reality it describes. You verify each record
yourself, so the introducer needs no trust at all. Cache what you
learned and your own peer list IS your directory from then on; the
well-known address is never load-bearing again. Knowing one peer is
knowing the network.

### Neighborhoods, not one world view

Peering nodes choose what they mirror (exclusion is their one
lever), so the network is overlapping neighborhoods rather than one
guaranteed global registry. Any entry point shows you its
neighborhood; two entry points show you the union. That is the
design working, not failing: the more peering nodes, the wider the
overlap.

### If the defaults go bad

The well-known list ships in the reality's config alongside the seed
code and updates the way code updates. Any operator can override it.
A captured default cannot forge records, alter listings, or
impersonate anyone, because everything it serves still self-
certifies. What it can do is BLIND: show a partial network. The
breakers are plural defaults (independent operators, so the views
union) and out-of-band introduction (paste any peer's address
directly; the directory is a convenience, never a gatekeeper). One
honest hello from anywhere ends the eclipse. The exposure is real
but narrow: introduction, briefly, and nothing else.

## What the peering pack will ship

When implemented, the pack will contain:

```
peering/
├── manifest.js               kind:"pack"
├── README.md
├── code/                     code piece
│   ├── manifest.js
│   ├── index.js              registers register-peer / forget-peer DO ops,
│   │                         SEE-ping liveness handler, peer-record verifier
│   └── handlers.js           peer-record signature checks; registry writes
├── roles/peer-registrar/     the directory's writer
│   ├── manifest.js
│   └── role.js               scripted; handles register-peer SUMMON intent;
│                             stores directory in its own qualities
└── seeds/peer-directory/     the plantable directory space
    ├── manifest.js
    └── seed.json             plants peer-directory space + the registrar
```

The pack's name is `peering`; the registrar's role registers as
`peering:peer-registrar`; the directory seed registers as
`peering:peer-directory`. The publish/retire SUMMON intents (when
built) follow the same shape as Store's
([STORE.md](STORE.md)): one self-authorized write per registration,
the registrar owns the directory space.

## See also

- [ROOTS.md](ROOTS.md) — the umbrella explaining peering's place in
  the four-layer model.
- [STORE.md](STORE.md) — the publishable catalog layer (independent
  of peering).
- [IDENTITY.md](IDENTITY.md) — why peer records sign cleanly.
- [reality/resources/peering/README.md](../../resources/peering/README.md)
  — the pack's README with up-to-date status.
