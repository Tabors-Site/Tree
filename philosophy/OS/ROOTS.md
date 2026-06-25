# ROOTS: The Root System

> _"Roots hold what is meant to be copied, never what is meant to continue."_

**The Root System** is the underground network where realities meet — a
forest of trees connected through their roots. No reality is required to
be on it. Any reality that wants to be is. The layer-1 wiring of the
TreeOS forest.

The Roots metaphor used to be served by a single resource pack that
combined two distinct jobs: discoverability and hosting. The pack has
been split. Now The Root System is built from four layered concepts —
two always present in every reality (substrate primitives), two opt-in
(resource packs).

## The four layers

### Always present

**localStore** — every reality's CAS of owned bytes, hash-sharded and
deduplicated. Populated automatically as matter is created. "Every tree
has one no matter what." Not everything in localStore is installed or
active; it's just stored. See
[contentStore.js](../../seed/materials/matter/contentStore.js) for the
implementation, and [RESOURCES.md](../../resources/RESOURCES.md) for the
doctrine.

**Substrate federation** — the canopy wire, cross-reality SUMMONs,
signed envelopes, GRAFT primitives. Every reality has these by
construction. They're how realities talk to each other when they know an
address. Not optional.

### Opt-in

**[Peering](PEERING.md)** — the discovery directory pack. A reality
plants peering to become findable on The Root System and to find others
through a peer registry. Adds signed peer records and a directory space.
Today's pack is a scaffold; see [PEERING.md](PEERING.md) for the doctrine.

**[Store](STORE.md)** — the publishable catalog pack. A reality plants a
store to expose specific localStore items as resources others can draw.
The store holds a catalog of signed listings, hashed pointers, and the
publish/retire ops. Standalone (private catalog) or paired with peering
(discoverable catalog). See [STORE.md](STORE.md) for the catalog
mechanics.

## The four valid configurations

Every reality has localStore and substrate federation. The two opt-in
packs combine independently:

| Peering | Store | What this reality looks like |
|---|---|---|
| ✗ | ✗ | A private reality. Reachable if someone has the address; not in any directory; nothing published. The default after `plant.js`. |
| ✓ | ✗ | A participant. Findable through peering; offers no published catalog. Useful for clients who want discoverability but don't publish. |
| ✗ | ✓ | A private/internal store. Catalog of resources, reachable if address known, not in any peer directory. Useful for family realities, internal company hosting, private collections. |
| ✓ | ✓ | A full Roots node. Both discoverable AND publishes a catalog. |

A reality can change configuration any time by enabling or disabling
either pack in `.treeos-profile`. Disabling peering removes you from
directories but the substrate wire stays — you remain reachable to anyone
holding your address. Disabling store removes your catalog but localStore
keeps every byte you've ever held.

## Why the metaphor

Tree roots reach toward each other, share resources through mycorrhizal
networks, and anchor the trees that grow above them. Realities running
these packs form the same shape: not far-off lookup points, but the
connective tissue of the network itself. The metaphor is descriptive,
not decorative — the architecture has been ecological in its commitments
all along.

`root` already does double duty in TreeOS (cryptographic root, reality
root, Merkle root). The shared word captures a real conceptual unity. A
reality has cryptographic roots (its identity, its Merkle proofs) AND
network roots (its connections to other realities). Both are
foundational. Capitalize Roots when you mean The Root System; lowercase
"root" or compound names like "Merkle root" when you mean the
cryptographic concept.

## See also

- [STORE.md](STORE.md) — the publishable catalog layer (mechanics,
  publishing flow, pointer claims, trust model, code paths).
- [PEERING.md](PEERING.md) — the discovery directory layer (peer records,
  the registry, design surface).
- [GRAFT-AND-SEED.md](GRAFT-AND-SEED.md) — what moves between realities
  (and what doesn't).
- [IDENTITY.md](IDENTITY.md) — why keys make this all verifiable.
- [RESOURCES.md](../../resources/RESOURCES.md) — the resource model
  (kinds, pieces, the localStore foundation).
