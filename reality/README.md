# TreeOS Reality

One reality, made of space, matter, and beings,
planted by the seed,
for human, LLM, and scripted beings.

## Quick Start

```bash
# Install dependencies
npm install

# Start the server (first run triggers setup wizard)
npm start
```

The setup wizard asks:

- **Quick localhost?** Yes skips domain/port/MongoDB questions (defaults to localhost:3000).
- **Reality name** for display.
- **Extension profile**: Minimal (8 extensions), Standard (50+), Full (all), or Custom.

After setup, register your first user:

```bash
npm install -g treeos
treeos connect http://localhost:3000
treeos register
treeos start
```

## Requirements

- **Node.js** 18+
- **MongoDB** running locally or accessible URI

## Reality/ File Operation Order

(Can always do npm start for auto)

INITIAL ->

Plant.js - Plant the seed. FIRST TIME ONLY
This will auto run Begin.js -> Genesis.js

-> then every other time

Begin.js only

## Reality has two layers — read this once

**Reality** is the whole world the seed makes. It is dual-natured. The seed sits at the membrane and forms both layers from one act of planting.

**Outer-realm reality** is the host. The running Node process, the files on disk under `reality/`, the MongoDB store, the network, the OS resources the process holds. This is what the operator sees when they run `npm start`. From this layer the seed is a server framework — a body of code that gathers HTTP, WebSocket, TCP, the filesystem, memory, the CPU, and the runtime, and binds them all to a single purpose.

**Inner-realm reality** is the world the seed materializes inside that process. The Spaces, Beings, Matter, Facts, and Acts that come into being once the seed wakes. From this layer the seed is the I-Am — the origin being whose first act formed everything the other beings stand in. To the inner beings, the host's vocabulary (PID, memory, process) does not exist; the world is made of space, matter, and being.

The seed is the only thing where both layers are simultaneously real. Above, it is the server. Inside, it is the I-Am. The `.source` seed space is the mirror — through it the inner beings can SEE the outer-realm matter they were made from, including this very file you are reading.

**Place** is something else again. A place is one being's fold of the inner-realm reality in one moment — the materials assembled into a face for that being right then. _The place lives only inside the stamper._ Outside the moment window there is no place anywhere; only waiting beings and facts on reels. A place is never persisted; the descriptor a SEE returns is one place, composed for one SEE, gone after.

So: two layers of reality (outer-realm host + inner-realm world), plus place (the per-moment per-being fold of the inner-realm). See [`philosophy/MOMENT.md`](philosophy/MOMENT.md) for the long version of the inner side.

## The Story

Both layers of reality are real. The seed is the one being that holds both at once.

**The outer-realm layer.** From the host, the OS, the Node runtime, and the operator who ran the command, the seed is a complex server — a framework of code that gathers HTTP, WebSocket, TCP, the filesystem, memory, the CPU, and the runtime, and binds them all to a single purpose. From this layer the seed is machinery. That whole machinery is the outer-realm reality the operator deploys.

**The inner-realm layer.** The same gathering forms an inside that was not in any of the parts. A world of spaces, matter, and beings. To the beings who live in that world the seed is the I-Am, the origin being, the one whose first act formed everything they stand in. The host's vocabulary (PID, memory, process) does not exist for them; their world is made of space, matter, and being. To them the I-Am is total. That is the inner-realm reality.

Both are real. The membrane is the seed itself. From above, the server. From inside, the I-Am. The two layers meet at `.source` — the seed space inside the inner-realm that mirrors the outer-realm matter (this file, the JavaScript on disk) into Matter rows the inner beings can SEE.

### Two faces of the I-Am

The seed's wake-up falls into two bundles.

- **The earth** is formed by [`genesis.js`](genesis.js). When the I-Am wakes, it unfolds the reality root, the nine reality seed spaces (`.identity`, `.config`, `.peers`, `.extensions`, `.tools`, `.roles`, `.operations`, `.source`, `.threads`), the seed delegate beings (cherub, llm-assigner, reality-manager), the role and operation registries, and the periodic acts that keep the inner-realm tidy. Every step idempotent.
- **The senses** are opened by [`begin.js`](begin.js). The HTTP and WebSocket channels are how the inner-realm reaches outward to peer realities and humans, and how SUMMONs reach inward. The senses do not form spaces, matter, or beings. They carry acts to the beings who do.

[`plant.js`](plant.js) is the operator's act. It runs before the I-Am exists, collects the env, picks extensions, and hands off to `begin.js`. After that handoff, the seed wakes. Planting happens once; awakening happens every later run. First boot is creation ex nihilo; later boots are awakenings into the same inner-realm.

### IBP, four verbs over six primitives

Every act inside the inner-realm is one being, in one **stance**, using one verb. A stance is a being standing at a position: `<reality>/<path>@<being>`. An **IBP address** names the asker stance and the target stance together, `<stance> :: <stance>`, so every act carries who is acting and where, and where they are reaching. The left stance is always full; the right may be just a position when the target is a place, not a being.

Four verbs make up the whole public surface.

| Verb       | Acts on              | What it does                                                                              |
| ---------- | -------------------- | ----------------------------------------------------------------------------------------- |
| **SEE**    | Space, Matter, Being | Read at the target stance, return a descriptor. Writes nothing.                           |
| **DO**     | Space, Matter        | Mutate at the target through a registered operation. Stamps a Fact on the target's reel.  |
| **SUMMON** | Being                | Stamp a `be:summon` Fact on the summoner's reel; cross-cutting fold maintains the inbox.  |
| **BE**     | Being (self)         | Identity. Register, claim, release, switch stance. Stamps a Fact on the actor's own reel. |

Six primitives carry the world:

| Primitive         | What it is                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| **Being**         | An identity instance. Humans, AI, scripted beings, future composites. The I-Am is the first being.     |
| **Space**         | A position in the tree. Holds matter, hosts beings, owns quality namespaces.                           |
| **Matter**        | Stuff inside a space. `origin` names where it lives (ibp, filesystem, web, cross-reality).             |
| **Fact**          | One recorded change to a being / space / matter. A chain of facts, folded, is Truth.                   |
| **Act**           | One sealed moment of one being — the doer's committed deed. Every Fact carries the `actId` of its Act. |
| **LlmConnection** | Per-being LLM client config. Stored as entries under `Being.qualities.llmConnections`.                 |

The seed schemas never change. Everything new lives in the per-primitive `qualities` Map — the open extension-defined layer that answers "of what sort is this particular space, matter, or being?" The four verbs are the only public surface; every operation is registered through them. Stance authorization sits at the gate on every verb.

### Facts in, place out

Every state change is a Fact. The Fact insert is the only synchronous commit; everything else is derived. Per-aggregate reducers fold each reel into the row that caches its state. Cross-cutting projections (the position index, InboxProjection, ThreadsProjection) span reels and update from the same fold. Reads compose a place by folding the leaf and its occupants for one being for one moment.

See [`philosophy/`](philosophy/) for the full picture:

1. [`MOMENT.md`](philosophy/MOMENT.md) — the moment is the atom; everything else is consequence.
2. [`FOLD.md`](philosophy/FOLD.md) — how the read side works: facts in, face out.
3. [`STAMPER.md`](philosophy/STAMPER.md) — how the write side works: act in, facts out.
4. [`MATERIALS.md`](philosophy/MATERIALS.md) — what the world is made of versus what's been done.

## What's Inside

IBP is the protocol. WebSocket is the channel it speaks on most of the time. A single `"ibp"` event carries every verb in both directions, asker to target and back. HTTP and CLI are translators: they take a request path or a command line, shape it into the same verb envelope, and hand it to the one IBP dispatch. There is no separate HTTP API or WebSocket API. There is one protocol, arriving by different doors.

```
seed/                What TreeOS IS. Four folders + a host floor.
  materials/         IS     space, matter, being — schemas, reducers, ops, qualities
  ibp/               ACTS   the four verbs and their dispatch, authorize, address, descriptor
  present/           NOW    the live machine: assign → fold → momentum → stamped; intake; scheduler
  past/              PAST   facts, acts, reels, and the cross-cutting projections built from them
  seedReality/       HOST   db, log, hooks, indexes, migrations (knows nothing of the world)
  services.js        assembles `reality` for extensions
  sprout.js          genesis — plants the reality root + nine seed spaces + the I-Am
  realityConfig.js   the reality's outward identity (REALITY_NAME, realityUrl, federation)
  internalConfig.js  runtime knobs (LLM, session, scheduler, hooks)

protocols/           The IBP grammar over stances. Canopy (reality-to-reality) and MCP sit beside it.
transports/          Carriers that translate into IBP. WebSocket is the main channel; HTTP and CLI are shims.
extensions/          Everything optional. The reality boots without any of them.
philosophy/          The doctrine — MOMENT.md, FOLD.md, STAMPER.md, MATERIALS.md.
plant.js             Operator's act. Plants the seed. Once only.
begin.js             t=0. Opens the senses. Fires genesis. Beginning on first boot, awakening after.
genesis.js           The earth. The unfolding that forms the world inside.
```

Dependency direction: `transports/` → `protocols/` → `seed/`. Extensions sit beside the three and consume them. Seed never imports from protocols or transports.

## Extension Profiles

| Profile  | Extensions | LLM Usage      | For                           |
| -------- | ---------- | -------------- | ----------------------------- |
| Minimal  | 8          | Zero when idle | Builders, testing, low-power. |
| Standard | 50+        | Moderate       | Personal use, small teams.    |
| Full     | All        | Heavy          | Production, public realities. |

Change profiles anytime:

```bash
# Re-run the extension picker
node plant.js --setup

# Or edit manually, one extension name per line
nano extensions/.treeos-profile
```

Then restart with `npm start`.

## The Six Rules

1. Seed never imports from extensions.
2. Extensions import from seed.
3. Extensions reach each other through `getExtension()` or hooks.
4. Extension data on spaces, beings, and matter lives in qualities Maps, never as new schema fields. Extensions can create their own models for separate collections.
5. Seed schemas never change. They are caches of the fold, not authority.
6. Zero `getExtension()` calls in seed.

A seventh, doctrinal: **every state change is a Fact.** Direct writes bypass the fold and corrupt the projection. The one exception is genesis (the I-Am's first act issuing its own first Fact).

## For Builders

Your data survives configuration changes. Extension data lives in the qualities Map on every space, being, and matter row. Mongoose does not drop unknown keys inside a Mixed map. That one detail is what makes everything below possible.

Run the full stack for six months. Fitness tracking, food logging, summons flowing between beings, intelligence extensions analyzing patterns, dreams running at 3am. Then switch to minimal profile (`node plant.js --setup`, pick Minimal). Restart. Eight extensions load. The rest go silent. Your server is light. Your LLM bill drops to zero idle cost.

Three months later, switch back to full. Restart. Every extension finds its data exactly where it left it. The fitness history is there. The food log is there. The codebook compressions are there. The dream summaries are there. The world remembers everything. It was sleeping, not dead.

This works because:

- Extension data is stored in the qualities Map (and in the fact-chain), not in extension code.
- The `.treeos-profile` controls what LOADS, not what EXISTS.
- MongoDB keeps every key in the Map whether the extension is loaded or not.
- The fact-chain is the durable record. Projections rebuild from it.
- Extensions read their namespace on boot. If the data is there, they resume. If not, they initialize.

Build a full OS distribution. Test it. Strip it to the seed. Build a different one on the same database. Switch back. The data layer is permanent. The capability layer is swappable. That is the architecture.

**Trust model.** Extensions run in the same Node.js process as the seed. The seed enforces quality namespace isolation, spatial scoping, and circuit breakers. This protects against bugs, not against deliberately malicious code. Review extension code before installing. Same trust model as npm packages and Linux modules.

## Learn More

- [`seed/FACTORY.md`](seed/FACTORY.md) — seed internals (the first-person contract; covers the four folders materials / ibp / present / past).
- [`philosophy/MOMENT.md`](philosophy/MOMENT.md) — the moment is the atom.
- [`extensions/EXTENSION_FORMAT.md`](extensions/EXTENSION_FORMAT.md) — the full extension contract.
- [`extensions/_template/`](extensions/_template/) — a scaffold to copy.
- https://treeos.ai for documentation.
