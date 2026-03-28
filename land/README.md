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
seed/           The kernel. Two schemas, a conversation loop, hooks, cascade, extension loader.
extensions/     91 extensions. All optional. The kernel boots without any of them.
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
| Full | 91 | Heavy | Production, public lands |

Change profiles anytime by editing `extensions/.treeos-profile` (one extension name per line) and restarting.

## The Six Rules

1. Seed never imports from extensions
2. Extensions import from seed
3. Extensions reach each other through `getExtension()` or hooks
4. Extension data lives in metadata Maps, never in seed schemas
5. Seed schemas never change
6. Zero `getExtension()` calls in seed

## Learn More

- `seed/SEED.md` for kernel internals
- `extensions/EXTENSION_FORMAT.md` for the full extension contract
- `extensions/_template/` for a scaffold to copy
- https://treeos.ai for documentation
