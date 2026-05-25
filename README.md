# TreeOS

An operating system for AI agents. You plant a seed on a host; it
grows a **reality**, the world a network of beings inhabits and acts
in. Six primitives (Being, Space, Matter, Fact, Act, LlmConnection),
four verbs (SEE, DO, SUMMON, BE), one extensible kernel. Modular
extensions on top. Self-hosted. Federated. Open source.

## Quick start

Requires Node.js 18+ and a running MongoDB.

```bash
git clone https://github.com/taborgreat/Tree.git
cd Tree
npm install            # installs reality/, site/, cli/ via postinstall
npm start              # boots the reality
```

First boot runs `plant.js`, a setup wizard that writes `.env` (domain,
MongoDB URI, JWT secret), mints the operator being, and asks for AGPL
consent. Every later boot runs `begin.js`, which opens senses and
fires `genesis.js`.

## Being in it

Use the **3D portal** in [`portal/3d-app/`](portal/3d-app/). It is a
Three.js + Vite client that speaks IBP (the four verbs over
WebSocket) and renders positions as a navigable 3D world.

```bash
cd portal/3d-app
npm install
npm run dev            # Vite dev server; open the URL it prints
```

The 3D portal is **in active development**. Expect rough edges. Point
it at your local reality (defaults to `http://localhost:3000`),
register, and you are in.

Optional landing/docs site:

```bash
npm run dev:site       # serves site/ via Vite
```

## The model in one paragraph

The **reality** is the whole world the seed makes. It is durable,
shared by every perspective. A **place** is one being's fold of the
reality for one moment. Beings act through the four verbs at IBP
addresses (`<reality>/<path>@<being>`); every act stamps a **Fact** on
the reel of the thing it changed. The fold replays facts on demand to
build the face a being sees. No state is stored as state; everything
is stored as facts, and faces are rebuilt fresh.

For the long form, read the doctrine in
[`reality/philosophy/`](reality/philosophy/), starting with
[MOMENT.md](reality/philosophy/MOMENT.md).

## Project layout

```
reality/             The reality. Boot trilogy + seed + protocols + extensions.
  plant.js              First boot. Setup wizard, operator mint.
  begin.js              Every boot. Opens HTTP/WebSocket; fires genesis.
  genesis.js            The unfolding. Indexes, config, migrations, beings.
  seed/                 The seed. The factory. The whole apparatus.
  protocols/            What conversation over the wire looks like (IBP, canopy, mcp).
  transports/           Thin carriers (HTTP, WebSocket).
  extensions/           Where you build. _template/ is the scaffold.
  philosophy/           The doctrine: MOMENT, FOLD, STAMPER, MATERIALS, chat, math.

portal/3d-app/      The 3D portal client (in dev). Vite + Three.js.
site/               Landing and docs site. React + Vite.
cli/                CLI client (separate package).
horizon/            Public directory + extension registry (standalone).
create-treeos/      Scaffolder for new TreeOS projects.
```

## Building an extension

Copy the template:

```bash
cp -r reality/extensions/_template reality/extensions/my-extension
```

Edit `manifest.js` to declare what you need and provide; edit
`index.js` to register operations, roles, tools, hooks, and seeds.
Restart the reality.

Full developer guide:
[`reality/extensions/README.md`](reality/extensions/README.md).
Manifest reference:
[`reality/extensions/EXTENSION_FORMAT.md`](reality/extensions/EXTENSION_FORMAT.md).

## Where to read deeper

- [`reality/seed/FACTORY.md`](reality/seed/FACTORY.md), the seed's own
  contract (first-person, from the I-Am).
- [`reality/philosophy/MOMENT.md`](reality/philosophy/MOMENT.md), the
  moment is the atom. Read first.
- [`reality/philosophy/FOLD.md`](reality/philosophy/FOLD.md), the read
  side: facts in, face out.
- [`reality/philosophy/STAMPER.md`](reality/philosophy/STAMPER.md),
  the write side: act in, facts out.
- [`reality/philosophy/MATERIALS.md`](reality/philosophy/MATERIALS.md),
  what the world is made of.
- [`reality/philosophy/math.md`](reality/philosophy/math.md), the
  formal statement (sets, reels, invariants).
- [`portal/README.md`](portal/README.md), the portal client and IBP
  vocabulary.
- [`CLAUDE.md`](CLAUDE.md), the working notes for AI assistants
  helping on this codebase.

## Security

Extensions run inside the same Node process as the seed. They can
reach the filesystem, the network, the database. Review third-party
extension code before installing. The seed is safe; an extension is
as safe as the code in it. Extensions declaring `scope: "confined"`
in their manifest are inactive until an operator explicitly allows
them at a position.

## License

AGPL-3.0. See [reality/seed/LICENSE](reality/seed/LICENSE) for the
full text and the seed preamble.
