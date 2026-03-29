# TreeOS Land

An operating system for AI agents. This is a land server. Plant trees, run AI conversations, connect to a federated network.

## Quick Start

```bash
# Install dependencies
npm install

# Start the server (first run triggers setup wizard)
npm start
```

The setup wizard asks:
- **Quick localhost?** Yes skips domain/port/MongoDB questions (defaults to localhost:3000)
- **Land name** for display
- **Extension profile**: Minimal (8 extensions), Standard (50+), Full (all), or Custom

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

## What's Inside

```
seed/           The kernel. Six models, a conversation loop, hooks, cascade, extension loader.
extensions/     95 extensions. All optional. The kernel boots without any of them.
routes/         HTTP API endpoints.
orchestrators/  Pipeline runtime for multi-step AI operations.
canopy/         Federation protocol. How lands find and talk to each other.
boot.js         Entry point. First-run setup wizard.
server.js       Express server, CORS, WebSocket, graceful shutdown.
startup.js      Boot sequence. Indexes, config, migrations, extensions, jobs.
```

## Extension Profiles

| Profile | Extensions | LLM Usage | For |
|---------|-----------|-----------|-----|
| Minimal | 8 | Zero when idle | Builders, testing, low-power |
| Standard | 50+ | Moderate | Personal use, small teams |
| Full | 95 | Heavy | Production, public lands |

Change profiles anytime:

```bash
# Re-run the extension picker
node boot.js --setup

# Or edit manually: one extension name per line
nano extensions/.treeos-profile
```

Then restart with `npm start`.

## The Six Rules

1. Seed never imports from extensions
2. Extensions import from seed
3. Extensions reach each other through `getExtension()` or hooks
4. Extension data on nodes/users lives in metadata Maps, never as new schema fields. Extensions can create their own models for separate collections.
5. Seed schemas never change
6. Zero `getExtension()` calls in seed

## Learn More

- `seed/SEED.md` for kernel internals
- `extensions/EXTENSION_FORMAT.md` for the full extension contract
- `extensions/_template/` for a scaffold to copy

## For Builders

Your data survives configuration changes. Extension data lives in the metadata Map on every node and user. Mongoose does not drop unknown keys inside a Mixed map. That one detail is what makes everything below possible.

Run the full stack for six months. Fitness tracking, food logging, cascade signals flowing between trees, intelligence extensions analyzing patterns, dreams running at 3am. Then switch to minimal profile (`node boot.js --setup`, pick Minimal). Restart. Eight extensions load. The rest go silent. Your server is light. Your LLM bill drops to zero idle cost.

Three months later, switch back to full. Restart. Every extension finds its data exactly where it left it. The fitness history is there. The food log is there. The codebook compressions are there. The dream summaries are there. The tree remembers everything. It was sleeping, not dead.

This works because:
- Extension data is stored in the metadata Map, not in extension code
- The `.treeos-profile` controls what LOADS, not what EXISTS
- MongoDB keeps every key in the Map whether the extension is loaded or not
- Extensions read their namespace on boot. If the data is there, they resume. If not, they initialize.

Build a full OS distribution. Test it. Strip it to the kernel. Build a different one on the same database. Switch back. The data layer is permanent. The capability layer is swappable. That is the architecture.

Extensions with custom models (their own MongoDB collections) survive too. The collections stay in the database whether the extension is loaded or not. Reload the extension and the data is there.

**Trust model:** Extensions run in the same Node.js process as the kernel. The kernel enforces metadata namespace isolation, spatial scoping, and circuit breakers. This protects against bugs, not against deliberately malicious code. Review extension code before installing. Same trust model as npm packages and Linux kernel modules.
- https://treeos.ai for documentation
