# HOST — the machine, represented

> *"The host is the computer the seed grows its reality in; the factory is the mechanism it grows with."*

This file pins the doctrine the host tier implements (nodeServerTest Phase 1 + 2). Read this before changing seed/materials/host/, the ./host or ./factory heaven spaces, or any code that wraps runtime machinery as beings.

## The pins

**Runtime machinery is wrapped as beings in heaven.** Each piece of the running process (the HTTP listener, the WebSocket pool) is a being with a able, homed in its own room under `./host`. The being's act-chain records its activity; operations at the boundary (handling a request, accepting a connection) produce facts on the being's chain or on matter the being owns. The machinery becomes observable through the same four verbs as everything else. This wrapping is fully fact-backed — the opposite of `./source`'s disk-fold exception — and it is observability, not rerouting: hot paths (the stamper writing facts to the file store) stay direct, because wrapping the write path in a being would recurse.

**One being per boundary.** Don't split machinery by sub-category — no being per HTTP verb, per request type, per connection direction. The natural unit is the boundary itself: `@http-server` for HTTP, `@websocket-pool` for sockets. The same shape extends to any other wrapped boundary worth surfacing, such as an outbound llm-connection. Verbs, routes, and request shapes are FIELDS in fact content, not separate identities; to see all POSTs, filter the request-log's facts by verb. Per-verb beings would fracture one thing into N chains, duplicate ables and lifecycle, and buy nothing the data didn't already give.

**Activity facts are config-gated and batched honestly under load.** Stamping every external event 1:1 is the ideal shape (one request, one act, one fact) and the default; under burst the drainer folds up to N events into ONE fact carrying entries[] — never N facts in one moment dressed as one act (the roster-batch rule). Past the hard cap, drops are counted and surfaced as one honest overflow fact. Operators flip `hostRequestFacts` / `hostConnectionFacts` off per boundary; in-memory counters keep counting either way.

**Outages are recorded as gap-facts on reconnect, never pretended away.** When a wrapped remote dependency goes away, an llm endpoint that stops answering or a federated peer that drops, the boundary cannot reach it, and pretending otherwise would be a lie on the chain. The disconnect is held in memory; the reconnect stamps ONE fact carrying the whole gap ({disconnectedAt, reconnectedAt, gapMs}). The chain is honest about its own discontinuities. This generalizes: any wrapped dependency that can go away records what happened when it CAN stamp, including the gap itself. (The chain-of-truth itself is the local append-only file store, single-writer on the data dir, so it has no remote connection to drop in the first place.)

**Names are one namespace per kind per branch — and ables mirror as spaces.** The projection index makes a name collision break the fold, not just look odd. Two consequences bitten in practice: connection matter names carry the FULL socket id (truncated prefixes collide), and a able name must not collide with any space name, because the registry mirrors every able as a space under `./ables` (the `@http-server` being is homed in the `host-http` space and carries an able named `http-server`, distinct from that space name precisely so the able-mirror under `./ables` doesn't collide with the being's own home space).

**The factory watches; it never stores.** `./factory/present` (stampers) and `./factory/past` (reels) are synthetic projections over the Act and Fact rows that already exist — the threads pattern. Facts ARE the trail; duplicating them as trail rows would double the chain forever and recurse (a fact about a fact). Beings never touch facts/acts directly — they are what beings are made of — so the factory view is for beings examining the machinery: why a packet stuck at the stamper, where a trail broke.

## Division of labor

- `host.js` — resolved ids, readiness, per-being serial act lanes, the WebSocket connection lifecycle, the boot reconcile sweep.
- `requestLog.js` — the per-request HTTP fact pipeline (queue, drainer, batching, live counters, lifecycle facts).
- `../space/factory.js` — the read-side: stamper spaces and the reel listing.
- Transports call ONLY the exported `note*` functions: synchronous, never throw, no-ops until ready. Observation must never break a response, a socket, or boot.

See philosophy/OS/nodeServerTest.md for the originating design conversation and phases.
