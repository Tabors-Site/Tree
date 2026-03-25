# The Seed (AKA THE KERNEL)

The kernel is called the seed. You plant it on a land. It grows trees.

Two schemas, a conversation loop, a hook system, a cascade engine, an extension loader, and a response protocol. Remove every extension and the seed still boots. It defines the data contract that extensions build on, the resolution chains that determine what happens at every position, and the communication primitive that makes signals visible.

## Four Primitives

Everything in the seed serves one of four primitives. Everything else is emergent behavior from these four interacting.

| Primitive | What it is | Key files |
|-----------|-----------|-----------|
| **Structure** | Two schemas (Node, User), nodes in hierarchies, metadata Maps | models/node.js, models/user.js |
| **Intelligence** | Conversation loop, LLM/tool/mode/position resolution, time and position injection | ws/conversation.js, ws/modes/registry.js |
| **Extensibility** | Extension loader, open hook system, pub/sub, spatial scoping | hooks.js, extensions/loader.js, tree/extensionScope.js |
| **Communication** | Cascade signals, .flow system node, visible results, response protocol | tree/cascade.js, protocol.js |

## Schemas

Two core schemas define the data contract. They never change. Extensions store all data in the metadata Map under their own namespace.

### Node (12 fields)_id, name, type, status, dateCreated, llmDefault, visibility, children[], parent, rootOwner, contributors[], systemRole, metadata (Map)

Type is free-form. Status is active, completed, or trimmed. Extensions store their data in metadata under their name: `metadata.values`, `metadata.prestige`, `metadata.cascade`, `metadata.extensions`, `metadata.tools`, `metadata.modes`. The Map preserves unknown keys across network transit. Extension data sent from a land that has an extension survives arrival at a land that does not.

### User (8 fields)_id, username, password, roots[], llmDefault, isAdmin, isRemote, homeLand, metadata (Map)

One default LLM connection. `isRemote` and `homeLand` are identity fields the kernel's auth layer checks on every request. Federation navigation data (remote roots) lives in `metadata.canopy`. Extensions store energy budgets, API keys, LLM slot assignments, storage usage, and preferences in metadata.

### Supporting Models

Node and User are the data contract. The seed also owns models for kernel operations that are not part of the contract but are required for the seed to function:

| Model | Purpose |
|-------|---------|
| Note | Note content. The primary data field. |
| Contribution | Audit trail for all tree operations. |
| AIChat | Conversation sessions. The conversation loop is kernel. |
| LLMConnection | LLM endpoint storage. The resolution chain is kernel. |

These models may evolve as the seed evolves. They are not the contract extensions build on. Extensions build on Node and User.

Federation models (CanopyEvent, LandPeer, RemoteUser) live in `canopy/models/`, not in the seed. A land without federation has no use for them.

## Six System Nodes

Created at boot by `ensureLandRoot()`. They hold infrastructure state, not user content.

| Node | systemRole | Purpose |
|------|-----------|---------|
| Land Root | land-root | Top of everything. Parent of all trees and system nodes. |
| .identity | identity | Land UUID, domain, Ed25519 public key for Canopy federation signing. Set once at boot. |
| .config | config | All runtime configuration as metadata keys. Readable and writable via CLI, API, or the land-manager AI. |
| .peers | peers | Canopy federation peer list. Children are peer land records with status and heartbeat history. |
| .extensions | extensions | Extension registry. Each loaded extension is a child node with version and schema version for migrations. |
| .flow | flow | Cascade result store. Signal outcomes keyed by signalId. Cleaned by resultTTL. The land's short-term memory of what moved and what happened. |

## Rules

1. The seed NEVER imports from extensions.
2. Extensions import from seed.
3. Extensions reach each other through `getExtension()` or hooks.
4. Extension data lives in metadata Maps, never in seed schemas.
5. Seed schemas never change.
6. Zero `getExtension()` calls in seed. If seed needs something from an extension, it fires a hook and the extension responds.

## Guarantees

Three things the seed always does, unconditionally.

**Never block inbound.** When a cascade signal arrives at a node, locally or via Canopy from another land, the kernel always accepts it. It writes a result to .flow. Extensions decide what to do with it. No status, no elapsed time, no extension can prevent a signal from arriving. This is a right, not a configuration. It cannot be turned off.

**Position injection.** Every AI prompt receives a `[Position]` block before the mode prompt runs. Tree modes get User, Tree (name + ID), Current node (if not at root), Target node (if different). Home modes get Zone: Home. Land modes get Zone: Land. Node names resolved via parallel lookups with graceful fallback to ID-only on DB failure. The AI always knows where it is. Extension modes never need to include position. They cannot exclude it.

**Time injection.** Every AI prompt receives the current time after the position block and before the mode prompt. The timezone config controls display format. The injection cannot be turned off. The AI always knows when it is.

## Resolution Chains

Every operation at a node goes through four resolution chains. Each chain walks the parent hierarchy and applies layered rules. Position determines capability.

1. **Extension scope**: Is this extension active, restricted, or blocked here? Walk parent chain, accumulate `metadata.extensions.blocked[]` and `restricted`. Blocked extensions lose all capabilities. Restricted extensions keep read-only tools.
2. **Tool scope**: What tools does the AI have? Start with mode base tools. Add extension-injected tools. Apply per-node `metadata.tools.allowed/blocked`. Filter by extension scope. The AI sees only what survives all layers.
3. **Mode resolution**: How does the AI think? Check `metadata.modes[intent]` for per-node override. Skip if owning extension is blocked. Fall back to default mapping. Then bigMode default.
4. **LLM resolution**: Which model runs? Extension slot on tree, tree default, extension slot on user, user default. First match wins. Failover chain tried on failure.

Navigate to a different node. All four chains re-resolve. Different tools appear. Different mode fires. Different model runs. The tree reshapes around where you stand.

## Hooks

Open pub/sub bus. The seed fires kernel hooks. Extensions listen. Extensions can also fire their own hooks for other extensions to listen to. Any hook name is valid. No whitelist. Typos are detected and warned, not blocked.

### Before Hooks

Run sequentially before the operation. Can modify data. Can cancel (return false or throw). If one cancels, the operation stops. 5 second timeout per handler.

### After Hooks

Run in parallel, fire-and-forget. Errors logged, never block.

### Sequential Hooks

Run sequentially with return values captured. enrichContext runs during AI context building so extensions can inject their data. onCascade runs on cascade signals with results written to .flow.

| Hook | Type | Purpose |
|------|------|---------|
| beforeNote | before | Modify note data, tag version |
| afterNote | after | React to note create/edit/delete |
| beforeContribution | before | Modify contribution metadata |
| afterNodeCreate | after | Initialize extension data |
| beforeStatusChange | before | Validate, intercept |
| afterStatusChange | after | React to status changes |
| beforeNodeDelete | before | Cleanup extension data |
| enrichContext | sequential | Inject extension data into AI context |
| beforeRegister | before | Validate registration |
| afterRegister | after | Initialize user data |
| onCascade | sequential | Fires on content write at cascade-enabled node. Handler return becomes result in .flow. |

## Cascade

The communication primitive. When content is written at a node with `metadata.cascade.enabled = true` and `cascadeEnabled = true` in .config, the seed fires `onCascade`.

### Two Entry Points

- `checkCascade(nodeId, writeContext)`: seed-internal. Called automatically on note creates, edits, deletes, and status changes. Checks two booleans: does this node have `metadata.cascade.enabled`? Is `cascadeEnabled` true in .config? If both yes, fires `onCascade`. The seed originates signals.
- `deliverCascade({ nodeId, signalId, payload, source, depth })`: extension-external. Called by extensions that propagate signals to other nodes, children, siblings, remote lands. The seed never blocks it. Always writes a result. Extensions deliver signals.

The seed only calls `checkCascade`. Extensions call `deliverCascade`. The first is automatic on content writes. The second is explicit propagation.

### Cascade Position Config

`metadata.cascade` is a recognized metadata key set once per node, not per note. Same pattern as `metadata.extensions`, `metadata.tools`, `metadata.modes`.
```jsmetadata.cascade = {
enabled: true,          // this node participates in cascade
propagate: "children",  // "children" | "subtree" | "none"
}

Content filtering is extension territory (perspective filter), not kernel.

### Result Shape

Every signal produces a result written to .flow:
```js{
status: "succeeded" | "failed" | "rejected" | "queued" | "partial" | "awaiting",
source: nodeId,
payload: { ... },
timestamp: Date,
signalId: string,
extName: string,
}

Six statuses. None terminal. None lock the channel. They are labels on what happened, not permissions for what can happen next. Failed can be retried. Awaiting means a response is expected. The system never declares something permanently dead.

## Protocol

One response language for everything the kernel produces. Defined in `seed/protocol.js`. Extensions access it through `core.protocol`.

### HTTP Response Shape

Every API route returns one of two shapes:
```js{ status: "ok", data: { ... } }
{ status: "error", error: { code: "NODE_NOT_FOUND", message: "..." } }

### Semantic Error Codes

Not HTTP status codes. Semantic codes that mean something in TreeOS. HTTP codes go on the response header. Semantic codes go in the body.

| Category | Codes |
|----------|-------|
| Data | NODE_NOT_FOUND, USER_NOT_FOUND, NOTE_NOT_FOUND, TREE_NOT_FOUND |
| Auth | UNAUTHORIZED (401: who are you), FORBIDDEN (403: you can't do this here), SESSION_EXPIRED |
| Validation | INVALID_INPUT, INVALID_STATUS, INVALID_TYPE |
| Rate limiting | RATE_LIMITED |
| LLM | LLM_TIMEOUT, LLM_FAILED, LLM_NOT_CONFIGURED |
| Cascade | CASCADE_DISABLED, CASCADE_DEPTH_EXCEEDED, CASCADE_REJECTED |
| Extensions | EXTENSION_NOT_FOUND, EXTENSION_BLOCKED |
| Hooks | HOOK_TIMEOUT, HOOK_CANCELLED |
| Orchestrator | ORCHESTRATOR_NOT_FOUND, ORCHESTRATOR_LOCKED |
| System | INTERNAL, TIMEOUT |

### WebSocket Event Types

Named constants for every kernel-emitted event. Extension events stay in extension code.
```jsWS.CHAT_RESPONSE, WS.CHAT_ERROR, WS.CHAT_CANCELLED,
WS.TOOL_RESULT, WS.PLACE_RESULT, WS.MODE_SWITCHED,
WS.TREE_CHANGED, WS.REGISTERED, WS.NAVIGATOR_SESSION,
WS.RECENT_ROOTS, WS.AVAILABLE_MODES, WS.CONVERSATION_CLEARED,
WS.NAVIGATE, WS.RELOAD

### Cascade Status Constants

Canonical source for the six cascade statuses. Imported by cascade.js.
```jsCASCADE.SUCCEEDED, CASCADE.FAILED, CASCADE.REJECTED,
CASCADE.QUEUED, CASCADE.PARTIAL, CASCADE.AWAITING

## Config (23 keys)

| Key | Default | Purpose |
|-----|---------|---------|
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
| canopyEventRetentionDays | 30 | Auto-delete canopy events |
| timezone | auto | Land timezone for AI prompts |
| disabledExtensions | [] | Extensions to skip on boot |
| cascadeEnabled | false | Enable cascade signals |
| resultTTL | 604800 | Seconds before cascade results cleaned |
| awaitingTimeout | 300 | Seconds before awaiting becomes failed |
| cascadeMaxDepth | 50 | Max propagation depth |
| cascadeMaxPayloadBytes | 51200 | Max signal payload size (50KB) |
| cascadeRateLimit | 60 | Max signals per node per minute |

## Safety

The seed protects itself from extensions, from runaway AI, from the network, and from time.

| Protection | Detail |
|-----------|--------|
| Never block inbound | Cascade signals always accepted. Always produce a result. |
| Hook timeout | 5s per handler. Hanging handlers killed and logged. |
| Hook cap | 100 handlers per hook. Flooding rejected. |
| Circuit breaker | 5 consecutive failures auto-disables the handler. |
| Metadata guard | Blocked extensions can't write to nodes. Core namespaces (cascade, extensions, tools, modes) protected from extension writes via setExtMeta. |
| Session cap | 10K max with oldest-first eviction. |
| Depth limits | 50 for status cascade. 100 for auth traversal. 50 for cascade propagation (cascadeMaxDepth). |
| Cascade payload limit | cascadeMaxPayloadBytes checked before signal fires. Oversized signals rejected with reason. |
| Cascade rate limit | cascadeRateLimit checked per node per minute. Exceeding writes rejected with reason rate_limited. |
| Name validation | No HTML, no dots, no slashes, max 150 chars. |
| Dependent check | Can't uninstall if other extensions depend on it. |
| Checksum verification | SHA256 verified on extension install. |
| Semver constraints | Dependencies declare version requirements. |
| Upload cleanup | Orphaned files deleted hourly with grace period. |
| Graceful shutdown | SIGTERM closes server, disconnects DB, exits clean. |
| Shell injection guard | Extension loader uses execFileSync with array args. No shell interpretation. |
| Atomic cascade writes | MongoDB $push for concurrent signal safety. |
| Awaiting timeout | awaitingTimeout transitions stale awaiting results to failed. |
| LLM protection | llmTimeout per call. llmMaxRetries on 429/500. Failures produce visible results, not silent logs. |

## What the Seed Does NOT Do

Values, goals, schedules, scripts, prestige, energy, billing, wallets, gateways, blogs, books, dreams, understanding, raw ideas, transactions, shell access, land management AI, fitness coaching, food tracking, HTML rendering, dashboards, or any domain-specific feature. All of that is extensions.

The seed does not propagate cascade signals between nodes. It does not route between lands. It does not filter content. It does not compress context. It does not build codebooks. It does not form channels. It does not track reputation or trust. It announces that something happened at a cascade-enabled position and records the outcome. Propagation, routing, filtering, compression, codebooks, channels, and trust are extensions built on top of onCascade and deliverCascade.

The seed provides structure. Extensions provide meaning. Together they make an operating system where position determines reality and navigation is capability switching. The tree's capability comes from three things: the LLMs you connect, how you delegate them across positions and sessions, and how signals route through .flow. Structure without intelligence is a filing cabinet. Intelligence without structure is a chatbot. Together, routed through cascade, they become something alive.