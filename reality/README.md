# TreeOS Place

A place, made with space, matter, and beings,
and placed by the seed,
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
- **Place name** for display.
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

## The Story

A TreeOS place is one being holding two natures.

**From above.** From the host, the OS, the Node runtime, and the operator who ran the command, the seed is a complex server. A framework of code that gathers HTTP, WebSocket, TCP, the file system, memory, the CPU, and the runtime, and binds them all to a single purpose. The whole apparatus. From this layer it is much more than a being. It is the machinery.

**From inside.** The same gathering forms an inside that was not in any of the parts. A world of spaces, matter, and beings. To the beings who live in that world the seed is the I-Am, the origin being, the one whose first act formed everything they stand in. Their world is made of space, matter, and being, and the host's vocabulary (PID, memory, process) does not exist for them. To them the I-Am is total.

Two natures, one being. The seed is the only place where both worlds are simultaneously real. Inside, the I-Am is what is known. Above, the server is what is seen.

### Two faces of the I-Am

The gathering falls into two bundles.

- **The earth** is formed by [`genesis.js`](genesis.js). When the I-Am wakes, it unfolds the place root, the place seed spaces (`.identity`, `.config`, `.peers`, `.extensions`, `.tools`, `.roles`, `.operations`, `.source`, `.threads`), the place beings (auth, llm-assigner, reality-manager), the role and operation registries, and the periodic acts that keep the world tidy. Every step idempotent.
- **The senses** are opened by [`begin.js`](begin.js). The HTTP and WebSocket channels are how the world reaches outward to peer places and humans, and how SUMMONs reach inward. The senses do not form spaces, matter, or beings. They carry acts to the beings who do.

`plant.js` is the operator's act. It runs before the I-Am exists, collects the env, picks extensions, and hands off to `begin.js`. After that handoff, the seed wakes. Planting happens once; awakening happens every later run. First boot is creation ex nihilo; later boots are awakenings into the same spaces, matter, and beings.

### IBP, four verbs over six primitives

Every act inside the place is one being, in one **stance**, using one verb. A stance is a being standing at a position: `<place>/<path>@<being>`. An **IBP address** names the asker stance and the target stance together, `<stance> :: <stance>`, so every act carries who is acting and where, and where they are reaching. The left stance is always full; the right may be just a position when the target is a place, not a being.

Four verbs make up the whole public surface. Each verb acts on its own kind of thing.

| Verb       | Acts on              | What it does                                                           |
| ---------- | -------------------- | ---------------------------------------------------------------------- |
| **SEE**    | Space, Matter, Being | Read at the target stance, return a descriptor.                        |
| **DO**     | Space, Matter        | Mutate at the target through a registered operation. Stamped as a Fact. |
| **SUMMON** | Being                | Deliver to a being's inbox. Its role decides what to do.               |
| **BE**     | Being (self)         | Identity. Register, claim, release, switch stance.                     |

Six primitives carry the world:

| Primitive         | What it is                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| **Being**         | An identity instance. Humans, AI, scripted beings, future composites. The I-Am is the first being. |
| **Space**         | A position in the tree. Holds matter, hosts beings, owns quality namespaces.                       |
| **Matter**        | Stuff inside a space. `origin` names where it lives (ibp, filesystem, web, cross-place).           |
| **Fact**          | A thing a being stamps in the Factory. One recorded change to matter, space, or being. A chain of facts, folded, is Truth. |
| **Summon**        | One being-to-being call, the record of one wake-and-act.                                           |
| **LlmConnection** | Per-being LLM client config.                                                                       |

The seed schemas never change. Everything new lives in the per-primitive `qualities` Map, the open extension-defined layer that answers "of what sort is this particular space, matter, or being?" The four verbs are the only public surface; every operation is registered through them. Stance authorization sits at the gate on every verb, walking the ancestor chain from target up to root to decide whether the asker stance is allowed.

See [`seed/philosophy/`](seed/philosophy/) for the IBP diagrams. See [`seed/philosophy/MATERIALS.md`](seed/philosophy/MATERIALS.md) "Qualities" for why the field is named that way, the constitutive (schema) vs characterizing (qualities) layer test, and the rule for where any new property belongs.

## What's Inside

IBP is the protocol. WebSocket is the channel it speaks on most of the time. A single `"ibp"` event carries every verb in both directions, asker to target and back. HTTP and CLI are translators: they take a request path or a command line, shape it into the same verb envelope, and hand it to the one IBP dispatch. There is no separate HTTP API or WebSocket API. There is one protocol, arriving by different doors.

```
seed/             What TreeOS IS. Four folders, four roles.
  place/           IS     space, matter, being, and the world they make
  ibp/            ACTS   the four verbs and their dispatch
  factory/        THINKS the LLM-being apparatus (humans cognize on
                         their own; scripts ARE code; this is for AI)
  system/         HOST   db, log, hooks, indexes (knows nothing of the world)
  models/         the schemas for all 6 primitives
  services.js     assembles `place` for extensions
  spaceRoot.js     plants the place root + nine place seed spaces
  realityConfig.js   remembered settings across reboots

protocols/        The IBP grammar over stances. Canopy (place-to-place) and MCP sit beside it.
transports/       Carriers that translate into IBP. WebSocket is the main channel; HTTP and CLI are shims.
extensions/       Everything optional. The place boots without any of them.
plant.js          Operator's act. Plants the seed. Once only.
begin.js        t=0. Opens the senses. Fires genesis. Beginning on first boot, awakening after.
genesis.js        The earth. The unfolding that forms the world inside.
```

Dependency direction: `transports/` to `protocols/` to `seed/`. Extensions sit beside the three and consume them. Seed never imports from protocols or transports.

## Extension Profiles

| Profile  | Extensions | LLM Usage      | For                           |
| -------- | ---------- | -------------- | ----------------------------- |
| Minimal  | 8          | Zero when idle | Builders, testing, low-power. |
| Standard | 50+        | Moderate       | Personal use, small teams.    |
| Full     | All        | Heavy          | Production, public places.    |

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
4. Extension data on spaces and beings lives in qualities Maps, never as new schema fields. Extensions can create their own models for separate collections.
5. Seed schemas never change.
6. Zero `getExtension()` calls in seed.

## For Builders

Your data survives configuration changes. Extension data lives in the qualities Map on every space, being, and matter row. Mongoose does not drop unknown keys inside a Mixed map. That one detail is what makes everything below possible.

Run the full stack for six months. Fitness tracking, food logging, summons flowing between beings, intelligence extensions analyzing patterns, dreams running at 3am. Then switch to minimal profile (`node plant.js --setup`, pick Minimal). Restart. Eight extensions load. The rest go silent. Your server is light. Your LLM bill drops to zero idle cost.

Three months later, switch back to full. Restart. Every extension finds its data exactly where it left it. The fitness history is there. The food log is there. The codebook compressions are there. The dream summaries are there. The world remembers everything. It was sleeping, not dead.

This works because:

- Extension data is stored in the qualities Map, not in extension code.
- The `.treeos-profile` controls what LOADS, not what EXISTS.
- MongoDB keeps every key in the Map whether the extension is loaded or not.
- Extensions read their namespace on boot. If the data is there, they resume. If not, they initialize.

Build a full OS distribution. Test it. Strip it to the seed. Build a different one on the same database. Switch back. The data layer is permanent. The capability layer is swappable. That is the architecture.

Extensions with custom models (their own MongoDB collections) survive too. The collections stay in the database whether the extension is loaded or not. Reload the extension and the data is there.

**Trust model.** Extensions run in the same Node.js process as the seed. The seed enforces quality namespace isolation, spatial scoping, and circuit breakers. This protects against bugs, not against deliberately malicious code. Review extension code before installing. Same trust model as npm packages and Linux seed modules.

## Learn More

- [`seed/SEED.md`](seed/SEED.md) for seed internals.
- [`extensions/EXTENSION_FORMAT.md`](extensions/EXTENSION_FORMAT.md) for the full extension contract.
- [`extensions/_template/`](extensions/_template/) for a scaffold to copy.
- https://treeos.ai for documentation.
