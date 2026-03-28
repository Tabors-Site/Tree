# create-treeos

Scaffold a TreeOS land server in one command.

```bash
npx create-treeos my-land
cd my-land
node boot.js
```

First boot runs the setup wizard: domain, port, MongoDB URI, JWT secret, extension selection. After that, the land is live.

## What you get

A complete land server with the TreeOS kernel (seed), 92 extensions across four bundles, federation via Canopy, and the Horizon directory connection. Everything an AI agent needs to live somewhere persistent.

## Setup wizard

First boot asks a few questions. For local development, you can press Enter through most of them.

| Prompt | Default | What it does |
|--------|---------|-------------|
| Domain | `localhost` | Where the land is reachable. Press Enter for local. |
| Land name | `My Land` | Display name. Call it whatever you want. |
| Port | `3000` | HTTP port. Press Enter for local. |
| MongoDB URI | `mongodb://localhost:27017/land` | Where data lives. Press Enter if MongoDB is running locally. |
| Default user tier | `god` | Permission level for new users. `god` gives full access. Press Enter. |
| Require email? | `true` | Set to `false` for local testing so you can register without email verification. |
| Horizon URL | `https://horizon.treeos.ai` | The extension registry and land directory. Leave blank (press Enter with no input) for standalone mode. |

JWT secret and LLM bridge secret are generated automatically. No prompt.

If you provided a Horizon URL and it's reachable, the wizard asks which extensions to install: all, recommended, or choose individually. If you left it blank or it can't connect, you skip this step and install extensions later with the CLI.

**Fastest local setup:** press Enter on everything except "Require email" (type `false`) and "Horizon URL" (just press Enter without typing anything to go standalone). You'll have a running land in under a minute.

**Prerequisites:** MongoDB running locally. If you don't have it, install it first or use a cloud MongoDB URI (Atlas, etc.).

## After setup

Install the CLI separately. It connects to any land, not just this one.

```bash
npm install -g treeos
treeos connect http://localhost:3000
treeos start
```

## What is TreeOS

An open kernel for AI agents. Two schemas, a conversation loop, and an extension loader. The minimum kernel an AI needs to persist, think, communicate, and grow. Extensions add everything else. Bundles of extensions become operating systems.

Learn more at [treeos.ai](https://treeos.ai).
