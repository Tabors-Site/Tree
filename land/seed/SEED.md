# NEVER MODIFY THE SEED WHEN BUILDING EXTENSIONS. ALL EXTENSIONS MUST BE OUTSIDE AND ONLY DEPENDENT FROM KERNEL THE KERNEL
# CAN NOT AND DOES NOT ADAPT. IT IS THE SEED

AND USE ALL APPROPRIATE HOOKS/TOOLS/ETC SEED
PROVIDES TO TAKE MOST DIRECT DATA PATH
TO MAKE WHAT IS NEEDED with extensions.


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
| Note | Content attached to nodes. Six fields: contentType, content, userId, nodeId, metadata (Map), createdAt. Extensions tag notes via metadata (prestige writes version, treeos writes isReflection). beforeNote/afterNote hooks fire. |
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

Created at boot by `ensureLandRoot()`. They hold infrastructure state, not user content. Every boot verifies all six exist. Missing nodes are recreated (recovery from partial boot failures). System nodes with wrong parents are repaired automatically.

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
| beforeNote | before | Modify note data. Extensions write to hookData.metadata. |
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
| afterScopeChange | after | After extension scope changes. { nodeId, blocked, restricted, allowed, userId } |
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

Single file `seed/protocol.js`. Extensions access via `core.protocol`. One shared language.

HTTP: `{ status: "ok", data }` or `{ status: "error", error: { code, message } }`. 34 semantic ERR codes. `ProtocolError` class for throwing typed errors from seed functions that routes can catch and map to HTTP responses.

WebSocket: Named constants in `WS` object. Kernel events only. Extension events own their own constants.

Cascade: Named constants in `CASCADE` object. Six statuses.

Shared vocabulary: `NODE_STATUS` (active, completed, trimmed), `SYSTEM_ROLE` (land-root, identity, config, peers, extensions, flow), `CONTENT_TYPE` (text, file), `DELETED` sentinel. Every file that references these values imports from protocol.js. Typo in a constant fails at import. Typo in a string fails silently.

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
| landLlmConnection | null | LLM connection ID. Fallback for users without their own. Admin creates a connection, sets this to its ID. All users get AI. Override by setting your own. |
| noteMaxChars | 5000 | Max characters per note |
| treeSummaryMaxDepth | 4 | How deep AI sees the tree |
| treeSummaryMaxNodes | 60 | How many nodes AI sees |
| carryMessages | 4 | Messages carried across mode switch |
| sessionTTL | 900 | Session idle timeout (seconds) |
| staleSessionTimeout | 1800 | Stale session cleanup (seconds) |
| maxSessions | 10000 | Max concurrent sessions |
| jwtExpiryDays | 30 | JWT token lifetime in days. Clamped 1 to 365. Shorter for higher security environments. |
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
| cascadeMaxDeliveriesPerSignal | 500 | Max child deliveries per cascade signal. Limits fan-out on wide trees. |
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
| failoverTimeout | 15 | Seconds before giving up walking the LLM failover stack |
| toolCallTimeout | 60 | Seconds before a single MCP tool call is killed |
| toolResultMaxBytes | 50000 | Max tool result size before truncation (bytes) |
| maxConversationSessions | 50000 | Hard cap on in-memory conversation sessions. Evicts oldest on overflow. |
| staleConversationTimeout | 1800 | Seconds before an idle conversation session is swept (default 30 min) |
| chatRateLimit | 10 | Max chat messages per rate window per user. Prevents spam via WebSocket. |
| chatRateWindowMs | 60000 | Chat rate limit window in milliseconds (default 1 minute). |
| maxNotesPerNode | 1000 | Max notes per node. Prevents runaway extension note floods. |
| maxRegisteredTools | 500 | Max tool definitions in the registry. Raise for lands with many extensions. |
| maxRegisteredModes | 200 | Max mode definitions in the registry. Raise for lands with many extensions. |
| maxConnectionsPerUser | 15 | Max custom LLM connections per user. Enterprise lands raise to 50+. Clamped 1 to 100. |
| maxOrchestrators | 10 | Max registered orchestrators. Raise as extensions define new zones beyond land/home/tree. |
| metadataNamespaceMaxBytes | 524288 | Max bytes per metadata namespace (node, user, contribution extensionData). Clamped 1KB to 2MB. One config controls all three. Default 512KB. |
| hookTimeoutMs | 5000 | Milliseconds before a single hook handler is killed. Raise for extensions with slow external calls. |
| hookMaxHandlers | 100 | Max handlers per hook name. Raise for lands with 50+ extensions. |
| hookCircuitThreshold | 5 | Consecutive failures before auto-disabling a hook handler. Lower for stricter lands. |
| hookCircuitHalfOpenMs | 300000 | Milliseconds before a tripped hook handler gets one test call (5 min default). |
| hookChainTimeoutMs | 15000 | Cumulative timeout for sequential hook chains (enrichContext, onCascade). |
| ancestorCacheMaxEntries | 50000 | Max cached ancestor chains. Raise for lands with 100K+ nodes. Lower for memory-constrained hosts. |
| ancestorCacheMaxDepth | 100 | Max parent chain depth before stopping. Clamped 10 to 500. Trees deeper than this are extremely rare. |
| metadataMaxNestingDepth | 5 | Max nesting depth for extension metadata values. Clamped 2 to 20. Deep nesting creates expensive queries. |
| mcpConnectRetries | 2 | MCP connection retry count for background pipelines. Clamped 0 to 10. Raise for unreliable networks. |
| treeAncestorDepth | 50 | Max ancestor chain depth in tree data queries. Clamped 5 to 200. |
| treeContributionsPerNode | 500 | Max contributions loaded per node in full tree export. Clamped 10 to 10000. |
| treeNotesPerNode | 100 | Max notes loaded per node in AI context and full tree export. Clamped 10 to 1000. |
| treeMaxChildrenResolve | 200 | Max children name-resolved per node for AI. Clamped 10 to 1000. |
| treeAllDataDepth | 20 | Max recursion depth in full tree export. Clamped 5 to 50. |
| noteQueryLimit | 5000 | Max notes returned per query. Clamped 1 to 50000. |
| noteSearchLimit | 500 | Max notes returned per search query. Clamped 1 to 10000. |
| subtreeNodeCap | 10000 | Max node IDs collected in subtree traversal. Clamped 100 to 100000. |
| contributionQueryLimit | 5000 | Max contribution documents returned per query. Clamped 1 to 50000. |
| maxContributorsPerNode | 500 | Max contributors[] entries per node. Enterprise collaboration lands raise this. |
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
| uploadCleanupBatchSize | 1000 | Max files deleted per cleanup cycle. Clamped 10 to 50000. Raise for lands with large backlogs. |
| retentionCleanupInterval | 86400000 | Retention job frequency (ms) |
| cascadeCleanupInterval | 21600000 | Cascade result cleanup frequency (ms) |
| npmInstallTimeout | 60000 | Timeout for npm install in extension directories (ms). Slow networks may need 120000. |
| dnsLookupTimeout | 5000 | DNS resolution timeout for custom LLM URLs (ms). Corporate VPN may need 15000. |
| mcpConnectTimeout | 10000 | MCP client connection timeout (ms). Remote MCP servers may need 20000. |
| mcpStaleTimeout | 3600000 | MCP client idle timeout before sweep (ms). High-traffic land may want 1800000. |
| orchestratorInitTimeout | 30000 | Background pipeline init timeout (ms). Slow LLM providers may need 60000. |
| circuitFlowScanLimit | 5000 | Max cascade results scanned per tree health check. Heavy cascade lands raise to 20000. Light lands lower to 1000. |

## Tree Circuit Breaker

When a tree exceeds health thresholds, its circuit trips. No AI interactions. No cascade. No writes. Read access stays open. The data is intact. The tree is sleeping.

Health equation: `(nodeCount / max) * nodeWeight + (metadataDensity / max) * densityWeight + (errorRate / max) * errorWeight`. When the score exceeds 1.0, the tree trips. Error rate reads from both sources, scoped to this tree's nodes: contribution log (`extensionData.error` exists) and .flow partitions (CASCADE.FAILED and CASCADE.REJECTED with source in this tree). Random sampling for metadata density estimation.

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
| Extension init timeout | 10s per extension init(). Hanging init skipped, boot continues. Init errors diagnose missing service declarations and suggest manifest fixes. |
| LLM concurrency semaphore | llmMaxConcurrent (default 20) caps in-flight LLM calls globally. Excess queued with abort signal support. Jittered exponential backoff on 429. |
| enrichContext chain timeout | 15s cumulative cap for the entire enrichContext/onCascade handler chain. Per-handler timeout reduced to remaining budget. |
| MCP spatial scoping | MCP tool calls check isExtensionBlockedAtNode before dispatch. Same spatial scoping guarantee as WebSocket conversations. |
| Extension install rollback | Files written to staging directory. Atomic rename on success. Cleanup on failure. No partial installs. |
| Metadata guard | Blocked extensions can't write to nodes. Four core namespaces (cascade, extensions, tools, modes) bypass blocking. |
| Document size guard | Every metadata write checks total document size against maxDocumentSizeBytes (14MB default). Writes exceeding the limit rejected with DOCUMENT_SIZE_EXCEEDED. onDocumentPressure fires at 80% capacity. |
| Per-namespace cap | metadataNamespaceMaxBytes (default 512KB) per extension namespace on nodes, users, and contribution extensionData. Configurable. 20 extensions at 512KB = 10MB, under the 14MB ceiling. |
| Namespace key length | Max 50 chars for metadata namespace keys in setExtMeta. Same cap as node type. |
| Metadata nesting depth | Max 5 levels deep in setExtMeta. Deeper structures must be flattened by the extension. Prevents expensive deep queries. |
| Note count per node | maxNotesPerNode (default 1000) checked in createNote before write. Prevents runaway loops from flooding a node. Configurable. |
| Contribution extensionData cap | 512KB per contribution extensionData field. Same cap as setExtMeta. Prevents buggy extensions from writing 5MB per contribution. |
| .flow partitioning | Daily partition nodes prevent unbounded growth. flowMaxResultsPerDay cap with circular overwrite. Retention deletes entire partitions by date. |
| Ownership chain | rootOwner/contributor mutations validate the parent chain. Only resolved owner or admin can modify. System nodes always rejected. transferOwnership uses bulkWrite for atomic two-op transfer. |
| Tree circuit breaker | Health equation monitors node count, metadata density, error rate. Score > 1.0 trips the tree. No AI, no writes, no cascade. Read access stays. Extensions revive. Defaults to off. |
| Ancestor cache | Shared cache for parent chain walks. One walk serves all six resolution chains. Snapshot per message for consistency. moveNode clears entire cache. deleteNode clears entries containing the deleted node. Metadata/ownership changes clear the affected node and descendants. |
| Session cap | 10K max (configurable) with oldest-first eviction. |
| Core session types immutable | Extensions can register custom session types but cannot overwrite core types (websocket-chat, api-tree-chat, etc.). Prevents extension from breaking the stale sweep or navigator promotion. |
| Scoped session cap | 20K max scoped session entries. Oldest evicted on overflow. Prevents unbounded growth from unique tree:root:user scope keys. |
| Session meta size cap | 64KB per session meta object. updateSessionMeta rejects if merged meta exceeds limit. Prevents extensions from writing unbounded data into session state. |
| Session abort cleanup | Stale sweep also cleans orphaned abort controllers (session ended but clearSessionAbort never called). |
| clearUserSessions fires hooks | All session removal paths fire afterSessionEnd. clearUserSessions iterates and fires per session, not silent bulk delete. Extensions always notified. |
| Session setter bounds | setMaxSessions: 100 to 500K. setSessionTTL: 5s to 24h. setStaleTimeout: 1m to 24h. No setter can produce a non-functional registry. |
| MCP client cap | 5,000 max MCP clients. Oldest evicted on overflow. Prevents OOM from API-mode sessions generating unique visitorIds. |
| MCP connect timeout | 10s. If the MCP server is unreachable, fail fast instead of blocking the conversation loop. Transport cleaned up on failure. |
| MCP close timeout | 5s. Broken transports that hang on close are abandoned after timeout. Cleanup never blocks the disconnect handler. |
| MCP stale sweep | Every 15 minutes, clients unused for 1 hour are closed. Safety net for violent disconnects where the cleanup handler never fires. |
| MCP token isolation | JWT tokens stored in a separate Map, not mutated onto the SDK client object. Prevents breakage if the SDK freezes instances. |
| WebSocket payload sanitization | All frontend sync events (nodeUpdated, nodeCreated, nodeDeleted, etc.) cap all string fields at 200 chars and JSON payloads at 500 chars. Prevents multi-MB payloads from consuming the AI context window via context injection. |
| WebSocket ID validation | rootId and nodeId from frontend capped at 36 chars (UUID length). URL payloads capped at 2000 chars. Rejects oversized or non-string values. |
| WebSocket auth logging | Failed JWT verification in the auth middleware is logged at debug level with the error reason. Enables detection of token probing. |
| Broadcast safety | emitBroadcast validates event name is a non-empty string. Documented: never send user-specific data via broadcast. |
| Depth limits | 50 for path building. 50 for status cascade. 50 for cascade propagation. 100 for isDescendant checks. |
| Cascade payload limit | Oversized signals rejected. |
| Cascade rate limit | Per node per minute. Exceeding rejected. |
| Name validation | No HTML, no dots, no slashes, max 150 chars. |
| Type validation | No HTML, no dots, no slashes, max 50 chars. Free-form string. |
| Dynamic service injection | Extensions register services on core during init(). Later extensions discover them by declaration, not by kernel naming. After all init() calls complete, the top-level core object is frozen. |
| Core service immutability | Individual kernel services (core.hooks, core.llm, core.protocol) are frozen before passing to init(). Extensions cannot replace or modify kernel functions. Extensions CAN add new top-level properties (core.energy) during init, but not after. |
| Canopy rate limit cap | In-memory rate limit map capped at 10K entries. Overflow rejected with 429 instead of growing without bound. |
| Auth optional | `authenticateOptional` tries all strategies, allows anonymous. Never hangs. |
| SSRF protection | Peer registration and auto-discovery both validate hostname against isPrivateHost() before any fetch. 15s timeout on all federation fetches. Canopy event payloads capped at 256KB. |
| Federation system tokens | System-to-system canopy events use sub="system" tokens. Auth handler returns system identity with isSystemToken flag. Route handlers gate access. |
| Password length | Min 8, max 128 characters. Prevents bcrypt memory DoS. |
| Password verify timeout | 5s ceiling on bcrypt.compare via Promise.race. Prevents extreme cost factors from blocking the event loop. |
| JWT unique ID | Every token includes a `jti` (UUID) for per-token revocation tracking. Extensions can check `decoded.jti` against a revocation list. |
| JWT configurable expiry | jwtExpiryDays (default 30, configurable 1 to 365). Government deployments set to 1 for daily re-authentication. |
| Username validation | Regex `^[a-zA-Z0-9_-]{1,32}$`. Trimmed before storage. Rejects empty, whitespace-only, HTML, and special characters. |
| Input null guards | All auth functions validate input types before processing. Null/undefined username or password returns clear error, not crash. findUserByUsername returns null on bad input instead of throwing. |
| bcrypt always hashes | Pre-save hook always hashes the password. No prefix detection, no skip path. Cost factor 12. |
| bcrypt cost factor 12 | Increased from 10. NIST 800-63B alignment. Each increment doubles the computation time. Cost 12 is the minimum recommendation for 2025+. |
| Timing-safe login | Login always runs bcrypt.compare even if the user doesn't exist. Uses a dummy hash for non-existent users. Attacker cannot distinguish "user not found" from "wrong password" by response timing. Closes the username enumeration oracle. |
| Auth strategy extra field sanitization | Extension auth strategies cannot overwrite userId, username, or authType via result.extra. Core auth fields are stripped before Object.assign. Prevents privilege escalation from malicious extensions. |
| Cookie expiry matches JWT | Cookie maxAge reads jwtExpiryDays from config. JWT and cookie always expire together. |
| Auth error logging | authenticateOptional logs all JWT failures, strategy failures, and pipeline errors at debug level. Zero silent catch blocks. |
| Atomic metadata writes | setExtMeta uses MongoDB $set on the specific namespace key. mergeExtMeta uses $set on individual keys within a namespace. Concurrent writes to different namespaces on the same node do not clobber. Concurrent merges to the same namespace preserve all keys. |
| DB health check | Before each tool call, the conversation loop checks database readyState. If unreachable, the tool result tells the AI "database unavailable" so it responds to the user instead of retrying blindly. |
| Boot recovery | ensureLandRoot verifies all six system nodes exist every boot. Missing nodes recreated with correct defaults. Nodes with wrong parent repaired. Orphan root adoption errors isolated per root (one failure doesn't skip the rest). Partial first-boot crashes leave a recoverable state, not a bricked land. |
| Extension sync atomicity | syncExtensionsToTree uses atomic $addToSet per child instead of in-memory push + single save. If one save fails, the tree is consistent. Integrity check repairs any stragglers. |
| Config key validation | Config keys must match `^[a-zA-Z][a-zA-Z0-9_]{0,63}$`. Dots rejected (prevent nested MongoDB path injection). `__proto__`, `constructor`, `prototype` rejected (prevent prototype pollution). |
| Config value size cap | 64KB per config value. Prevents a 10MB string from bloating the .config node and every cache load. |
| Config protected keys | seedVersion and disabledExtensions cannot be written via public API. Only kernel internals with `{ internal: true }`. |
| Config env fallback restricted | Before DB init, only known boot-time keys (socket params, LAND_NAME, landUrl, HORIZON_URL) fall back to process.env. All other keys return null. Prevents arbitrary env var injection into config. |
| Config deep copy on all reads | getLandConfigValue and getAllLandConfig both return deep copies. Callers cannot pollute the config cache by mutating returned arrays or objects. |
| Config load sanitization | Keys loaded from DB are sanitized. `__proto__`, `constructor`, `prototype`, `hasOwnProperty` stripped. Keys starting with `$` or `_` (Mongoose internals) stripped. Prevents prototype pollution from direct DB injection. |
| Config write verification | setLandConfigValue checks `result.matchedCount`. If .config node doesn't exist (deleted, corrupted), throws instead of silently updating only the in-memory cache. Fail loud. |
| Config delete support | deleteLandConfigValue uses atomic $unset. Keys are properly removed from both DB and cache instead of accumulating as null entries. |
| Config reload without restart | reloadLandConfig() re-reads .config from DB. Use after migrations or manual DB repairs. |
| Config load error handling | If the DB query fails during boot, config initializes to empty and logs the error. Boot continues with defaults instead of crashing. |
| Config change audit | Every set and delete logged at verbose level with the key name. |
| DB URI validation | Missing MONGODB_URI fails at boot with clear error and example, not a cryptic Mongoose crash. |
| DB socket timeout | 30s default (configurable via MONGO_SOCKET_TIMEOUT). Hung queries on degraded replicas killed instead of blocking the pool forever. |
| DB heartbeat | 5s (configurable via MONGO_HEARTBEAT_MS). Failure detection within 5s instead of default 10s. |
| DB event monitoring | disconnected, reconnected, and error events logged. Operators see exactly when the DB dropped and when it came back. |
| DB graceful shutdown | SIGTERM closes the MongoDB connection cleanly. |
| Seed versioning | SEED_VERSION checked at boot against .config. Migrations run in order between stored and current version. Failed migrations block version update. Next boot retries. |
| Date range validation | Query date ranges validated: ISO 8601 format, endDate after startDate, 365-day max span. |
| Upload guard | Pre-multer check: master switch, size ceiling (100MB default), MIME filter. Rejects before file reaches memory. |
| Upload cleanup | Orphaned files deleted hourly with grace period. |
| Tree integrity check | On boot and daily: verify parent/children[] consistency. Auto-repair safe inconsistencies (phantom refs, missing children entries). Log orphans. `core.tree.checkIntegrity()` on demand. |
| Index verification | On boot: verify all required indexes exist. Create missing ones with background builds. Extensions declare indexes in manifests. No collection scan on any kernel query path. |
| Orchestrator init timeout | 30s timeout on init(). MCP connect or DB hang fails fast instead of blocking forever. Timer cleaned up on success (no leaked rejection). |
| Orchestrator init rollback | init() cleans up on partial failure. If MCP connect fails after Chat and session are created, cleanup releases the lock, ends the session, finalizes the Chat, and closes MCP. No leaked resources. |
| Orchestrator chain circuit breaker | 500 max steps per pipeline run. Runaway loops killed with clear error. trackStep silently caps. |
| Orchestrator zombie guard | runStep() throws if called after cleanup(). trackStep() silently returns. No operations on dead pipelines. |
| Orchestrator lock ownership | Lock acquired with visitorId as owner. Only the owning runtime can release or renew. Prevents cross-pipeline lock interference. Lock renewed on every runStep to prevent TTL expiry during long pipelines. |
| Orchestrator abort on cleanup | cleanup() aborts in-flight work via AbortController before releasing resources. Prevents orphaned LLM calls running after pipeline teardown. |
| Orchestrator abort check | runStep checks abort signal before starting any work. No wasted mode switches on cancelled pipelines. |
| Scope ownership validation | registerToolOwner and registerModeOwner validate name type, length (1-64 chars), and extName. Rejects empty strings and oversized names. |
| Scope ownership caps | Tool ownership capped at maxRegisteredTools (config, default 1000). Mode ownership capped at maxRegisteredModes (config, default 500). Same config keys as the tool/mode definition registries. |
| Scope ownership cleanup | clearToolOwnersForExtension and clearModeOwnersForExtension remove all entries for an extension on uninstall. No stale ownership after removal. |
| Scope hook static import | notifyScopeChange uses static import of hooks.js instead of dynamic import. Hook errors logged instead of silently swallowed. |
| Orchestrator idempotent cleanup | cleanup() is safe to call multiple times. `_cleaned` flag prevents double-finalize, double-session-end, double-lock-release. |
| Orchestrator finalize default | If cleanup is called without setResult or setError, the chat is finalized as "Pipeline ended without result" with stopped:true. |
| Orchestrator MCP retry | MCP connection retries once with linear backoff on transient failure. Single network blip doesn't kill the pipeline. |
| Orchestrator MCP JWT 4h | Internal JWT expiry extended to 4 hours. Understanding pipelines that run 2+ hours no longer fail mid-pipeline from expired tokens. |
| Orchestrator session validation | attach() verifies session exists before attaching. Dead session IDs throw immediately. |
| Orchestrator duration tracking | Every pipeline logs total duration and step count on cleanup. Visibility into pipeline performance. |
| Orchestrator input validation | Constructor requires userId and visitorId. attach() requires sessionId. Missing fields throw immediately instead of producing null-reference errors downstream. |
| Lock owner tracking | Every lock records who acquired it (userId, visitorId). releaseLock rejects if owner doesn't match. One extension can't release another's lock. |
| Lock renewal | renewLock() resets TTL without releasing. Long pipelines stay locked. Expired locks cannot be renewed (must re-acquire). |
| Lock hard cap | 10,000 locks max across all namespaces. Buggy extension flooding locks gets rejected with warning. |
| Lock input validation | Empty strings, non-strings, null values rejected on acquire. |
| Lock force release | forceReleaseLock() for admin use. Bypasses owner check. Logged as warning with owner and hold duration. |
| Lock visibility | getLockInfo() and listLocks() for debugging and admin endpoints. Shows owner, reason, age, TTL remaining. |
| Lock sweep logging | Periodic sweep logs count of expired locks removed. Visibility into lock churn. |
| parseJsonSafe hardened | 200KB input cap. Balanced-brace scanner replaces greedy regex (prevents ReDoS). Single-quote JSON support. Think-tag stripping uses non-backtracking pattern. Trailing comma fix scoped to JSON context only. |
| nullSocket frozen | Background orchestrator socket is Object.freeze'd. Shared singleton cannot be mutated by extensions. Has id, userId, username, visitorId properties for logging compatibility. |
| Chat content cap | 100KB per chat message stored. User messages and AI responses truncated before persisting to Chat documents. Prevents oversized content from exceeding the 16MB BSON limit. |
| Chat finalize atomicity | finalizeChat uses findOneAndUpdate with condition `endMessage.time: null`. Two concurrent finalize calls on the same chat: only the first writes. Second returns null. No double-write. |
| Chain step content cap | 2KB per chain step input and output in trackChainStep. Orchestrator internal calls produce compact records. |
| Contribution per-chat cap | finalizeChat loads at most 2000 contribution IDs per chat. Long orchestrator chains with 5000+ contributions are capped. |
| AI context map cap | activeAiContext (in-memory visitorId to chatId mapping) capped at 10,000 entries. Periodic sweep halves the map when over 50% capacity. Prevents leaks from missed clearChatContext calls. |
| Request queue depth | 100 max waiting tasks per queue key. When all active slots are held by hung tasks, new requests are rejected with a clear error instead of queuing without bound. |
| Config value clamping | Every setKernelConfig value is clamped to safe bounds. llmTimeout: 5s to 30m. llmMaxRetries: 0 to 10. maxToolIterations: 1 to 100. maxConversationMessages: 4 to 200. llmMaxConcurrent: 1 to 500. No config path produces a non-functional system. |
| Context injection cap | injectContext caps injected system messages at 32KB. Extensions cannot consume the entire context window with a single injection. |
| Tool call timeout | toolCallTimeout (default 60s, configurable) per individual MCP tool call. Prevents a single hung tool from blocking the conversation loop. |
| Tool result truncation | toolResultMaxBytes (default 50KB, configurable) caps tool result size. Large results truncated before entering the message array. |
| LLM response validation | Every LLM response validated for structure (choices array exists, is non-empty, first choice has message). Malformed responses from bad providers normalized to safe fallback instead of crashing. |
| Conversation session cap | maxConversationSessions (default 50,000, configurable) hard cap on in-memory sessions. Evicts oldest on overflow. Prevents OOM from leaked API-mode sessions. |
| Mode prompt safety | buildSystemPrompt wrapped in try/catch. Extension prompt builder crashes produce degraded prompt, not request failure. Prompts capped at 32KB. Non-string returns caught and replaced. |
| Mode key validation | Mode keys must match `^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$`. Rejects path traversal, empty strings, uppercase, missing colons. |
| Tool name validation | Tool names must match `^[a-z][a-z0-9_-]{0,63}$`. Schemas validated for structure and frozen on registration. Post-registration mutations silently fail. |
| Tool/mode registry caps | maxRegisteredTools (default 500, configurable). maxRegisteredModes (default 200, configurable). Prevents runaway extensions from degrading iteration performance. |
| Tool unregister on uninstall | Extension uninstall removes tool definitions and mode registrations. Stale tools from uninstalled extensions no longer linger in the registry. |
| Default mode fallback on unregister | When an extension's mode is unregistered and it was the default for its zone, the default falls back to the kernel fallback mode. |
| Blocked tool filter performance | Tree tool config blocked list uses Set for O(1) lookup instead of Array.includes O(n). |
| var elimination | Zero `var` declarations in conversation.js, requestQueue.js, chatTracker.js. All const/let. Eliminates hoisting hazards in async code. |
| Graceful shutdown | All interval timers use `.unref()`. SIGTERM closes server cleanly. |

## What the Seed Does NOT Do

Values, goals, schedules, scripts, prestige, energy, billing, wallets, gateways, blogs, books, dreams, understanding, raw ideas, transactions, shell access, land management AI, fitness coaching, food tracking, HTML rendering, dashboards, recent trees, user tiers, starter types, or any domain-specific feature. All extensions.

The seed does not define AI modes (navigate, structure, edit, respond). Those are the treeos extension. The seed provides a fallback mode and a mode registry. What modes exist is an extension decision.

The seed does not define MCP tool definitions. The treeos extension registers tools. The seed provides the tool resolver registry.

The seed does not render HTML, manage share tokens, or serve login pages. That's the html-rendering extension.

The seed does not know what email is, what a billing tier is, or what a share token is. Extensions own those concepts through metadata.

The seed provides structure. Extensions provide meaning.
