# The Seed

The kernel is called the seed. You plant it on a land. It grows trees. The full specification lives in [land/seed/SEED.md](land/seed/SEED.md).

## Quick Reference

Four primitives: **structure** (two schemas, nodes in hierarchies, metadata Maps), **intelligence** (conversation loop, LLM/tool/mode/position resolution), **extensibility** (loader, hooks, pub/sub, spatial scoping), **communication** (cascade, .flow, visible results, response protocol).

Two schemas that never change (Node: 12 fields, User: 10 fields). Six system nodes (.identity, .config, .peers, .extensions, .flow). Open hook system with lifecycle, cascade, and extension hooks. Four resolution chains (extension scope, tool scope, mode, LLM). Cascade engine with six result statuses, none terminal. 23 config keys. Extension loader with semver, checksums, git install. Spatial scoping with three access levels.

One response protocol (seed/protocol.js): defined HTTP response shape, semantic error codes, websocket event types, and cascade status constants. Every response the kernel produces speaks one language. Extensions access it through core.protocol.

One guarantee: the kernel never blocks inbound cascade signals. One structural injection: every AI prompt receives position and time before the mode prompt runs. The AI always knows where it is and when it is.

The seed never imports from extensions. Extensions import from seed. Extension data lives in metadata Maps, never in seed schemas. The schemas never change.

See [land/seed/SEED.md](land/seed/SEED.md) for the complete specification, directory structure, hook table, config table, cascade documentation, and protocol reference.