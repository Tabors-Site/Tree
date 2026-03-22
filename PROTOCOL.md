# TreeOS Protocol Specification

Version 1.0

This document defines the core TreeOS protocol for tree-based knowledge systems. Any land (server) implementing this protocol can participate in the network. The reference implementation at treeos.ai includes additional features documented in EXTENSIONS.md.

The key words MUST, SHOULD, and MAY follow RFC 2119 conventions.

## Overview

A **land** is a server that hosts trees. A **tree** is a hierarchical structure of nodes. A **node** holds content (notes), optional numeric state (values/goals), and a semantic type. Users and AI agents interact with trees through three defined modes.

Lands are self-hosted. They MAY operate standalone or connect to other lands through the Canopy federation protocol. Every land MUST serve its capabilities at `GET /api/v1/protocol`.

## Authentication

Lands MUST support bearer token authentication via the `Authorization: Bearer <token>` header. The token format (JWT, session ID, API key, etc.) is an implementation choice.

Lands MUST provide:

```
POST /api/v1/register    Body: { username, password }
POST /api/v1/login       Body: { username, password }    Response: { token, userId }
GET  /api/v1/me          Response: { userId, username }
```

Lands MAY support additional auth (email verification, OAuth, API keys) as extensions.

## Node Shape

### Required Fields

Every node MUST have these fields:

| Field | Type | Description |
|-------|------|-------------|
| `_id` | string (UUID) | Unique identifier |
| `name` | string | Node name (max 150 chars) |
| `type` | string or null | Semantic type label |
| `status` | string | `"active"`, `"completed"`, or `"trimmed"` |
| `parent` | string or null | Parent node ID (null for roots) |
| `children` | string[] | Child node IDs |

### Recommended Fields

Lands SHOULD support:

| Field | Type | Description |
|-------|------|-------------|
| `values` | map<string, number> | Named numeric state |
| `goals` | map<string, number> | Targets for values |

### Notes

Notes are content attached to nodes. Lands MUST support notes.

| Field | Type | Description |
|-------|------|-------------|
| `_id` | string | Note identifier |
| `nodeId` | string | Parent node |
| `content` | string | Text content |
| `contentType` | string | `"text"` or `"file"` |
| `userId` | string | Author |
| `createdAt` | date | Creation timestamp |

Lands MAY support file uploads as notes.

## Node Types

Nodes have an optional `type` field. Six core types provide a shared vocabulary:

| Type | Meaning |
|------|---------|
| `goal` | A desired outcome |
| `plan` | A strategy or sequence of steps |
| `task` | A discrete piece of work |
| `knowledge` | Stored information or understanding |
| `resource` | A tool, skill, capability, or reference |
| `identity` | Who or what this tree represents, its values, its constraints |

Type is a free-form string. Custom types are valid. `null` means untyped. Lands MUST accept any type string. The six core types are a shared vocabulary for interop. Lands SHOULD NOT reject unknown types.

Types carry no hardcoded behavior. How agents treat typed nodes is defined by the tree itself through instruction nodes (notes on resource/identity nodes that teach agents what to do).

## AI Interaction Modes

Every land MUST expose three AI interaction endpoints. Each has strict read/write boundaries.

### Chat (read + write + conversation)

```
POST /api/v1/root/:rootId/chat
Body: { "message": "..." }
Response: { "success": true, "answer": "..." }
```

**CAN**: create nodes, read tree, edit values/names/status/type, delete branches, write notes, navigate, restructure
**Returns**: natural conversational response

### Place (write + placement)

```
POST /api/v1/root/:rootId/place
Body: { "message": "..." }
Response: { "success": true, "answer": "..." }
```

**CAN**: create nodes, write notes, edit values, navigate to find placement
**CANNOT**: delete, restructure, respond conversationally beyond confirming placement
**Returns**: placement summary

### Query (read only)

```
POST /api/v1/root/:rootId/query
Body: { "message": "..." }
Response: { "success": true, "answer": "..." }
```

**CAN**: read nodes, notes, values, navigate, search
**CANNOT**: create, edit, delete, or modify anything
**Returns**: natural response based on tree contents

Lands MAY make query available to unauthenticated visitors on public trees.

## Tree Operations

All write operations require authentication unless noted. Core endpoints do not include version segments. Lands that implement versioning (prestige) MAY add versioned routes as an extension.

### Root (Tree-Level)

| Method | Path | Type | Description |
|--------|------|------|-------------|
| GET | /api/v1/root/:rootId | Read | Tree structure |
| POST | /api/v1/root/:rootId/chat | AI | Chat interaction |
| POST | /api/v1/root/:rootId/place | AI | Place content |
| POST | /api/v1/root/:rootId/query | AI | Query tree (MAY be public) |

### Node CRUD

| Method | Path | Type | Description |
|--------|------|------|-------------|
| GET | /api/v1/node/:nodeId | Read | Node data |
| POST | /api/v1/node/:nodeId/createChild | Write | Create child. Body: `{ name, type }` |
| POST | /api/v1/node/:nodeId/delete | Write | Delete node branch |
| POST | /api/v1/node/:nodeId/editType | Write | Set/clear type. Body: `{ type }` |
| POST | /api/v1/node/:nodeId/editName | Write | Rename. Body: `{ name }` |
| POST | /api/v1/node/:nodeId/editStatus | Write | Change status. Body: `{ status }` |
| POST | /api/v1/node/:nodeId/updateParent | Write | Move node. Body: `{ newParentId }` |

### Notes

| Method | Path | Type | Description |
|--------|------|------|-------------|
| GET | /api/v1/node/:nodeId/notes | Read | List notes |
| POST | /api/v1/node/:nodeId/notes | Write | Create note. Body: `{ content }` |
| PUT | /api/v1/node/:nodeId/notes/:noteId | Write | Edit note |
| DELETE | /api/v1/node/:nodeId/notes/:noteId | Write | Delete note |

### Values and Goals

Lands that support values SHOULD expose:

| Method | Path | Type | Description |
|--------|------|------|-------------|
| GET | /api/v1/node/:nodeId/values | Read | Node values and goals |
| POST | /api/v1/node/:nodeId/value | Write | Set value. Body: `{ key, value }` |
| POST | /api/v1/node/:nodeId/goal | Write | Set goal. Body: `{ key, goal }` |

### Transactions

Lands SHOULD support value transactions between nodes.

| Method | Path | Type | Description |
|--------|------|------|-------------|
| GET | /api/v1/node/:nodeId/transactions | Read | List transactions |
| POST | /api/v1/node/:nodeId/transactions | Write | Propose trade |
| POST | /api/v1/node/:nodeId/transactions/:id/approve | Write | Accept trade |
| POST | /api/v1/node/:nodeId/transactions/:id/deny | Write | Reject trade |

Transaction semantics: a trade proposes value movement between two nodes. Both sides must approve. On approval, values transfer atomically. On denial, the trade is removed.

## Contributions

Lands SHOULD log mutations as contribution records. This is a design pattern for auditability, not a strict enforcement.

A contribution record SHOULD contain:

| Field | Type | Description |
|-------|------|-------------|
| `userId` | string | Who made the change |
| `nodeId` | string | What was changed |
| `action` | string | What happened (create, edit, delete, etc.) |
| `date` | date | When it happened |
| `wasAi` | boolean | Whether an AI agent made the change |

Lands MAY extend the contribution schema with additional metadata.

## User Operations

| Method | Path | Type | Description |
|--------|------|------|-------------|
| GET | /api/v1/user/:userId | Read | User profile |
| POST | /api/v1/user/:userId/createRoot | Write | Create tree. Body: `{ name, type }` |
| POST | /api/v1/root/:rootId/invite | Write | Invite collaborator |
| POST | /api/v1/root/:rootId/remove-user | Write | Remove collaborator |

## LLM Assignments

Lands MUST support per-tree LLM routing. Each tree can assign different models to different stages of AI interaction.

| Method | Path | Type | Description |
|--------|------|------|-------------|
| POST | /api/v1/root/:rootId/llm-assign | Write | Assign LLM to slot. Body: `{ slot, connectionId }` |

Slots define which model handles which stage. Lands SHOULD support at minimum a default slot.

## Gateway

Lands MUST support gateway channels for external input and output. Gateway is the interface through which agents and trees reach the outside world and receive input from it. The specific platforms (Telegram, Discord, etc.) are implementation choices.

| Method | Path | Type | Description |
|--------|------|------|-------------|
| GET | /api/v1/root/:rootId/gateway/channels | Read | List channels |
| POST | /api/v1/root/:rootId/gateway/channels | Write | Create channel |
| PUT | /api/v1/root/:rootId/gateway/channels/:id | Write | Update channel |
| DELETE | /api/v1/root/:rootId/gateway/channels/:id | Write | Delete channel |

## Federation (Canopy Protocol)

The Canopy protocol enables land-to-land discovery and collaboration. Every land MUST implement these endpoints so other lands can discover and connect. A land MAY choose not to actively peer, but the interface MUST be present.

| Method | Path | Description |
|--------|------|-------------|
| GET | /canopy/info | Land identity: `{ domain, landId, name, version, capabilities }` |
| GET | /canopy/public-trees | Discoverable trees: `[{ name, owner, rootId }]` |
| POST | /canopy/peer/register | Register as peer. Body: `{ landId, domain, publicKey }` |
| POST | /canopy/peer/:id/heartbeat | Health check. Response: `{ ok }` |
| POST | /canopy/peer/:id/invite | Cross-land collaboration invite |
| POST | /canopy/proxy/:path | Proxy request to remote land |

### Discovery

Lands MAY register with a directory service for network-wide discovery. The directory is optional infrastructure, not part of the core protocol.

## Protocol Endpoint

Every land MUST serve:

```
GET /api/v1/protocol
Response: {
  "version": "1.0",
  "capabilities": [
    "chat", "place", "query",
    "canopy", "types", "gateway", "llm-assignments",
    "transactions", "contributions"
  ],
  "nodeTypes": ["goal", "plan", "task", "knowledge", "resource", "identity"],
  "extensions": ["energy", "scripts", "prestige", ...]
}
```

`capabilities` lists core protocol features the land supports.
`extensions` lists optional features beyond the core protocol.
`nodeTypes` lists the types this land recognizes (MUST include the six core types).

## Response Format

All endpoints MUST return JSON.

```json
{ "success": true, ... }
{ "error": "message" }
```

Lands MAY support HTML rendering via `?html` query parameter as an extension.

## Status Codes

- 200: Success
- 201: Created
- 400: Bad request
- 403: Forbidden
- 404: Not found
- 429: Rate limited (MAY be used for public query endpoints)
- 500: Server error
