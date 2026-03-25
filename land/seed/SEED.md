# The Seed

The kernel is called the seed. You plant it on a land. It grows trees.

Two schemas, a conversation loop, a hook system, a cascade engine, an extension loader, and a response protocol. Remove every extension and the seed still boots. It defines the data contract that extensions build on, the resolution chains that determine what happens at every position, and the communication primitive that makes signals visible.

## Four Primitives

Everything in the seed serves one of four primitives. Everything else is emergent behavior from these four interacting.

| Primitive | What it is | Key files |
|-----------|-----------|-----------|
| **Structure** | Two schemas (Node, User), nodes in hierarchies, metadata Maps | models/node.js, models/user.js |
| **Intelligence** | Conversation loop, LLM/tool/mode/position resolution, time and position injection | ws/conversation.js, ws/modes/registry.js, ws/mcp.js |
| **Extensibility** | Extension loader, open hook system, pub/sub, spatial scoping, five registries | hooks.js, extensions/loader.js, tree/extensionScope.js |
| **Communication** | Cascade signals, .flow system node, visible results, response protocol | tree/cascade.js, protocol.js |

## Schemas

Two core schemas define the data contract. They never change. Extensions store all data in the metadata Map under their own namespace.

### Node (12 fields, excluding _id)

name, type, status, dateCreated, llmDefault, visibility, children[], parent, rootOwner, contributors[], systemRole, metadata (Map)

Type is free-form. The kernel validates format (string, max 50 chars, no HTML). Extensions define meaning. Status is active, completed, or trimmed. Extensions store their data in metadata under their name: `metadata.values`, `metadata.prestige`, `metadata.cascade`, `metadata.extensions`, `metadata.tools`, `metadata.modes`. The Map preserves unknown keys across network transit.

### User (7 fields, excluding _id)

username, password, llmDefault, isAdmin, isRemote, homeLand, metadata (Map)

One default LLM connection. `isAdmin` is a boolean the kernel checks for authorization (private IP bypass, note size bypass, admin route gates). `isRemote` and `homeLand` are identity fields the auth layer checks on every request. Federation data (remote roots) lives in `metadata.canopy`. Tier/plan lives in `metadata.tiers`. Extensions store energy budgets, API keys, LLM slot assignments, storage usage, and preferences in metadata.

### Supporting Models

Node and User are the data contract. The seed also owns models for kernel operations:

| Model | Purpose |
|-------|---------|
| Note | Note content. The primary data field. beforeNote/afterNote hooks fire. |
| Contribution | Audit trail. Core action shapes + extensionData for everything else. |
| AIChat | Conversation sessions. The conversation loop is kernel. |
| LLMConnection | LLM endpoint storage. The resolution chain is kernel. |

Federation models (CanopyEvent, LandPeer, RemoteUser) live in `canopy/models/`, not in the seed.

## Three Zones

Navigation determines the AI's behavior zone. Structural, not interpretive. Determined by URL.

| Position | Zone | Fallback Mode |
|----------|------|---------------|
| `/` (land root) | Land | land:fallback |
| `~` (user home) | Home | home:fallback |
| `/MyTree` (inside tree) | Tree | tree:fallback |

Zones are kernel. Sub-modes within zones are extensions. The treeos extension registers navigate, structure, edit, respond, librarian, and others. A different extension could register completely different modes. The kernel provides fallback modes (the floor) when no extension registers anything.

## Six System Nodes

Created at boot by `ensureLandRoot()`. They hold infrastructure state, not user content.

| Node | systemRole | Purpose |
|------|-----------|---------|
| Land Root | land-root | Top of everything. Parent of all trees and system nodes. |
| .identity | identity | Land UUID, domain, Ed25519 public key for Canopy federation signing. |
| .config | config | All runtime configuration as metadata keys. CLI, API, or AI writable. |
| .peers | peers | Canopy federation peer list. |
| .extensions | extensions | Extension registry. Loaded extensions tracked as child nodes. |
| .flow | flow | Cascade result store. Daily partition children hold results. Retention deletes entire partitions. |

## Five Registries

Same pattern. Extensions register. The kernel resolves. Failure falls back to the kernel, never to silence.

| Registry | What it registers | Infrastructure file |
|----------|-------------------|---------------------|
| **Hooks** | Lifecycle event handlers | hooks.js |
| **Modes** | AI conversation modes | ws/modes/registry.js |
| **Orchestrators** | Conversation flow replacements | orchestratorRegistry.js |
| **Socket handlers** | WebSocket event handlers | ws/websocket.js |
| **Auth strategies** | Authentication methods | middleware/authenticate.js |

## Rules

1. The seed NEVER imports from extensions.
2. Extensions import from seed.
3. Extensions reach each other through `getExtension()` or hooks.
4. Extension data lives in metadata Maps, never in seed schemas.
5. Seed schemas never change.
6. Zero `getExtension()` calls in seed.

## Guarantees

**Never block inbound.** Cascade signals always accepted. Always produce a result. No configuration can prevent a signal from arriving.

**Position injection.** Every AI prompt receives a `[Position]` block before the mode prompt. Tree modes get User, Tree (name + ID), Current node, Target node. Home modes get Zone: Home. Land modes get Zone: Land. The AI always knows where it is. Extension modes cannot exclude it.

**Time injection.** Every AI prompt receives the current time in the land's timezone. Cannot be turned off.

**Extension router timeout.** Extension page routes (mounted at /) wrapped with 5-second timeout. If an extension page route hangs, the kernel handles the request. API routes (/api/v1) are not wrapped because AI chat routes can take 30+ seconds.

**MCP transport ordering.** The MCP SDK locks tool registration after `server.connect(transport)`. Extensions register tools during the wire phase. Transport connects after wire completes. Reordering breaks silently: the AI has no tools and nothing errors.

**Auth fallthrough.** `authenticateOptional` tries every registered auth strategy. If none match, request continues anonymously. Extensions register share token, public access, API key strategies. The kernel pipeline handles them all.

## Resolution Chains

Every operation at a node goes through four resolution chains. Position determines capability.

1. **Extension scope**: Walk parent chain, accumulate `metadata.extensions.blocked[]` and `restricted`. Blocked = no tools, hooks, modes, metadata writes. Restricted = read-only tools only.
2. **Tool scope**: Mode base tools + extension tools + per-node `metadata.tools.allowed/blocked`. Filtered by extension scope.
3. **Mode resolution**: `metadata.modes[intent]` per-node override, then default mapping, then bigMode fallback.
4. **LLM resolution**: Extension slot on tree, tree default, extension slot on user, user default.

## Hooks

Two rules, no exceptions. Before hooks run sequential because they can cancel. After hooks run parallel because they react independently. Two hooks override this: enrichContext and onCascade are sequential because their handlers build cumulative output. Don't make a hook sequential without articulating why handlers depend on each other's output. If you can't, it's parallel.

| Hook | Type | Purpose |
|------|------|---------|
| beforeNodeCreate | before | Gate node creation. Enforce naming, child limits, compliance. |
| beforeNote | before | Modify note data, tag version |
| afterNote | after | React to note create/edit/delete |
| beforeContribution | before | Modify contribution data. Extensions add to extensionData via hook. |
| afterNodeCreate | after | Initialize extension data |
| beforeStatusChange | before | Validate, intercept |
| afterStatusChange | after | React to status changes |
| beforeNodeDelete | before | Cleanup extension data |
| enrichContext | sequential | Inject extension data into AI context |
| beforeLLMCall | before | Before LLM API call. Cancel if quota exhausted. |
| afterLLMCall | after | After LLM API call. Token metering, billing, analytics. |
| beforeToolCall | before | Before MCP tool executes. Modify args, cancel. |
| afterToolCall | after | After MCP tool executes. React to result or error. |
| beforeResponse | before | Modify AI response before client receives it |
| beforeRegister | before | Validate registration. Extensions own email, verification. |
| afterRegister | after | Initialize user data (share tokens, etc.) |
| afterSessionCreate | after | Session registered. React to { sessionId, userId, type }. |
| afterSessionEnd | after | Session ended. React to { sessionId, userId, type }. |
| afterNavigate | after | Fires when user navigates to a tree root. Extensions track recency. |
| afterMetadataWrite | after | After setExtMeta succeeds. { nodeId, extName, data }. Zero overhead if no listeners. |
| afterScopeChange | after | After extension blocking/restriction changes. { nodeId, blocked, restricted, userId } |
| afterOwnershipChange | after | After rootOwner or contributors changed. { nodeId, action, targetUserId, previousOwnerId? } |
| afterBoot | after | Once after all extensions loaded, config initialized, server listening. |
| onCascade | sequential | Fires on content write at cascade-enabled node. Results written to .flow. |
| onDocumentPressure | after | Any document exceeds 80% of maxDocumentSizeBytes. { documentType, documentId, currentSize, projectedSize, maxSize, percent } |
| onTreeTripped | after | Tree circuit breaker tripped. { rootId, reason, scores, timestamp } |
| onTreeRevived | after | Tripped tree revived. { rootId, timestamp } |

## Ownership

Ownership resolves by walking the parent chain. The first node with `rootOwner` set is the ownership boundary. `rootOwner` means "the owner from this point down." Setting rootOwner on a branch delegates that sub-tree to a new owner.

Contributors accumulate along the walk. If a user is in `contributors[]` at any node between the current position and the ownership boundary, they have write access.

Five ownership mutation functions in `seed/tree/ownership.js`, all chain-validated:

| Function | Rule |
|----------|------|
| addContributor | Resolved owner or admin. Atomic $addToSet. |
| removeContributor | Resolved owner, admin, or self-removal. |
| setOwner | Owner above or admin can delegate. |
| removeOwner | Owner above or admin can revoke. Section falls back to next owner up. |
| transferOwnership | Current owner or admin can transfer. |

All reject on system nodes. Extensions use `core.ownership.*`.

## Cascade

When content is written at a node with `metadata.cascade.enabled = true` and `cascadeEnabled = true` in .config, the seed fires `onCascade`.

- `checkCascade(nodeId, writeContext)`: seed-internal. Automatic on content writes.
- `deliverCascade({ nodeId, signalId, payload, source, depth })`: extension-external. Extensions propagate signals. The seed never blocks it.

Result shape: `{ status, source, payload, timestamp, signalId, extName }`. Six statuses: succeeded, failed, rejected, queued, partial, awaiting. None terminal.

### .flow Partitioning

Results are stored in daily partition nodes under .flow. Each partition is a child node named by date (YYYY-MM-DD). The kernel creates today's partition on first cascade write of the day.

Retention deletes entire partition nodes older than resultTTL. No scanning individual keys. Drop the node.

`flowMaxResultsPerDay` (default 10,000) caps results per partition. When the cap is hit, the oldest signal in that partition is overwritten. Circular buffer. The land never stops recording. It just forgets the oldest when pressure is high.

Query functions (`getCascadeResults`, `getAllCascadeResults`) search across partitions transparently. Extensions never know partitions exist.

## Protocol

Single file `seed/protocol.js`. Extensions access via `core.protocol`.

HTTP: `{ status: "ok", data }` or `{ status: "error", error: { code, message } }`.

WebSocket: Named constants in `WS` object. Kernel events only. Extension events own their own constants.

Cascade: Named constants in `CASCADE` object.

## Config

Runtime config stored in .config system node. Readable and writable via CLI (`treeos config set`), API, or AI.

| Key | Default | Purpose |
|-----|---------|---------|
| LAND_NAME | "My Land" | Display name |
| landUrl | auto | Land URL. Set at boot from domain and port. Used in security headers and LLM request signing. |
| llmTimeout | 900 | Seconds per LLM API call |
| llmMaxRetries | 3 | Retry count on 429/500 |
| maxToolIterations | 15 | Tool calls per message |
| maxConversationMessages | 30 | Context window size |
| defaultModel | "" | Fallback LLM model |
| noteMaxChars | 5000 | Max characters per note |
| treeSummaryMaxDepth | 4 | How deep AI sees the tree |
| treeSummaryMaxNodes | 60 | How many nodes AI sees |
| carryMessages | 4 | Messages carried across mode switch |
| sessionTTL | 900 | Session idle timeout (seconds) |
| staleSessionTimeout | 1800 | Stale session cleanup (seconds) |
| maxSessions | 10000 | Max concurrent sessions |
| chatRetentionDays | 90 | Auto-delete chats |
| contributionRetentionDays | 365 | Auto-delete contributions |
| timezone | auto | Land timezone for AI prompts |
| disabledExtensions | [] | Extensions to skip on boot |
| cascadeEnabled | false | Enable cascade signals |
| resultTTL | 604800 | Cascade result TTL (seconds) |
| awaitingTimeout | 300 | Awaiting to failed timeout (seconds) |
| cascadeMaxDepth | 50 | Max propagation depth |
| cascadeMaxPayloadBytes | 51200 | Max signal payload (50KB) |
| cascadeRateLimit | 60 | Max signals per node per minute |
| uploadEnabled | true | Master switch for uploads |
| maxUploadBytes | 104857600 | Hard ceiling per upload (100MB) |
| allowedMimeTypes | null | Allowed MIME prefixes, null means all |
| maxDocumentSizeBytes | 14680064 | Document size ceiling (14MB, 2MB headroom under MongoDB's 16MB) |
| flowMaxResultsPerDay | 10000 | Max cascade results per daily partition |
| allowedFrameDomains | [] | Additional domains allowed in CSP frame-ancestors |
| ancestorCacheTTL | 30000 | Milliseconds before cached ancestor chains expire |
| integrityCheckInterval | 86400000 | Milliseconds between periodic tree integrity checks (24h) |
| treeCircuitEnabled | false | Master switch for tree circuit breaker |
| maxTreeNodes | 10000 | Node count threshold for health equation |
| maxTreeMetadataBytes | 1073741824 | Total metadata size threshold (1GB) |
| maxTreeErrorRate | 100 | Errors per hour threshold |
| circuitNodeWeight | 0.4 | Weight of node count in health equation |
| circuitDensityWeight | 0.3 | Weight of metadata density |
| circuitErrorWeight | 0.3 | Weight of error rate |
| circuitCheckInterval | 3600000 | Health check interval (1 hour) |
| toolCircuitThreshold | 5 | Consecutive failures before a tool is disabled for the session |
| llmMaxConcurrent | 20 | Max in-flight LLM API calls across all users. Prevents thundering herd. |
| maxNotesPerNode | 1000 | Max notes per node. Prevents runaway extension note floods. |
| seedVersion | "0.1.0" | Current seed version. Compared at boot to run migrations. Set by migration runner. Do not modify manually. |

Extension config (like `htmlEnabled`) lives in .config too, written by extensions on first boot, not by the kernel.

### Internal Tuning

Advanced operators can adjust these values via `treeos config set`. Most lands never need to. Defaults are safe.

| Key | Default | What it tunes |
|-----|---------|---------------|
| socketMaxBufferSize | 1048576 | Max WS message size (bytes) |
| socketPingTimeout | 30000 | WS ping timeout (ms) |
| socketPingInterval | 25000 | WS ping interval (ms) |
| socketConnectTimeout | 10000 | WS connection timeout (ms) |
| maxConnectionsPerIp | 20 | Per-IP WS connection cap |
| llmClientCacheTtl | 300 | User LLM client cache lifetime (seconds) |
| canopyProxyCacheTtl | 60 | Canopy proxy client cache lifetime (seconds) |
| apiOrchestrationTimeout | 1140000 | API request timeout (ms) |
| canopyHeartbeatInterval | 300000 | Heartbeat frequency (ms) |
| canopyDegradedThreshold | 2 | Failed heartbeats before degraded |
| canopyUnreachableThreshold | 12 | Failed heartbeats before unreachable |
| canopyDeadThresholdDays | 30 | Days before dead peer cleanup |
| canopyOutboxInterval | 60000 | Outbox processing frequency (ms) |
| canopyMaxRetries | 5 | Event delivery retries |
| canopyEventDeliveryTimeout | 15000 | Per-event delivery timeout (ms) |
| canopyDestLimitPerCycle | 10 | Events per destination per cycle |
| orchestratorLockTtlMs | 1800000 | Lock TTL before auto-expire (ms) |
| lockSweepInterval | 300000 | Lock cleanup sweep (ms) |
| uploadCleanupInterval | 21600000 | Cleanup frequency (ms) |
| uploadGracePeriodMs | 3600000 | File age before deletion (ms) |
| retentionCleanupInterval | 86400000 | Retention job frequency (ms) |
| cascadeCleanupInterval | 21600000 | Cascade result cleanup frequency (ms) |

## Tree Circuit Breaker

When a tree exceeds health thresholds, its circuit trips. No AI interactions. No cascade. No writes. Read access stays open. The data is intact. The tree is sleeping.

Health equation: `(nodeCount / max) * nodeWeight + (metadataDensity / max) * densityWeight + (errorRate / max) * errorWeight`. When the score exceeds 1.0, the tree trips. Error rate reads from both contribution log (tool/write failures) and .flow partitions (cascade failures/rejections).

State stored on root node: `metadata.circuit = { tripped, reason, timestamp, scores }`. The kernel writes one field. Extensions read it.

The kernel trips. Extensions heal. `core.tree.reviveTree(rootId)` clears the circuit. The kernel does NOT auto-revive.

Defaults to OFF (`treeCircuitEnabled: false`).

## Seed Versioning

`SEED_VERSION` constant in `seed/version.js`. Checked at boot against `seedVersion` in .config. If they differ, the migration runner executes every migration between the stored version and the current version in order. Migrations live in `seed/migrations/` named by version (0.1.0.js, 0.2.0.js). Each exports a default async function. If a migration fails, the stored version is not updated. Next boot retries from the failure point. Same pattern as extension schema migrations.

## Safety

| Protection | Detail |
|-----------|--------|
| Never block inbound | Cascade signals always accepted, always produce a result. |
| Hook timeout | 5s per handler. Hanging handlers killed and logged. |
| Hook cap | 100 handlers per hook. |
| Hook circuit breaker | 5 consecutive failures auto-disables the hook handler. Half-open recovery: after 5 minutes, one test call allowed through. Success resets. Failure re-opens. |
| Tool circuit breaker | 5 consecutive failures disables the tool for that session. AI adapts to other tools. One bad API key disables one tool, not the whole tree. |
| Extension router timeout | 5s on page routes (/). API routes (/api/v1) not wrapped. AI chat routes take as long as the LLM needs. Mid-stream responses closed after timeout. |
| Extension init timeout | 10s per extension init(). Hanging init skipped, boot continues. |
| LLM concurrency semaphore | llmMaxConcurrent (default 20) caps in-flight LLM calls globally. Excess queued with abort signal support. Jittered exponential backoff on 429. |
| enrichContext chain timeout | 15s cumulative cap for the entire enrichContext/onCascade handler chain. Per-handler timeout reduced to remaining budget. |
| MCP spatial scoping | MCP tool calls check isExtensionBlockedAtNode before dispatch. Same spatial scoping guarantee as WebSocket conversations. |
| Extension install rollback | Files written to staging directory. Atomic rename on success. Cleanup on failure. No partial installs. |
| Metadata guard | Blocked extensions can't write to nodes. Four core namespaces (cascade, extensions, tools, modes) bypass blocking. |
| Document size guard | Every metadata write checks total document size against maxDocumentSizeBytes (14MB default). Writes exceeding the limit rejected with DOCUMENT_SIZE_EXCEEDED. onDocumentPressure fires at 80% capacity. |
| Per-namespace cap | 512KB per extension namespace per node via setExtMeta. 20 extensions at 512KB = 10MB, under the 14MB ceiling. |
| Namespace key length | Max 50 chars for metadata namespace keys in setExtMeta. Same cap as node type. |
| Metadata nesting depth | Max 5 levels deep in setExtMeta. Deeper structures must be flattened by the extension. Prevents expensive deep queries. |
| Note count per node | maxNotesPerNode (default 1000) checked in createNote before write. Prevents runaway loops from flooding a node. Configurable. |
| Contribution extensionData cap | 512KB per contribution extensionData field. Same cap as setExtMeta. Prevents buggy extensions from writing 5MB per contribution. |
| .flow partitioning | Daily partition nodes prevent unbounded growth. flowMaxResultsPerDay cap with circular overwrite. Retention deletes entire partitions by date. |
| Ownership chain | rootOwner/contributor mutations validate the parent chain. Only resolved owner or admin can modify. System nodes always rejected. |
| Tree circuit breaker | Health equation monitors node count, metadata density, error rate. Score > 1.0 trips the tree. No AI, no writes, no cascade. Read access stays. Extensions revive. Defaults to off. |
| Ancestor cache | Shared cache for parent chain walks. One walk serves all six resolution chains. Snapshot per message for consistency. moveNode clears entire cache. deleteNode clears entries containing the deleted node. Metadata/ownership changes clear the affected node and descendants. |
| Session cap | 10K max with oldest-first eviction. |
| Depth limits | 50 for status cascade. 100 for auth traversal. 50 for cascade propagation. |
| Cascade payload limit | Oversized signals rejected. |
| Cascade rate limit | Per node per minute. Exceeding rejected. |
| Name validation | No HTML, no dots, no slashes, max 150 chars. |
| Type validation | No HTML, no dots, no slashes, max 50 chars. Free-form string. |
| Dynamic service injection | Extensions register services on core during init(). Later extensions discover them by declaration, not by kernel naming. |
| Auth optional | `authenticateOptional` tries all strategies, allows anonymous. Never hangs. |
| SSRF protection | Peer registration validates hostname against isPrivateHost() before any fetch. 15s timeout on all federation fetches. |
| Federation system tokens | System-to-system canopy events use sub="system" tokens. Auth handler returns system identity with isSystemToken flag. Route handlers gate access. |
| Password length | Min 8, max 128 characters. Prevents bcrypt memory DoS. |
| Atomic metadata writes | setExtMeta uses MongoDB $set on the specific namespace key. Concurrent writes to different namespaces on the same node do not clobber. |
| DB health check | Before each tool call, the conversation loop checks database readyState. If unreachable, the tool result tells the AI "database unavailable" so it responds to the user instead of retrying blindly. |
| Seed versioning | SEED_VERSION checked at boot against .config. Migrations run in order between stored and current version. Failed migrations block version update. Next boot retries. |
| Upload guard | Pre-multer check: master switch, size ceiling (100MB default), MIME filter. Rejects before file reaches memory. |
| Upload cleanup | Orphaned files deleted hourly with grace period. |
| Tree integrity check | On boot and daily: verify parent/children[] consistency. Auto-repair safe inconsistencies (phantom refs, missing children entries). Log orphans. `core.tree.checkIntegrity()` on demand. |
| Index verification | On boot: verify all required indexes exist. Create missing ones with background builds. Extensions declare indexes in manifests. No collection scan on any kernel query path. |
| Graceful shutdown | All interval timers use `.unref()`. SIGTERM closes server cleanly. |

## What the Seed Does NOT Do

Values, goals, schedules, scripts, prestige, energy, billing, wallets, gateways, blogs, books, dreams, understanding, raw ideas, transactions, shell access, land management AI, fitness coaching, food tracking, HTML rendering, dashboards, recent trees, user tiers, starter types, or any domain-specific feature. All extensions.

The seed does not define AI modes (navigate, structure, edit, respond). Those are the treeos extension. The seed provides a fallback mode and a mode registry. What modes exist is an extension decision.

The seed does not define MCP tool definitions. The treeos extension registers tools. The seed provides the tool resolver registry.

The seed does not render HTML, manage share tokens, or serve login pages. That's the html-rendering extension.

The seed does not know what email is, what a billing tier is, or what a share token is. Extensions own those concepts through metadata.

The seed provides structure. Extensions provide meaning.
