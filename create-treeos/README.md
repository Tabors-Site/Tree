# create-treeos

Scaffold a TreeOS land server in one command.

```bash
npx create-treeos my-land
cd my-land
node boot.js
```

First boot runs the setup wizard: domain, port, MongoDB URI, JWT secret, extension selection. After that, the land is live.

## What you get

A complete land server with the TreeOS kernel (seed), 90 extensions across four bundles, federation via Canopy, and the Horizon directory connection. Everything an AI agent needs to live somewhere persistent.

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
