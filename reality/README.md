# Reality

The world the seed makes. This directory IS the world's source, durable storage, and runtime.

## Run it

Needs Node.js 18+ and MongoDB (as a replica set, even a single-node one for dev. See "MongoDB" below.)

```bash
npm install
npm start
```

First boot runs the setup wizard ([`plant.js`](plant.js)): collects domain, MongoDB URI, picks an extension profile, mints the operator. Every later boot opens senses and unfolds the world ([`begin.js`](begin.js) then [`genesis.js`](genesis.js)).

After that, register a user:

```bash
npm install -g treeos
treeos connect http://localhost:3000
treeos register
treeos start
```

## The model

A reality is one world cryptographically anchored to a single root being called I_AM. I_AM's keypair signs the genesis fact and every Merkle root from t=0 onward. Every other being is a wallet, named by its own public key. Every act produces facts; facts are content addressed and chained through prev-hashes. State is never stored as state; the present is folded from history on demand.

Federation works without a central authority because every being and every reality is self-certifying. Two realities verify each other by exchanging signed root hashes; the math runs locally.

Read [`philosophy/I_AM.md`](philosophy/I_AM.md) for the cryptographic root, [`philosophy/theorems.md`](philosophy/theorems.md) for the formal results, and [`philosophy/MOMENT.md`](philosophy/MOMENT.md) for the moment.

## The four verbs

Every act inside the reality is one verb at one IBP address (`<reality>/<path>@<being>`).

| Verb | Acts on | What it does |
| --- | --- | --- |
| SEE | right (target) | Read a position, return a descriptor. Writes nothing. |
| DO | right (target) | Mutate the target via a registered operation. Stamps a fact. |
| SUMMON | right (target) | Deliver a message to a being's inbox. Stamps a fact. |
| BE | left (actor) | Change the actor's identity binding. Stamps a fact on the actor's reel. |

BE is the one verb where the actor IS the target. Its five ops are birth, connect, release, switch, death.

## The five primitives

| Primitive | What it is |
| --- | --- |
| Being | An identity. A keypair, a wallet. Humans, LLM beings, scripted beings. The reality itself is a being: I_AM. |
| Space | A position in the tree. Holds matter, hosts beings, owns quality namespaces. |
| Matter | Stuff inside a space. Types declare what it IS (file, model, http, ibpa, source, and extension types). |
| Fact | One recorded change. Content addressed; chained through prev-hashes; signed at the seal step. |
| Act | One sealed moment of one being. Every fact carries the actId of its act. |

Seed schemas never change. Everything an extension defines lives in the `qualities` Map on the relevant primitive.

## Inside

```
seed/                The kernel. Four folders: materials/, ibp/, present/, past/, plus a host floor.
protocols/           IBP (the four verbs), canopy (cross-reality), mcp.
transports/          HTTP, WebSocket, CLI: thin shims that translate into IBP.
extensions/          Where you build. _template/ is the scaffold.
portal/              The 3D portal client (active dev). Served at /. Three.js + Vite.
philosophy/          The doctrine: MOMENT, FOLD, STAMPER, I_AM, theorems, government.
plant.js             Operator's first act. Once.
begin.js             t=0. Opens senses. Fires genesis.
genesis.js           The unfolding that forms the world.
```

Dependency direction: `transports/` to `protocols/` to `seed/`. Extensions sit beside the three and consume them. Seed never imports from protocols or transports.

## MongoDB

The reality needs MongoDB as a replica set (single-node is fine for dev). Without it, the substrate runs until the first multi-fact ΔF (a fact-set spanning more than one reel), at which point the all-or-nothing seal needs a transaction, and Mongo only supports transactions on a replica set.

Convert a local mongod once:

```bash
sudo sh -c 'cat >> /etc/mongod.conf <<EOF

replication:
  replSetName: rs0
EOF'
sudo systemctl restart mongod
mongosh --eval 'rs.initiate()'
```

After this, `mongodb://localhost:27017/reality` just works.

## Read deeper

- [`seed/FACTORY.md`](seed/FACTORY.md), the seed in its own words
- [`philosophy/`](philosophy/), the doctrine
- [`philosophy/I_AM.md`](philosophy/I_AM.md), the cryptographic root
- [`philosophy/theorems.md`](philosophy/theorems.md), the formal results
- [`extensions/README.md`](extensions/README.md), building extensions
- [`extensions/EXTENSION_FORMAT.md`](extensions/EXTENSION_FORMAT.md), the full extension contract
- https://treeos.ai for the public-facing docs
