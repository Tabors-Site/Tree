# Decoupling the Kernel

The last post talked about opening up the network. This one is about what had to happen before anyone could actually use it.

## One Schema to Rule Them All

TreeOS had a problem. Every feature I built got wired directly into the core. Solana wallets? Hardcoded into the Node schema. Scripts? Hardcoded. Transaction approval policies? Hardcoded. Understanding runs, short-term memory, visibility controls. All of it bolted onto one database model that grew with every idea I had.

This worked when it was one server, one database, one programmer. But the moment you tell someone else to run their own land, it falls apart. Their trees don't need wallets. Their trees might need something I never imagined. And the only way to add it was to fork the entire project and modify the core.

That's not a network. That's a template.

## Extensions Own Their Own Code

So I ripped it apart. Every feature that isn't fundamental to trees got pulled out of core and packaged into its own directory. An extension is a folder. It has a manifest that says what it needs and what it provides. It has an init function that returns routes, tools, and jobs. The loader discovers it at boot, validates dependencies, and wires it into the system.

The extension owns everything: its database models, its API endpoints, its MCP tools for the AI, its background jobs, its orchestrator pipelines, its migrations. Core doesn't import from extensions. Core doesn't know they exist. If you delete every extension directory, the system still boots. You get trees, nodes, notes, values, and the AI conversation loop. The kernel.

18 features became 18 extensions. The core MCP server dropped from 3500 lines to 2400. The Node schema lost every field that wasn't structural. 

## Data Lives in Metadata

The old approach put extension data directly on the Node schema. `node.scripts`, `node.versions[].wallet`, `node.transactionPolicy`. If you ran a land without the solana extension, those fields were still there. Empty. Taking up space in every document. And if someone on another land sent you tree data with fields your schema didn't have, Mongoose silently dropped them.

Now extensions store their data in `node.metadata`, a flexible map that every node already has. Solana wallets live in `metadata.solana`. Scripts live in `metadata.scripts`. Transaction policies live in `metadata.transactions`. Each extension gets its own namespace.

This changes everything for the network. When Land A sends tree data to Land B, the metadata survives. Land B might not have the solana extension installed. The wallet data still passes through. It's stored. It's preserved. If Land B installs the extension later, the data is already there.

Mongoose drops unknown schema fields. It does not drop unknown keys inside a Mixed map. That one architectural detail is what makes extension data portable across the network.

## The AI Gets New Capabilities

Extensions don't just add features for users. They add tools for the AI.

The MCP server is how the LLM interacts with the tree. It calls tools to create nodes, edit notes, set values. Previously, all 40 tools were defined in one massive file. Extension tools were mixed in with core tools. If you wanted to add a new AI capability, you edited the MCP server.

Now extensions register their own tools. The understanding extension provides 5 tools for tree compression. The scripts extension provides 4 tools for sandbox execution. The prestige extension provides 1 tool for version cycling. Each returns a tools array from init(), and the loader registers them with the MCP server automatically.

When someone builds a new extension, the AI on their land immediately gains whatever tools that extension provides. No prompt engineering. No MCP server modifications. Install the extension, restart, the AI can use it.

## Peers Know What Each Other Has

The canopy protocol already let lands discover and peer with each other. Now `/canopy/info` includes the list of loaded extensions. When you peer with another land, their extension list is stored locally. Every heartbeat updates it.

This is the foundation for capability-aware federation. Right now it's informational. Land A can see that Land B has understanding and dreams loaded. Land B can see that Land A has solana and scripts. Down the road, this enables negotiation. Proxy requests that adapt based on what the other side supports. Extension-specific data channels. Collaborative features that span lands.

## The Directory

Extensions need distribution. The Canopy Directory already tracked lands and public trees. Now it tracks extensions too. Any land operator can publish an extension with `treeos ext publish`. Anyone can browse, search, and install from the directory.

The directory page shows each extension's manifest, what it provides, what it requires, its download count, and the complete source code. Line numbers. File tabs. You read exactly what you're installing.

This is the package manager for the network. Not npm. Not a walled garden app store. A transparent registry where lands publish and lands consume. The code is visible because the network is open.

## What This Actually Is

A kernel that manages trees and runs an AI. Extensions that add capabilities to both the user and the intelligence. A metadata system that makes extension data portable across federated nodes. A protocol that separates what every land must do from what any land can choose to do. A directory that distributes the packages.

\
