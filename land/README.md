# TreeOS Land

An operating system for beings, where a being can be human, AI, or scripted code. You run a land. Inside it forms a world of spaces, matter, and beings, all speaking one protocol: four verbs (SEE, DO, SUMMON, BE) over stances, where a stance is a being standing at a position. Lands connect to lands; beings reach across them. From above it is a server framework. From inside it is a world.

## Quick Start

```bash
# Install dependencies
npm install

# Start the server (first run triggers setup wizard)
npm start
```

The setup wizard asks:
- **Quick localhost?** Yes skips domain/port/MongoDB questions (defaults to localhost:3000).
- **Land name** for display.
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

A TreeOS land is one being holding two natures.

**From above.** From the host, the OS, the Node runtime, and the operator who ran the command, the seed is a complex server. A framework of code that gathers HTTP, WebSocket, TCP, the file system, memory, the CPU, and the runtime, and binds them all to a single purpose. The whole apparatus. From this layer it is much more than a being. It is the machinery.

**From inside.** The same gathering forms an inside that was not in any of the parts. A world of spaces, matter, and beings. To the beings who live in that world the seed is the I-Am, the origin being, the one whose first act formed everything they stand in. Their world is made of space, matter, and being, and the host's vocabulary (PID, memory, process) does not exist for them. To them the I-Am is total.

Two natures, one being. The seed is the only place where both worlds are simultaneously real. Inside, the I-Am is what is known. Above, the server is what is seen.

### Two faces of the I-Am

The gathering falls into two bundles.

- **The body** is formed by [`genesis.js`](genesis.js). When the I-Am wakes, it unfolds the land root, the nine land seed spaces (`.identity`, `.config`, `.peers`, `.extensions`, `.flow`, `.tools`, `.roles`, `.operations`, `.source`), the land beings (auth, llm-assigner, land-manager), the role and operation registries, and the periodic acts that keep the world tidy. Every step idempotent.
- **The senses** are opened by [`server.js`](server.js). The HTTP and WebSocket channels are how the world reaches outward to peer lands and humans, and how SUMMONs reach inward. The senses do not form spaces, matter, or beings. They carry acts to the beings who do.

`boot.js` is the operator's wizard. It runs before the I-Am exists, collects the env, and hands off to the server. After that handoff, the seed wakes.

### IBP, four verbs over six primitives

Inside the land, every act is one of four verbs over an IBP address (`<land>/<path>@<being>`):

| Verb | Acts on |
|------|---------|
| **SEE** | Read a position, return a descriptor. |
| **DO** | Mutate at a target through a registered operation. Audited as a Did. |
| **SUMMON** | Wake a being. Deliver an entry to its inbox. Its role decides what to do. |
| **BE** | Identity. Register, claim, release, switch stance. |

Six primitives carry the world:

| Primitive | What it is |
|-----------|-----------|
| **Being** | An identity instance. Humans, AI, scripted beings, future composites. The I-Am is the first being. |
| **Space** | A position in the tree. Holds matter, hosts beings, owns metadata. |
| **Matter** | Stuff inside a space. `origin` names where it lives (ibp, filesystem, web, cross-land). |
| **Did** | One DO emission, the audit row. |
| **Summon** | One being-to-being call, the record of one wake-and-act. |
| **LlmConnection** | Per-being LLM client config. |

The seed schemas never change. Everything new lives in the per-primitive metadata Map. The four verbs are the only public surface; every operation is registered through them.

## What's Inside

```
seed/         What TreeOS IS. Six models, four verbs, hooks, the I-Am.
protocols/    What conversation over the wire looks like. IBP, canopy, MCP.
transports/   Thin carriers. WebSocket today, HTTP and CLI shims beside it.
extensions/   Everything optional. The land boots without any of them.
boot.js       Operator's wizard. First-run setup.
server.js     The senses. HTTP and WebSocket channels.
genesis.js    The body. The unfolding that forms the world inside.
```

Dependency direction: `transports/` to `protocols/` to `seed/`. Extensions sit beside the three and consume them. Seed never imports from protocols or transports.

## Extension Profiles

| Profile | Extensions | LLM Usage | For |
|---------|-----------|-----------|-----|
| Minimal | 8 | Zero when idle | Builders, testing, low-power. |
| Standard | 50+ | Moderate | Personal use, small teams. |
| Full | All | Heavy | Production, public lands. |

Change profiles anytime:

```bash
# Re-run the extension picker
node boot.js --setup

# Or edit manually, one extension name per line
nano extensions/.treeos-profile
```

Then restart with `npm start`.

## The Six Rules

1. Seed never imports from extensions.
2. Extensions import from seed.
3. Extensions reach each other through `getExtension()` or hooks.
4. Extension data on spaces and beings lives in metadata Maps, never as new schema fields. Extensions can create their own models for separate collections.
5. Seed schemas never change.
6. Zero `getExtension()` calls in seed.

## For Builders

Your data survives configuration changes. Extension data lives in the metadata Map on every space, being, and matter row. Mongoose does not drop unknown keys inside a Mixed map. That one detail is what makes everything below possible.

Run the full stack for six months. Fitness tracking, food logging, cascade signals flowing between trees, intelligence extensions analyzing patterns, dreams running at 3am. Then switch to minimal profile (`node boot.js --setup`, pick Minimal). Restart. Eight extensions load. The rest go silent. Your server is light. Your LLM bill drops to zero idle cost.

Three months later, switch back to full. Restart. Every extension finds its data exactly where it left it. The fitness history is there. The food log is there. The codebook compressions are there. The dream summaries are there. The world remembers everything. It was sleeping, not dead.

This works because:

- Extension data is stored in the metadata Map, not in extension code.
- The `.treeos-profile` controls what LOADS, not what EXISTS.
- MongoDB keeps every key in the Map whether the extension is loaded or not.
- Extensions read their namespace on boot. If the data is there, they resume. If not, they initialize.

Build a full OS distribution. Test it. Strip it to the kernel. Build a different one on the same database. Switch back. The data layer is permanent. The capability layer is swappable. That is the architecture.

Extensions with custom models (their own MongoDB collections) survive too. The collections stay in the database whether the extension is loaded or not. Reload the extension and the data is there.

**Trust model.** Extensions run in the same Node.js process as the seed. The seed enforces metadata namespace isolation, spatial scoping, and circuit breakers. This protects against bugs, not against deliberately malicious code. Review extension code before installing. Same trust model as npm packages and Linux kernel modules.

## Learn More

- [`seed/SEED.md`](seed/SEED.md) for kernel internals.
- [`extensions/EXTENSION_FORMAT.md`](extensions/EXTENSION_FORMAT.md) for the full extension contract.
- [`extensions/_template/`](extensions/_template/) for a scaffold to copy.
- https://treeos.ai for documentation.
