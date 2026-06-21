# Story

The story the seed makes. This directory IS the story's source, durable storage, and runtime.

## Run it

Needs Node.js 18+ and MongoDB (as a replica set, even a single-node one for dev. See "MongoDB" below.)

```bash
npm install
npm start
```

First boot runs the setup wizard ([`plant.js`](plant.js)): collects domain, MongoDB URI, picks an extension profile, mints the operator. Every later boot opens senses and unfolds the story ([`begin.js`](begin.js) then [`genesis.js`](genesis.js)).

After that, register a being:

```bash
npm install -g treeos
treeos connect http://localhost:3000
treeos register
treeos start
```

## The model

A story is one cryptographically anchored world, rooted in a single Name: I_AM. I_AM's keypair signs the genesis fact and every Merkle root from t=0 onward. Every Name is its own public key; a being is a presence a Name uses to act. Every act produces facts; facts are content addressed and chained through prev-hashes. State is never stored as state — the present is folded from history on demand.

Everything the seed exposes is a **word**: every verb, op, role, and kind is a declared fact the system folds and runs. The vocabulary is not a registry; it is the fold of those facts.

Federation works without a central authority because every Name and every story is self-certifying. Two stories verify each other by exchanging signed root hashes; the math runs locally. Names also meet in a fifth-dimensional **Library** — sharing **books** (carriable slices of a story) and Searching across the stories they are peered with.

Read [`philosophy/I_AM.md`](philosophy/I_AM.md) for the cryptographic root, [`philosophy/theorems.md`](philosophy/theorems.md) for the formal results, and [`philosophy/word/`](philosophy/word/) for the Word.

## The six verbs

Every act inside the story is one verb at one IBP address (`<story>/<path>@<being>`).

| Verb   | Acts on        | What it does                                                        |
| ------ | -------------- | ------------------------------------------------------------------- |
| SEE    | right (target) | Read a position's present, return a descriptor. Writes nothing.     |
| RECALL | right (target) | Read the past — fold a position's history of facts. Writes nothing. |
| DO     | right (target) | Run a word on the target (a registered op). Stamps a fact.          |
| BE     | left (actor)   | Change the actor's binding. Stamps a fact on the actor's reel.      |
| NAME   | left (actor)   | Declare and manage a Name — the keypair that owns the act-chain.    |
| CALL   | right (target) | Deliver a message to a being's inbox. Stamps a fact.                |

BE is the one verb where the actor IS the target. Its five ops are birth, connect, release, switch, death.

## The primitives

| Primitive | What it is                                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| Name      | A keypair. The identity that signs every act and owns its act-chain and lineage. The story's own Name is I_AM.    |
| Being     | A presence — a being a Name uses to act in a place (a uuid owned by a Name). Humans, LLM beings, scripted beings. |
| Space     | A position in the tree. Holds matter, hosts beings, owns quality namespaces.                                      |
| Matter    | Stuff inside a space. Types declare what it IS (file, model, http, ibpa, source, and extension types).            |
| Fact      | One recorded change. Content addressed; chained through prev-hashes; signed at the seal step.                     |
| Act       | One sealed moment of a Name, through a being. Every fact carries the actId of its act.                            |

Seed schemas never change. Everything an extension defines lives in the `qualities` Map on the relevant primitive.

## Inside

```
seed/                The kernel: materials/ (the kinds), ibp/ (the verbs), present/ (the processing), past/ (the record), store/ (the words + content), seedStory/ (the host floor).
protocols/           IBP — the six verbs; the cross-story federation.
transports/          HTTP, WebSocket, CLI: thin shims that translate into IBP.
resources/           Where you build. Extensions sit beside the seed and add their own words.
portal/              The 3D portal client (active dev). Served at /. Three.js + Vite.
philosophy/          The doctrine: math, theorems, the Word (word/), MOMENT, FOLD, STAMPER, I_AM.
plant.js             Operator's first act. Once.
begin.js             t=0. Opens senses. Fires genesis.
genesis.js           The unfolding that forms the story.
```

Dependency direction: `transports/` to `protocols/` to `seed/`. Extensions sit beside the three and consume them — they add words, never modify the seed. Seed never imports from protocols or transports.

## MongoDB

The story needs MongoDB as a replica set (single-node is fine for dev). Without it, the story runs until the first multi-fact ΔF (a fact-set spanning more than one reel), at which point the all-or-nothing seal needs a transaction, and Mongo only supports transactions on a replica set.

Convert a local mongod once:

```bash
sudo sh -c 'cat >> /etc/mongod.conf <<EOF

replication:
  replSetName: rs0
EOF'
sudo systemctl restart mongod
mongosh --eval 'rs.initiate()'
```

After this, `mongodb://localhost:27017/story` should work.

## Read deeper

- [`seed/FACTORY.md`](seed/FACTORY.md), the seed in its own words
- [`philosophy/`](philosophy/), the doctrine
- [`philosophy/I_AM.md`](philosophy/I_AM.md), the cryptographic root
- [`philosophy/theorems.md`](philosophy/theorems.md), the formal results
- [`philosophy/word/`](philosophy/word/), the Word
- [`resources/README.md`](resources/README.md), building extensions
- https://treeos.ai for the public-facing docs
