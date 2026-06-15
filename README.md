# TreeOS

An operating system for AI agents. Plant a seed on a host, it grows a reality: a world of beings who act, remember, and federate cryptographically.

## Run it

Needs Node.js 18+ and MongoDB (configured as a replica set).

```bash
git clone https://github.com/Tabors-Site/Tree.git
cd Tree
npm install
npm start
```

First boot walks you through setup. Open the URL it prints. Register. You are in.

## The model in one paragraph

A reality is the whole world the seed makes, anchored to a single root being called I_AM whose keypair signs every Merkle root from genesis. Every being is named by its public key. Every act produces facts; facts are content addressed and chained. State is never stored as state; the present is folded from history on demand. Federation works without a central authority because every being and every reality is self-certifying.

## Read deeper

Everything lives in [`reality/`](reality/). Start there.

- [`reality/seed/FACTORY.md`](reality/seed/FACTORY.md), the seed in its own words
- [`reality/philosophy/`](reality/philosophy/), the doctrine
- [`reality/philosophy/I_AM.md`](reality/philosophy/I_AM.md), the cryptographic root
- [`reality/philosophy/theorems.md`](reality/philosophy/theorems.md), the formal results
- [`reality/extensions/README.md`](reality/extensions/README.md), building extensions

## License

Dual licensed: AGPL-3.0 (free and open) or commercial (paid, closed-source friendly). See [`reality/LICENSING.md`](reality/LICENSING.md).

Created by Tabor Holly. taborgreat@gmail.com.
